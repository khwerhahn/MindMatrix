import { DocumentProcessingError } from '../models/DocumentChunk';
import { TaskProcessingError } from '../models/ProcessingTask';
import { DebugSettings } from '../settings/Settings';
import { Notice } from 'obsidian';
import { PostgrestError } from '@supabase/supabase-js';

export interface ErrorContext {
    context: string;
    taskId?: string;
    taskType?: string;
    metadata?: Record<string, any>;
}

export interface ErrorLog {
    timestamp: number;
    error: Error;
    context: ErrorContext;
    level: 'error' | 'warn' | 'info' | 'debug';
    handled: boolean;
}

export interface SupabaseError extends Error {
    code: string;
    details: string;
    hint?: string;
}

export class ErrorHandler {
    private errorLogs: ErrorLog[] = [];
    private readonly maxLogs: number = 100;
    private settings: DebugSettings;
    private logFilePath?: string;

    constructor(settings: DebugSettings, vaultPath?: string) {
        this.settings = settings;
        if (settings.logToFile && vaultPath) {
            this.logFilePath = `${vaultPath}/.obsidian/mind-matrix.log`;
        }
    }

    /**
     * Handles errors with context and optional recovery
     */
    handleError(error: any, context: ErrorContext, level: 'error' | 'warn' | 'info' | 'debug' = 'error'): void {
        if (!this.shouldLog(level)) {
            return;
        }

        const errorLog: ErrorLog = {
            timestamp: Date.now(),
            error: this.normalizeError(error),
            context,
            level,
            handled: false
        };

        // Add to error logs with rotation
        this.errorLogs.unshift(errorLog);
        if (this.errorLogs.length > this.maxLogs) {
            this.errorLogs.pop();
        }

        // Show notification if appropriate
        if (level === 'error' || (level === 'warn' && this.settings.logLevel === 'debug')) {
            this.showErrorNotification(error);
        }

        // Debug logging
        if (this.settings.enableDebugLogs) {
            console.group(`[${level.toUpperCase()}] ${context.context}`);
            console.error('Error details:', error);
            console.error('Context:', context);
            if (error.stack) {
                console.error('Stack trace:', error.stack);
            }
            console.groupEnd();
        }

        // File logging
        if (this.settings.logToFile && this.logFilePath) {
            this.writeToLogFile(errorLog);
        }
    }

    /**
     * Checks if the error level should be logged
     */
    private shouldLog(level: 'error' | 'warn' | 'info' | 'debug'): boolean {
        const levels = {
            'error': 0,
            'warn': 1,
            'info': 2,
            'debug': 3
        };

        return levels[level] <= levels[this.settings.logLevel];
    }

    /**
     * Normalizes different error formats
     */
    private normalizeError(error: any): Error {
        if (error instanceof Error) {
            return error;
        }

        // Handle Supabase errors
        if (this.isSupabaseError(error)) {
            return new Error(`Database error (${error.code}): ${error.message}${error.hint ? ` - ${error.hint}` : ''}`);
        }

        if (typeof error === 'string') {
            return new Error(error);
        }

        if (typeof error === 'object') {
            const message = error.message || 'Unknown error';
            const normalizedError = new Error(message);
            Object.assign(normalizedError, error);
            return normalizedError;
        }

        return new Error('Unknown error occurred');
    }

    /**
     * Type guard for Supabase errors
     */
    private isSupabaseError(error: any): error is PostgrestError {
        return error && typeof error === 'object' && 'code' in error && 'details' in error;
    }

    /**
     * Shows appropriate notification based on error type
     */
    private showErrorNotification(error: any): void {
        let message = 'An error occurred';
        let duration = 4000;

        // Handle Supabase specific errors
        if (this.isSupabaseError(error)) {
            switch (error.code) {
                case '42P01':
                    message = 'Database table not found. Please run setup SQL.';
                    break;
                case '42501':
                    message = 'Insufficient database permissions.';
                    break;
                case '23505':
                    message = 'Duplicate entry found.';
                    break;
                default:
                    message = `Database error: ${error.message}`;
            }
            duration = 6000;
        }
        // Handle Document Processing Errors
        else if (error.type === DocumentProcessingError.CHUNKING_ERROR) {
            message = 'Error splitting document into chunks';
        } else if (error.type === DocumentProcessingError.EMBEDDING_ERROR) {
            message = 'Error generating embeddings';
        } else if (error.type === DocumentProcessingError.DATABASE_ERROR) {
            message = 'Database operation failed';
        } else if (error.type === DocumentProcessingError.INVALID_METADATA) {
            message = 'Invalid document metadata';
        } else if (error.type === DocumentProcessingError.FILE_ACCESS_ERROR) {
            message = 'Error accessing file';
        } else if (error.type === DocumentProcessingError.YAML_PARSE_ERROR) {
            message = 'Error parsing YAML front matter';
        } else if (error.type === DocumentProcessingError.VECTOR_EXTENSION_ERROR) {
            message = 'Vector extension not available';
        } else if (error.type === DocumentProcessingError.SYNC_ERROR) {
            message = 'Sync operation failed';
        }
        // Handle Task Processing Errors
        else if (error.type === TaskProcessingError.QUEUE_FULL) {
            message = 'Task queue is full';
        } else if (error.type === TaskProcessingError.TASK_TIMEOUT) {
            message = 'Task timed out';
        } else if (error.type === TaskProcessingError.TASK_CANCELLED) {
            message = 'Task was cancelled';
        } else if (error.type === TaskProcessingError.MAX_RETRIES_EXCEEDED) {
            message = 'Maximum retry attempts exceeded';
        } else if (error.type === TaskProcessingError.INVALID_TASK_STATE) {
            message = 'Invalid task state';
        } else if (error.type === TaskProcessingError.TASK_NOT_FOUND) {
            message = 'Task not found';
        }

        // Use provided message if available
        if (error.message) {
            message = `${message}: ${error.message}`;
        }

        new Notice(message, duration);
    }

    /**
     * Writes error log to file
     */
    private writeToLogFile(log: ErrorLog): void {
        if (!this.logFilePath) return;

        const logEntry = {
            timestamp: new Date(log.timestamp).toISOString(),
            level: log.level.toUpperCase(),
            context: log.context.context,
            error: log.error.message,
            stack: log.error.stack,
            metadata: log.context.metadata
        };

        try {
            if (this.app?.vault?.adapter?.append) {
                this.app.vault.adapter.append(
                    this.logFilePath,
                    JSON.stringify(logEntry) + '\n'
                );
            }
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    /**
     * Updates debug settings
     */
    updateSettings(settings: DebugSettings): void {
        this.settings = settings;
    }

    /**
     * Gets recent error logs
     */
    getRecentLogs(count: number = 10): ErrorLog[] {
        return this.errorLogs.slice(0, count);
    }

    /**
     * Clears error logs
     */
    clearLogs(): void {
        this.errorLogs = [];
    }

    /**
     * Gets error statistics
     */
    getErrorStats(): Record<string, number> {
        return this.errorLogs.reduce((acc, log) => {
            const errorType = log.error.name || 'Unknown';
            acc[errorType] = (acc[errorType] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }
}
