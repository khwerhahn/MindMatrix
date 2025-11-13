import { ErrorHandler } from '../utils/ErrorHandler';
import type { DebugSettings } from '../settings/Settings';
import { Notice } from 'obsidian';

describe('ErrorHandler notices', () => {
        const baseSettings: DebugSettings = {
                enableDebugLogs: false,
                logLevel: 'error',
                logToFile: false
        };

        beforeEach(() => {
                (Notice as unknown as jest.Mock).mockClear();
        });

        it('uses the normalized error message for non-Error inputs', () => {
                const handler = new ErrorHandler(baseSettings);

                handler.handleError('string failure', { context: 'Testing' });

                expect((Notice as unknown as jest.Mock).mock.calls[0][0]).toContain('string failure');
        });

        it('includes contextual metadata when available', () => {
                const handler = new ErrorHandler(baseSettings);

                handler.handleError(new Error('Task failed'), {
                        context: 'Queue processor',
                        taskId: 'task-123',
                        taskType: 'sync',
                        metadata: { file: 'note.md' }
                });

                const noticeArg = (Notice as unknown as jest.Mock).mock.calls[0][0] as string;

                expect(noticeArg).toContain('Task failed');
                expect(noticeArg).toContain('Queue processor');
                expect(noticeArg).toContain('Queue task error');

                const [log] = handler.getRecentLogs();
                expect(log.context.taskId).toBe('task-123');
                expect(log.context.metadata).toEqual({ file: 'note.md' });
        });
});

describe('ErrorHandler logging controls', () => {
        const settings: DebugSettings = {
                enableDebugLogs: false,
                logLevel: 'debug',
                logToFile: false,
        };

        beforeEach(() => {
                (Notice as unknown as jest.Mock).mockClear();
        });

        it('skips warn-level logging when the configured log level is stricter', () => {
                const handler = new ErrorHandler({ ...settings, logLevel: 'error' });
                handler.handleError(new Error('warn-only'), { context: 'Queue' }, 'warn');

                expect(handler.getRecentLogs()).toHaveLength(0);
                expect(Notice as unknown as jest.Mock).not.toHaveBeenCalled();
        });

        it('categorizes database errors and stores friendly details', () => {
                const handler = new ErrorHandler(settings);
                handler.handleError(new Error('Database connection lost'), { context: 'SupabaseService.connect' });

                const [log] = handler.getRecentLogs();
                expect(log.category).toBe('database');
                expect(log.friendlyMessage).toContain('Database request failed');
                expect(Notice as unknown as jest.Mock).toHaveBeenCalledTimes(1);
        });
});
