import { InitialSyncManager } from '../services/InitialSyncManager';
import type { NotificationManager } from '../utils/NotificationManager';
import type { ErrorHandler } from '../utils/ErrorHandler';
import type { ProcessingTask } from '../models/ProcessingTask';
import type { DocumentMetadata } from '../models/DocumentChunk';
import { TaskStatus, TaskType } from '../models/ProcessingTask';

jest.mock('p-limit', () => ({
        __esModule: true,
        default: () => async (fn: () => Promise<void>) => fn(),
}));

class MockQueueService {
        private listeners = new Map<string, Array<(payload: any) => void>>();

        on(event: string, callback: (data: any) => void): () => void {
                const callbacks = this.listeners.get(event) ?? [];
                callbacks.push(callback);
                this.listeners.set(event, callbacks);
                return () => {
                        const list = this.listeners.get(event);
                        if (!list) return;
                        this.listeners.set(
                                event,
                                list.filter(cb => cb !== callback),
                        );
                };
        }

        emit(event: string, payload: any): void {
                this.listeners.get(event)?.forEach(cb => cb(payload));
        }
}

describe('InitialSyncManager mode-specific flows', () => {
        const metadata: DocumentMetadata = {
                obsidianId: 'Note.md',
                path: 'Note.md',
                lastModified: 1,
                created: 1,
                size: 10,
                customMetadata: {},
        };
        let queueService: MockQueueService;
        const syncManager = { updateSyncStatus: jest.fn() };
        const notificationManager = { updateProgress: jest.fn(), clear: jest.fn(), showNotification: jest.fn() } as unknown as NotificationManager;
        const errorHandler = { handleError: jest.fn() } as unknown as ErrorHandler;
        const metadataExtractor = { extractMetadata: jest.fn(), extractMetadataFromContent: jest.fn() } as any;

        beforeEach(() => {
                jest.clearAllMocks();
                queueService = new MockQueueService();
        });

        const createTask = (): ProcessingTask => ({
                id: metadata.path,
                type: TaskType.CREATE,
                status: TaskStatus.PENDING,
                priority: 1,
                maxRetries: 3,
                retryCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata,
                data: {},
        });

        const instantiate = (supabaseService: any) =>
                new InitialSyncManager(
                        {} as any,
                        queueService as any,
                        null,
                        syncManager as any,
                        metadataExtractor,
                        errorHandler,
                        notificationManager,
                        supabaseService,
                        { batchSize: 1 },
                );

        it('updates local sync status when completing tasks offline', async () => {
                        const manager = instantiate(null);
                        (manager as any).pendingFileMetadata.set(metadata.path, { metadata, hash: 'abc', lastModified: 123 });

                        queueService.emit('task-completed', { task: createTask() });
                        await Promise.resolve();

                        expect(syncManager.updateSyncStatus).toHaveBeenCalledWith(
                                metadata.path,
                                'OK',
                                expect.objectContaining({ hash: 'abc' }),
                        );
                        expect((manager as any).pendingFileMetadata.size).toBe(0);
        });

        it('marks failed offline tasks in sync metadata and logs the failure', async () => {
                        const manager = instantiate(null);
                        (manager as any).pendingFileMetadata.set(metadata.path, { metadata, hash: 'abc', lastModified: 123 });
                        const error = new Error('queue failed');

                        queueService.emit('task-failed', { task: createTask(), error });
                        await Promise.resolve();

                        expect(syncManager.updateSyncStatus).toHaveBeenCalledWith(
                                metadata.path,
                                'FAILED',
                                expect.objectContaining({ hash: 'abc' }),
                        );
                        expect(errorHandler.handleError).toHaveBeenCalledWith(
                                error,
                                expect.objectContaining({ context: 'InitialSyncManager.queueTaskFailed' }),
                        );
        });

        it('avoids sync file updates when Supabase is available (online mode)', async () => {
                        const manager = instantiate({});
                        (manager as any).pendingFileMetadata.set(metadata.path, { metadata, hash: 'abc', lastModified: 123 });

                        queueService.emit('task-completed', { task: createTask() });
                        await Promise.resolve();

                        expect(syncManager.updateSyncStatus).not.toHaveBeenCalled();
                        expect((manager as any).pendingFileMetadata.size).toBe(0);
        });
});
