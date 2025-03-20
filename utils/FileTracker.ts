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
	private maxFileSizeBytes: number = 10 * 1024 * 1024;

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
			console.log('[FileTracker.initialize] Starting FileTracker initialization');
			console.log(`[FileTracker.initialize] Sync file path: ${this.syncFilePath}`);
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

	/**
	 * Handle file modification events.
	 * Enhanced with change detection and intelligent debouncing.
	 */
	async handleModify(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file)) return;

		try {
			// Check if this file was recently modified
			const recentChange = this.recentChanges.get(file.path);
			const currentTime = Date.now();

			// Calculate hash for change detection
			const hash = await this.calculateFileHash(file);

			// If the file was recently processed and content hasn't changed, debounce more aggressively
			if (recentChange &&
				recentChange.hash === hash &&
				(currentTime - recentChange.lastProcessed) < (this.processingTimeout * 2)) {

				console.log(`Skipping redundant update for ${file.path} - content unchanged`);
				return;
			}

			// If file was recently processed but content has changed, we'll queue it
			if (recentChange) {
				console.log(`Content changed for ${file.path}. Previous hash: ${recentChange.hash.substring(0, 8)}..., New hash: ${hash.substring(0, 8)}...`);
			}

			// Update the recent changes record
			this.recentChanges.set(file.path, {
				lastModified: file.stat.mtime,
				hash,
				lastProcessed: currentTime
			});

			const event: FileEvent = {
				type: 'modify',
				file,
				timestamp: currentTime,
				hash
			};

			await this.queueEvent(event);
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'FileTracker.handleModify',
				metadata: { filePath: file.path }
			});
		}
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

	/**
	 * Queue an event for processing with intelligent debouncing.
	 */
	private async queueEvent(event: FileEvent): Promise<void> {
		// Add the event to the queue
		this.eventQueue.push(event);

		// If not already processing, start a timer based on event type
		if (!this.isProcessing) {
			// Use standard debounce time for most events
			let debounceTime = this.processingTimeout;

			// For delete and rename events, use a shorter debounce time
			if (event.type === 'delete' || event.type === 'rename') {
				debounceTime = Math.min(debounceTime / 2, 500);
			}

			// For rapid typing scenarios, use a longer debounce time
			if (event.type === 'modify') {
				const recentEvents = this.eventQueue.filter(e =>
					e.file.path === event.file.path &&
					e.type === 'modify' &&
					(event.timestamp - e.timestamp) < 5000
				);

				if (recentEvents.length > 3) {
					// Multiple rapid changes detected, increase debounce time
					debounceTime = Math.max(debounceTime * 2, 3000);
					console.log(`Increased debounce time to ${debounceTime}ms for rapid changes to ${event.file.path}`);
				}
			}

			setTimeout(() => this.processEventQueue(), debounceTime);
		}
	}

	/**
	 * Process the event queue with improved conflict handling.
	 */
	private async processEventQueue(): Promise<void> {
		if (this.isProcessing || this.eventQueue.length === 0) return;

		this.isProcessing = true;
		console.log(`Processing ${this.eventQueue.length} queued events`);

		try {
			// Group events by file path for intelligent processing
			const eventsByPath = new Map<string, FileEvent[]>();

			for (const event of this.eventQueue) {
				const path = event.file.path;
				if (!eventsByPath.has(path)) {
					eventsByPath.set(path, []);
				}
				eventsByPath.get(path)?.push(event);
			}

			// Process events for each file with proper prioritization
			const paths = Array.from(eventsByPath.keys());

			// Process delete operations first
			const deleteFirst = paths.sort((a, b) => {
				const aHasDelete = eventsByPath.get(a)?.some(e => e.type === 'delete') ?? false;
				const bHasDelete = eventsByPath.get(b)?.some(e => e.type === 'delete') ?? false;

				if (aHasDelete && !bHasDelete) return -1;
				if (!aHasDelete && bHasDelete) return 1;
				return 0;
			});

			for (const path of deleteFirst) {
				const events = eventsByPath.get(path);
				if (events) {
					await this.processFileEvents(path, events);
				}
			}

			// Clear the event queue
			this.eventQueue = [];

		} catch (error) {
			this.errorHandler.handleError(error, { context: 'FileTracker.processEventQueue' });
		} finally {
			this.isProcessing = false;

			// If events were added during processing, trigger another process cycle
			if (this.eventQueue.length > 0) {
				setTimeout(() => this.processEventQueue(), 100);
			}
		}
	}

	/**
	 * Process all events for a single file with improved change detection.
	 */
	private async processFileEvents(path: string, events: FileEvent[]): Promise<void> {
		// Sort events by timestamp to ensure correct order
		events.sort((a, b) => a.timestamp - b.timestamp);

		// Get the final event after all changes
		const finalEvent = events[events.length - 1];

		console.log(`Processing ${events.length} events for ${path}, final event: ${finalEvent.type}`);

		try {
			// Delete events are handled immediately in handleDelete, no further processing needed
			if (finalEvent.type === 'delete') {
				console.log(`Skipping further processing for deleted file: ${path}`);
				return;
			}

			// Get the hash either from the event or calculate it
			const newHash = finalEvent.hash || await this.calculateFileHash(finalEvent.file);

			// Determine if the file needs vectorizing based on available services
			let needsVectorizing = true;

			if (this.supabaseService) {
				try {
					needsVectorizing = await this.supabaseService.needsVectorizing(
						path,
						finalEvent.file.stat.mtime,
						newHash
					);

					if (!needsVectorizing) {
						console.log(`File ${path} does not need vectorizing - no significant changes`);
					}
				} catch (error) {
					console.error('Error checking if file needs vectorizing:', error);
					needsVectorizing = true;
				}
			} else {
				// Fallback to sync file status check
				const syncStatus = await this.syncManager.getSyncStatus(path);

				if (syncStatus &&
					syncStatus.hash === newHash &&
					finalEvent.file.stat.mtime <= syncStatus.lastModified &&
					syncStatus.status !== 'PENDING') {

					needsVectorizing = false;
					console.log(`File ${path} does not need vectorizing according to sync file status`);
				}
			}

			// Update tracking regardless of whether vectorization is needed
			this.recentChanges.set(path, {
				lastModified: finalEvent.file.stat.mtime,
				hash: newHash,
				lastProcessed: Date.now()
			});

			// Only proceed with vectorization if needed
			if (needsVectorizing) {
				console.log(`Updating status for ${path} with hash ${newHash.substring(0, 8)}...`);

				// Create metadata with content hash for reliable change detection
				const metadata = await this.createFileMetadata(finalEvent.file);
				metadata.customMetadata.contentHash = newHash;

				if (this.supabaseService) {
					await this.supabaseService.updateFileVectorizationStatus(metadata);
				} else {
					await this.syncManager.updateSyncStatus(path, 'PENDING', {
						lastModified: finalEvent.file.stat.mtime,
						hash: newHash
					});
				}
			}
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'FileTracker.processFileEvents',
				metadata: { path, eventType: finalEvent.type }
			});
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


	/**
	 * Determine if a file should be tracked and processed.
	 * Enhanced with additional exclusion logic.
	 */
	private shouldTrackFile(file: TFile): boolean {
		if (!this.settings || !isVaultInitialized(this.settings)) {
			return false;
		}

		if (!this.settings.enableAutoSync) {
			return false;
		}

		// Get combined exclusions (system + user)
		const allExclusions = getAllExclusions(this.settings);

		const filePath = file.path;
		const fileName = file.name;

		// Check if this is the sync file directly
		if (filePath === this.settings.sync.syncFilePath ||
			filePath === this.settings.sync.syncFilePath + '.backup') {
			return false;
		}

		// Check if the file is binary or non-text based
		const isBinaryFile = this.isBinaryFile(fileName);
		if (isBinaryFile) {
			console.log(`Skipping binary file: ${fileName}`);
			return false;
		}

		// Check file size constraints - skip extremely large files
		if (file.stat.size > this.maxFileSizeBytes) {
			console.log(`Skipping file exceeding size limit: ${fileName} (${file.stat.size} bytes)`);
			return false;
		}

		// Check excluded files
		if (Array.isArray(allExclusions.excludedFiles) &&
			allExclusions.excludedFiles.includes(fileName)) {
			console.log('Skipping excluded file:', fileName);
			return false;
		}

		// Check excluded folders
		if (Array.isArray(allExclusions.excludedFolders)) {
			const isExcludedFolder = allExclusions.excludedFolders.some(folder => {
				const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
				return filePath.startsWith(normalizedFolder);
			});
			if (isExcludedFolder) {
				console.log('Skipping file in excluded folder:', filePath);
				return false;
			}
		}

		// Check excluded file types
		if (Array.isArray(allExclusions.excludedFileTypes)) {
			const isExcludedType = allExclusions.excludedFileTypes.some(
				ext => filePath.toLowerCase().endsWith(ext.toLowerCase())
			);
			if (isExcludedType) {
				console.log('Skipping excluded file type:', filePath);
				return false;
			}
		}

		// Check excluded file prefixes
		if (Array.isArray(allExclusions.excludedFilePrefixes)) {
			const isExcludedPrefix = allExclusions.excludedFilePrefixes.some(
				prefix => fileName.startsWith(prefix)
			);
			if (isExcludedPrefix) {
				console.log('Skipping file with excluded prefix:', fileName);
				return false;
			}
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

	/**
     * Helper method to determine if a file is likely binary based on extension
    */
	private isBinaryFile(fileName: string): boolean {
		const binaryExtensions = [
			'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.ico',
			'.pdf', '.zip', '.7z', '.rar', '.tar', '.gz',
			'.mp3', '.mp4', '.wav', '.ogg', '.flac',
			'.exe', '.dll', '.so', '.dylib',
			'.db', '.sqlite'
		];

		return binaryExtensions.some(ext =>
			fileName.toLowerCase().endsWith(ext)
		);
	}
}
