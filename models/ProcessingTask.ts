import { TFile } from 'obsidian';
import { DocumentChunk } from './DocumentChunk';

export enum TaskType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    RENAME = 'rename'
}

export enum TaskStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

export interface ProcessingTask {
    id: string;
    type: TaskType;
    status: TaskStatus;
    file: TFile;
    oldPath?: string;  // Used for rename operations
    chunks?: DocumentChunk[];
    error?: Error;
    retryCount: number;
    created: Date;
    updated: Date;
}

export interface TaskProgress {
    total: number;
    completed: number;
    failed: number;
    status: TaskStatus;
}

export interface QueueStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}
