import {
    ProcessingTask,
    TaskStatus,
    TaskType,
    QueueStats,
    TaskProgress,
    TaskProcessingError,
    DEFAULT_TASK_OPTIONS
} from '../models/ProcessingTask';
import { ErrorHandler } from '../utils/ErrorHandler';
import { NotificationManager } from '../utils/NotificationManager';
import { QueueSettings } from '../settings/Settings';

export class QueueService {
    private queue: ProcessingTask[] = [];
    private processingQueue: ProcessingTask[] = [];
    private settings: QueueSettings;
    private isProcessing: boolean = false;
    private stats: QueueStats = {
        totalTasks: 0,
        tasksByStatus: {
            [TaskStatus.PENDING]: 0,
            [TaskStatus.PROCESSING]: 0,
            [TaskStatus.COMPLETED]: 0,
            [TaskStatus.FAILED]: 0,
            [TaskStatus.RETRYING]: 0,
            [TaskStatus.CANCELLED]: 0
        },
        tasksByType: {
            [TaskType.CREATE]: 0,
            [TaskType.UPDATE]: 0,
            [TaskType.DELETE]: 0,
            [TaskType.CHUNK]: 0,
            [TaskType.EMBED]: 0,
            [TaskType.SYNC]: 0,
            [TaskType.CLEANUP]: 0
        },
        averageProcessingTime: 0,
        failedTasks: 0,
        retryingTasks: 0,
        tasksLastHour: 0
    };

    constructor(
        private errorHandler: ErrorHandler,
        private notificationManager: NotificationManager,
        settings: QueueSettings
    ) {
        this.settings = settings;
    }

