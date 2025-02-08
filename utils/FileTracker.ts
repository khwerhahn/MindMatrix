// src/utils/FileTracker.ts

import { TAbstractFile, TFile, Vault } from 'obsidian';
import { ErrorHandler } from './ErrorHandler';
import { DocumentMetadata } from '../models/DocumentChunk';
import { SyncFileManager } from '../services/SyncFileManager';

interface FileEvent {
	type: 'create' | 'modify' | 'delete' | 'rename';
	file: TFile;
	oldPath?: string;
	timestamp: number;
}

interface FileCache {
	path: string;
	hash: string;
	lastModified: number;
	lastSynced?: number;
}

export class FileTracker {
	private fileCache: Map<string, FileCache> = new Map();
	private eventQueue: FileEvent[] = [];
	private isProcessing: boolean = false;
	private processingTimeout: number = 1000; // Debounce time in ms
	private syncManager: SyncFileManager;

	constructor(
		private vault: Vault,
		private errorHandler: ErrorHandler,
		syncFilePath: string = '_mindmatrixsync.md'
	) {
		this.syncManager = new SyncFileManager(vault, errorHandler, syncFilePath);
	}

	/**
	 * Initialize the file tracker and sync manager
	 */
	async initialize(): Promise<void> {
		try {
			// Initialize sync manager first
			await this.syncManager.initialize();

			// Get existing sync entries
			const syncEntries = await this.syncManager.getAllSyncEntries();

			// Initialize cache from sync entries, excluding sync files
			for (const entry of syncEntries) {
				if (this.shouldTrackFile(entry.filePath)) {
					this.fileCache.set(entry.filePath, {
						path: entry.filePath,
						hash: entry.hash,
						lastModified: entry.lastModified,
						lastSynced: entry.lastSynced
					});
				}
			}

			// Scan vault for new or modified files
			const files = this.vault.getFiles();
			for (const file of files) {
				try {
					if (!this.shouldTrackFile(file.path)) {
						continue;
					}

					const hash = await this.calculateFileHash(file);
					const existing = this.fileCache.get(file.path);

					if (!existing || existing.hash !== hash) {
						this.fileCache.set(file.path, {
							path: file.path,
							hash,
							lastModified: file.stat.mtime
						});

						// Update sync status for modified files
						await this.syncManager.updateSyncStatus(file.path, 'PENDING', {
							lastModified: file.stat.mtime,
							hash
						});
					}
				} catch (error) {
					this.errorHandler.handleError(error, {
						context: 'FileTracker.initialize',
						metadata: { filePath: file.path }
					});
				}
			}

			// Clean up entries for files that no longer exist
			const allPaths = new Set(files.map(f => f.path));
			for (const [path, cache] of this.fileCache.entries()) {
				if (!allPaths.has(path)) {
					this.fileCache.delete(path);
				}
			}

		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'FileTracker.initialize'
			});
			throw error;
		}
	}

	/**
	 * Handle file creation events
	 */
	async handleCreate(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) {
			return;
		}

		const event: FileEvent = {
			type: 'create',
			file,
			timestamp: Date.now()
		};

		await this.queueEvent(event);
	}

	/**
	 * Handle file modification events
	 */
	async handleModify(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) {
			return;
		}

		const event: FileEvent = {
			type: 'modify',
			file,
			timestamp: Date.now()
		};

		await this.queueEvent(event);
	}

	/**
	 * Handle file deletion events
	 */
	async handleDelete(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) {
			return;
		}

		const event: FileEvent = {
			type: 'delete',
			file,
			timestamp: Date.now()
		};

		await this.queueEvent(event);
		this.fileCache.delete(file.path);

		// Update sync status to reflect deletion
		await this.syncManager.updateSyncStatus(file.path, 'OK', {
			lastModified: Date.now(),
			hash: ''  // Empty hash indicates deletion
		});
	}

	/**
	 * Handle file rename events
	 */
	async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!(file instanceof TFile) || !this.shouldTrackFile(file.path)) {
			return;
		}

		const event: FileEvent = {
			type: 'rename',
			file,
			oldPath,
			timestamp: Date.now()
		};

		await this.queueEvent(event);

		// Update cache and sync status for renamed file
		if (this.fileCache.has(oldPath)) {
			const cache = this.fileCache.get(oldPath);
			if (cache) {
				this.fileCache.delete(oldPath);
				const newHash = await this.calculateFileHash(file);
				this.fileCache.set(file.path, {
					...cache,
					path: file.path,
					hash: newHash,
					lastModified: file.stat.mtime
				});

				// Update sync status for both old and new paths
				await this.syncManager.updateSyncStatus(oldPath, 'OK', {
					lastModified: Date.now(),
					hash: ''  // Empty hash indicates deletion/move
				});

				await this.syncManager.updateSyncStatus(file.path, 'PENDING', {
					lastModified: file.stat.mtime,
					hash: newHash
				});
			}
		}
	}

	private shouldTrackFile(filePath: string): boolean {
		// Never track sync files
		if (filePath === this.syncFilePath ||
			filePath.endsWith('_mindmatrixsync.md') ||
			filePath.endsWith('_mindmatrixsync.md.backup')) {
			return false;
		}
		return true;
	}

	/**
	 * Queue an event for processing
	 */
	private async queueEvent(event: FileEvent): Promise<void> {
		this.eventQueue.push(event);

		if (!this.isProcessing) {
			setTimeout(() => this.processEventQueue(), this.processingTimeout);
		}
	}

	/**
	 * Process queued events with debouncing
	 */
	private async processEventQueue(): Promise<void> {
		if (this.isProcessing || this.eventQueue.length === 0) return;

		this.isProcessing = true;

		try {
			// Group events by file path
			const eventsByPath = new Map<string, FileEvent[]>();

			for (const event of this.eventQueue) {
				const path = event.file.path;
				if (!eventsByPath.has(path)) {
					eventsByPath.set(path, []);
				}
				eventsByPath.get(path)?.push(event);
			}

			// Process each file's events
			for (const [path, events] of eventsByPath) {
				await this.processFileEvents(path, events);
			}

			// Clear the queue
			this.eventQueue = [];

		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'FileTracker.processEventQueue'
			});
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Process all events for a single file
	 */
	private async processFileEvents(path: string, events: FileEvent[]): Promise<void> {
		// Sort events by timestamp
		events.sort((a, b) => a.timestamp - b.timestamp);

		// Get the final state after all events
		const finalEvent = events[events.length - 1];

		try {
			// Calculate new hash for existing files
			if (finalEvent.type !== 'delete') {
				const newHash = await this.calculateFileHash(finalEvent.file);
				const existingCache = this.fileCache.get(path);

				// Check if file actually changed
				if (existingCache && existingCache.hash === newHash) {
					return; // No real change
				}

				// Update cache
				this.fileCache.set(path, {
					path,
					hash: newHash,
					lastModified: finalEvent.file.stat.mtime
				});

				// Update sync status
				await this.syncManager.updateSyncStatus(path, 'PENDING', {
					lastModified: finalEvent.file.stat.mtime,
					hash: newHash
				});
			}
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'FileTracker.processFileEvents',
				metadata: { path, eventType: finalEvent.type }
			});
		}
	}

	/**
	 * Calculate a hash of file contents
	 */
	private async calculateFileHash(file: TFile): Promise<string> {
		try {
			const content = await this.vault.read(file);
			return await this.hashString(content);
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'FileTracker.calculateFileHash',
				metadata: { filePath: file.path }
			});
			return '';
		}
	}

	/**
	 * Create a hash from a string
	 */
	private async hashString(str: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(str);
		const buffer = await crypto.subtle.digest('SHA-256', data);
		return Array.from(new Uint8Array(buffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
	}

	/**
	 * Create metadata for a file
	 */
	public async createFileMetadata(file: TFile): Promise<DocumentMetadata> {
		try {
			const content = await this.vault.read(file);
			const lineCount = content.split('\n').length;

			return {
				obsidianId: file.path,
				path: file.path,
				lastModified: file.stat.mtime,
				created: file.stat.ctime,
				size: file.stat.size,
				customMetadata: {},
				// Add n8n compatible metadata
				loc: {
					lines: {
						from: 1,
						to: lineCount
					}
				},
				source: "obsidian",
				file_id: file.path,
				blobType: "text/markdown"
			};
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'FileTracker.createFileMetadata',
				metadata: { filePath: file.path }
			});
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
	 * Clear file cache and queue
	 */
	public clearCache(): void {
		this.fileCache.clear();
		this.eventQueue = [];
	}

	/**
	 * Update processing timeout
	 */
	public setProcessingTimeout(timeout: number): void {
		this.processingTimeout = timeout;
	}

	/**
	 * Get sync status for a file
	 */
	public async getSyncStatus(path: string) {
		return await this.syncManager.getSyncStatus(path);
	}

	/**
	 * Get all sync statuses
	 */
	public async getAllSyncStatuses() {
		return await this.syncManager.getAllSyncEntries();
	}
}
