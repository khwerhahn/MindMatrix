// src/services/QueueService.ts
import { Vault, TFile } from 'obsidian';
import { TextSplitter, ChunkingOptions } from '../utils/TextSplitter';
import {
        ProcessingTask,
        TaskStatus,
        TaskType,
        QueueStats,
        TaskProcessingError
} from '../models/ProcessingTask';
import { DocumentChunk, DocumentMetadata } from '../models/DocumentChunk';
import { ErrorHandler } from '../utils/ErrorHandler';
import { NotificationManager } from '../utils/NotificationManager';
import { SupabaseService } from './SupabaseService';
import { EmbeddingService } from './EmbeddingService';
import { Neo4jService } from './Neo4jService';
import { EntityExtractor } from './EntityExtractor';
import { DEFAULT_CHUNKING_OPTIONS, DEFAULT_HYBRID_STRATEGY, HybridStrategySettings, SyncMode } from '../settings/Settings';
import { HybridRAGService } from './HybridRAGService';
import { EventEmitter } from './EventEmitter';

interface QueueIntegrationOptions {
        vectorSyncEnabled?: boolean;
        graphSyncEnabled?: boolean;
        neo4jService?: Neo4jService | null;
        entityExtractor?: EntityExtractor | null;
        hybridStrategy?: HybridStrategySettings;
        syncMode?: SyncMode;
}

export class QueueService {
        private queue: ProcessingTask[] = [];
        private processingQueue: ProcessingTask[] = [];
        private isProcessing: boolean = false;
        private isStopped: boolean = true;
        private textSplitter: TextSplitter;
        private chunkSettings: ChunkingOptions;
        private vault: Vault;
        // Event emitter for queue events
        private eventEmitter: EventEmitter;
        private readonly maxQueueSize: number = 1000;
        private pendingBackoffTimer: NodeJS.Timeout | null = null;
        private consecutiveFailures: number = 0;
        private readonly baseBackoffDelay = 500;
        private readonly maxBackoffDelay = 30000;
        private servicesUnavailableNoticeShown = false;
        private vectorSyncEnabled: boolean;
        private graphSyncEnabled: boolean;
        private neo4jService: Neo4jService | null;
        private entityExtractor: EntityExtractor | null;
        private hybridRAGService: HybridRAGService;
        private syncMode: SyncMode;

        constructor(
                private maxConcurrent: number,
                private maxRetries: number,
                private supabaseService: SupabaseService | null,
                private embeddingService: EmbeddingService | null,
                private errorHandler: ErrorHandler,
                private notificationManager: NotificationManager,
                vault: Vault,
                chunkSettings?: Partial<ChunkingOptions>,
                integrationOptions: QueueIntegrationOptions = {}
        ) {
                this.vault = vault;
                const validatedChunkSettings: ChunkingOptions = {
                        ...DEFAULT_CHUNKING_OPTIONS,
                        ...chunkSettings,
                };
                this.chunkSettings = validatedChunkSettings;
                try {
                        this.textSplitter = new TextSplitter(
                                this.vault,
                                this.errorHandler,
                                validatedChunkSettings
                        );
                } catch (error) {
                        this.errorHandler.handleError(error, {
                                context: 'QueueService.constructor',
                                metadata: validatedChunkSettings,
                        });
                        throw new Error('Failed to initialize TextSplitter with provided settings.');
                }
                this.eventEmitter = new EventEmitter();
                this.vectorSyncEnabled = integrationOptions.vectorSyncEnabled ?? true;
                this.graphSyncEnabled = integrationOptions.graphSyncEnabled ?? false;
                this.neo4jService = integrationOptions.neo4jService ?? null;
                this.entityExtractor = integrationOptions.entityExtractor ?? null;
                const strategy = integrationOptions.hybridStrategy || DEFAULT_HYBRID_STRATEGY;
                this.hybridRAGService = new HybridRAGService(strategy);
                this.syncMode = integrationOptions.syncMode || 'supabase';
        }

	public start(): void {
                if (!this.isStopped) return;
                this.isStopped = false;
                this.resetBackoff();
                this.scheduleNextProcessing(true);
                // Emit initial queue status
                this.eventEmitter.emit('queue-status', {
                        queueSize: this.queue.length,
                        pendingChanges: 0,
                        processingCount: this.processingQueue.length,
			status: 'processing'
		});
	}

