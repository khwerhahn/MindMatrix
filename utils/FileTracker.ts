// src/utils/FileTracker.ts
import { TAbstractFile, TFile, Vault } from 'obsidian';
import { ErrorHandler } from './ErrorHandler';
import { DocumentMetadata } from '../models/DocumentChunk';
import { SyncFileManager } from '../services/SyncFileManager';
import { SupabaseService } from '../services/SupabaseService';
// Optional: Import OfflineQueueManager if available
import { OfflineQueueManager } from '../services/OfflineQueueManager';

interface FileEvent {
	type: 'create' | 'modify' | 'delete' | 'rename';
	file: TFile;
	oldPath?: string;
	timestamp: number;
}

export class FileTracker {
	private eventQueue: FileEvent[] = [];
	private isProcessing: boolean = false;
	private processingTimeout: number = 1000; // Debounce time in ms
	private syncManager: SyncFileManager;
	private readonly syncFilePath: string;
	// Optional offline queue manager for offline operations
	private offlineQueueManager: OfflineQueueManager | null = null;

	/**
	 * @param vault The Obsidian vault instance.
	 * @param errorHandler Centralized error handler.
	 * @param syncFilePath Path to the sync file.
	 * @param supabaseService Optional Supabase service instance.
	 * @param offlineQueueManager Optional OfflineQueueManager for offline mode.
	 */
	constructor(
		private vault: Vault,
		private errorHandler: ErrorHandler,
		syncFilePath: string = '_mindmatrixsync.md',
		private supabaseService: SupabaseService | null = null,
		offlineQueueManager?: OfflineQueueManager
	) {
		this.syncFilePath = syncFilePath;
		// Initialize the sync manager using the provided sync file path.
		this.syncManager = new SyncFileManager(vault, errorHandler, syncFilePath);
		if (offlineQueueManager) {
			this.offlineQueueManager = offlineQueueManager;
		}
	}

