import { OfflineQueueManager, OfflineOperation } from '../services/OfflineQueueManager';
import type { ErrorHandler } from '../utils/ErrorHandler';

describe('OfflineQueueManager reconciliation', () => {
        const errorHandler = { handleError: jest.fn() } as unknown as ErrorHandler;
        const createManager = (supabaseService: any) => {
                const syncFileManager = { updateSyncStatus: jest.fn() };
                const manager = new OfflineQueueManager(errorHandler, supabaseService, syncFileManager as any);
                return { manager, syncFileManager };
        };

        beforeEach(() => {
                jest.clearAllMocks();
        });

        it('updates Supabase when queued create operations are replayed', async () => {
                const supabaseService = {
                        updateFileVectorizationStatus: jest.fn().mockResolvedValue(undefined),
                };
                const { manager } = createManager(supabaseService);
                const operation: OfflineOperation = {
                        id: 'op-1',
                        fileId: 'Note.md',
                        operationType: 'create',
                        timestamp: Date.now(),
                        metadata: { contentHash: 'abc', lastModified: 123 },
                        status: 'pending',
                };
                (manager as any).queue = [operation];

                await manager.processQueue();

                expect(supabaseService.updateFileVectorizationStatus).toHaveBeenCalledWith(
                        expect.objectContaining({
                                obsidianId: 'Note.md',
                                customMetadata: { contentHash: 'abc' },
                        }),
                );
                expect((manager as any).queue).toHaveLength(0);
        });

        it('falls back to SyncFileManager when deleting offline without Supabase connectivity', async () => {
                const syncFileManager = { updateSyncStatus: jest.fn().mockResolvedValue(undefined) };
                const manager = new OfflineQueueManager(errorHandler, null, syncFileManager as any);
                const operation: OfflineOperation = {
                        id: 'op-2',
                        fileId: 'Note.md',
                        operationType: 'delete',
                        timestamp: Date.now(),
                        status: 'pending',
                };
                (manager as any).queue = [operation];
                const originalNavigator = (global as any).navigator;
                (global as any).navigator = { onLine: true };

                await manager.processQueue();

                expect(syncFileManager.updateSyncStatus).toHaveBeenCalledWith('Note.md', 'OK', expect.any(Object));
                expect((manager as any).queue).toHaveLength(0);
                (global as any).navigator = originalNavigator;
        });
});
