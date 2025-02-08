// src/services/InitialSyncManager.ts

import { TFile, Vault, Notice } from 'obsidian';
import { ErrorHandler } from '../utils/ErrorHandler';
import { NotificationManager } from '../utils/NotificationManager';
import { QueueService } from './QueueService';
import { SyncFileManager } from './SyncFileManager';
import { MetadataExtractor } from './MetadataExtractor';
import { DocumentMetadata } from '../models/DocumentChunk';

interface InitialSyncOptions {
	batchSize: number;
	maxConcurrentBatches: number;
	enableAutoInitialSync: boolean;
	priorityRules: PriorityRule[];
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

interface SyncProgress {
	totalFiles: number;
	processedFiles: number;
	currentBatch: number;
	totalBatches: number;
	startTime: number;
	estimatedTimeRemaining?: number;
}

export class InitialSyncManager {
	private batches: Map<string, SyncBatch> = new Map();
	private progress: SyncProgress;
	private isRunning: boolean = false;
	private processingTimeout: NodeJS.Timeout | null = null;
	private readonly options: InitialSyncOptions;

	constructor(
		private vault: Vault,
		private queueService: QueueService,
		private syncFileManager: SyncFileManager,
		private metadataExtractor: MetadataExtractor,
		private errorHandler: ErrorHandler,
		private notificationManager: NotificationManager,
		options: Partial<InitialSyncOptions> = {}
	) {
		// Set default options
		this.options = {
			batchSize: 50,
			maxConcurrentBatches: 3,
			enableAutoInitialSync: true,
			priorityRules: [],
			...options
		};

		this.progress = {
			totalFiles: 0,
			processedFiles: 0,
			currentBatch: 0,
			totalBatches: 0,
			startTime: 0
		};
	}

