import { Vault, TFile } from 'obsidian';
import { TextSplitter } from '../utils/TextSplitter';
import {
    ProcessingTask,
    TaskStatus,
    TaskType,
    QueueStats,
    TaskProgress,
    TaskProcessingError,
} from '../models/ProcessingTask';
import { ErrorHandler } from '../utils/ErrorHandler';
import { NotificationManager } from '../utils/NotificationManager';
import { SupabaseService } from './SupabaseService';
import { OpenAIService } from './OpenAIService';
import { DEFAULT_CHUNKING_OPTIONS } from '../settings/Settings';

export class QueueService {
    private queue: ProcessingTask[] = [];
    private processingQueue: ProcessingTask[] = [];
    private isProcessing: boolean = false;
    private isStopped: boolean = true;
    private processingInterval: NodeJS.Timeout | null = null;
    private textSplitter: TextSplitter;
    private vault: Vault;

    constructor(
        private maxConcurrent: number,
        private maxRetries: number,
        private supabaseService: SupabaseService | null,
        private openAIService: OpenAIService | null,
        private errorHandler: ErrorHandler,
        private notificationManager: NotificationManager,
        vault: Vault,
        chunkSettings?: { chunkSize: number; chunkOverlap: number; minChunkSize: number }
    ) {
        this.vault = vault;
        const validatedChunkSettings = chunkSettings || { ...DEFAULT_CHUNKING_OPTIONS };

        try {
            this.textSplitter = new TextSplitter(validatedChunkSettings);
        } catch (error) {
            this.errorHandler.handleError(error, {
                context: 'QueueService.constructor',
                metadata: validatedChunkSettings,
            });
            throw new Error('Failed to initialize TextSplitter with provided settings.');
        }
    }

    public start(): void {
        if (!this.isStopped) return;

        this.isStopped = false;
        this.processQueue();

        this.processingInterval = setInterval(() => {
            if (!this.isProcessing) {
                this.processQueue();
            }
        }, 1000);
    }

    public stop(): void {
        this.isStopped = true;
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }

