import { EmbeddingService } from '../services/EmbeddingService';
import type { EmbeddingProviderSettings } from '../settings/Settings';
import type { ErrorHandler } from '../utils/ErrorHandler';
import { Notice } from 'obsidian';

jest.mock('openai', () => {
        const mockCreate = jest.fn();
        const MockOpenAI = jest.fn().mockImplementation(() => ({
                embeddings: {
                        create: mockCreate,
                },
        }));
        return {
                __esModule: true,
                default: MockOpenAI,
                mockCreate,
        };
});

const { mockCreate, default: MockOpenAI } = jest.requireMock('openai');
const mockOpenAIConstructor = MockOpenAI as jest.Mock;

describe('EmbeddingService provider selection', () => {
        const baseSettings: EmbeddingProviderSettings = {
                ollama: { enabled: false, url: '', model: 'nomic-embed-text', fallbackToOpenAI: true },
                openai: { apiKey: '', model: 'text-embedding-3-small', maxTokens: 8000, temperature: 0 },
        };
        const errorHandler = { handleError: jest.fn() } as unknown as ErrorHandler;

        beforeAll(() => {
                global.fetch = jest.fn();
        });

        beforeEach(() => {
                jest.clearAllMocks();
                (global.fetch as jest.Mock).mockReset();
                (Notice as unknown as jest.Mock).mockClear();
        });

        const createService = (overrides?: Partial<EmbeddingProviderSettings>) => {
                return new EmbeddingService({
                        ...baseSettings,
                        ...overrides,
                        ollama: { ...baseSettings.ollama, ...(overrides?.ollama ?? {}) },
                        openai: { ...baseSettings.openai, ...(overrides?.openai ?? {}) },
                }, errorHandler);
        };

        it('falls back to OpenAI when Ollama embedding fails and fallback is enabled', async () => {
                (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
                mockCreate.mockResolvedValue({
                        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
                        usage: { prompt_tokens: 2, total_tokens: 2 },
                        model: 'text-embedding-3-small',
                });

                const service = createService({
                        ollama: { enabled: true, url: 'http://localhost:11434', model: 'nomic', fallbackToOpenAI: true },
                        openai: { ...baseSettings.openai, apiKey: 'test-key' },
                });

                const [embedding] = await service.createEmbeddings(['Example chunk']);

                expect(global.fetch).toHaveBeenCalled();
                expect(mockCreate).toHaveBeenCalledTimes(1);
                expect(embedding?.model).toContain('text-embedding-3-small');
        });

        it('tracks initialization state as OpenAI keys are added or removed', () => {
                const service = createService();
                expect(service.isInitialized()).toBe(false);

                service.updateSettings({
                        ...baseSettings,
                        openai: { ...baseSettings.openai, apiKey: 'key-123' },
                });
                expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1);
                expect(service.isInitialized()).toBe(true);

                service.updateSettings({
                        ...baseSettings,
                        ollama: { enabled: false, url: '', model: 'nomic-embed-text', fallbackToOpenAI: true },
                        openai: { ...baseSettings.openai, apiKey: '' },
                });
                expect(service.isInitialized()).toBe(false);
        });
});
