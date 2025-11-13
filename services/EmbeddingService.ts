import OpenAI from 'openai';
import { Notice } from 'obsidian';
import { EmbeddingResponse } from '../models/DocumentChunk';
import { ErrorHandler } from '../utils/ErrorHandler';
import { EmbeddingProviderSettings, DEFAULT_OPENAI_SETTINGS } from '../settings/Settings';

export class EmbeddingService {
        private openAIClient: OpenAI | null = null;
        private rateLimitDelay = 20; // ms between requests
        private lastRequestTime = 0;
        private readonly errorHandler: ErrorHandler;
        private settings: EmbeddingProviderSettings;
        private readonly targetVectorSize = 768;
        private missingOpenAINoticeShown = false;

        constructor(settings: EmbeddingProviderSettings, errorHandler: ErrorHandler) {
                this.settings = settings;
                this.errorHandler = errorHandler;
                this.initializeOpenAIClient();
        }

        /**
         * Check if any embedding provider is available.
         */
        public isInitialized(): boolean {
                return (this.settings.ollama?.enabled ?? false) || this.openAIClient !== null;
        }

        /**
         * Updates provider settings and refreshes OpenAI client state.
         */
        public updateSettings(settings: EmbeddingProviderSettings): void {
                this.settings = settings;
                this.initializeOpenAIClient();
                this.missingOpenAINoticeShown = false;
        }

        /**
         * Allows tuning the delay between OpenAI requests.
         */
        public updateRateLimit(delayMs: number): void {
                this.rateLimitDelay = delayMs;
        }

        /**
         * Creates embeddings for the given text chunks, preferring Ollama before OpenAI.
         */
        async createEmbeddings(chunks: string[]): Promise<EmbeddingResponse[]> {
                const embeddings: EmbeddingResponse[] = [];

                for (let i = 0; i < chunks.length; i++) {
                        embeddings.push(await this.generateEmbeddingForChunk(chunks[i], i));
                }

                return embeddings;
        }

        private async generateEmbeddingForChunk(chunk: string, index: number): Promise<EmbeddingResponse> {
                const ollamaEnabled = this.settings.ollama?.enabled;
                if (ollamaEnabled) {
                        try {
                                const { embedding, model } = await this.createOllamaEmbedding(chunk);
                                return this.buildEmbeddingResponse(embedding, index, model, {
                                        prompt_tokens: chunk.length,
                                        total_tokens: chunk.length,
                                });
                        } catch (error) {
                                this.handleEmbeddingError(error, chunk, 'ollama');
                                if (!this.settings.ollama.fallbackToOpenAI) {
                                        return this.emptyEmbeddingResponse(index, `ollama:${this.settings.ollama.model}`);
                                }
                        }
                }

                if (this.openAIClient) {
                        try {
                                return await this.createOpenAIEmbedding(chunk, index);
                        } catch (error) {
                                this.handleEmbeddingError(error, chunk, 'openai');
                        }
                } else if (!ollamaEnabled || this.settings.ollama.fallbackToOpenAI) {
                        if (!this.missingOpenAINoticeShown) {
                                new Notice('OpenAI API key is missing. Please set it in the plugin settings.');
                                this.missingOpenAINoticeShown = true;
                        }
                }

                const fallbackModel = ollamaEnabled ? `ollama:${this.settings.ollama.model}` : this.getOpenAIModel();
                return this.emptyEmbeddingResponse(index, fallbackModel);
        }

        private async createOllamaEmbedding(input: string): Promise<{ embedding: number[]; model: string }> {
                const { url, model } = this.settings.ollama;
                if (!url) {
                        throw new Error('Ollama URL is not configured.');
                }
                if (!model) {
                        throw new Error('Ollama model is not configured.');
                }

                const normalizedUrl = url.replace(/\/+$/, '');
                const response = await fetch(`${normalizedUrl}/api/embeddings`, {
                        method: 'POST',
                        headers: {
                                'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                                model,
                                prompt: input,
                        }),
                });

                if (!response.ok) {
                        throw new Error(`Ollama responded with status ${response.status}`);
                }

                const data = await response.json();
                if (!data || !Array.isArray(data.embedding)) {
                        throw new Error('Unexpected response structure from Ollama.');
                }

                const normalizedEmbedding = this.ensureVectorSize(data.embedding);
                const modelName = typeof data.model === 'string' ? data.model : model;

                return {
                        embedding: normalizedEmbedding,
                        model: `ollama:${modelName}`,
                };
        }

        private async createOpenAIEmbedding(chunk: string, index: number): Promise<EmbeddingResponse> {
                await this.applyOpenAIRateLimit();

                const model = this.getOpenAIModel();
                const response = await this.openAIClient!.embeddings.create({
                        model,
                        input: chunk,
                        encoding_format: 'float',
                });

                this.lastRequestTime = Date.now();

                const embedding = response.data?.[0]?.embedding ?? [];
                const normalizedEmbedding = this.ensureVectorSize(embedding);

                return this.buildEmbeddingResponse(normalizedEmbedding, index, response.model ?? model, {
                        prompt_tokens: response.usage?.prompt_tokens ?? 0,
                        total_tokens: response.usage?.total_tokens ?? 0,
                });
        }

        private async applyOpenAIRateLimit(): Promise<void> {
                const timeSinceLastRequest = Date.now() - this.lastRequestTime;
                if (timeSinceLastRequest < this.rateLimitDelay) {
                        await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest));
                }
        }

        private buildEmbeddingResponse(
                embedding: number[],
                index: number,
                model: string,
                usage?: { prompt_tokens?: number; total_tokens?: number }
        ): EmbeddingResponse {
                return {
                        data: [
                                {
                                        embedding,
                                        index,
                                },
                        ],
                        usage: {
                                prompt_tokens: usage?.prompt_tokens ?? 0,
                                total_tokens: usage?.total_tokens ?? 0,
                        },
                        model,
                };
        }

        private emptyEmbeddingResponse(index: number, model: string): EmbeddingResponse {
                return {
                        data: [],
                        usage: { prompt_tokens: 0, total_tokens: 0 },
                        model,
                };
        }

        private ensureVectorSize(vector: number[]): number[] {
                if (vector.length === this.targetVectorSize) {
                        return vector;
                }
                if (vector.length > this.targetVectorSize) {
                        return vector.slice(0, this.targetVectorSize);
                }

                const padded = new Array(this.targetVectorSize).fill(0);
                for (let i = 0; i < vector.length; i++) {
                        padded[i] = vector[i];
                }
                return padded;
        }

        private initializeOpenAIClient(): void {
                const apiKey = this.settings.openai?.apiKey;
                if (!apiKey) {
                        this.openAIClient = null;
                        return;
                }

                this.openAIClient = new OpenAI({
                        apiKey,
                        dangerouslyAllowBrowser: true,
                });
        }

        private getOpenAIModel(): string {
                return this.settings.openai?.model || DEFAULT_OPENAI_SETTINGS.model;
        }

        private handleEmbeddingError(error: any, chunk: string, provider: 'ollama' | 'openai'): void {
                const message = error instanceof Error ? error.message : String(error);
                const noticeMessage = provider === 'ollama'
                        ? `Ollama embedding error: ${message}`
                        : `OpenAI embedding error: ${message}`;

                this.errorHandler.handleError(error, {
                        context: `EmbeddingService.${provider}`,
                        metadata: {
                                provider,
                                chunkPreview: chunk.substring(0, 100) + '...',
                        },
                });

                new Notice(noticeMessage);
        }
}