    async addTask(task: ProcessingTask): Promise<void> {
        if (this.queue.length >= 1000) {
            throw new Error(TaskProcessingError.QUEUE_FULL);
        }

        console.log('Adding task to queue:', {
            id: task.id,
            type: task.type,
            priority: task.priority
        });

        if (task.priority > 1) {
            this.queue.unshift(task);
        } else {
            this.queue.push(task);
        }

        this.notifyProgress(task.id, 0, 'Task queued');

        if (!this.isProcessing && !this.isStopped) {
            this.processQueue();
        }
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.isStopped || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.queue.length > 0 && this.processingQueue.length < this.maxConcurrent) {
                const task = this.queue.shift();
                if (task) {
                    this.processingQueue.push(task);
                    this.processTask(task).catch((error) => {
                        this.handleTaskError(task, error);
                    });
                }
            }
        } catch (error) {
            this.errorHandler.handleError(error, {
                context: 'QueueService.processQueue',
            });
        } finally {
            this.isProcessing = false;
        }
    }

    private async processTask(task: ProcessingTask): Promise<void> {
        console.log('Processing task:', {
            id: task.id,
            type: task.type,
            status: task.status
        });

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
        } catch (error) {
            console.error('Error processing task:', {
                taskId: task.id,
                error: error
            });
            await this.handleTaskError(task, error);
        } finally {
            this.removeFromProcessingQueue(task);
        }
    }

    private async processCreateUpdateTask(task: ProcessingTask): Promise<void> {
        if (!this.supabaseService || !this.openAIService) {
            throw new Error('Required services not initialized');
        }

        try {
            console.log('Reading file:', task.id);

            // Get file from task path
            const file = this.vault.getAbstractFileByPath(task.id);
            if (!(file instanceof TFile)) {
                throw new Error(`File not found or not a TFile: ${task.id}`);
            }

            // Read file content
            const content = await this.vault.read(file);
            console.log('File content read successfully:', {
                fileId: task.id,
                contentLength: content.length,
                contentPreview: content.substring(0, 100)
            });

            // Split the content into chunks
            this.notifyProgress(task.id, 20, 'Splitting content');
            const chunks = this.textSplitter.splitDocument(content, task.metadata);
            console.log('Content split into chunks:', {
                numberOfChunks: chunks.length,
                chunkSizes: chunks.map(c => c.content.length),
                firstChunkPreview: chunks[0]?.content.substring(0, 100)
            });

            if (chunks.length === 0) {
                console.warn('No chunks created for file:', {
                    fileId: task.id,
                    contentLength: content.length,
                    settings: this.textSplitter.getSettings()
                });
                throw new Error('No chunks created from file content');
            }

            // Generate embeddings for each chunk
            this.notifyProgress(task.id, 40, 'Generating embeddings');
            for (let i = 0; i < chunks.length; i++) {
                const response = await this.openAIService.createEmbeddings([chunks[i].content]);
                if (response.length > 0 && response[0].data.length > 0) {
                    chunks[i].embedding = response[0].data[0].embedding;
                    console.log(`Generated embedding for chunk ${i + 1}/${chunks.length}`);
                } else {
                    throw new Error(`Failed to generate embedding for chunk ${i + 1}`);
                }

                this.notifyProgress(
                    task.id,
                    40 + Math.floor((i / chunks.length) * 30),
                    `Processed ${i + 1} of ${chunks.length} chunks`
                );
            }

            // Save chunks to database
            this.notifyProgress(task.id, 70, 'Saving to database');
            await this.supabaseService.upsertChunks(chunks);
            console.log('Chunks saved to database:', {
                numberOfChunks: chunks.length,
                fileId: task.id
            });

            this.notifyProgress(task.id, 100, 'Processing completed');
        } catch (error) {
            console.error('Error in processCreateUpdateTask:', {
                error,
                taskId: task.id,
                metadata: task.metadata
            });
            throw error;
        }
    }

    private async processDeleteTask(task: ProcessingTask): Promise<void> {
        if (!this.supabaseService) {
            throw new Error('Supabase service not initialized');
        }

        try {
            this.notifyProgress(task.id, 50, 'Deleting from database');
            await this.supabaseService.deleteDocumentChunks(task.metadata.obsidianId);
            this.notifyProgress(task.id, 100, 'Delete completed');
        } catch (error) {
            console.error('Error in processDeleteTask:', {
                error,
                taskId: task.id,
                metadata: task.metadata
            });
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
            console.log('Task queued for retry:', {
                taskId: task.id,
                retryCount: task.retryCount,
                maxRetries: this.maxRetries
            });
        } else {
            task.status = TaskStatus.FAILED;
            task.error = {
                message: error.message,
                code: error.code || 'UNKNOWN_ERROR',
                stack: error.stack,
            };
            task.completedAt = Date.now();
            console.error('Task failed after max retries:', {
                taskId: task.id,
                error: task.error
            });
        }

        this.errorHandler.handleError(error, {
            context: 'QueueService.processTask',
            taskId: task.id,
            taskType: task.type,
        });
    }

    private removeFromProcessingQueue(task: ProcessingTask): void {
        const index = this.processingQueue.findIndex((t) => t.id === task.id);
        if (index !== -1) {
            this.processingQueue.splice(index, 1);
        }
    }

    private notifyProgress(taskId: string, progress: number, message: string): void {
        this.notificationManager.updateProgress({
            taskId,
            progress,
            currentStep: message,
            totalSteps: 1,
            currentStepNumber: 1,
        });
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

        const completedTasks = this.queue.filter(
            task => task.status === TaskStatus.COMPLETED && task.completedAt
        );

        const averageTime = completedTasks.length > 0
            ? completedTasks.reduce((sum, task) => sum + (task.completedAt! - task.startedAt!), 0) / completedTasks.length
            : 0;

        const tasksLastHour = completedTasks.filter(
            task => task.completedAt! > now - oneHour
        ).length;

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
    }

    public updateSettings(settings: {
        maxConcurrent: number;
        maxRetries: number;
        chunkSettings?: { chunkSize: number; chunkOverlap: number; minChunkSize: number };
    }): void {
        this.maxConcurrent = settings.maxConcurrent;
        this.maxRetries = settings.maxRetries;

        if (settings.chunkSettings) {
            this.textSplitter = new TextSplitter(settings.chunkSettings);
        }
    }
}