    /**
     * Adds a new task to the queue
     */
    async addTask(taskData: Omit<ProcessingTask, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<string> {
        if (this.queue.length >= 1000) {
            throw {
                type: TaskProcessingError.QUEUE_FULL,
                message: 'Task queue is full'
            };
        }

        const id = crypto.randomUUID();
        const now = Date.now();

        const newTask: ProcessingTask = {
            ...DEFAULT_TASK_OPTIONS,
            ...taskData,
            id,
            status: TaskStatus.PENDING,
            createdAt: now,
            updatedAt: now,
            retryCount: 0,
        };

        // Add high priority tasks to the front of the queue
        if (newTask.priority > 1) {
            this.queue.unshift(newTask);
        } else {
            this.queue.push(newTask);
        }

        this.updateStats();
        this.notifyProgress(id);

        if (!this.isProcessing) {
            this.processQueue();
        }

        return id;
    }

    /**
     * Processes the queue with concurrency control
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                // Remove completed tasks from processing queue
                this.processingQueue = this.processingQueue.filter(
                    task => [TaskStatus.PROCESSING, TaskStatus.RETRYING].includes(task.status)
                );

                // Process up to maxConcurrent tasks
                while (
                    this.processingQueue.length < this.settings.maxConcurrent &&
                    this.queue.length > 0
                ) {
                    const task = this.queue.shift();
                    if (task) {
                        task.status = TaskStatus.PROCESSING;
                        task.startedAt = Date.now();
                        this.processingQueue.push(task);
                        this.processTask(task).catch(error => {
                            this.handleTaskError(task, error);
                        });
                    }
                }

                // Wait for any task to complete
                if (this.processingQueue.length > 0) {
                    await Promise.race(
                        this.processingQueue.map(task => this.waitForTaskCompletion(task))
                    );
                }

                this.updateStats();
            }
        } catch (error) {
            this.errorHandler.handleError(error, {
                context: 'QueueService.processQueue'
            });
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Processes an individual task
     */
    private async processTask(task: ProcessingTask): Promise<void> {
        try {
            const startTime = Date.now();
            this.updateTaskProgress(task.id, {
                taskId: task.id,
                progress: 0,
                currentStep: `Starting ${task.type.toLowerCase()} task`,
                totalSteps: this.getTaskTotalSteps(task.type),
                currentStepNumber: 0
            });

            // Process based on task type
            switch (task.type) {
                case TaskType.CHUNK:
                    await this.processChunkTask(task);
                    break;
                case TaskType.EMBED:
                    await this.processEmbedTask(task);
                    break;
                case TaskType.SYNC:
                    await this.processSyncTask(task);
                    break;
                case TaskType.CLEANUP:
                    await this.processCleanupTask(task);
                    break;
                default:
                    throw new Error(`Unsupported task type: ${task.type}`);
            }

            task.status = TaskStatus.COMPLETED;
            task.completedAt = Date.now();
            task.updatedAt = Date.now();

            this.updateStats();
            this.notifyTaskCompletion(task, startTime);

        } catch (error) {
            await this.handleTaskError(task, error);
        }
    }

    /**
     * Updates progress for a specific task
     */
    private updateTaskProgress(taskId: string, progress: TaskProgress): void {
        const task = this.findTask(taskId);
        if (task) {
            task.updatedAt = Date.now();
            this.notificationManager.updateProgress(progress);
        }
    }

    /**
     * Handles task errors with retry logic
     */
    private async handleTaskError(task: ProcessingTask, error: any): Promise<void> {
        task.updatedAt = Date.now();

        if (task.retryCount < this.settings.retryAttempts) {
            task.retryCount++;
            task.status = TaskStatus.RETRYING;

            // Add back to queue after delay
            setTimeout(() => {
                this.queue.unshift(task);
                this.processQueue();
            }, this.settings.retryDelay * task.retryCount);

        } else {
            task.status = TaskStatus.FAILED;
            task.error = {
                message: error.message,
                code: error.code || 'UNKNOWN_ERROR',
                stack: error.stack
            };
            task.completedAt = Date.now();
        }

        this.errorHandler.handleError(error, {
            context: 'QueueService.processTask',
            taskId: task.id,
            taskType: task.type
        });

        this.updateStats();
    }

    /**
     * Updates queue statistics
     */
    private updateStats(): void {
        const allTasks = [...this.queue, ...this.processingQueue];
        const now = Date.now();
        const hourAgo = now - 3600000;

        // Reset counters
        Object.keys(this.stats.tasksByStatus).forEach(status => {
            this.stats.tasksByStatus[status as TaskStatus] = 0;
        });
        Object.keys(this.stats.tasksByType).forEach(type => {
            this.stats.tasksByType[type as TaskType] = 0;
        });

        // Calculate stats
        let totalProcessingTime = 0;
        let completedTasksCount = 0;

        allTasks.forEach(task => {
            // Update status counts
            this.stats.tasksByStatus[task.status]++;
            this.stats.tasksByType[task.type]++;

            // Calculate processing times for completed tasks
            if (task.status === TaskStatus.COMPLETED && task.startedAt && task.completedAt) {
                totalProcessingTime += task.completedAt - task.startedAt;
                completedTasksCount++;
            }
        });

        this.stats = {
            totalTasks: allTasks.length,
            tasksByStatus: this.stats.tasksByStatus,
            tasksByType: this.stats.tasksByType,
            averageProcessingTime: completedTasksCount ? totalProcessingTime / completedTasksCount : 0,
            failedTasks: this.stats.tasksByStatus[TaskStatus.FAILED],
            retryingTasks: this.stats.tasksByStatus[TaskStatus.RETRYING],
            tasksLastHour: allTasks.filter(t => t.createdAt >= hourAgo).length
        };
    }

    /**
     * Gets the total number of steps for a task type
     */
    private getTaskTotalSteps(type: TaskType): number {
        switch (type) {
            case TaskType.CHUNK:
                return 2; // Read + Chunk
            case TaskType.EMBED:
                return 3; // Read + Process + Embed
            case TaskType.SYNC:
                return 4; // Read + Chunk + Embed + Save
            case TaskType.CLEANUP:
                return 1;
            default:
                return 1;
        }
    }

    /**
     * Notifies task completion
     */
    private notifyTaskCompletion(task: ProcessingTask, startTime: number): void {
        const duration = Date.now() - startTime;
        const message = `${task.type} task completed in ${(duration / 1000).toFixed(1)}s`;
        this.notificationManager.showNotification(message);
    }

    /**
     * Task type-specific processing methods
     */
    private async processChunkTask(task: ProcessingTask): Promise<void> {
        // Implementation will be added when TextSplitter is integrated
    }

    private async processEmbedTask(task: ProcessingTask): Promise<void> {
        // Implementation will be added when OpenAIService is integrated
    }

    private async processSyncTask(task: ProcessingTask): Promise<void> {
        // Implementation will be added when SupabaseService is integrated
    }

    private async processCleanupTask(task: ProcessingTask): Promise<void> {
        // Implementation will be added when cleanup logic is defined
    }

    /**
     * Utility methods
     */
    private findTask(taskId: string): ProcessingTask | undefined {
        return [...this.queue, ...this.processingQueue].find(t => t.id === taskId);
    }

    private async waitForTaskCompletion(task: ProcessingTask): Promise<void> {
        return new Promise(resolve => {
            const checkStatus = () => {
                if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(task.status)) {
                    resolve();
                } else {
                    setTimeout(checkStatus, 100);
                }
            };
            checkStatus();
        });
    }

    /**
     * Public utility methods
     */
    getStats(): QueueStats {
        return { ...this.stats };
    }

    updateSettings(settings: QueueSettings): void {
        this.settings = settings;
    }

    async cancelTask(taskId: string): Promise<void> {
        const task = this.findTask(taskId);
        if (task && task.status !== TaskStatus.COMPLETED) {
            task.status = TaskStatus.CANCELLED;
            task.completedAt = Date.now();
            task.updatedAt = Date.now();
            this.updateStats();
        }
    }

    clearFailedTasks(): void {
        this.queue = this.queue.filter(task => task.status !== TaskStatus.FAILED);
        this.updateStats();
    }
}
