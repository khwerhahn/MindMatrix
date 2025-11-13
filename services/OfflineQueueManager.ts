// src/services/OfflineQueueManager.ts
import { SupabaseService } from './SupabaseService';
import { SyncFileManager } from './SyncFileManager';
import { ErrorHandler } from '../utils/ErrorHandler';
import { Notice } from 'obsidian';

export type OfflineOperationType = 'create' | 'update' | 'delete' | 'rename';

export interface OfflineOperation {
        id: string;
        fileId: string;
        operationType: OfflineOperationType;
        timestamp: number;
        metadata?: {
                oldPath?: string;
                contentHash?: string;
                lastModified?: number;
        };
        status: 'pending' | 'processing' | 'error';
        errorDetails?: string;
        retryCount?: number;
        lastAttemptAt?: number;
}

export class OfflineQueueManager {
        private queue: OfflineOperation[] = [];
        private errorHandler: ErrorHandler;
        private supabaseService: SupabaseService | null;
        private syncFileManager: SyncFileManager;
        private readonly storageKey = 'obsidian-rag-offline-queue';
        private readonly processedKey = 'obsidian-rag-offline-processed';
        private readonly maxQueueSize = 500;
        private readonly baseBackoffDelay = 1000;
        private readonly maxBackoffDelay = 60000;
        private processedSignatures: Set<string> = new Set();
        private processing: boolean = false;
        private reconnectionTimer: ReturnType<typeof setTimeout> | null = null;

        constructor(
                errorHandler: ErrorHandler,
                supabaseService: SupabaseService | null,
                syncFileManager: SyncFileManager
        ) {
                this.errorHandler = errorHandler;
                this.supabaseService = supabaseService;
                this.syncFileManager = syncFileManager;
                this.loadPersistedState();
                if (this.queue.length > 0) {
                        this.scheduleReconnectionAttempt(true);
                }
        }

	/**
	 * Queue an operation to be processed when connectivity is restored.
	 */
        public async queueOperation(operation: Omit<OfflineOperation, 'id' | 'status'>): Promise<void> {
                const signature = this.buildOperationSignature(operation);
                if (this.processedSignatures.has(signature)) {
                        console.log('Skipping already processed offline operation:', signature);
                        return;
                }
                if (this.queue.length >= this.maxQueueSize) {
                        const removed = this.queue.shift();
                        if (removed) {
                                console.warn('Offline queue overflow. Dropping oldest operation.', removed);
                        }
                }
                const op: OfflineOperation = {
                        id: crypto.randomUUID(),
                        ...operation,
                        status: 'pending',
                        retryCount: 0
                };
                this.queue.push(op);
                console.log('Operation queued for offline processing:', op);
                this.persistQueue();
                this.scheduleReconnectionAttempt(true);
        }

	/**
	 * Retrieve the current list of queued operations.
	 */
	public getQueuedOperations(): OfflineOperation[] {
		return this.queue;
	}

	/**
	 * Clear all queued operations.
	 */
        public clearQueue(): void {
                this.queue = [];
                this.persistQueue();
        }

	/**
	 * Attempt to process all queued operations.
	 * Should be called when connectivity is restored.
	 */
        public async processQueue(): Promise<void> {
                if (this.processing || this.queue.length === 0) {
                        return;
                }
                if (!this.isConnectivityAvailable()) {
                        console.log('Connectivity unavailable. Deferring offline queue processing.');
                        this.scheduleReconnectionAttempt();
                        return;
                }
                this.processing = true;
                console.log('Starting offline queue reconciliation. Operations queued:', this.queue.length);
                for (const op of [...this.queue]) {
                        // Process only pending operations.
                        if (op.status !== 'pending') continue;
                        op.status = 'processing';
                        op.lastAttemptAt = Date.now();
                        try {
                                await this.processOperation(op);
                                // Remove the operation from the queue on success.
                                this.removeOperation(op.id);
                                this.markOperationProcessed(op);
                        } catch (error) {
                                op.status = 'error';
                                op.errorDetails = error.message;
                                op.retryCount = (op.retryCount || 0) + 1;
                                this.errorHandler.handleError(error, {
                                        context: 'OfflineQueueManager.processQueue',
                                        metadata: { operation: op }
                                });
                                // Optionally notify the user.
                                new Notice(`Offline operation failed for file ${op.fileId}: ${error.message}`);
                                if ((op.retryCount || 0) < 5) {
                                        op.status = 'pending';
                                }
                        }
                }
                console.log('Offline queue reconciliation completed.');
                this.processing = false;
                this.persistQueue();
                if (this.queue.some(op => op.status === 'pending')) {
                        this.scheduleReconnectionAttempt();
                } else {
                        this.clearReconnectionTimer();
                }
        }

