// src/models/QueueEvents.ts
import { TaskStatus } from './ProcessingTask';

export interface QueueStatusEvent {
    queueSize: number;
    pendingChanges: number;
    processingCount: number;
    status: 'initializing' | 'processing' | 'paused';
    taskStatus?: TaskStatus;
}

export interface QueueProgressEvent {
    processed: number;
    total: number;
    currentTask?: string;
}

export type QueueEventTypes = {
    'queue-status': QueueStatusEvent;
    'queue-progress': QueueProgressEvent;
};

export type QueueEventCallback<T extends keyof QueueEventTypes> =
    (data: QueueEventTypes[T]) => void;
