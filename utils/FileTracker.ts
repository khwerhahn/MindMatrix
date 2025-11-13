// src/utils/FileTracker.ts
import { TAbstractFile, TFile, Vault, Notice } from 'obsidian';
import { ErrorHandler } from './ErrorHandler';
import { DocumentMetadata, DocumentChunk, FileStatusRecord } from '@/models/DocumentChunk';
import { SyncFileManager } from '@/services/SyncFileManager';
import { SupabaseService } from '@/services/SupabaseService';
// Optional: Import OfflineQueueManager if available
import { OfflineQueueManager } from '@/services/OfflineQueueManager';
import { ObsidianRAGSettings } from '@/settings/Settings';
import { QueueService } from '@/services/QueueService';
import { ProcessingTask, TaskType, TaskStatus } from '@/models/ProcessingTask';

interface FileEvent {
	type: 'create' | 'modify' | 'delete' | 'rename';
	file: TFile | null;
	oldPath?: string;
	path?: string;
	timestamp: number;
	hash?: string;
}

interface RecentChange {
	lastModified: number;
	hash: string;
	lastProcessed: number;
}

export class FileTracker {
	private eventQueue: FileEvent[] = [];
	private isProcessing: boolean = false;
	private processingTimeout: number = 1000; // Debounce time in ms
	private syncManager: SyncFileManager;
	private readonly syncFilePath: string;
	private offlineQueueManager: OfflineQueueManager | null = null;
	private maxFileSizeBytes: number = 10 * 1024 * 1024;
	private lastExclusions: {
		excludedFolders: string[];
		excludedFileTypes: string[];
		excludedFilePrefixes: string[];
		excludedFiles: string[];
	} = {
		excludedFolders: [],
		excludedFileTypes: [],
		excludedFilePrefixes: [],
		excludedFiles: []
	};
	private vaultId: string | null = null;
	private settings: ObsidianRAGSettings | null = null;
	private isInitialized: boolean = false;
	private pendingChanges: FileEvent[] = [];
	private recentChanges: Map<string, RecentChange> = new Map();
	private queueService: QueueService | null = null;
	private preInitQueue: FileEvent[] = []; // Queue for events that occur before initialization

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
		syncFilePath: string = '_obsidianragsync.md',
		private supabaseService: SupabaseService | null = null,
		offlineQueueManager?: OfflineQueueManager
	) {
		this.syncFilePath = syncFilePath;
		this.syncManager = new SyncFileManager(
			vault,
			errorHandler,
			syncFilePath,
			3600000, // backupInterval: 1 hour in milliseconds
			this.vaultId || '',
			'device-' + Date.now(), // deviceId
			'obsidian', // deviceName
			'1.0.0' // pluginVersion
		);
		if (offlineQueueManager) {
			this.offlineQueueManager = offlineQueueManager;
		}
	}

	/**
	 * Initialize the file tracker.
	 * If a Supabase service is available, reconcile the database with the local sync file.
	 */
        public async initialize(settings: ObsidianRAGSettings, supabaseService: SupabaseService | null, queueService: QueueService): Promise<void> {
                console.log('[FileTracker.initialize] Starting FileTracker initialization');
                this.settings = settings;
                this.supabaseService = supabaseService;
                this.queueService = queueService;

		// Get sync file path
		const syncFilePath = this.settings.sync.syncFilePath || '_obsidianragsync.md';
		console.log('[FileTracker.initialize] Sync file path:', syncFilePath);

		// Initialize sync file manager
		this.syncManager = new SyncFileManager(
			this.vault,
			this.errorHandler,
			syncFilePath,
			3600000, // backupInterval: 1 hour in milliseconds
			this.vaultId || '',
			'device-' + Date.now(), // deviceId
			'obsidian', // deviceName
			'1.0.0' // pluginVersion
		);

		try {
			// Reconcile database with local sync file
			await this.reconcileDatabaseWithSyncFile();

			// Queue initial file checks instead of processing them immediately
			const files = this.vault.getMarkdownFiles();
			for (const file of files) {
				if (!this.shouldTrackFile(file.path)) {
					console.log(`[ObsidianRAG] Skipping file with excluded prefix: ${file.path}`);
					continue;
				}
				// Queue the file for processing
				await this.queueFileForProcessing(file);
			}

			// Set initialization flag
			this.isInitialized = true;
			console.log('[FileTracker.initialize] FileTracker initialized successfully');

			// Process any events that occurred before initialization
			if (this.preInitQueue.length > 0) {
				console.log(`[FileTracker] Processing ${this.preInitQueue.length} pre-initialization events`);
				for (const event of this.preInitQueue) {
					await this.queueEvent(event);
				}
				this.preInitQueue = [];
			}
		} catch (error) {
			console.error('[FileTracker.initialize] Error during initialization:', error);
			throw error;
		}
	}

	private async queueFileForProcessing(file: TFile): Promise<void> {
		if (!this.settings || !this.supabaseService || !this.queueService) {
			console.warn('[ObsidianRAG] Services not properly initialized. Skipping file processing.');
			return;
		}

		try {
			// Get file metadata
			const metadata = await this.createFileMetadata(file);
			if (!metadata) {
				console.warn(`[ObsidianRAG] Failed to extract metadata for file: ${file.path}`);
				return;
			}

			// Create a processing task
			const task: ProcessingTask = {
				id: file.path,
				type: TaskType.CREATE,
				priority: 1,
				maxRetries: 3,
				retryCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				status: TaskStatus.PENDING,
				metadata,
				data: {}
			};

			// Add to queue
			await this.queueService.addTask(task);
			console.log(`[ObsidianRAG] Queued file for processing: ${file.path}`);
		} catch (error) {
			console.error(`[ObsidianRAG] Error queueing file for processing: ${file.path}`, error);
		}
	}

	private async processPendingChanges(): Promise<void> {
		if (this.pendingChanges.length === 0) {
			return;
		}

		console.log(`[FileTracker] Processing ${this.pendingChanges.length} pending changes`);
		for (const event of this.pendingChanges) {
			try {
				await this.queueEvent(event);
			} catch (error) {
				console.error('[FileTracker] Error processing pending change:', error);
				this.errorHandler.handleError(error, {
					context: 'FileTracker.processPendingChanges',
					metadata: { event }
				});
			}
		}
		this.pendingChanges = [];
	}

        /**
         * Reconcile database records with local sync file entries.
         * Ensures that each file in the vault has an up-to-date status in the database.
         * When a change is detected the Supabase record is explicitly marked as `pending`
         * so downstream processors (QueueService) know to re-vectorize the file before
         * eventually transitioning it back to `vectorized`.
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
                                                        await this.supabaseService.updateFileVectorizationStatus(metadata, 'pending');
                                                        console.log(`Database record updated to PENDING for modified file: ${file.path}`);
                                                }
                                        } else {
                                                // No valid record or not vectorized yet—create or update it in the database
                                                const metadata = await this.createFileMetadata(file);
                                                await this.supabaseService.updateFileVectorizationStatus(metadata, 'pending');
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
		if (!(file instanceof TFile)) return;
		const event: FileEvent = { type: 'create', file, timestamp: Date.now() };
		if (!this.isInitialized) {
			this.preInitQueue.push(event);
			console.log(`[ObsidianRAG] Queued create event for later processing: ${file.path}`);
			return;
		}
		await this.queueEvent(event);
	}

	/**
	 * Handle file modification events.
	 * Enhanced with change detection and intelligent debouncing.
	 */
	async handleModify(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile)) return;
		const event: FileEvent = { type: 'modify', file, timestamp: Date.now() };
		if (!this.isInitialized) {
			this.preInitQueue.push(event);
			console.log(`[ObsidianRAG] Queued modify event for later processing: ${file.path}`);
			return;
		}
		await this.queueEvent(event);
	}

	async handleDelete(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile)) return;
		const event: FileEvent = { type: 'delete', file, timestamp: Date.now() };
		if (!this.isInitialized) {
			this.preInitQueue.push(event);
			console.log(`[ObsidianRAG] Queued delete event for later processing: ${file.path}`);
			return;
		}
		await this.queueEvent(event);
	}

	async handleRename(file: TFile, oldPath: string): Promise<void> {
		if (!this.supabaseService || !this.settings?.vaultId) {
			console.warn('[ObsidianRAG] SupabaseService not initialized');
			return;
		}

		console.log(`[ObsidianRAG] Starting file rename process: ${oldPath} -> ${file.path}`);

		try {
			// Get the current file status before making any changes
			console.log(`[ObsidianRAG] Checking old file status for: ${oldPath}`);
			const oldFileStatus = await this.supabaseService.getFileStatus(oldPath);
			if (!oldFileStatus) {
				console.log(`[ObsidianRAG] No file status found for ${oldPath}, treating as new file`);
				await this.processFile(file);
				return;
			}
			console.log(`[ObsidianRAG] Found existing file status with ID: ${oldFileStatus.id}`);

			// Add a small delay to allow the file system to stabilize
			console.log(`[ObsidianRAG] Waiting for file system to stabilize...`);
			await new Promise(resolve => setTimeout(resolve, 100));

			// Check if there's already a record at the new path
			console.log(`[ObsidianRAG] Checking for existing record at new path: ${file.path}`);
			let newFileStatus: FileStatusRecord | null = null;
			try {
				newFileStatus = await this.supabaseService.getFileStatus(file.path);
				if (newFileStatus) {
					console.log(`[ObsidianRAG] Found existing record at new path with ID: ${newFileStatus.id}`);
				}
			} catch (error) {
				if (error instanceof Error && error.message?.includes('406')) {
					console.log(`[ObsidianRAG] 406 error when checking new path, treating as no existing record`);
				} else {
					console.error(`[ObsidianRAG] Error checking new path:`, error);
					throw error;
				}
			}

			// Calculate new hash to check if content changed
			console.log(`[ObsidianRAG] Calculating new file hash...`);
			const newHash = await this.calculateFileHash(file);
			const contentChanged = newHash !== oldFileStatus.content_hash;
			console.log(`[ObsidianRAG] Content changed during move: ${contentChanged}`);

			if (newFileStatus) {
				// If a record exists at the new path, we need to handle this conflict
				console.log(`[ObsidianRAG] Handling file status conflict at new path ${file.path}`);
				try {
					// First delete the old record's chunks and wait for completion
					console.log(`[ObsidianRAG] Deleting old chunks for file status ID: ${oldFileStatus.id}`);
					await this.supabaseService.deleteDocumentChunks(oldFileStatus.id);
					
					// Then delete the existing record's chunks at the new path
					console.log(`[ObsidianRAG] Deleting existing chunks at new path for file status ID: ${newFileStatus.id}`);
					await this.supabaseService.deleteDocumentChunks(newFileStatus.id);
					
					// Delete the old file status
					console.log(`[ObsidianRAG] Purging old file status record ID: ${oldFileStatus.id}`);
					await this.supabaseService.purgeFileStatus(oldFileStatus.id);
					
					// Delete the existing file status at the new path
					console.log(`[ObsidianRAG] Purging existing file status at new path ID: ${newFileStatus.id}`);
					await this.supabaseService.purgeFileStatus(newFileStatus.id);
					
					// Finally, process the file as new
					console.log(`[ObsidianRAG] Processing file as new after conflict resolution`);
					await this.processFile(file);
				} catch (error) {
					console.error(`[ObsidianRAG] Error handling file status conflict for ${file.path}:`, error);
					throw error;
				}
				return;
			}

			if (!contentChanged) {
				// If only the path changed, just update the path in the database
				console.log(`[ObsidianRAG] Only path changed, updating database record`);
				await this.supabaseService.updateFilePath(oldPath, file.path);
				console.log(`[ObsidianRAG] File path updated from ${oldPath} to ${file.path}`);
			} else {
				try {
					// If content changed, first delete old chunks and wait for completion
					console.log(`[ObsidianRAG] Content changed during move, deleting old chunks for file status ID: ${oldFileStatus.id}`);
					await this.supabaseService.deleteDocumentChunks(oldFileStatus.id);
					
					// Then delete the old file status
					console.log(`[ObsidianRAG] Purging old file status record ID: ${oldFileStatus.id}`);
					await this.supabaseService.purgeFileStatus(oldFileStatus.id);
					
					// Finally reprocess the file
					console.log(`[ObsidianRAG] Reprocessing file at new location: ${file.path}`);
					await this.processFile(file);
				} catch (error) {
					console.error(`[ObsidianRAG] Error reprocessing file ${file.path}:`, error);
					throw error;
				}
			}
		} catch (error) {
			console.error(`[ObsidianRAG] Error processing file ${file.path}:`, error);
			this.errorHandler.handleError(error, {
				context: 'FileTracker.handleRename',
				metadata: { filePath: file.path, oldPath }
			});
		}
	}

	async processFile(file: TFile): Promise<void> {
		if (!this.supabaseService || !this.settings) {
			console.warn('[ObsidianRAG] SupabaseService or settings not initialized');
			return;
		}

		try {
			// 1. Create or update file status
			const metadata = await this.createFileMetadata(file);
			const fileHash = await this.calculateFileHash(file);
			
			// Map metadata to FileStatusRecord format
			const fileStatus = await this.supabaseService.createOrUpdateFileStatus(
				this.settings.vaultId!,
				metadata.path,
				metadata.lastModified,
				fileHash,
				'vectorized',
                                metadata.tags || [],
                                metadata.aliases || [],
                                metadata.links || []
			);

			if (!fileStatus) {
				throw new Error('Failed to create or update file status');
			}

			// 2. Delete old chunks if they exist
			await this.supabaseService.deleteDocumentChunks(fileStatus.id);

			// 3. Create new chunks
			const chunks = await this.createDocumentChunks(file);
			await this.supabaseService.createDocumentChunks(fileStatus.id, chunks);

			console.log(`[ObsidianRAG] Successfully processed file: ${file.path}`);
		} catch (error) {
			console.error(`[ObsidianRAG] Error processing file ${file.path}:`, error);
			this.errorHandler.handleError(error, {
				context: 'FileTracker.processFile',
				metadata: { filePath: file.path }
			});
		}
	}

	private async createDocumentChunks(file: TFile): Promise<DocumentChunk[]> {
		if (!this.settings) {
			throw new Error('Settings not initialized');
		}

		try {
			const content = await this.vault.read(file);
			const chunks: DocumentChunk[] = [];
			let currentIndex = 0;
			let currentPosition = 0;

			while (currentPosition < content.length) {
				const chunkSize = Math.min(
					this.settings.chunking.chunkSize,
					content.length - currentPosition
				);
				const chunkContent = content.slice(
					currentPosition,
					currentPosition + chunkSize
				);

				// Create a partial chunk first
				const chunk: Partial<DocumentChunk> = {
					content: chunkContent,
					chunk_index: currentIndex,
					metadata: {
						obsidianId: file.path,
						path: file.path,
						lastModified: file.stat.mtime,
						created: file.stat.ctime,
						size: file.stat.size
					},
					vault_id: this.settings.vaultId!,
					embedding: [], // Will be populated later
					vectorized_at: new Date().toISOString()
				};

				// Push as DocumentChunk (file_status_id will be set when saving to database)
				chunks.push(chunk as DocumentChunk);

				currentIndex++;
				currentPosition += chunkSize - (this.settings.chunking.chunkOverlap || 0);
			}

			return chunks;
		} catch (error) {
			console.error(`[ObsidianRAG] Error creating chunks for ${file.path}:`, error);
			throw error;
		}
	}

	/**
	 * Queue an event for processing with intelligent debouncing.
	 */
	private async queueEvent(event: FileEvent): Promise<void> {
		// Add the event to the queue
		this.eventQueue.push(event);

		// If not initialized, just keep the event in the queue
		if (!this.isInitialized) {
			return;
		}

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
					e.file?.path === event.file?.path &&
					e.type === 'modify' &&
					(event.timestamp - e.timestamp) < 5000
				);

				if (recentEvents.length > 3) {
					// Multiple rapid changes detected, increase debounce time
					debounceTime = Math.max(debounceTime * 2, 3000);
					console.log(`Increased debounce time to ${debounceTime}ms for rapid changes to ${event.file?.path}`);
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
		console.log(`[ObsidianRAG] Processing ${this.eventQueue.length} queued events`);

		try {
			// Group events by file path for intelligent processing
			const eventsByPath = new Map<string, FileEvent[]>();

			for (const event of this.eventQueue) {
				const path = event.file?.path || event.path || '';
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

			// Process rename events sequentially to prevent race conditions
			for (const path of deleteFirst) {
				const events = eventsByPath.get(path);
				if (events) {
					// Sort events by timestamp to ensure correct order
					events.sort((a, b) => a.timestamp - b.timestamp);
					
					// Process rename events first
					const renameEvents = events.filter(e => e.type === 'rename');
					const otherEvents = events.filter(e => e.type !== 'rename');
					
					// Process rename events one at a time
					for (const event of renameEvents) {
						await this.processFileEvents(path, [event]);
					}
					
					// Then process other events
					if (otherEvents.length > 0) {
						await this.processFileEvents(path, otherEvents);
					}
				}
			}

			// Clear the event queue
			this.eventQueue = [];

		} catch (error) {
			console.error(`[ObsidianRAG] Error processing event queue:`, error);
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
		if (!this.settings?.vaultId || !this.supabaseService) {
			console.warn('[ObsidianRAG] Settings or SupabaseService not initialized. Skipping file change processing.');
			return;
		}

		try {
			const finalEvent = events[events.length - 1];
			const file = finalEvent.file || (finalEvent.path ? this.vault.getAbstractFileByPath(finalEvent.path) : null);

			if (!file || !(file instanceof TFile)) {
				return;
			}

			// For rename events, handle them immediately
			if (finalEvent.type === 'rename' && finalEvent.oldPath) {
				const exclusions = this.getAllExclusions();
				const isExcluded = await this.supabaseService.isFileExcluded(path, exclusions);

				if (isExcluded) {
					console.log(`[ObsidianRAG] File moved to excluded location: ${path}`);
					// Queue a delete task for the old path
					await this.queueEvent({
						type: 'delete',
						path: finalEvent.oldPath,
						file: null,
						oldPath: undefined,
						timestamp: Date.now()
					});
					return;
				}

				// Check if the file already exists in the new location
				const existingStatus = await this.supabaseService.getFileVectorizationStatus(path);
				if (existingStatus && existingStatus.isVectorized) {
					console.log(`[ObsidianRAG] File already exists in new location: ${path}`);
					return;
				}

				// Update the file path in the database
				await this.supabaseService.updateFilePath(finalEvent.oldPath, path);
				console.log(`[ObsidianRAG] File path updated from ${finalEvent.oldPath} to ${path}`);

				// No need to update status since only the path changed, not the content
				return;
			}

			// For other event types, proceed with normal processing
			const newHash = finalEvent.hash || await this.calculateFileHash(file);
			let needsVectorizing = true;

			if (this.supabaseService) {
				try {
					needsVectorizing = await this.supabaseService.needsVectorizing(
						path,
						file.stat.mtime,
						newHash
					);

					if (!needsVectorizing) {
						console.log(`File ${path} does not need vectorizing - no significant changes`);
					}
				} catch (error) {
					console.error('Error checking if file needs vectorizing:', error);
					needsVectorizing = true;
				}
			}

			this.recentChanges.set(path, {
				lastModified: file.stat.mtime,
				hash: newHash,
				lastProcessed: Date.now()
			});

                        if (needsVectorizing) {
                                console.log(`Updating status for ${path} with hash ${newHash.substring(0, 8)}...`);
                                const metadata = await this.createFileMetadata(file);
                                if (metadata.customMetadata) {
                                        metadata.customMetadata.contentHash = newHash;
                                }
                                // Mark the file as pending so downstream processors know to re-vectorize it
                                await this.supabaseService.updateFileVectorizationStatus(metadata, 'pending');
                        }
                } catch (error) {
                        console.error(`[ObsidianRAG] Error processing file events for ${path}:`, error);
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
	 * Determines if a file should be tracked based on exclusion rules.
	 * For rename events, we always track the file to handle moves to excluded locations.
	 */
	public shouldTrackFile(file: TFile | string, eventType?: 'create' | 'modify' | 'delete' | 'rename'): boolean {
		const filePath = typeof file === 'string' ? file : file.path;
		const fileType = typeof file === 'string' ? file.split('.').pop() || '' : file.extension;

		// For rename events, always track the file to handle moves to excluded locations
		if (eventType === 'rename') {
			return true;
		}

		// Check if file is in an excluded folder
		const isExcludedFolder = this.settings?.exclusions.excludedFolders.some((folder: string) => 
			filePath.startsWith(folder)
		) || false;

		if (isExcludedFolder) {
			console.log(`[ObsidianRAG] Skipping file in excluded folder: ${filePath}`);
			return false;
		}

		// Check if file type is excluded
		if (this.settings?.exclusions.excludedFileTypes.includes(fileType)) {
			console.log(`[ObsidianRAG] Skipping excluded file type: ${fileType}`);
			return false;
		}

		// Check if file name starts with an excluded prefix
		const fileName = filePath.split('/').pop() || '';
		if (this.settings?.exclusions.excludedFilePrefixes.some((prefix: string) => 
			fileName.startsWith(prefix)
		)) {
			console.log(`[ObsidianRAG] Skipping file with excluded prefix: ${fileName}`);
			return false;
		}

		// Check if file is in the specific excluded files list
		if (this.settings?.exclusions.excludedFiles.includes(filePath)) {
			console.log(`[ObsidianRAG] Skipping specifically excluded file: ${filePath}`);
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

	/**
	 * Checks for changes in exclusion settings and triggers cleanup if needed
	 */
	private async checkExclusionChanges(): Promise<void> {
		const currentExclusions = this.getAllExclusions();
		
		// Check if any exclusions have changed
		const hasChanges = 
			JSON.stringify(currentExclusions.excludedFolders) !== JSON.stringify(this.lastExclusions.excludedFolders) ||
			JSON.stringify(currentExclusions.excludedFileTypes) !== JSON.stringify(this.lastExclusions.excludedFileTypes) ||
			JSON.stringify(currentExclusions.excludedFilePrefixes) !== JSON.stringify(this.lastExclusions.excludedFilePrefixes) ||
			JSON.stringify(currentExclusions.excludedFiles) !== JSON.stringify(this.lastExclusions.excludedFiles);

		if (hasChanges) {
			console.log('Exclusion settings changed, cleaning up database...');
			try {
				if (this.supabaseService && this.settings?.vaultId) {
					const removedCount = await this.supabaseService.removeExcludedFiles(
						this.settings.vaultId,
						currentExclusions
					);
					console.log(`Removed ${removedCount} files from database due to exclusion changes`);
				}
			} catch (error) {
				console.error('Error cleaning up excluded files:', error);
			}
		}

		// Update last known exclusions
		this.lastExclusions = currentExclusions;
	}

	/**
	 * Handles file moves to check if files are moved to excluded folders
	 */
	private async handleFileMove(oldPath: string, newPath: string): Promise<void> {
		// Check if we have the minimum required services
		if (!this.settings?.vaultId) {
			console.warn('[ObsidianRAG] Settings not properly initialized. Skipping file move handling.');
			return;
		}

		try {
			// Check if the new path is in an excluded folder
			const exclusions = this.getAllExclusions();
			const isExcluded = this.supabaseService 
				? await this.supabaseService.isFileExcluded(newPath, exclusions)
				: false;

			if (isExcluded) {
				console.log(`[ObsidianRAG] File moved to excluded location: ${newPath}`);
				if (this.supabaseService) {
					// Remove the file from the database
					await this.supabaseService.removeExcludedFiles(this.settings.vaultId, exclusions);
				}
				return;
			}

			// Update the file path in the database if SupabaseService is available
			if (this.supabaseService) {
				await this.supabaseService.updateFilePath(oldPath, newPath);
				console.log(`[ObsidianRAG] File path updated from ${oldPath} to ${newPath}`);
			} else {
				console.log(`[ObsidianRAG] SupabaseService not available. File move recorded: ${oldPath} -> ${newPath}`);
			}
		} catch (error) {
			console.error(`[ObsidianRAG] Error handling file move from ${oldPath} to ${newPath}:`, error);
		}
	}

	private async onFileChange(event: FileEvent): Promise<void> {
		// Check if we have the minimum required settings
		if (!this.settings?.vaultId) {
			console.warn('[ObsidianRAG] Settings not properly initialized. Skipping file change handling.');
			return;
		}

		try {
			// Queue all events, including renames
			await this.queueEvent(event);
		} catch (error) {
			console.error(`[ObsidianRAG] Error handling file change for ${event.path || 'unknown'}:`, error);
		}
	}

	private getAllExclusions(): {
		excludedFolders: string[];
		excludedFileTypes: string[];
		excludedFilePrefixes: string[];
		excludedFiles: string[];
	} {
		if (!this.settings?.exclusions) {
			return {
				excludedFolders: [],
				excludedFileTypes: [],
				excludedFilePrefixes: [],
				excludedFiles: []
			};
		}

		return {
			excludedFolders: this.settings.exclusions.excludedFolders || [],
			excludedFileTypes: this.settings.exclusions.excludedFileTypes || [],
			excludedFilePrefixes: this.settings.exclusions.excludedFilePrefixes || [],
			excludedFiles: this.settings.exclusions.excludedFiles || []
		};
	}

	private async processFileChange(event: FileEvent): Promise<void> {
		if (!this.settings?.vaultId || !this.supabaseService) {
			console.warn('[ObsidianRAG] Settings or SupabaseService not initialized. Skipping file change processing.');
			return;
		}

		try {
			// Handle file renames
			if (event.type === 'rename' && event.oldPath && event.path) {
				const exclusions = this.getAllExclusions();
				const isExcluded = await this.supabaseService.isFileExcluded(event.path, exclusions);

				if (isExcluded) {
					console.log(`[ObsidianRAG] File moved to excluded location: ${event.path}`);
					// Queue a delete task for the old path
					await this.queueEvent({
						type: 'delete',
						path: event.oldPath,
						file: null,
						oldPath: undefined,
						timestamp: Date.now()
					});
					return;
				}

				// Check if the file already exists in the new location
				const existingStatus = await this.supabaseService.getFileVectorizationStatus(event.path);
				if (existingStatus && existingStatus.isVectorized) {
					console.log(`[ObsidianRAG] File already exists in new location: ${event.path}`);
					return;
				}

				// Update the file path in the database
				await this.supabaseService.updateFilePath(event.oldPath, event.path);
				console.log(`[ObsidianRAG] File path updated from ${event.oldPath} to ${event.path}`);
			}
		} catch (error) {
			console.error(`[ObsidianRAG] Error processing file change for ${event.path || 'unknown'}:`, error);
		}
	}

	/**
	 * Returns whether the FileTracker is properly initialized.
	 */
	public getInitializationStatus(): boolean {
		return this.isInitialized;
	}
}