	/**
	 * Initialize the file tracker.
	 * If a Supabase service is available, reconcile the database with the local sync file.
	 */
	async initialize(): Promise<void> {
		try {
			// Initialize sync manager (fallback for offline mode)
			await this.syncManager.initialize();
			// If Supabase service is available, reconcile DB status with local file state.
			if (this.supabaseService) {
				await this.reconcileDatabaseWithSyncFile();
			} else {
				console.log('Supabase service not available. Using sync file only for tracking.');
			}
			console.log('FileTracker initialized.');
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'FileTracker.initialize' });
			throw error;
		}
	}

	/**
	 * Reconcile database records with local sync file entries.
	 * Ensures that each file in the vault has an up-to-date status in the database.
	 */
	private async reconcileDatabaseWithSyncFile(): Promise<void> {
		try {
			if (!this.supabaseService) return;
			// Retrieve all sync entries from the local sync file
			const syncEntries = await this.syncManager.getAllSyncEntries();
			const entriesMap = new Map(syncEntries.map(entry => [entry.filePath, entry]));
			// Iterate over all files in the vault
			const files = this.vault.getFiles();
			for (const file of files) {
				// Only process markdown files that are not excluded
				if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) continue;
				try {
					// Get file status from the database
					const dbStatus = await this.supabaseService.getFileVectorizationStatus(file.path);
					const currentHash = await this.calculateFileHash(file);
					// If the file is marked as vectorized but the file has changed, update status to PENDING
					if (dbStatus.isVectorized) {
						const fileModifiedSinceDb = file.stat.mtime > (dbStatus.lastModified || 0);
						if (fileModifiedSinceDb) {
							const metadata = await this.createFileMetadata(file);
							await this.supabaseService.updateFileVectorizationStatus(metadata);
							console.log(`Database record updated to PENDING for modified file: ${file.path}`);
						}
					} else {
						// No valid record or not vectorized yet—create or update it in the database
						const metadata = await this.createFileMetadata(file);
						await this.supabaseService.updateFileVectorizationStatus(metadata);
						console.log(`Database record created/updated for file: ${file.path}`);
					}
				} catch (error) {
					this.errorHandler.handleError(error, {
						context: 'FileTracker.reconcileDatabaseWithSyncFile',
						metadata: { filePath: file.path }
					});
				}
			}
			// For files that exist in the sync file but are deleted from the vault,
			// mark them as deleted in the database.
			for (const entry of syncEntries) {
				const file = this.vault.getAbstractFileByPath(entry.filePath);
				if (!file && entry.status !== 'ERROR' && this.supabaseService) {
					await this.supabaseService.updateFileStatusOnDelete(entry.filePath);
					console.log(`Database record marked as deleted for file: ${entry.filePath}`);
				}
			}
		} catch (error) {
			console.error('Error reconciling database with sync file:', error);
			// Non-critical; do not throw.
		}
	}

	async handleCreate(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) return;
		const event: FileEvent = { type: 'create', file, timestamp: Date.now() };
		await this.queueEvent(event);
	}

	async handleModify(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) return;
		const event: FileEvent = { type: 'modify', file, timestamp: Date.now() };
		await this.queueEvent(event);
	}

	async handleDelete(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) return;
		const event: FileEvent = { type: 'delete', file, timestamp: Date.now() };
		await this.queueEvent(event);

		// If offline queue manager is enabled, queue the deletion operation.
		if (this.offlineQueueManager) {
			await this.offlineQueueManager.queueOperation({
				operationType: 'delete',
				fileId: file.path,
				timestamp: Date.now()
			});
		} else if (this.supabaseService) {
			try {
				await this.supabaseService.updateFileStatusOnDelete(file.path);
			} catch (error) {
				console.error('Error updating database for deleted file:', error);
			}
		} else {
			// Fallback to updating the sync file
			await this.syncManager.updateSyncStatus(file.path, 'OK', {
				lastModified: Date.now(),
				hash: ''
			});
		}
	}

	async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) return;
		const event: FileEvent = { type: 'rename', file, oldPath, timestamp: Date.now() };
		await this.queueEvent(event);
		const newHash = await this.calculateFileHash(file);
		const metadata = await this.createFileMetadata(file);

		// If offline, queue rename operation
		if (this.offlineQueueManager) {
			await this.offlineQueueManager.queueOperation({
				operationType: 'rename',
				fileId: file.path,
				metadata: { oldPath },
				timestamp: Date.now()
			});
		} else if (this.supabaseService) {
			await this.supabaseService.updateFileVectorizationStatus(metadata);
			await this.supabaseService.updateFileStatusOnDelete(oldPath);
		} else {
			await this.syncManager.updateSyncStatus(file.path, 'PENDING', {
				lastModified: file.stat.mtime,
				hash: newHash
			});
			await this.syncManager.updateSyncStatus(oldPath, 'OK', {
				lastModified: Date.now(),
				hash: ''
			});
		}
	}

	private async queueEvent(event: FileEvent): Promise<void> {
		this.eventQueue.push(event);
		if (!this.isProcessing) {
			setTimeout(() => this.processEventQueue(), this.processingTimeout);
		}
	}

	private async processEventQueue(): Promise<void> {
		if (this.isProcessing || this.eventQueue.length === 0) return;
		this.isProcessing = true;
		try {
			// Group events by file path.
			const eventsByPath = new Map<string, FileEvent[]>();
			for (const event of this.eventQueue) {
				const path = event.file.path;
				if (!eventsByPath.has(path)) {
					eventsByPath.set(path, []);
				}
				eventsByPath.get(path)?.push(event);
			}
			// Process events for each file.
			for (const [path, events] of eventsByPath) {
				await this.processFileEvents(path, events);
			}
			// Clear the event queue.
			this.eventQueue = [];
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'FileTracker.processEventQueue' });
		} finally {
			this.isProcessing = false;
		}
	}

	private async processFileEvents(path: string, events: FileEvent[]): Promise<void> {
		events.sort((a, b) => a.timestamp - b.timestamp);
		const finalEvent = events[events.length - 1];
		try {
			if (finalEvent.type !== 'delete') {
				const newHash = await this.calculateFileHash(finalEvent.file);
				let needsVectorizing = true;
				if (this.supabaseService) {
					try {
						needsVectorizing = await this.supabaseService.needsVectorizing(
							path,
							finalEvent.file.stat.mtime,
							newHash
						);
					} catch (error) {
						console.error('Error checking if file needs vectorizing:', error);
						needsVectorizing = true;
					}
				} else {
					const syncStatus = await this.syncManager.getSyncStatus(path);
					if (syncStatus && syncStatus.hash === newHash && finalEvent.file.stat.mtime <= syncStatus.lastModified && syncStatus.status !== 'PENDING') {
						needsVectorizing = false;
					}
				}
				if (needsVectorizing) {
					const metadata = await this.createFileMetadata(finalEvent.file);
					if (this.supabaseService) {
						await this.supabaseService.updateFileVectorizationStatus(metadata);
					} else {
						await this.syncManager.updateSyncStatus(path, 'PENDING', {
							lastModified: finalEvent.file.stat.mtime,
							hash: newHash
						});
					}
				}
			}
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'FileTracker.processFileEvents', metadata: { path, eventType: finalEvent.type } });
		}
	}

	private async calculateFileHash(file: TFile): Promise<string> {
		try {
			const content = await this.vault.read(file);
			return await this.hashString(content);
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'FileTracker.calculateFileHash', metadata: { filePath: file.path } });
			return '';
		}
	}

	private async hashString(str: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(str);
		const buffer = await crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(buffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
	}

	public async createFileMetadata(file: TFile): Promise<DocumentMetadata> {
		try {
			const content = await this.vault.read(file);
			const lineCount = content.split('\n').length;
			let additionalMetadata = {};
			if (this.supabaseService) {
				try {
					const status = await this.supabaseService.getFileVectorizationStatus(file.path);
					if (status.isVectorized) {
						additionalMetadata = {
							lastVectorized: status.lastVectorized,
							contentHash: status.contentHash
						};
					}
				} catch (error) {
					console.error('Error getting file status from database:', error);
				}
			}
			return {
				obsidianId: file.path,
				path: file.path,
				lastModified: file.stat.mtime,
				created: file.stat.ctime,
				size: file.stat.size,
				customMetadata: { ...additionalMetadata },
				loc: { lines: { from: 1, to: lineCount } },
				source: "obsidian",
				file_id: file.path,
				blobType: "text/markdown"
			};
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'FileTracker.createFileMetadata', metadata: { filePath: file.path } });
			return {
				obsidianId: file.path,
				path: file.path,
				lastModified: file.stat.mtime,
				created: file.stat.ctime,
				size: file.stat.size,
				customMetadata: {}
			};
		}
	}

	private shouldTrackFile(filePath: string): boolean {
		if (
			filePath === this.syncFilePath ||
			filePath.endsWith('_mindmatrixsync.md') ||
			filePath.endsWith('_mindmatrixsync.md.backup')
		) {
			return false;
		}
		return true;
	}

	/**
	 * Retrieve sync status for a given file from the sync file.
	 */
	public async getSyncStatus(path: string) {
		return await this.syncManager.getSyncStatus(path);
	}

	/**
	 * Retrieve all sync statuses.
	 */
	public async getAllSyncStatuses() {
		return await this.syncManager.getAllSyncEntries();
	}

	/**
	 * Allows late binding of the Supabase service.
	 */
	public setSupabaseService(service: SupabaseService): void {
		this.supabaseService = service;
	}

	/**
	 * Clear the event queue.
	 */
	public clearQueue(): void {
		this.eventQueue = [];
	}

	/**
	 * Update the processing timeout.
	 */
	public setProcessingTimeout(timeout: number): void {
		this.processingTimeout = timeout;
	}
}
