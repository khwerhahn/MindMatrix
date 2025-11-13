import { QueueService } from '../services/QueueService';
import { TaskType, TaskStatus, ProcessingTask, TaskProcessingError } from '../models/ProcessingTask';
import type { ErrorHandler } from '../utils/ErrorHandler';
import type { NotificationManager } from '../utils/NotificationManager';
import { Vault } from 'obsidian';
import type { DocumentMetadata } from '../models/DocumentChunk';

const createMetadata = (): DocumentMetadata => ({
        obsidianId: 'Note.md',
        path: 'Note.md',
        lastModified: Date.now(),
        created: Date.now(),
        size: 10,
        customMetadata: {},
});

const createTask = (id: string, type: TaskType): ProcessingTask => ({
        id,
        type,
        status: TaskStatus.PENDING,
        priority: 1,
        maxRetries: 3,
        retryCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: createMetadata(),
        data: {},
});

const buildQueueService = () => {
        const errorHandler = { handleError: jest.fn() } as unknown as ErrorHandler;
        const notificationManager = { updateProgress: jest.fn(), clear: jest.fn() } as unknown as NotificationManager;
        const queueService = new QueueService(2, 3, null as any, null as any, errorHandler, notificationManager, new Vault() as any);
        return queueService;
};

describe('QueueService edge cases', () => {
        it('throws when attempting to enqueue beyond the max queue size', async () => {
                const queueService = buildQueueService();
                (queueService as any).queue = Array(1000).fill(createTask('existing', TaskType.CREATE));

                await expect(queueService.addTask(createTask('overflow', TaskType.CREATE))).rejects.toThrow(
                        TaskProcessingError.QUEUE_FULL,
                );
        });

        it('replaces existing tasks with delete operations and prioritizes them', async () => {
                const queueService = buildQueueService();
                await queueService.addTask(createTask('Note.md', TaskType.CREATE));
                await queueService.addTask(createTask('Note.md', TaskType.DELETE));

                const queue = (queueService as any).queue;
                expect(queue).toHaveLength(1);
                expect(queue[0].type).toBe(TaskType.DELETE);
                expect(queue[0].priority).toBe(3);
        });

        it('ignores update tasks when a delete task for the same file is pending', async () => {
                const queueService = buildQueueService();
                await queueService.addTask(createTask('Note.md', TaskType.DELETE));
                await queueService.addTask(createTask('Note.md', TaskType.UPDATE));

                const queue = (queueService as any).queue;
                expect(queue).toHaveLength(1);
                expect(queue[0].type).toBe(TaskType.DELETE);
        });
});