	public stop(): void {
		this.isStopped = true;
		if (this.pendingBackoffTimer) {
			clearTimeout(this.pendingBackoffTimer);
			this.pendingBackoffTimer = null;
		}
		this.eventEmitter.emit('queue-status', {
			queueSize: this.queue.length,
			pendingChanges: 0,
			processingCount: this.processingQueue.length,
			status: 'paused'
		});
	}

	public async addTask(task: ProcessingTask): Promise<void> {
                if (this.queue.length + this.processingQueue.length >= this.maxQueueSize) {
                        throw new Error(TaskProcessingError.QUEUE_FULL);
                }
                console.log('Adding task to queue:', { id: task.id, type: task.type, priority: task.priority });

		// Check for duplicate or conflicting tasks on the same file.
		const existingTaskIndex = this.queue.findIndex(t => t.id === task.id);
		const processingTaskIndex = this.processingQueue.findIndex(t => t.id === task.id);

		if (task.type === TaskType.DELETE) {
			// DELETE tasks get highest priority.
			task.priority = 3;
			if (processingTaskIndex >= 0) {
				const processingTask = this.processingQueue[processingTaskIndex];
				if (processingTask.type !== TaskType.DELETE) {
					console.log(`Conflict in processing for ${task.id}. Marking existing task as CANCELLED.`);
					processingTask.status = TaskStatus.CANCELLED;
				}
			}
			if (existingTaskIndex >= 0) {
				const existingTask = this.queue[existingTaskIndex];
				if (existingTask.type === TaskType.DELETE) {
					console.log(`Duplicate DELETE task for ${task.id}. Ignoring.`);
					return;
				} else {
					console.log(`Replacing existing ${existingTask.type} task for ${task.id} with DELETE task.`);
					this.queue.splice(existingTaskIndex, 1);
				}
			}
			// Unshift to prioritize deletion
			this.queue.unshift(task);
		} else {
			// For CREATE/UPDATE tasks, if a DELETE is pending, skip the update.
			const hasDeleteTask = this.queue.some(t => t.id === task.id && t.type === TaskType.DELETE);
			if (hasDeleteTask) {
				console.log(`Skipping ${task.type} for ${task.id} as DELETE is pending.`);
				return;
			}
			if (existingTaskIndex >= 0) {
				console.log(`Replacing existing task for ${task.id} with new ${task.type} task.`);
				this.queue[existingTaskIndex] = task;
			} else {
				// Add based on priority.
				if (task.priority >= 2) {
					this.queue.unshift(task);
				} else {
					this.queue.push(task);
				}
			}
		}

		// Emit progress update event.
		this.eventEmitter.emit('queue-progress', {
			processed: 0,
			total: this.queue.length,
			currentTask: task.id
		});

                if (!this.isProcessing && !this.isStopped) {
                        this.scheduleNextProcessing(true);
                }
        }

