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
		private syncFileManager: SyncFileManager,
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
	 * Filter files based on exclusion rules
	 */
	private filterExcludedFiles(files: TFile[]): TFile[] {
		console.log(`[InitialSyncManager.filterExcludedFiles] Filtering ${files.length} files`);

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

			// First explicitly check for sync files
			if (
				filePath === syncFilePath ||
				filePath === '_mindmatrixsync.md' ||
				filePath === '_mindmatrixsync.md.backup'
			) {
				console.log(`[InitialSyncManager.filterExcludedFiles] Excluding sync file: ${filePath}`);
				return false;
			}

			// Check excluded files
			if (exclusions.excludedFiles && exclusions.excludedFiles.includes(fileName)) {
				console.log(`[InitialSyncManager.filterExcludedFiles] Excluding file on exclusion list: ${fileName}`);
				return false;
			}

			// Check excluded folders
			if (exclusions.excludedFolders) {
				for (const folder of exclusions.excludedFolders) {
					const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
					if (filePath.startsWith(normalizedFolder)) {
						console.log(`[InitialSyncManager.filterExcludedFiles] Excluding file in excluded folder: ${filePath}`);
						return false;
					}
				}
			}

			// Check excluded file types
			if (exclusions.excludedFileTypes) {
				for (const fileType of exclusions.excludedFileTypes) {
					if (filePath.toLowerCase().endsWith(fileType.toLowerCase())) {
						console.log(`[InitialSyncManager.filterExcludedFiles] Excluding file with excluded type: ${filePath}`);
						return false;
					}
				}
			}

			// Check excluded file prefixes
			if (exclusions.excludedFilePrefixes) {
				for (const prefix of exclusions.excludedFilePrefixes) {
					if (fileName.startsWith(prefix)) {
						console.log(`[InitialSyncManager.filterExcludedFiles] Excluding file with excluded prefix: ${fileName}`);
						return false;
					}
				}
			}

			return true;
		});
	}

	/**
	 * Start the initial sync process.
	 * Scans all markdown files in the vault and updates their status in the database.
	 * If interrupted, resumes from the last processed file.
	 */
	async startSync(): Promise<void> {
		if (this.isRunning) {
			console.log('Initial sync already running');
			return;
		}
		try {
			this.isRunning = true;
			this.progress.startTime = Date.now();
			console.log('[InitialSyncManager] Starting to collect files for initial sync');

			// Get all markdown files from the vault
			const allFiles = this.vault.getMarkdownFiles();
			console.log(`[InitialSyncManager] Collected ${allFiles.length} total markdown files from vault`);

			// Filter out excluded files
			const files = this.filterExcludedFiles(allFiles);
			console.log(`[InitialSyncManager] After exclusion filtering: ${files.length} files remain`);

			// Additional logging for verification
			const syncFilePath = this.options.syncFilePath || '_mindmatrixsync.md';
			console.log(`[InitialSyncManager] Sync file path being excluded: ${syncFilePath}`);
			console.log('[InitialSyncManager] Sample of filtered files:', files.slice(0, 5).map(f => f.path));

			// Verify sync file is not included
			const syncFileIncluded = files.some(file =>
				file.path === syncFilePath ||
				file.path === '_mindmatrixsync.md' ||
				file.path === '_mindmatrixsync.md.backup'
			);
			console.log(`[InitialSyncManager] Is sync file included in filtered files? ${syncFileIncluded}`);

			this.resumeFileList = await this.sortFilesByPriority(files);
			this.progress.totalFiles = this.resumeFileList.length;
			// Create batches based on resumeFileList and lastProcessedIndex
			this.batches = this.createBatches(this.resumeFileList.slice(this.lastProcessedIndex));
			this.progress.totalBatches = this.batches.length;
			console.log(`Starting initial sync: ${this.progress.totalFiles} files in ${this.batches.length} batches.`);
			// Process each batch concurrently with a limit
			await this.processBatches();
			new Notice('Initial sync completed successfully');
			// Reset resume index upon successful completion
			this.lastProcessedIndex = 0;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'InitialSyncManager.startSync' });
			new Notice('Initial sync failed. Check console for details.');
			// Retain lastProcessedIndex so that a subsequent sync can resume from where it left off.
		} finally {
			this.isRunning = false;
		}
	}

	/**
	 * Sort files by priority based on rules.
	 */
	private async sortFilesByPriority(files: TFile[]): Promise<TFile[]> {
		return files.sort((a, b) => {
			const priorityA = this.getFilePriority(a.path);
			const priorityB = this.getFilePriority(b.path);
			return priorityB - priorityA;
		});
	}

	/**
	 * Determine the processing priority for a file.
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
		console.log(`[InitialSyncManager.createBatches] Creating batches from ${files.length} files`);

		// Double-check for sync file as a safety measure
		const syncFilePath = this.options.syncFilePath || '_mindmatrixsync.md';
		const syncFileIncluded = files.some(file =>
			file.path === syncFilePath ||
			file.path === '_mindmatrixsync.md' ||
			file.path === '_mindmatrixsync.md.backup'
		);

		if (syncFileIncluded) {
			console.log(`[InitialSyncManager.createBatches] WARNING: Sync file is still in the file list at batching stage`);
			// Additional safety: filter here too
			files = files.filter(file =>
				file.path !== syncFilePath &&
				file.path !== '_mindmatrixsync.md' &&
				file.path !== '_mindmatrixsync.md.backup'
			);
			console.log(`[InitialSyncManager.createBatches] Filtered out sync file, now have ${files.length} files`);
		}

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
	 * Also updates resume progress in case of interruption.
	 */
	private async processBatches(): Promise<void> {
		const activeBatches = new Set<string>();
		for (const batch of this.batches) {
			while (activeBatches.size >= this.options.maxConcurrentBatches) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			activeBatches.add(batch.id);
			this.processBatch(batch)
				.then(() => {
					activeBatches.delete(batch.id);
					// Update resume index after batch completes
					this.lastProcessedIndex += batch.files.length;
				})
				.catch(error => {
					this.errorHandler.handleError(error, {
						context: 'InitialSyncManager.processBatch',
						metadata: { batchId: batch.id }
					});
					activeBatches.delete(batch.id);
					// Optionally, mark batch as failed or retry later
				});
		}
		// Wait for all batches to complete
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
			for (const file of batch.files) {
				try {
					await this.processFile(file);
					this.progress.processedFiles++;
					batch.progress = (this.progress.processedFiles / this.progress.totalFiles) * 100;
					this.updateProgressNotification();
				} catch (error) {
					this.errorHandler.handleError(error, {
						context: 'InitialSyncManager.processFile',
						metadata: { filePath: file.path }
					});
				}
			}
			batch.status = 'completed';
			batch.endTime = Date.now();
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
			console.log(`[InitialSyncManager.processFile] Processing file: ${file.path}`);

			// Final safety check before processing
			const syncFilePath = this.options.syncFilePath || '_mindmatrixsync.md';
			if (file.path === syncFilePath ||
				file.path === '_mindmatrixsync.md' ||
				file.path === '_mindmatrixsync.md.backup') {
				console.log(`[InitialSyncManager.processFile] SKIPPING sync file: ${file.path}`);
				return; // Skip processing entirely
			}

			// Extract metadata
			const metadata = await this.metadataExtractor.extractMetadata(file);
			// Calculate file hash for change detection
			const fileHash = await this.calculateFileHash(file);
			// Update file status in the database via Supabase if available, else fallback to sync file
			if (this.supabaseService) {
				await this.supabaseService.updateFileVectorizationStatus(metadata);
			} else {
				// Fallback: update sync file status (assuming updateSyncStatus method exists)
				await this.syncFileManager.updateSyncStatus(file.path, 'PENDING', {
					lastModified: file.stat.mtime,
					hash: fileHash
				});
			}
			// Queue file processing (e.g., for embedding generation)
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
					// After processing, mark file as 'OK' in the database or sync file.
					if (this.supabaseService) {
						await this.supabaseService.updateFileVectorizationStatus(metadata);
					} else {
						await this.syncFileManager.updateSyncStatus(file.path, 'OK', {
							lastModified: file.stat.mtime,
							hash: fileHash
						});
					}
					resolve();
				}).catch(reject);
			});
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'InitialSyncManager.processFile',
				metadata: { filePath: file.path }
			});
			throw error;
		}
	}

	/**
	 * Calculate SHA-256 hash of a file's content.
	 */
	private async calculateFileHash(file: TFile): Promise<string> {
		const content = await this.vault.read(file);
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const buffer = await crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(buffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
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
	 * Update sync progress notifications.
	 */
	private updateProgressNotificationBatch(): void {
		this.updateProgressNotification();
	}

	/**
	 * Stop the initial sync process.
	 */
	stop(): void {
		this.isRunning = false;
		if (this.processingTimeout) {
			clearTimeout(this.processingTimeout);
			this.processingTimeout = null;
		}
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
