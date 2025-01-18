import { DocumentChunk, DocumentMetadata } from './DocumentChunk';

/**
 * Types of tasks that can be processed
 */
export enum TaskType {
    CREATE = 'CREATE',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE',
    CHUNK = 'CHUNK',
    EMBED = 'EMBED',
    SYNC = 'SYNC',
    CLEANUP = 'CLEANUP'
}

/**
 * Possible states of a processing task
 */
export enum TaskStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    RETRYING = 'RETRYING',
    CANCELLED = 'CANCELLED'
}

/**
 * Represents a task in the processing queue
 */
export interface ProcessingTask {
    // Unique identifier for the task
    id: string;
    // Type of task to be performed
    type: TaskType;
    // Current status of the task
    status: TaskStatus;
    // Priority level (higher number = higher priority)
    priority: number;
    // Maximum number of retry attempts
    maxRetries: number;
    // Current retry count
    retryCount: number;
    // Timestamp when task was created
    createdAt: number;
    // Timestamp when task was last updated
    updatedAt: number;
    // Timestamp when task started processing
    startedAt?: number;
    // Timestamp when task completed or failed
    completedAt?: number;
    // Error information if task failed
    error?: {
        message: string;
        code: string;
        stack?: string;
    };
    // Task-specific metadata
    metadata: DocumentMetadata;
    // Task-specific data
    data: {
        chunks?: DocumentChunk[];
        embeddings?: number[][];
        path?: string;
        content?: string;
    };
}

/**
 * Progress information for a task
 */
export interface TaskProgress {
    // Task identifier
    taskId: string;
    // Overall progress percentage
    progress: number;
    // Current step description
    currentStep: string;
    // Total steps in the task
    totalSteps: number;
    // Current step number
    currentStepNumber: number;
    // Estimated time remaining in milliseconds
    estimatedTimeRemaining?: number;
    // Additional progress details
    details?: {
        processedChunks?: number;
        totalChunks?: number;
        processedTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Statistics for the task queue
 */
export interface QueueStats {
    // Total tasks in queue
    totalTasks: number;
    // Tasks grouped by status
    tasksByStatus: Record<TaskStatus, number>;
    // Tasks grouped by type
    tasksByType: Record<TaskType, number>;
    // Average processing time in milliseconds
    averageProcessingTime: number;
    // Number of failed tasks
    failedTasks: number;
    // Number of retrying tasks
    retryingTasks: number;
    // Tasks processed in the last hour
    tasksLastHour: number;
}

/**
 * Constants for task processing
 */
export const DEFAULT_TASK_OPTIONS = {
    maxRetries: 3,
    priority: 1,
    timeout: 30000, // 30 seconds
    retryDelay: 5000, // 5 seconds
};

/**
 * Error types specific to task processing
 */
export enum TaskProcessingError {
    QUEUE_FULL = 'QUEUE_FULL',
    TASK_TIMEOUT = 'TASK_TIMEOUT',
    TASK_CANCELLED = 'TASK_CANCELLED',
    MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
    INVALID_TASK_STATE = 'INVALID_TASK_STATE',
    TASK_NOT_FOUND = 'TASK_NOT_FOUND'
}