	/**
	 * Start the initial sync process
	 */
	async startSync(): Promise<void> {
		if (this.isRunning) {
			console.log('Initial sync already running');
			return;
		}

		try {
			this.isRunning = true;
			this.progress.startTime = Date.now();

			// Get all markdown files
			const files = this.vault.getMarkdownFiles();
			this.progress.totalFiles = files.length;

			// Create batches
			const sortedFiles = await this.sortFilesByPriority(files);
			const batches = this.createBatches(sortedFiles);
			this.progress.totalBatches = batches.length;

			// Initialize batches
			batches.forEach((batch, index) => {
				this.batches.set(batch.id, {
					...batch,
					status: 'pending',
					progress: 0
				});
			});

			// Start processing batches
			await this.processBatches();

			new Notice('Initial sync completed successfully');
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'InitialSyncManager.startSync'
			});
			new Notice('Initial sync failed. Check console for details.');
		} finally {
			this.isRunning = false;
		}
	}

	/**
	 * Sort files by priority based on rules
	 */
	private async sortFilesByPriority(files: TFile[]): Promise<TFile[]> {
		return files.sort((a, b) => {
			const priorityA = this.getFilePriority(a.path);
			const priorityB = this.getFilePriority(b.path);
			return priorityB - priorityA;
		});
	}

	/**
	 * Get priority for a file based on rules
	 */
	private getFilePriority(path: string): number {
		for (const rule of this.options.priorityRules) {
			if (path.includes(rule.pattern)) {
				return rule.priority;
			}
		}
		return 1; // Default priority
	}

	/**
	 * Create batches of files for processing
	 */
	private createBatches(files: TFile[]): SyncBatch[] {
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
	 * Process batches of files
	 */
	private async processBatches(): Promise<void> {
		const activeBatches = new Set<string>();

		// Process batches until all are complete
		while (this.hasUnprocessedBatches() && this.isRunning) {
			// Get next batch if we have capacity
			if (activeBatches.size < this.options.maxConcurrentBatches) {
				const nextBatch = this.getNextPendingBatch();
				if (nextBatch) {
					activeBatches.add(nextBatch.id);
					this.processBatch(nextBatch)
						.then(() => {
							activeBatches.delete(nextBatch.id);
						})
						.catch((error) => {
							this.errorHandler.handleError(error, {
								context: 'InitialSyncManager.processBatch',
								metadata: { batchId: nextBatch.id }
							});
							activeBatches.delete(nextBatch.id);
						});
				}
			}

			// Wait before checking again
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	/**
	 * Process a single batch of files
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

					// Update progress notification
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
	 * Process a single file
	 */
	// In InitialSyncManager.ts, modify the processFile method:
	private async processFile(file: TFile): Promise<void> {
		try {
			// Extract metadata
			const metadata = await this.metadataExtractor.extractMetadata(file);

			// Create or update frontmatter
			await this.updateFrontmatter(file, metadata);

			// Calculate file hash once
			const fileHash = await this.calculateFileHash(file);

			// Update initial sync status
			await this.syncFileManager.updateSyncStatus(file.path, 'PENDING', {
				lastModified: file.stat.mtime,
				hash: fileHash
			});

			// Queue file for processing and wait for completion
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
					// Update sync status to OK after successful processing
					await this.syncFileManager.updateSyncStatus(file.path, 'OK', {
						lastModified: file.stat.mtime,
						hash: fileHash
					});
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
	 * Calculate file hash
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
	 * Update file frontmatter with sync information
	 */
	private async updateFrontmatter(file: TFile, metadata: DocumentMetadata): Promise<void> {
		const content = await this.vault.read(file);

		// Extract existing frontmatter
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		const frontmatter = frontmatterMatch
			? this.parseFrontmatter(frontmatterMatch[1])
			: {};

		// Update sync metadata
		frontmatter.vectorized_last = new Date().toISOString();
		frontmatter.vectorized_version = '1.0';

		// Create new frontmatter string
		const newFrontmatter = Object.entries(frontmatter)
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			.join('\n');

		// Update file content
		const newContent = frontmatterMatch
			? content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFrontmatter}\n---`)
			: `---\n${newFrontmatter}\n---\n\n${content}`;

		await this.vault.modify(file, newContent);
	}

	/**
	 * Parse frontmatter YAML
	 */
	private parseFrontmatter(yaml: string): Record<string, any> {
		try {
			const frontmatter: Record<string, any> = {};
			const lines = yaml.split('\n');

			for (const line of lines) {
				const [key, ...valueParts] = line.split(':');
				if (key && valueParts.length) {
					frontmatter[key.trim()] = valueParts.join(':').trim();
				}
			}

			return frontmatter;
		} catch (error) {
			console.warn('Error parsing frontmatter:', error);
			return {};
		}
	}

	/**
	 * Update progress notification
	 */
	private updateProgressNotification(): void {
		const progress = this.calculateProgress();
		this.notificationManager.updateProgress({
			taskId: 'initial-sync',
			progress: progress.percentage,
			currentStep: `Processing files (${this.progress.processedFiles}/${this.progress.totalFiles})`,
			totalSteps: this.progress.totalBatches,
			currentStepNumber: this.progress.currentBatch + 1,
			estimatedTimeRemaining: progress.estimatedTimeRemaining,
			details: {
				processedFiles: this.progress.processedFiles,
				totalFiles: this.progress.totalFiles
			}
		});
	}

	/**
	 * Calculate current progress and estimated time remaining
	 */
	private calculateProgress(): { percentage: number; estimatedTimeRemaining: number } {
		const percentage = (this.progress.processedFiles / this.progress.totalFiles) * 100;

		// Calculate estimated time remaining
		const elapsed = Date.now() - this.progress.startTime;
		const filesPerMs = this.progress.processedFiles / elapsed;
		const remainingFiles = this.progress.totalFiles - this.progress.processedFiles;
		const estimatedTimeRemaining = filesPerMs > 0
			? remainingFiles / filesPerMs
			: 0;

		return {
			percentage,
			estimatedTimeRemaining
		};
	}

	/**
	 * Check if there are unprocessed batches
	 */
	private hasUnprocessedBatches(): boolean {
		return Array.from(this.batches.values()).some(
			batch => batch.status === 'pending' || batch.status === 'processing'
		);
	}

	/**
	 * Get next pending batch
	 */
	private getNextPendingBatch(): SyncBatch | null {
		return Array.from(this.batches.values()).find(
			batch => batch.status === 'pending'
		) || null;
	}

	/**
	 * Stop the sync process
	 */
	stop(): void {
		this.isRunning = false;
		if (this.processingTimeout) {
			clearTimeout(this.processingTimeout);
			this.processingTimeout = null;
		}
	}

	/**
	 * Get current sync progress
	 */
	getProgress(): SyncProgress {
		return { ...this.progress };
	}

	/**
	 * Update sync options
	 */
	updateOptions(options: Partial<InitialSyncOptions>): void {
		Object.assign(this.options, options);
	}
}