        private async processQueue(): Promise<void> {
                if (this.isProcessing || this.isStopped || this.queue.length === 0) {
                        return;
                }
                if (!this.areCoreServicesAvailable()) {
                        this.applyReconnectionSafeguards();
                        return;
                }
                if (this.pendingBackoffTimer) {
                        clearTimeout(this.pendingBackoffTimer);
                        this.pendingBackoffTimer = null;
                }
                this.isProcessing = true;
                try {
                        if (this.servicesUnavailableNoticeShown) {
                                this.servicesUnavailableNoticeShown = false;
                        }
                        // Sort tasks by priority, then DELETE tasks, then by creation time.
                        this.queue.sort((a, b) => {
                                if (b.priority !== a.priority) return b.priority - a.priority;
				if (a.type === TaskType.DELETE && b.type !== TaskType.DELETE) return -1;
				if (b.type === TaskType.DELETE && a.type !== TaskType.DELETE) return 1;
				return a.createdAt - b.createdAt;
			});

			// Group tasks by file id to resolve collisions.
			const tasksByFile = new Map<string, ProcessingTask[]>();
			this.queue.forEach(task => {
				if (!tasksByFile.has(task.id)) {
					tasksByFile.set(task.id, []);
				}
				tasksByFile.get(task.id)!.push(task);
			});

			let tasksToProcess: ProcessingTask[] = [];
			for (const [fileId, fileTasks] of tasksByFile.entries()) {
				if (fileTasks.length > 1) {
					console.log(`Detected ${fileTasks.length} tasks for ${fileId}, resolving collisions.`);
					const deleteTask = fileTasks.find(t => t.type === TaskType.DELETE);
					if (deleteTask) {
						tasksToProcess.push(deleteTask);
						this.queue = this.queue.filter(t => t.id !== fileId);
						console.log(`Keeping only DELETE task for ${fileId}`);
					} else {
						const mostRecentTask = fileTasks.reduce((latest, current) =>
							current.updatedAt > latest.updatedAt ? current : latest, fileTasks[0]);
						tasksToProcess.push(mostRecentTask);
						this.queue = this.queue.filter(t => t.id !== fileId || t === mostRecentTask);
						console.log(`Keeping most recent task for ${fileId}`);
					}
				}
			}

			// Fill tasksToProcess with remaining tasks until we hit the concurrency limit.
			for (const task of this.queue) {
				if (tasksToProcess.some(t => t.id === task.id)) continue;
				tasksToProcess.push(task);
				if (tasksToProcess.length + this.processingQueue.length >= this.maxConcurrent) {
					break;
				}
			}

			// Remove selected tasks from the main queue.
			for (const task of tasksToProcess) {
				const index = this.queue.indexOf(task);
				if (index !== -1) {
					this.queue.splice(index, 1);
				}
			}

			// Process selected tasks.
			for (const task of tasksToProcess) {
				if (this.processingQueue.length >= this.maxConcurrent) {
					this.queue.unshift(task);
					continue;
				}
				this.processingQueue.push(task);
				this.processTask(task).catch(error => {
					this.handleTaskError(task, error);
				});
			}

                        this.eventEmitter.emit('queue-status', {
                                queueSize: this.queue.length,
                                pendingChanges: this.queue.length + this.processingQueue.length,
                                processingCount: this.processingQueue.length,
                                status: 'processing'
                        });
                        this.resetBackoff();
                } catch (error) {
                        this.errorHandler.handleError(error, { context: 'QueueService.processQueue' });
                        this.incrementBackoff();
                } finally {
                        this.isProcessing = false;
                        if (this.queue.length > 0 && !this.isStopped) {
                                this.scheduleNextProcessing();
                        }
                }
        }

	private async processTask(task: ProcessingTask): Promise<void> {
		console.log('Processing task:', { id: task.id, type: task.type, status: task.status });
		try {
			task.status = TaskStatus.PROCESSING;
			task.startedAt = Date.now();
			this.notifyProgress(task.id, 0, `Starting ${task.type.toLowerCase()}`);
			switch (task.type) {
				case TaskType.CREATE:
				case TaskType.UPDATE:
					await this.processCreateUpdateTask(task);
					break;
				case TaskType.DELETE:
					await this.processDeleteTask(task);
					break;
				default:
					throw new Error(`Unsupported task type: ${task.type}`);
			}
                        task.status = TaskStatus.COMPLETED;
                        task.completedAt = Date.now();
                        this.notifyProgress(task.id, 100, 'Task completed');
                        console.log('Task completed successfully:', task.id);
                        this.eventEmitter.emit('queue-progress', {
                                processed: 1,
                                total: this.queue.length + 1,
                                currentTask: task.id
                        });
                        this.eventEmitter.emit('task-completed', { task });
                        this.resetBackoff();
                } catch (error) {
                        console.error('Error processing task:', { taskId: task.id, error });
                        await this.handleTaskError(task, error);
                } finally {
                        this.removeFromProcessingQueue(task);
                }
	}

