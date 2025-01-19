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
import { TFile } from 'obsidian';
import { DEFAULT_CHUNKING_OPTIONS } from '../settings/Settings';

export class QueueService {
    private queue: ProcessingTask[] = [];
    private processingQueue: ProcessingTask[] = [];
    private isProcessing: boolean = false;
    private isStopped: boolean = true;
    private processingInterval: NodeJS.Timeout | null = null;
    private textSplitter: TextSplitter;

    constructor(
        private maxConcurrent: number,
        private maxRetries: number,
        private supabaseService: SupabaseService | null,
        private openAIService: OpenAIService | null,
        private errorHandler: ErrorHandler,
        private notificationManager: NotificationManager,
        chunkSettings?: { chunkSize: number; chunkOverlap: number; minChunkSize: number }
    ) {
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
            throw new Error('Queue is full');
        }

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
        } catch (error) {
            await this.handleTaskError(task, error);
        } finally {
            this.removeFromProcessingQueue(task);
        }
    }

    private async processCreateUpdateTask(task: ProcessingTask): Promise<void> {
        if (!this.supabaseService || !this.openAIService) {
            throw new Error('Required services not initialized');
        }

        const file = task.file as TFile;
        const content = await file.vault.read(file);

        this.notifyProgress(task.id, 20, 'Splitting content');
        const chunks = this.textSplitter.splitDocument(content, task.metadata);

        this.notifyProgress(task.id, 40, 'Generating embeddings');
        for (let i = 0; i < chunks.length; i++) {
            const response = await this.openAIService.createEmbeddings([chunks[i].content]);
            if (response.length > 0 && response[0].data.length > 0) {
                chunks[i].embedding = response[0].data[0].embedding;
            }
            this.notifyProgress(
                task.id,
                40 + Math.floor((i / chunks.length) * 30),
                `Processed ${i + 1} of ${chunks.length} chunks`
            );
        }

        this.notifyProgress(task.id, 70, 'Saving to database');
        await this.supabaseService.upsertChunks(chunks);

        this.notifyProgress(task.id, 100, 'Processing completed');
    }

    private async processDeleteTask(task: ProcessingTask): Promise<void> {
        if (!this.supabaseService) {
            throw new Error('Supabase service not initialized');
        }

        this.notifyProgress(task.id, 50, 'Deleting from database');
        await this.supabaseService.deleteDocumentChunks(task.metadata.obsidianId);
        this.notifyProgress(task.id, 100, 'Delete completed');
    }

    private async handleTaskError(task: ProcessingTask, error: any): Promise<void> {
        task.retryCount = (task.retryCount || 0) + 1;
        task.updatedAt = Date.now();

        if (task.retryCount < this.maxRetries) {
            task.status = TaskStatus.RETRYING;
            this.queue.unshift(task);

            this.notifyProgress(task.id, 0, `Retry attempt ${task.retryCount}`);
        } else {
            task.status = TaskStatus.FAILED;
            task.error = {
                message: error.message,
                code: error.code || 'UNKNOWN_ERROR',
                stack: error.stack,
            };
            task.completedAt = Date.now();
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
}
