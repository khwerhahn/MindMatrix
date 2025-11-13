import { SupabaseService } from '@/services/SupabaseService';
import { DEFAULT_SETTINGS, type ObsidianRAGSettings } from '@/settings/Settings';
import { createClient } from '@supabase/supabase-js';

type MockClient = {
        from: jest.Mock;
};

type QueryResult<T> = { data: T; error: null };

type FileStatusRecord = { file_path: string };

jest.mock('@supabase/supabase-js', () => ({
        createClient: jest.fn()
}));

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

const baseSettings: ObsidianRAGSettings = {
        ...DEFAULT_SETTINGS,
        vaultId: 'vault-123',
        supabase: {
                ...DEFAULT_SETTINGS.supabase,
                url: 'http://example.com',
                apiKey: 'example-key'
        },
        exclusions: {
                ...DEFAULT_SETTINGS.exclusions,
                excludedFolders: [],
                excludedFileTypes: [],
                excludedFilePrefixes: [],
                excludedFiles: []
        }
};

const createSettings = (): ObsidianRAGSettings => ({
        ...baseSettings,
        supabase: { ...baseSettings.supabase },
        exclusions: {
                ...baseSettings.exclusions,
                excludedFolders: [...baseSettings.exclusions.excludedFolders],
                excludedFileTypes: [...baseSettings.exclusions.excludedFileTypes],
                excludedFilePrefixes: [...baseSettings.exclusions.excludedFilePrefixes],
                excludedFiles: [...baseSettings.exclusions.excludedFiles]
        }
});

const createSelectBuilder = <T>(result: QueryResult<T>): any => {
        const builder: any = {};
        builder.select = jest.fn(() => builder);
        builder.eq = jest.fn(() => builder);
        builder.or = jest.fn(() => Promise.resolve(result));
        return builder;
};

const createDeleteBuilder = (): any => {
        const builder: any = {};
        builder.delete = jest.fn(() => builder);
        builder.eq = jest.fn(() => builder);
        builder.in = jest.fn(() => Promise.resolve({ error: null }));
        return builder;
};

beforeEach(() => {
        jest.clearAllMocks();
        (SupabaseService as unknown as { instance: SupabaseService | null }).instance = null;
});

describe('SupabaseService.removeExcludedFiles', () => {
        it('returns 0 without querying when no exclusions are provided', async () => {
                const mockClient: MockClient = {
                        from: jest.fn()
                };

                mockCreateClient.mockReturnValue(mockClient as any);

                const service = new (SupabaseService as any)(createSettings()) as SupabaseService;

                const result = await service.removeExcludedFiles('vault-123', {
                        excludedFolders: [],
                        excludedFileTypes: [],
                        excludedFilePrefixes: [],
                        excludedFiles: []
                });

                expect(result).toBe(0);
                expect(mockClient.from).not.toHaveBeenCalled();
        });

        it('applies exclusion filters safely and removes matching files', async () => {
                const filesToRemove: FileStatusRecord[] = [
                        { file_path: 'Projects/Client,Work/report.md' }
                ];

                const fileStatusSelectBuilder = createSelectBuilder<FileStatusRecord[]>(
                        { data: filesToRemove, error: null }
                );
                const documentsDeleteBuilder = createDeleteBuilder();
                const fileStatusDeleteBuilder = createDeleteBuilder();

                let fileStatusCallCount = 0;
                const fromMock = jest.fn((table: string) => {
                        if (table === 'obsidian_file_status') {
                                fileStatusCallCount += 1;
                                return fileStatusCallCount === 1 ? fileStatusSelectBuilder : fileStatusDeleteBuilder;
                        }
                        if (table === 'obsidian_documents') {
                                return documentsDeleteBuilder;
                        }
                        throw new Error(`Unexpected table ${table}`);
                });

                const mockClient: MockClient = {
                        from: fromMock
                };

                mockCreateClient.mockReturnValue(mockClient as any);

                const service = new (SupabaseService as any)(createSettings()) as SupabaseService;

                const result = await service.removeExcludedFiles('vault-123', {
                        excludedFolders: ['', 'Projects/Client,Work'],
                        excludedFileTypes: ['MD'],
                        excludedFilePrefixes: ['Archive_File'],
                        excludedFiles: ['notes/"quote".md']
                });

                expect(fileStatusSelectBuilder.or).toHaveBeenCalledWith(
                        'file_path.ilike."Projects/Client,Work%",file_path.ilike."%.md",file_path.ilike."Archive\\_File%",file_path.eq."notes/\\"quote\\".md"'
                );
                expect(result).toBe(1);
                expect(documentsDeleteBuilder.in).toHaveBeenCalledWith('file_path', ['Projects/Client,Work/report.md']);
                expect(fileStatusDeleteBuilder.in).toHaveBeenCalledWith('file_path', ['Projects/Client,Work/report.md']);
        });
});