        private async processCreateUpdateTask(task: ProcessingTask): Promise<void> {
                const requiresVectors = this.vectorSyncEnabled;
                const requiresGraph = this.graphSyncEnabled;
                if (requiresVectors && (!this.supabaseService || !this.embeddingService)) {
                        throw new Error('Vector synchronization requested but Supabase or embeddings are unavailable');
                }
                if (requiresGraph && !this.neo4jService) {
                        throw new Error('Graph synchronization requested but Neo4j service is unavailable');
                }
                try {
			console.log('Reading file:', task.id);
			const file = this.vault.getAbstractFileByPath(task.id);
			if (!(file instanceof TFile)) {
				throw new Error(`File not found or not a TFile: ${task.id}`);
			}
			const timings = {
				start: Date.now(),
				readComplete: 0,
				chunkingComplete: 0,
				embeddingComplete: 0,
				saveComplete: 0
			};
                        const content = await this.vault.read(file);
                        timings.readComplete = Date.now();
                        console.log('File content read:', {
                                fileId: task.id,
                                contentLength: content.length,
                                readTime: timings.readComplete - timings.start
                        });
                        this.notifyProgress(task.id, 20, 'Splitting content');
                        const chunks = await this.textSplitter.splitDocument(content, task.metadata);
                        timings.chunkingComplete = Date.now();
                        if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
                                console.log('No valid chunks created for file:', {
                                        fileId: task.id,
                                        contentLength: content.length,
                                        settings: this.textSplitter.getSettings()
                                });
                                if (requiresVectors && this.supabaseService) {
                                        await this.supabaseService.updateFileVectorizationStatus(task.metadata, 'vectorized');
                                }
                                if (requiresGraph && this.neo4jService) {
                                        const extraction = this.entityExtractor
                                                ? await this.entityExtractor.extractFromDocument(content, task.metadata)
                                                : null;
                                        await this.neo4jService.upsertDocumentGraph(task.metadata, [], extraction);
                                }
                                return;
                        }
                        if (requiresGraph) {
                                this.applyGraphIdentifiers(task.metadata, chunks);
                        }
                        console.log('Content split into chunks:', {
                                numberOfChunks: chunks.length,
                                chunkSizes: chunks.map(c => c.content.length),
                                chunkingTime: timings.chunkingComplete - timings.readComplete
                        });
			const enhancedChunks = chunks.map(chunk => ({
				...chunk,
				metadata: {
					...chunk.metadata,
					aliases: chunk.metadata.aliases || [],
					links: chunk.metadata.links || [],
					tags: chunk.metadata.tags || []
				}
			}));
			const vectorStage = requiresVectors && this.embeddingService && this.supabaseService
				? async () => {
					this.notifyProgress(task.id, 40, 'Generating embeddings');
					for (let i = 0; i < enhancedChunks.length; i++) {
						const embedProgress = Math.floor(40 + (i / enhancedChunks.length) * 30);
						this.notifyProgress(
							task.id,
							embedProgress,
							`Generating embedding ${i + 1}/${enhancedChunks.length}`
						);
						const response = await this.embeddingService!.createEmbeddings([enhancedChunks[i].content]);
						if (response.length > 0 && response[0].data.length > 0) {
							enhancedChunks[i].embedding = response[0].data[0].embedding;
							enhancedChunks[i].vectorized_at = new Date().toISOString();
							console.log(`Generated embedding for chunk ${i + 1}/${enhancedChunks.length}`);
						} else {
							throw new Error(`Failed to generate embedding for chunk ${i + 1}`);
						}
					}
					timings.embeddingComplete = Date.now();
					this.notifyProgress(task.id, 70, 'Saving to database');
					let saveAttempts = 0;
					const maxSaveAttempts = 3;
					let savedSuccessfully = false;
					while (!savedSuccessfully && saveAttempts < maxSaveAttempts) {
						try {
							await this.supabaseService!.upsertChunks(enhancedChunks);
							savedSuccessfully = true;
						} catch (saveError) {
							saveAttempts++;
							console.error(
								`Error saving chunks (attempt ${saveAttempts}/${maxSaveAttempts}):`,
								saveError
							);
							if (saveAttempts >= maxSaveAttempts) throw saveError;
							const backoffTime = Math.pow(2, saveAttempts) * 1000;
							this.notifyProgress(task.id, 70, `Retrying database save in ${backoffTime / 1000}s`);
							await new Promise(resolve => setTimeout(resolve, backoffTime));
						}
					}
					timings.saveComplete = Date.now();
					console.log('Chunks saved to database:', {
						numberOfChunks: enhancedChunks.length,
						fileId: task.id,
						timings: {
							total: timings.saveComplete - timings.start,
							read: timings.readComplete - timings.start,
							chunking: timings.chunkingComplete - timings.readComplete,
							embedding: timings.embeddingComplete - timings.chunkingComplete,
							save: timings.saveComplete - timings.embeddingComplete
						}
					});
					await this.supabaseService!.updateFileVectorizationStatus(task.metadata, 'vectorized');
				}
				: undefined;
			const graphStage = requiresGraph && this.neo4jService
				? async () => {
					this.notifyProgress(task.id, requiresVectors ? 85 : 70, 'Updating knowledge graph');
					const extraction = this.entityExtractor
						? await this.entityExtractor.extractFromDocument(content, task.metadata)
						: null;
					await this.neo4jService!.upsertDocumentGraph(task.metadata, enhancedChunks, extraction);
					timings.saveComplete = Date.now();
				}
				: undefined;
			if (!vectorStage) {
				timings.embeddingComplete = timings.chunkingComplete;
				timings.saveComplete = timings.chunkingComplete;
			}
			await this.hybridRAGService.execute({
				mode: this.syncMode,
				vectorStage,
				graphStage
			});
			this.notifyProgress(task.id, 100, 'Processing completed');
                } catch (error) {
			console.error('Error in processCreateUpdateTask:', { error, taskId: task.id, metadata: task.metadata });
			throw error;
		}
	}

        private async processDeleteTask(task: ProcessingTask): Promise<void> {
                const requiresVectors = this.vectorSyncEnabled;
                const requiresGraph = this.graphSyncEnabled;
                if (requiresVectors && !this.supabaseService) throw new Error('Supabase service not initialized');
                if (requiresGraph && !this.neo4jService) throw new Error('Neo4j service not initialized');
                try {
                        const filePath = task.metadata.obsidianId;
                        const documentPath = task.metadata.path || task.metadata.obsidianId;
                        this.notifyProgress(task.id, 10, 'Starting deletion process');
                        if (requiresVectors && this.supabaseService) {
                                console.log(`Resolving file status before deletion: ${filePath}`);
                                const fileStatusId = await this.supabaseService.getFileStatusIdByPath(filePath);

                                if (!fileStatusId) {
                                        console.log(`No file status record found for deletion: ${filePath}`);
                                        this.notifyProgress(task.id, 30, 'No chunks to delete');
                                } else {
                                        const chunks = await this.supabaseService.getDocumentChunks(fileStatusId);
                                        const chunkCount = chunks.length;
                                        if (chunkCount > 0) {
                                                console.log(`Found ${chunkCount} chunks to delete for ${filePath}`);
                                                this.notifyProgress(task.id, 30, `Deleting ${chunkCount} chunks`);
                                        } else {
                                                console.log(`No chunks found for deletion: ${filePath}`);
                                                this.notifyProgress(task.id, 30, 'No chunks to delete');
                                        }
                                        let deleteAttempts = 0;
                                        const maxDeleteAttempts = 3;
                                        let deletedSuccessfully = false;
                                        while (!deletedSuccessfully && deleteAttempts < maxDeleteAttempts) {
                                                try {
                                                        this.notifyProgress(
                                                                task.id,
                                                                50,
                                                                deleteAttempts > 0
                                                                        ? `Deletion attempt ${deleteAttempts + 1}/${maxDeleteAttempts}`
                                                                        : 'Deleting from database'
                                                        );
                                                        await this.supabaseService.deleteDocumentChunks(fileStatusId);
                                                        deletedSuccessfully = true;
                                                        const remainingChunks = await this.supabaseService.getDocumentChunks(fileStatusId);
                                                        if (remainingChunks.length > 0) {
                                                                console.warn(`Deletion verification failed: ${remainingChunks.length} chunks still exist`);
                                                                deletedSuccessfully = false;
                                                                throw new Error(`Deletion verification failed for ${filePath}`);
                                                        }
                                                } catch (deleteError) {
                                                        deleteAttempts++;
                                                        console.error(`Error deleting chunks (attempt ${deleteAttempts}/${maxDeleteAttempts}):`, deleteError);
                                                        if (deleteAttempts >= maxDeleteAttempts) throw deleteError;
                                                        const backoffTime = Math.pow(2, deleteAttempts) * 1000;
                                                        this.notifyProgress(task.id, 50, `Will retry deletion in ${backoffTime / 1000}s`);
                                                        await new Promise(resolve => setTimeout(resolve, backoffTime));
                                                }
                                        }
                                }
                                this.notifyProgress(task.id, 80, 'Updating file status');
                                await this.supabaseService.updateFileStatusOnDelete(filePath);
                        }
                        if (requiresGraph && this.neo4jService) {
                                this.notifyProgress(task.id, requiresVectors ? 90 : 60, 'Removing graph nodes');
                                await this.neo4jService.deleteDocument(documentPath);
                        }
                        this.notifyProgress(task.id, 100, 'Delete completed');
                        console.log(`Successfully processed delete for document: ${filePath}`);
                } catch (error) {
                        console.error('Error in processDeleteTask:', { error, taskId: task.id, metadata: task.metadata });
                        throw error;
                }
        }

	private async handleTaskError(task: ProcessingTask, error: any): Promise<void> {
		task.retryCount = (task.retryCount || 0) + 1;
		task.updatedAt = Date.now();
                if (task.retryCount < this.maxRetries) {
                        task.status = TaskStatus.RETRYING;
                        this.queue.unshift(task);
                        this.notifyProgress(task.id, 0, `Retry attempt ${task.retryCount}`);
                        console.log('Task queued for retry:', { taskId: task.id, retryCount: task.retryCount, maxRetries: this.maxRetries });
                } else {
                        task.status = TaskStatus.FAILED;
                        task.error = {
                                message: error.message,
                                code: error.code || 'UNKNOWN_ERROR',
                                stack: error.stack,
                        };
                        task.completedAt = Date.now();
                        console.error('Task failed after max retries:', { taskId: task.id, error: task.error });
                        this.eventEmitter.emit('task-failed', { task, error });
                }
                this.errorHandler.handleError(error, { context: 'QueueService.processTask', taskId: task.id, taskType: task.type });
                this.eventEmitter.emit('queue-progress', { processed: 0, total: this.queue.length, currentTask: task.id });
                this.incrementBackoff();
                this.scheduleNextProcessing();
        }

        private removeFromProcessingQueue(task: ProcessingTask): void {
                const index = this.processingQueue.findIndex(t => t.id === task.id);
                if (index !== -1) {
                        this.processingQueue.splice(index, 1);
                }
        }

        private applyGraphIdentifiers(metadata: DocumentMetadata, chunks: DocumentChunk[]): void {
                const graphDocumentId = metadata.graphDocumentId || metadata.obsidianId || metadata.path;
                metadata.graphDocumentId = graphDocumentId;
                chunks.forEach(chunk => {
                        const chunkMetadata = { ...(chunk.metadata || {}) };
                        chunkMetadata.graphDocumentId = graphDocumentId;
                        if (!chunkMetadata.graphChunkId) {
                                chunkMetadata.graphChunkId = `${graphDocumentId}::${chunk.chunk_index}`;
                        }
                        chunk.metadata = chunkMetadata;
                });
        }

        private notifyProgress(taskId: string, progress: number, message: string): void {
                this.notificationManager.updateProgress({
                        taskId,
                        progress,
                        currentStep: message,
			totalSteps: 1,
			currentStepNumber: 1,
		});
		this.eventEmitter.emit('queue-progress', { processed: progress, total: 100, currentTask: taskId });
	}

        public getQueueStats(): QueueStats {
                const now = Date.now();
                const oneHour = 60 * 60 * 1000;
		const tasksByStatus = this.queue.reduce((acc, task) => {
			acc[task.status] = (acc[task.status] || 0) + 1;
			return acc;
		}, {} as Record<TaskStatus, number>);
		const tasksByType = this.queue.reduce((acc, task) => {
			acc[task.type] = (acc[task.type] || 0) + 1;
			return acc;
		}, {} as Record<TaskType, number>);
		const completedTasks = this.queue.filter(task => task.status === TaskStatus.COMPLETED && task.completedAt);
		const averageTime = completedTasks.length > 0
			? completedTasks.reduce((sum, task) => sum + (task.completedAt! - task.startedAt!), 0) / completedTasks.length
			: 0;
		const tasksLastHour = completedTasks.filter(task => task.completedAt! > now - oneHour).length;
		return {
			totalTasks: this.queue.length,
			tasksByStatus,
			tasksByType,
			averageProcessingTime: averageTime,
			failedTasks: tasksByStatus[TaskStatus.FAILED] || 0,
			retryingTasks: tasksByStatus[TaskStatus.RETRYING] || 0,
			tasksLastHour,
		};
	}

        public clear(): void {
                this.queue = [];
                this.processingQueue = [];
                this.notificationManager.clear();
                if (this.pendingBackoffTimer) {
                        clearTimeout(this.pendingBackoffTimer);
                        this.pendingBackoffTimer = null;
                }
        }

        public updateSettings(settings: { maxConcurrent: number; maxRetries: number; chunkSettings?: Partial<ChunkingOptions> }): void {
                this.maxConcurrent = settings.maxConcurrent;
                this.maxRetries = settings.maxRetries;
                if (settings.chunkSettings) {
                        const mergedChunkSettings: ChunkingOptions = {
                                ...DEFAULT_CHUNKING_OPTIONS,
                                ...settings.chunkSettings,
                        };
                        try {
                                this.textSplitter = new TextSplitter(
                                        this.vault,
                                        this.errorHandler,
                                        mergedChunkSettings
                                );
                                this.chunkSettings = mergedChunkSettings;
                        } catch (error) {
                                this.errorHandler.handleError(error, {
                                        context: 'QueueService.updateSettings',
                                        metadata: mergedChunkSettings,
                                });
                                throw new Error('Failed to update TextSplitter with provided settings.');
                        }
                }
        }

        private scheduleNextProcessing(forceImmediate: boolean = false): void {
                if (this.isStopped || this.queue.length === 0) {
                        return;
                }
                if (this.pendingBackoffTimer) {
                        clearTimeout(this.pendingBackoffTimer);
                }
                const delay = forceImmediate ? 0 : this.getBackoffDelay();
                this.pendingBackoffTimer = setTimeout(() => {
                        this.pendingBackoffTimer = null;
                        this.processQueue();
                }, delay);
        }

        private getBackoffDelay(): number {
                const exponent = Math.min(this.consecutiveFailures, 10);
                const delay = this.baseBackoffDelay * Math.pow(2, exponent);
                const jitter = Math.random() * this.baseBackoffDelay;
                return Math.min(delay + jitter, this.maxBackoffDelay);
        }

        private resetBackoff(): void {
                this.consecutiveFailures = 0;
        }

        private incrementBackoff(): void {
                this.consecutiveFailures = Math.min(this.consecutiveFailures + 1, 10);
        }

        private areCoreServicesAvailable(): boolean {
                if (this.vectorSyncEnabled && (!this.supabaseService || !this.embeddingService)) {
                        return false;
                }
                if (this.graphSyncEnabled && !this.neo4jService) {
                        return false;
                }
                return true;
        }

        private applyReconnectionSafeguards(): void {
                this.incrementBackoff();
                if (!this.servicesUnavailableNoticeShown) {
                        this.servicesUnavailableNoticeShown = true;
                        this.errorHandler.handleError(
                                new Error('Core services unavailable. Queue processing paused.'),
                                { context: 'QueueService.reconnectionGuard' },
                                'warn'
                        );
                }
                this.scheduleNextProcessing();
        }

	/**
	 * Subscribe to queue events.
	 * @param eventName The event to subscribe to.
	 * @param callback The callback function.
	 */
	public on<T extends keyof any>(eventName: T, callback: (data: any) => void): () => void {
		return this.eventEmitter.on(eventName as any, callback);
	}
}

	public updateHybridPreferences(strategy: HybridStrategySettings, mode: SyncMode): void {
		this.hybridRAGService.updateStrategy(strategy);
		this.syncMode = mode;
	}
