// src/services/InitialSyncManager.ts
import { TFile, Vault, Notice } from 'obsidian';
import { ErrorHandler } from '../utils/ErrorHandler';
import { NotificationManager } from '../utils/NotificationManager';
import { QueueService } from './QueueService';
import { SyncFileManager } from './SyncFileManager';
import { MetadataExtractor } from './MetadataExtractor';
import { SupabaseService } from './SupabaseService';

interface InitialSyncOptions {
	batchSize: number;
	maxConcurrentBatches: number;
	enableAutoInitialSync: boolean;
	priorityRules: PriorityRule[];
	syncFilePath?: string;
	exclusions?: {
		excludedFolders: string[];
		excludedFileTypes: string[];
		excludedFilePrefixes: string[];
		excludedFiles: string[];
	};
}

interface PriorityRule {
	pattern: string;
	priority: number;
}

interface SyncBatch {
	id: string;
	files: TFile[];
	status: 'pending' | 'processing' | 'completed' | 'failed';
	progress: number;
	startTime?: number;
	endTime?: number;
}

export interface SyncProgress {
	totalFiles: number;
	processedFiles: number;
	currentBatch: number;
	totalBatches: number;
	startTime: number;
	estimatedTimeRemaining?: number;
}

export class InitialSyncManager {
	private batches: SyncBatch[] = [];
	private progress: SyncProgress;
	private isRunning: boolean = false;
	private lastProcessedIndex: number = 0; // For resuming interrupted syncs
	private processingTimeout: NodeJS.Timeout | null = null;
	private readonly options: InitialSyncOptions;
	private supabaseService: SupabaseService | null;
	private resumeFileList: TFile[] = [];

	constructor(
		private vault: Vault,
		private queueService: QueueService,
		private syncManager: SyncFileManager,
		private metadataExtractor: MetadataExtractor,
		private errorHandler: ErrorHandler,
		private notificationManager: NotificationManager,
		supabaseService: SupabaseService | null,
		options: Partial<InitialSyncOptions> = {}
	) {
		this.options = {
			batchSize: 50,
			maxConcurrentBatches: 3,
			enableAutoInitialSync: true,
			priorityRules: [],
			syncFilePath: '_mindmatrixsync.md',
			exclusions: {
				excludedFolders: [],
				excludedFileTypes: [],
				excludedFilePrefixes: [],
				excludedFiles: []
			},
			...options
		};
		this.progress = {
			totalFiles: 0,
			processedFiles: 0,
			currentBatch: 0,
			totalBatches: 0,
			startTime: 0
		};
		this.supabaseService = supabaseService;
	}

	/**
	 * Filters files based on exclusion rules.
	 */
	private filterExcludedFiles(files: TFile[]): TFile[] {
		const syncFilePath = this.options.syncFilePath || '_mindmatrixsync.md';
		const exclusions = this.options.exclusions || {
			excludedFolders: [],
			excludedFileTypes: [],
			excludedFilePrefixes: [],
			excludedFiles: []
		};

		return files.filter(file => {
			const filePath = file.path;
			const fileName = file.name;
			// Exclude sync files explicitly
			if (
				filePath === syncFilePath ||
				filePath === '_mindmatrixsync.md' ||
				filePath === '_mindmatrixsync.md.backup'
			) {
				return false;
			}
			if (exclusions.excludedFiles.includes(fileName)) return false;
			if (exclusions.excludedFolders.some(folder => filePath.startsWith(folder.endsWith('/') ? folder : folder + '/'))) return false;
			if (exclusions.excludedFileTypes.some(ext => filePath.toLowerCase().endsWith(ext.toLowerCase()))) return false;
			if (exclusions.excludedFilePrefixes.some(prefix => fileName.startsWith(prefix))) return false;
			return true;
		});
	}