	/**
	 * Process a single offline operation.
	 */
        private async processOperation(op: OfflineOperation): Promise<void> {
                switch (op.operationType) {
                        case 'create':
                        case 'update': {
				if (this.supabaseService) {
					// Use provided metadata if available.
					const metadata = {
						obsidianId: op.fileId,
						path: op.fileId,
						lastModified: op.metadata?.lastModified || Date.now(),
						created: Date.now(), // fallback value
						size: 0,
						customMetadata: { contentHash: op.metadata?.contentHash || '' }
					};
					await this.supabaseService.updateFileVectorizationStatus(metadata);
				} else {
					throw new Error('Supabase service unavailable during offline reconciliation.');
				}
				break;
			}
			case 'delete': {
				if (this.supabaseService) {
					await this.supabaseService.updateFileStatusOnDelete(op.fileId);
				} else {
					// Fallback to sync file update if Supabase is unavailable.
					await this.syncFileManager.updateSyncStatus(op.fileId, 'OK', {
						lastModified: Date.now(),
						hash: ''
					});
				}
				break;
			}
			case 'rename': {
				if (this.supabaseService) {
					// Update the new file's status.
					const metadata = {
						obsidianId: op.fileId,
						path: op.fileId,
						lastModified: op.metadata?.lastModified || Date.now(),
						created: Date.now(),
						size: 0,
						customMetadata: {}
					};
					await this.supabaseService.updateFileVectorizationStatus(metadata);
					// Mark the old file as deleted.
					if (op.metadata?.oldPath) {
						await this.supabaseService.updateFileStatusOnDelete(op.metadata.oldPath);
					}
				} else {
					throw new Error('Supabase service unavailable during offline reconciliation for rename.');
				}
				break;
			}
                        default:
                                throw new Error(`Unsupported offline operation type: ${op.operationType}`);
                }
        }

        /**
         * Remove an operation from the queue by its ID.
         */
        private removeOperation(id: string): void {
                this.queue = this.queue.filter(op => op.id !== id);
                this.persistQueue();
        }

        private loadPersistedState(): void {
                if (typeof window === 'undefined') {
                        return;
                }
                try {
                        const storedQueue = window.localStorage.getItem(this.storageKey);
                        const storedProcessed = window.localStorage.getItem(this.processedKey);
                        if (storedProcessed) {
                                const parsedProcessed: string[] = JSON.parse(storedProcessed);
                                this.processedSignatures = new Set(parsedProcessed);
                        }
                        if (storedQueue) {
                                const parsedQueue: OfflineOperation[] = JSON.parse(storedQueue);
                                this.queue = parsedQueue.filter(op => !this.processedSignatures.has(this.buildOperationSignature(op)));
                        }
                } catch (error) {
                        console.warn('Failed to load persisted offline queue state:', error);
                }
        }

        private persistQueue(): void {
                if (typeof window === 'undefined') {
                        return;
                }
                try {
                        window.localStorage.setItem(this.storageKey, JSON.stringify(this.queue));
                } catch (error) {
                        console.warn('Failed to persist offline queue:', error);
                }
        }

        private markOperationProcessed(op: OfflineOperation): void {
                const signature = this.buildOperationSignature(op);
                this.processedSignatures.add(signature);
                if (this.processedSignatures.size > this.maxQueueSize) {
                        const iterator = this.processedSignatures.values();
                        const oldest = iterator.next().value;
                        if (oldest) {
                                this.processedSignatures.delete(oldest);
                        }
                }
                if (typeof window !== 'undefined') {
                        try {
                                window.localStorage.setItem(this.processedKey, JSON.stringify(Array.from(this.processedSignatures)));
                        } catch (error) {
                                console.warn('Failed to persist processed offline operations:', error);
                        }
                }
        }

        private buildOperationSignature(operation: Omit<OfflineOperation, 'id' | 'status'> | OfflineOperation): string {
                const metadata = operation.metadata || {};
                return [
                        operation.fileId,
                        operation.operationType,
                        metadata.oldPath || '',
                        metadata.contentHash || '',
                        metadata.lastModified || ''
                ].join('::');
        }

        private isConnectivityAvailable(): boolean {
                if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
                        return navigator.onLine;
                }
                return !!this.supabaseService;
        }

        private scheduleReconnectionAttempt(immediate: boolean = false): void {
                if (this.queue.length === 0) {
                        this.clearReconnectionTimer();
                        return;
                }
                const pendingRetries = this.queue.filter(op => op.status === 'pending' && op.retryCount);
                const highestRetry = pendingRetries.reduce((max, op) => Math.max(max, op.retryCount || 0), 0);
                const delayBase = this.baseBackoffDelay * Math.pow(2, Math.min(highestRetry, 6));
                const delay = immediate ? 0 : Math.min(delayBase, this.maxBackoffDelay);
                this.clearReconnectionTimer();
                this.reconnectionTimer = setTimeout(() => {
                        this.reconnectionTimer = null;
                        void this.processQueue();
                }, delay);
        }

        private clearReconnectionTimer(): void {
                if (this.reconnectionTimer !== null) {
                        clearTimeout(this.reconnectionTimer);
                        this.reconnectionTimer = null;
                }
        }
}
