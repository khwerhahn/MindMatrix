import {
    DocumentChunk,
    DocumentMetadata,
    DocumentProcessingError
} from '../models/DocumentChunk';
import { ChunkSettings } from '../settings/Settings';

export class TextSplitter {
    private settings: ChunkSettings;
    private readonly sentenceEndRegex = /[.!?]\s+/g;
    private readonly paragraphEndRegex = /\n\s*\n/g;

    constructor(settings: ChunkSettings) {
        this.settings = settings;
        this.validateSettings(settings);
    }

    /**
     * Splits a document into chunks based on configured settings
     */
    splitDocument(content: string, metadata: DocumentMetadata): DocumentChunk[] {
        try {
            if (!content?.trim()) {
                return [];
            }

            // First split into paragraphs
            const paragraphs = content.split(this.paragraphEndRegex);
            const chunks: DocumentChunk[] = [];
            let currentChunk = '';
            let currentIndex = 0;

            for (const paragraph of paragraphs) {
                if (this.getByteSize(currentChunk + paragraph) > this.settings.chunkSize) {
                    // If current chunk is not empty, save it
                    if (currentChunk) {
                        chunks.push(this.createChunk(currentChunk, currentIndex, metadata));
                        currentIndex++;

                        // Start new chunk with overlap from previous
                        const overlapText = this.getOverlapText(currentChunk);
                        currentChunk = overlapText + paragraph;
                    } else {
                        // If paragraph itself is too large, split it into sentences
                        const sentenceChunks = this.splitIntoSentences(paragraph);
                        for (const chunk of sentenceChunks) {
                            chunks.push(this.createChunk(chunk, currentIndex, metadata));
                            currentIndex++;
                        }
                    }
                } else {
                    currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
                }
            }

            // Add final chunk if not empty
            if (currentChunk) {
                chunks.push(this.createChunk(currentChunk, currentIndex, metadata));
            }

            return this.validateChunks(chunks);

        } catch (error) {
            throw {
                type: DocumentProcessingError.CHUNKING_ERROR,
                message: 'Error splitting document into chunks',
                originalError: error
            };
        }
    }

    /**
     * Splits text into sentences and combines them into chunks
     */
    private splitIntoSentences(text: string): string[] {
        const sentences = text.split(this.sentenceEndRegex);
        const chunks: string[] = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            const combinedSize = this.getByteSize(currentChunk + sentence);

            if (combinedSize > this.settings.chunkSize && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /**
     * Creates a chunk object with the given content and metadata
     */
    private createChunk(content: string, index: number, metadata: DocumentMetadata): DocumentChunk {
        return {
            content: content.trim(),
            chunkIndex: index,
            metadata: { ...metadata }
        };
    }

    /**
     * Gets overlapping text from the end of a chunk
     */
    private getOverlapText(text: string): string {
        const sentences = text.split(this.sentenceEndRegex);
        let overlapText = '';
        let currentSize = 0;

        for (let i = sentences.length - 1; i >= 0; i--) {
            const sentence = sentences[i];
            const newSize = this.getByteSize(sentence + overlapText);

            if (newSize > this.settings.chunkOverlap) {
                break;
            }

            overlapText = sentence + (overlapText ? ' ' : '') + overlapText;
            currentSize = newSize;
        }

        return overlapText;
    }

    /**
     * Calculates the byte size of a string
     */
    private getByteSize(str: string): number {
        return new TextEncoder().encode(str).length;
    }

    /**
     * Validates chunks meet minimum size requirements
     */
    private validateChunks(chunks: DocumentChunk[]): DocumentChunk[] {
        // Combine chunks smaller than minChunkSize with the next chunk
        const validatedChunks: DocumentChunk[] = [];
        let currentChunk: DocumentChunk | null = null;

        for (const chunk of chunks) {
            if (!currentChunk) {
                currentChunk = chunk;
                continue;
            }

            const chunkSize = this.getByteSize(chunk.content);
            if (chunkSize < this.settings.minChunkSize) {
                currentChunk.content += '\n\n' + chunk.content;
            } else {
                validatedChunks.push(currentChunk);
                currentChunk = chunk;
            }
        }

        if (currentChunk) {
            validatedChunks.push(currentChunk);
        }

        // Reindex chunks
        return validatedChunks.map((chunk, index) => ({
            ...chunk,
            chunkIndex: index
        }));
    }

    /**
     * Updates chunking settings
     */
    updateSettings(settings: ChunkSettings): void {
        this.validateSettings(settings);
        this.settings = settings;
    }

    /**
     * Validates chunking settings
     */
    private validateSettings(settings: ChunkSettings): void {
        if (settings.chunkSize < settings.minChunkSize) {
            throw new Error('chunkSize must be greater than or equal to minChunkSize');
        }

        if (settings.chunkOverlap >= settings.chunkSize) {
            throw new Error('chunkOverlap must be less than chunkSize');
        }

        if (settings.minChunkSize <= 0) {
            throw new Error('minChunkSize must be greater than 0');
        }
    }
}
