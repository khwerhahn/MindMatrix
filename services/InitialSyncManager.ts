// src/services/InitialSyncManager.ts
import { TFile, Vault, Notice } from 'obsidian';
import pLimit from 'p-limit';
import { ErrorHandler } from '../utils/ErrorHandler';
import { NotificationManager } from '../utils/NotificationManager';
import { QueueService } from './QueueService';
import { EmbeddingService } from './EmbeddingService';
import { SyncFileManager } from './SyncFileManager';
import { MetadataExtractor } from './MetadataExtractor';
import { SupabaseService } from './SupabaseService';
import { DocumentMetadata } from '../models/DocumentChunk';
import { ProcessingTask, TaskStatus, TaskType } from '../models/ProcessingTask';

interface ThrottlingControls {
        minBatchSize: number;
        maxBatchSize: number;
        targetBatchDurationMs: number;
        throttleDelayMs: number;
        progressIntervalMs: number;
}

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
        throttling: ThrottlingControls;
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
        private embeddingService: EmbeddingService | null;
        private embeddingWarningShown = false;
        private adaptiveBatchSize: number;
        private completedBatchCount: number = 0;
        private rafScheduled = false;
        private rafFallbackTimer: NodeJS.Timeout | null = null;
        private pendingFileMetadata: Map<string, { metadata: DocumentMetadata; hash: string; lastModified: number }> = new Map();
        private queueEventUnsubscribers: Array<() => void> = [];

        constructor(
                private vault: Vault,
                private queueService: QueueService,
                embeddingService: EmbeddingService | null,
                private syncManager: SyncFileManager,
                private metadataExtractor: MetadataExtractor,
                private errorHandler: ErrorHandler,
		private notificationManager: NotificationManager,
                supabaseService: SupabaseService | null,
                options: Partial<Omit<InitialSyncOptions, 'throttling'>> & { throttling?: Partial<ThrottlingControls> } = {}
        ) {
                const defaultThrottling: ThrottlingControls = {
                        minBatchSize: 10,
                        maxBatchSize: 200,
                        targetBatchDurationMs: 2000,
                        throttleDelayMs: 0,
                        progressIntervalMs: 16
                };
                const { throttling: throttlingOverrides, ...restOptions } = options;
                this.options = {
                        batchSize: 50,
                        maxConcurrentBatches: 3,
                        enableAutoInitialSync: true,
                        priorityRules: [],
                        syncFilePath: '_obsidianragsync.md',
			exclusions: {
				excludedFolders: [],
				excludedFileTypes: [],
				excludedFilePrefixes: [],
				excludedFiles: []
                        },
                        throttling: defaultThrottling,
                        ...restOptions
                };
                if (throttlingOverrides) {
                        this.options.throttling = { ...defaultThrottling, ...throttlingOverrides };
                }
                this.progress = {
                        totalFiles: 0,
                        processedFiles: 0,
                        currentBatch: 0,
                        totalBatches: 0,
                        startTime: 0
                };
                this.supabaseService = supabaseService;
                this.embeddingService = embeddingService;
                this.adaptiveBatchSize = this.options.batchSize;
                this.registerQueueEventHandlers();
        }

        private registerQueueEventHandlers(): void {
                const completedUnsub = this.queueService.on('task-completed', async ({ task }: { task: ProcessingTask }) => {
                        await this.handleTaskCompleted(task);
                });
                const failedUnsub = this.queueService.on(
                        'task-failed',
                        async ({ task, error }: { task: ProcessingTask; error: unknown }) => {
                                await this.handleTaskFailed(task, error);
                        }
                );
                this.queueEventUnsubscribers.push(completedUnsub, failedUnsub);
        }

        private async handleTaskCompleted(task: ProcessingTask): Promise<void> {
                const pending = this.pendingFileMetadata.get(task.id);
                if (pending) {
                        this.pendingFileMetadata.delete(task.id);
                        if (!this.supabaseService) {
                                try {
                                        await this.syncManager.updateSyncStatus(task.id, 'OK', {
                                                lastModified: pending.lastModified,
                                                hash: pending.hash
                                        });
                                } catch (error) {
                                        this.errorHandler.handleError(error, {
                                                context: 'InitialSyncManager.handleTaskCompleted',
                                                metadata: { filePath: task.id }
                                        });
                                }
                        }
                }
        }

        private async handleTaskFailed(task: ProcessingTask, error: unknown): Promise<void> {
                const pending = this.pendingFileMetadata.get(task.id);
                if (pending) {
                        this.pendingFileMetadata.delete(task.id);
                        if (!this.supabaseService) {
                                try {
                                        await this.syncManager.updateSyncStatus(task.id, 'FAILED', {
                                                lastModified: pending.lastModified,
                                                hash: pending.hash
                                        });
                                } catch (updateError) {
                                        this.errorHandler.handleError(updateError, {
                                                context: 'InitialSyncManager.handleTaskFailed',
                                                metadata: { filePath: task.id }
                                        });
                                }
                        }
                }
                if (error instanceof Error) {
                        this.errorHandler.handleError(error, {
                                context: 'InitialSyncManager.queueTaskFailed',
                                metadata: { filePath: task.id }
                        });
                }
        }

	/**
	 * Filters files based on exclusion rules.
	 */
	private filterExcludedFiles(files: TFile[]): TFile[] {
		const syncFilePath = this.options.syncFilePath || '_obsidianragsync.md';
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
				filePath === '_obsidianragsync.md' ||
				filePath === '_obsidianragsync.md.backup'
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
        public async startSync(): Promise<void> {
                try {
                        this.isRunning = true;
                        console.log('[ObsidianRAG] Starting initial sync...');

			// Check if files are already in the database
			if (this.supabaseService) {
				const existingFiles = await this.supabaseService.getFileCount();
				if (existingFiles > 0) {
					console.log('[ObsidianRAG] Files already exist in database, skipping initial sync');
					return;
				}
			}

                        const files = this.vault.getMarkdownFiles();
                        const filteredFiles = this.filterExcludedFiles(files);
                        const filesToSync = filteredFiles.filter(file => !this.isExcluded(file.path));

                        if (filesToSync.length === 0) {
                                console.log('[ObsidianRAG] No files to sync');
                                return;
                        }

                        console.log(`[ObsidianRAG] Total files to sync: ${filesToSync.length}`);

                        const prioritizedFiles = await this.sortFilesByPriority(filesToSync);

                        this.progress.totalFiles = prioritizedFiles.length;
                        this.progress.processedFiles = 0;
                        this.progress.startTime = Date.now();
                        this.progress.currentBatch = 0;
                        this.completedBatchCount = 0;
                        this.adaptiveBatchSize = this.options.batchSize;
                        this.batches = [];
                        this.progress.totalBatches = Math.max(
                                1,
                                Math.ceil(prioritizedFiles.length / Math.max(1, this.options.batchSize))
                        );

                        await this.processFilesAdaptive(prioritizedFiles);
                        console.log('[ObsidianRAG] Initial sync completed');
                } catch (error) {
                        console.error('[ObsidianRAG] Error during initial sync:', error);
                        throw error;
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

        private async processFilesAdaptive(files: TFile[]): Promise<void> {
                if (files.length === 0) {
                        return;
                }
                const concurrency = Math.max(1, this.options.maxConcurrentBatches);
                const limit = pLimit(concurrency);
                const throttling = this.options.throttling;
                let nextIndex = 0;
                let batchCounter = 0;
                const tasks: Promise<void>[] = [];

                const getNextBatch = (): SyncBatch | null => {
                        if (nextIndex >= files.length) {
                                return null;
                        }
                        const normalizedBatchSize = Math.min(
                                throttling.maxBatchSize,
                                Math.max(throttling.minBatchSize, Math.round(this.adaptiveBatchSize))
                        );
                        const remaining = files.length - nextIndex;
                        const size = Math.max(1, Math.min(normalizedBatchSize, remaining));
                        const start = nextIndex;
                        const batchFiles = files.slice(start, start + size);
                        nextIndex += size;
                        const batch: SyncBatch = {
                                id: `batch-${batchCounter++}`,
                                files: batchFiles,
                                status: 'pending',
                                progress: 0
                        };
                        this.batches.push(batch);
                        return batch;
                };

                const workerFactory = (): Promise<void> | null => {
                        const initialBatch = getNextBatch();
                        if (!initialBatch) {
                                return null;
                        }
                        return limit(async () => {
                                let currentBatch: SyncBatch | null = initialBatch;
                                while (currentBatch) {
                                        const duration = await this.processBatch(currentBatch);
                                        this.adjustBatchSize(duration, currentBatch.files.length);
                                        this.completedBatchCount++;
                                        this.progress.currentBatch = this.completedBatchCount;
                                        const remainingFiles = this.progress.totalFiles - this.progress.processedFiles;
                                        const estimatedRemainingBatches = Math.ceil(
                                                remainingFiles / Math.max(1, Math.round(this.adaptiveBatchSize))
                                        );
                                        this.progress.totalBatches = this.completedBatchCount + Math.max(0, estimatedRemainingBatches);
                                        if (throttling.throttleDelayMs > 0) {
                                                await new Promise(resolve => setTimeout(resolve, throttling.throttleDelayMs));
                                        }
                                        currentBatch = getNextBatch();
                                }
                        });
                };

                for (let i = 0; i < concurrency; i++) {
                        const worker = workerFactory();
                        if (worker) {
                                tasks.push(worker);
                        } else {
                                break;
                        }
                }

                await Promise.allSettled(tasks);
        }

        private adjustBatchSize(duration: number, processedCount: number): void {
                if (processedCount === 0 || duration <= 0) {
                        return;
                }
                const throttling = this.options.throttling;
                const target = throttling.targetBatchDurationMs;
                const lowerBound = target * 0.6;
                const upperBound = target * 1.4;
                if (duration < lowerBound && this.adaptiveBatchSize < throttling.maxBatchSize) {
                        this.adaptiveBatchSize = Math.min(
                                throttling.maxBatchSize,
                                Math.max(1, Math.round(this.adaptiveBatchSize * 1.25))
                        );
                } else if (duration > upperBound && this.adaptiveBatchSize > throttling.minBatchSize) {
                        this.adaptiveBatchSize = Math.max(
                                throttling.minBatchSize,
                                Math.max(1, Math.round(this.adaptiveBatchSize * 0.8))
                        );
                }
        }

        /**
         * Process a single batch of files.
         */
        private async processBatch(batch: SyncBatch): Promise<number> {
                try {
                        batch.status = 'processing';
                        const startTime = Date.now();
                        batch.startTime = startTime;
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
                        const duration = batch.endTime - startTime;
                        console.log(`Batch ${batch.id} completed in ${duration} ms`);
                        return duration;
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
                        const syncFilePath = this.options.syncFilePath || '_obsidianragsync.md';
                        if (file.path === syncFilePath || file.path === '_obsidianragsync.md' || file.path === '_obsidianragsync.md.backup') {
                                return;
                        }
                        const metadata = await this.metadataExtractor.extractMetadata(file);
                        const fileHash = await this.calculateFileHash(file);
                        metadata.customMetadata = {
                                ...(metadata.customMetadata || {}),
                                contentHash: fileHash
                        };
                        this.pendingFileMetadata.set(file.path, {
                                metadata,
                                hash: fileHash,
                                lastModified: file.stat.mtime
                        });
                        if (this.supabaseService) {
                                await this.supabaseService.updateFileVectorizationStatus(metadata, 'pending');
                        } else {
                                await this.syncManager.updateSyncStatus(file.path, 'PENDING', {
                                        lastModified: file.stat.mtime,
                                        hash: fileHash
                                });
                        }
                        // Queue file processing for further steps (like embedding generation)
                        if (!this.embeddingWarningShown && !this.embeddingService?.isInitialized()) {
                                this.embeddingWarningShown = true;
                                new Notice('No embedding provider configured. Initial sync will queue tasks, but embedding generation may fail until configured.');
                        }
                        const task: ProcessingTask = {
                                id: file.path,
                                type: TaskType.CREATE,
                                priority: this.getFilePriority(file.path),
                                maxRetries: 3,
                                retryCount: 0,
                                createdAt: Date.now(),
                                updatedAt: Date.now(),
                                status: TaskStatus.QUEUED_DURING_INIT,
                                metadata,
                                data: {}
                        };
                        await this.queueService.addTask(task);
                        console.log(`Processed file: ${file.path}`);
                } catch (error) {
                        this.pendingFileMetadata.delete(file.path);
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
                if (this.progress.totalFiles === 0) {
                        return;
                }
                if (this.rafScheduled) {
                        return;
                }
                this.rafScheduled = true;
                const useAnimationFrame =
                        typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
                if (useAnimationFrame) {
                        window.requestAnimationFrame(() => this.flushProgressUpdate());
                } else {
                        if (this.rafFallbackTimer) {
                                clearTimeout(this.rafFallbackTimer);
                        }
                        const interval = Math.max(16, this.options.throttling.progressIntervalMs);
                        this.rafFallbackTimer = setTimeout(() => this.flushProgressUpdate(), interval);
                }
        }

        private flushProgressUpdate(): void {
                if (this.rafFallbackTimer) {
                        clearTimeout(this.rafFallbackTimer);
                        this.rafFallbackTimer = null;
                }
                this.rafScheduled = false;
                if (this.progress.totalFiles === 0) {
                        return;
                }
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
                if (elapsed <= 0 || this.progress.processedFiles === 0) {
                        return 0;
                }
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
        updateOptions(
                options: Partial<Omit<InitialSyncOptions, 'throttling'>> & { throttling?: Partial<ThrottlingControls> }
        ): void {
                if (options.throttling) {
                        this.updateThrottlingControls(options.throttling);
                }
                const { throttling, ...rest } = options;
                Object.assign(this.options, rest);
                if (typeof rest.batchSize === 'number' && rest.batchSize > 0) {
                        this.adaptiveBatchSize = rest.batchSize;
                }
        }

        getThrottlingControls(): ThrottlingControls {
                return { ...this.options.throttling };
        }

        updateThrottlingControls(controls: Partial<ThrottlingControls>): void {
                this.options.throttling = { ...this.options.throttling, ...controls };
                this.adaptiveBatchSize = Math.min(
                        this.options.throttling.maxBatchSize,
                        Math.max(this.options.throttling.minBatchSize, this.adaptiveBatchSize)
                );
        }

	private isExcluded(path: string): boolean {
		const exclusions = this.options.exclusions || {
			excludedFolders: [],
			excludedFileTypes: [],
			excludedFilePrefixes: [],
			excludedFiles: []
		};

		// Check if file is in an excluded folder
		if (exclusions.excludedFolders.some(folder => path.startsWith(folder))) {
			return true;
		}

		// Check if file has an excluded extension
		const fileExtension = path.split('.').pop()?.toLowerCase();
		if (fileExtension && exclusions.excludedFileTypes.includes(fileExtension)) {
			return true;
		}

		// Check if file starts with an excluded prefix
		if (exclusions.excludedFilePrefixes.some(prefix => path.startsWith(prefix))) {
			return true;
		}

		// Check if file is in the specific files list
		if (exclusions.excludedFiles.includes(path)) {
			return true;
		}

		return false;
	}
}
