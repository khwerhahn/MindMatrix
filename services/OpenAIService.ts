import OpenAI from 'openai';
import { EmbeddingResponse } from '../models/DocumentChunk';
import { Notice } from 'obsidian';
import { ErrorHandler } from '../utils/ErrorHandler';
import { OpenAISettings } from '../settings/Settings';

export class OpenAIService {
    private client: OpenAI | null;
    private rateLimitDelay: number = 20; // ms between requests
    private lastRequestTime: number = 0;
    private readonly errorHandler: ErrorHandler;
    private settings: OpenAISettings;

    constructor(settings: OpenAISettings, errorHandler: ErrorHandler) {
        this.settings = settings;
        this.errorHandler = errorHandler;

        if (!settings.apiKey) {
            console.warn('OpenAI API key is missing. OpenAIService will not be initialized.');
            this.client = null;
            return;
        }

        // Initialize OpenAI client with browser support
        this.client = new OpenAI({
            apiKey: settings.apiKey,
            dangerouslyAllowBrowser: true, // Enable browser-like environment usage
        });
    }

    /**
     * Check if the service is initialized
     */
    public isInitialized(): boolean {
        return this.client !== null;
    }

    /**
     * Creates embeddings for the given text chunks with rate limiting and retries
     */
    async createEmbeddings(chunks: string[]): Promise<EmbeddingResponse[]> {
        if (!this.client) {
            console.warn('OpenAIService is not initialized. Cannot create embeddings.');
            new Notice('OpenAI API key is missing. Please set it in the plugin settings.');
            return chunks.map(() => ({
                data: [],
                usage: { prompt_tokens: 0, total_tokens: 0 },
                model: this.settings.model,
            }));
        }

        const embeddings: EmbeddingResponse[] = [];

        for (let i = 0; i < chunks.length; i++) {
            try {
                // Rate limiting
                const timeSinceLastRequest = Date.now() - this.lastRequestTime;
                if (timeSinceLastRequest < this.rateLimitDelay) {
                    await new Promise(resolve =>
                        setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
                    );
                }

                const response = await this.client.embeddings.create({
                    model: this.settings.model,
                    input: chunks[i],
                    encoding_format: "float",
                });

                this.lastRequestTime = Date.now();

                embeddings.push({
                    data: [{
                        embedding: response.data[0].embedding,
                        index: i
                    }],
                    usage: {
                        prompt_tokens: response.usage.prompt_tokens,
                        total_tokens: response.usage.total_tokens
                    },
                    model: response.model
                });

            } catch (error) {
                this.handleEmbeddingError(error, chunks[i]);
                // Push null for failed embeddings to maintain array indices
                embeddings.push({
                    data: [],
                    usage: { prompt_tokens: 0, total_tokens: 0 },
                    model: this.settings.model
                });
            }
        }

        return embeddings;
    }

    /**
     * Handles various types of OpenAI API errors
     */
    private handleEmbeddingError(error: any, chunk: string): void {
        let errorMessage: string;

        if (error instanceof OpenAI.APIError) {
            switch (error.status) {
                case 429:
                    errorMessage = 'Rate limit exceeded. Please try again later.';
                    break;
                case 401:
                    errorMessage = 'Invalid API key. Please check your settings.';
                    break;
                case 413:
                    errorMessage = 'Text chunk too large for embedding.';
                    break;
                default:
                    errorMessage = `OpenAI API error: ${error.message}`;
            }
        } else {
            errorMessage = `Unexpected error: ${error.message}`;
        }

        // Log the error through the centralized error handler
        this.errorHandler.handleError(error, {
            context: 'OpenAIService.createEmbeddings',
            metadata: {
                chunkPreview: chunk.substring(0, 100) + '...' // First 100 chars for context
            }
        });

        new Notice(`Error creating embedding: ${errorMessage}`);
    }

    /**
     * Updates service settings
     */
    updateSettings(settings: OpenAISettings): void {
        this.settings = settings;

        if (!settings.apiKey) {
            console.warn('OpenAI API key is missing. OpenAIService will not be initialized.');
            this.client = null;
            return;
        }

        // Reinitialize the OpenAI client with updated settings
        this.client = new OpenAI({
            apiKey: settings.apiKey,
            dangerouslyAllowBrowser: true, // Ensure this remains enabled
        });
    }

    /**
     * Updates rate limiting parameters
     */
    updateRateLimit(delayMs: number): void {
        this.rateLimitDelay = delayMs;
    }
}
