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
}

export class OfflineQueueManager {
	private queue: OfflineOperation[] = [];
	private errorHandler: ErrorHandler;
	private supabaseService: SupabaseService | null;
	private syncFileManager: SyncFileManager;

	constructor(
		errorHandler: ErrorHandler,
		supabaseService: SupabaseService | null,
		syncFileManager: SyncFileManager
	) {
		this.errorHandler = errorHandler;
		this.supabaseService = supabaseService;
		this.syncFileManager = syncFileManager;
	}

	/**
	 * Queue an operation to be processed when connectivity is restored.
	 */
	public async queueOperation(operation: Omit<OfflineOperation, 'id' | 'status'>): Promise<void> {
		const op: OfflineOperation = {
			id: crypto.randomUUID(),
			...operation,
			status: 'pending'
		};
		this.queue.push(op);
		console.log('Operation queued for offline processing:', op);
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
	}

	/**
	 * Attempt to process all queued operations.
	 * Should be called when connectivity is restored.
	 */
	public async processQueue(): Promise<void> {
		console.log('Starting offline queue reconciliation. Operations queued:', this.queue.length);
		for (const op of this.queue) {
			// Process only pending operations.
			if (op.status !== 'pending') continue;
			op.status = 'processing';
			try {
				await this.processOperation(op);
				// Remove the operation from the queue on success.
				this.removeOperation(op.id);
			} catch (error) {
				op.status = 'error';
				op.errorDetails = error.message;
				this.errorHandler.handleError(error, {
					context: 'OfflineQueueManager.processQueue',
					metadata: { operation: op }
				});
				// Optionally notify the user.
				new Notice(`Offline operation failed for file ${op.fileId}: ${error.message}`);
			}
		}
		console.log('Offline queue reconciliation completed.');
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
	}
}