	/**
	 * Starts the initial sync process.
	 * Scans all markdown files in the vault and updates their status in the database.
	 * Resumes from the last processed file if the sync is interrupted.
	 */
	async startSync(): Promise<void> {
		if (this.isRunning) {
			console.log('Initial sync already running');
			return;
		}
		try {
			this.isRunning = true;
			this.progress.startTime = Date.now();
			console.log('Starting initial sync...');

			// Get and filter all markdown files
			const allFiles = this.vault.getMarkdownFiles();
			const files = this.filterExcludedFiles(allFiles);
			this.resumeFileList = await this.sortFilesByPriority(files);
			this.progress.totalFiles = this.resumeFileList.length;
			console.log(`Total files to sync: ${this.progress.totalFiles}`);

			// Create batches from the files starting from lastProcessedIndex
			this.batches = this.createBatches(this.resumeFileList.slice(this.lastProcessedIndex));
			this.progress.totalBatches = this.batches.length;
			console.log(`Created ${this.progress.totalBatches} batches for syncing`);

			// Process each batch concurrently with a limit
			await this.processBatches();

			new Notice('Initial sync completed successfully');
			console.log('Initial sync completed');
			// Reset resume index on success
			this.lastProcessedIndex = 0;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'InitialSyncManager.startSync' });
			new Notice('Initial sync failed. Check console for details.');
			// Resume from the last processed index on failure
		} finally {
			this.isRunning = false;
		}
	}

	/**
	 * Sort files by priority based on rules.
	 * Files matching higher priority rules are sorted to the front.
	 */
	private async sortFilesByPriority(files: TFile[]): Promise<TFile[]> {
		return files.sort((a, b) => {
			const priorityA = this.getFilePriority(a.path);
			const priorityB = this.getFilePriority(b.path);
			console.log(`Priority for ${a.path}: ${priorityA}, ${b.path}: ${priorityB}`);
			return priorityB - priorityA;
		});
	}

	/**
	 * Determine the processing priority for a file.
	 * Returns the highest matching rule priority or defaults to 1.
	 */
	private getFilePriority(path: string): number {
		for (const rule of this.options.priorityRules) {
			if (path.includes(rule.pattern)) {
				return rule.priority;
			}
		}
		return 1;
	}

	/**
	 * Create batches of files for processing.
	 */
	private createBatches(files: TFile[]): SyncBatch[] {
		const syncFilePath = this.options.syncFilePath || '_mindmatrixsync.md';
		// Ensure sync file is not included
		files = files.filter(file => file.path !== syncFilePath && file.path !== '_mindmatrixsync.md' && file.path !== '_mindmatrixsync.md.backup');
		const batches: SyncBatch[] = [];
		for (let i = 0; i < files.length; i += this.options.batchSize) {
			const batchFiles = files.slice(i, i + this.options.batchSize);
			batches.push({
				id: `batch-${Math.floor(i / this.options.batchSize)}`,
				files: batchFiles,
				status: 'pending',
				progress: 0
			});
		}
		return batches;
	}

	/**
	 * Process batches concurrently with a limit.
	 * Updates resume progress in case of interruption.
	 */
	private async processBatches(): Promise<void> {
		const activeBatches = new Set<string>();
		for (const batch of this.batches) {
			// Wait until active batches are below the concurrent limit
			while (activeBatches.size >= this.options.maxConcurrentBatches) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			activeBatches.add(batch.id);
			this.processBatch(batch)
				.then(() => {
					activeBatches.delete(batch.id);
					// Update resume index after batch completes
					this.lastProcessedIndex += batch.files.length;
					console.log(`Completed ${batch.id}, resuming at index ${this.lastProcessedIndex}`);
				})
				.catch(error => {
					this.errorHandler.handleError(error, { context: 'InitialSyncManager.processBatch', metadata: { batchId: batch.id } });
					activeBatches.delete(batch.id);
				});
		}
		// Wait until all batches are processed
		while (activeBatches.size > 0) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	/**
	 * Process a single batch of files.
	 */
	private async processBatch(batch: SyncBatch): Promise<void> {
		try {
			batch.status = 'processing';
			batch.startTime = Date.now();
			console.log(`Processing ${batch.id} with ${batch.files.length} files`);
			for (const file of batch.files) {
				try {
					await this.processFile(file);
					this.progress.processedFiles++;
					batch.progress = (this.progress.processedFiles / this.progress.totalFiles) * 100;
					this.updateProgressNotification();
				} catch (error) {
					this.errorHandler.handleError(error, { context: 'InitialSyncManager.processFile', metadata: { filePath: file.path } });
				}
			}
			batch.status = 'completed';
			batch.endTime = Date.now();
			console.log(`Batch ${batch.id} completed in ${batch.endTime - (batch.startTime || 0)} ms`);
		} catch (error) {
			batch.status = 'failed';
			throw error;
		}
	}

	/**
	 * Process a single file.
	 * Extracts metadata, calculates file hash, and updates its status.
	 */
	private async processFile(file: TFile): Promise<void> {
		try {
			// Skip sync file if somehow reached here
			const syncFilePath = this.options.syncFilePath || '_mindmatrixsync.md';
			if (file.path === syncFilePath || file.path === '_mindmatrixsync.md' || file.path === '_mindmatrixsync.md.backup') {
				return;
			}
			const metadata = await this.metadataExtractor.extractMetadata(file);
			const fileHash = await this.calculateFileHash(file);
			// Update file status in the database if available; else, update sync file status.
			if (this.supabaseService) {
				await this.supabaseService.updateFileVectorizationStatus(metadata);
			} else {
				await this.syncManager.updateSyncStatus(file.path, 'PENDING', {
					lastModified: file.stat.mtime,
					hash: fileHash
				});
			}
			// Queue file processing for further steps (like embedding generation)
			await new Promise<void>((resolve, reject) => {
				this.queueService.addTask({
					id: file.path,
					type: 'CREATE',
					priority: this.getFilePriority(file.path),
					maxRetries: 3,
					retryCount: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					status: 'PENDING',
					metadata,
					data: {}
				}).then(async () => {
					// Mark file as processed in the database or sync file.
					if (this.supabaseService) {
						await this.supabaseService.updateFileVectorizationStatus(metadata);
					} else {
						await this.syncManager.updateSyncStatus(file.path, 'OK', {
							lastModified: file.stat.mtime,
							hash: fileHash
						});
					}
					resolve();
				}).catch(reject);
			});
			console.log(`Processed file: ${file.path}`);
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'InitialSyncManager.processFile', metadata: { filePath: file.path } });
			throw error;
		}
	}

	/**
	 * Calculate SHA-256 hash of a file's content.
	 */
	private async calculateFileHash(file: TFile): Promise<string> {
		try {
			const content = await this.vault.read(file);
			const encoder = new TextEncoder();
			const data = encoder.encode(content);
			const buffer = await crypto.subtle.digest('SHA-256', data);
			return Array.from(new Uint8Array(buffer))
				.map(b => b.toString(16).padStart(2, '0'))
				.join('');
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'InitialSyncManager.calculateFileHash', metadata: { filePath: file.path } });
			return '';
		}
	}

	/**
	 * Update progress notifications.
	 */
	private updateProgressNotification(): void {
		const progressPercentage = (this.progress.processedFiles / this.progress.totalFiles) * 100;
		this.notificationManager.updateProgress({
			taskId: 'initial-sync',
			progress: progressPercentage,
			currentStep: `Processing files (${this.progress.processedFiles}/${this.progress.totalFiles})`,
			totalSteps: this.progress.totalBatches,
			currentStepNumber: this.progress.currentBatch + 1,
			estimatedTimeRemaining: this.calculateEstimatedTimeRemaining(),
			details: {
				processedFiles: this.progress.processedFiles,
				totalFiles: this.progress.totalFiles
			}
		});
	}

	/**
	 * Calculate estimated time remaining based on progress.
	 */
	private calculateEstimatedTimeRemaining(): number {
		const elapsed = Date.now() - this.progress.startTime;
		const filesPerMs = this.progress.processedFiles / elapsed;
		const remainingFiles = this.progress.totalFiles - this.progress.processedFiles;
		return filesPerMs > 0 ? remainingFiles / filesPerMs : 0;
	}

	/**
	 * Stops the initial sync process.
	 */
	stop(): void {
		this.isRunning = false;
		if (this.processingTimeout) {
			clearTimeout(this.processingTimeout);
			this.processingTimeout = null;
		}
		new Notice('Initial sync stopped');
	}

	/**
	 * Get current sync progress.
	 */
	getProgress(): SyncProgress {
		return { ...this.progress };
	}

	/**
	 * Update sync options.
	 */
	updateOptions(options: Partial<InitialSyncOptions>): void {
		Object.assign(this.options, options);
	}
}
