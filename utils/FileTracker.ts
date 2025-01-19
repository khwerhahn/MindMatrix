import { TAbstractFile, TFile, Vault } from 'obsidian';
import { ErrorHandler } from '../utils/ErrorHandler';
import { DocumentMetadata } from '../models/DocumentChunk';

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

    constructor(
        private vault: Vault,
        private errorHandler: ErrorHandler
    ) {}

    /**
     * Initialize the file tracker with existing files
     */
    async initialize(): Promise<void> {
        const files = this.vault.getFiles();
        for (const file of files) {
            try {
                const hash = await this.calculateFileHash(file);
                this.fileCache.set(file.path, {
                    path: file.path,
                    hash,
                    lastModified: file.stat.mtime
                });
            } catch (error) {
                this.errorHandler.handleError(error, {
                    context: 'FileTracker.initialize',
                    metadata: { filePath: file.path }
                });
            }
        }
    }

    /**
     * Handle file creation events
     */
    async handleCreate(file: TAbstractFile): Promise<void> {
        if (!(file instanceof TFile)) return;

        const event: FileEvent = {
            type: 'create',
            file,
            timestamp: Date.now()
        };

        this.queueEvent(event);
    }

    /**
     * Handle file modification events
     */
    async handleModify(file: TAbstractFile): Promise<void> {
        if (!(file instanceof TFile)) return;

        const event: FileEvent = {
            type: 'modify',
            file,
            timestamp: Date.now()
        };

        this.queueEvent(event);
    }

    /**
     * Handle file deletion events
     */
    async handleDelete(file: TAbstractFile): Promise<void> {
        if (!(file instanceof TFile)) return;

        const event: FileEvent = {
            type: 'delete',
            file,
            timestamp: Date.now()
        };

        this.queueEvent(event);
        this.fileCache.delete(file.path);
    }

    /**
     * Handle file rename events
     */
    async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
        if (!(file instanceof TFile)) return;

        const event: FileEvent = {
            type: 'rename',
            file,
            oldPath,
            timestamp: Date.now()
        };

        this.queueEvent(event);
        if (this.fileCache.has(oldPath)) {
            const cache = this.fileCache.get(oldPath);
            if (cache) {
                this.fileCache.delete(oldPath);
                this.fileCache.set(file.path, {
                    ...cache,
                    path: file.path
                });
            }
        }
    }

    /**
     * Queue an event for processing
     */
    private queueEvent(event: FileEvent): void {
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
        }

        // Emit the appropriate event
        await this.emitFileChange(finalEvent);
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
        return {
            obsidianId: file.path,
            path: file.path,
            lastModified: file.stat.mtime,
            created: file.stat.ctime,
            size: file.stat.size,
            customMetadata: await this.extractCustomMetadata(file)
        };
    }

    /**
     * Extract custom metadata from file (e.g., frontmatter)
     */
    private async extractCustomMetadata(file: TFile): Promise<Record<string, unknown>> {
        try {
            const content = await this.vault.read(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

            if (frontmatterMatch) {
                const frontmatter = frontmatterMatch[1];
                const metadata: Record<string, unknown> = {};

                frontmatter.split('\n').forEach(line => {
                    const [key, ...valueParts] = line.split(':');
                    if (key && valueParts.length > 0) {
                        const value = valueParts.join(':').trim();
                        metadata[key.trim()] = value;
                    }
                });

                return metadata;
            }

            return {};
        } catch (error) {
            this.errorHandler.handleError(error, {
                context: 'FileTracker.extractCustomMetadata',
                metadata: { filePath: file.path }
            });
            return {};
        }
    }

    /**
     * Event emitter for file changes
     */
    private async emitFileChange(event: FileEvent): Promise<void> {
        // Implementation will depend on how you want to handle these events
        // This could emit events to the QueueService or directly to the database
        console.log('File change detected:', event);
    }

    /**
     * Get cached file information
     */
    public getFileCache(path: string): FileCache | undefined {
        return this.fileCache.get(path);
    }

    /**
     * Clear file cache
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
}
