import {
    DocumentChunk,
    DocumentMetadata,
    DocumentProcessingError,
} from '../models/DocumentChunk';
import { DEFAULT_CHUNKING_OPTIONS } from '../settings/Settings';

export class TextSplitter {
    private settings: {
        chunkSize: number;
        chunkOverlap: number;
        minChunkSize: number;
    };

    // Regex patterns for splitting
    private readonly SENTENCE_BOUNDARY = /[.!?]\s+/;
    private readonly PARAGRAPH_BOUNDARY = /\n\s*\n/;
    private readonly YAML_FRONT_MATTER = /^---\n([\s\S]*?)\n---/;

    constructor(settings?: { chunkSize: number; chunkOverlap: number; minChunkSize: number }) {
        // Use provided settings or fallback to defaults
        this.settings = { ...DEFAULT_CHUNKING_OPTIONS, ...settings };
        this.validateSettings(this.settings);
    }

    /**
     * Validates the chunking settings to ensure correctness
     */
    private validateSettings(settings: { chunkSize: number; chunkOverlap: number; minChunkSize: number }) {
        if (settings.chunkSize <= 0) {
            throw new Error('Chunk size must be greater than 0.');
        }
        if (settings.chunkOverlap >= settings.chunkSize) {
            throw new Error('Chunk overlap must be less than chunk size.');
        }
        if (settings.minChunkSize > settings.chunkSize) {
            throw new Error('Minimum chunk size must not exceed chunk size.');
        }
    }

    /**
     * Splits a document into chunks based on configured settings
     */
    public splitDocument(content: string, metadata: DocumentMetadata): DocumentChunk[] {
        try {
            if (!content?.trim()) {
                return [];
            }

            // Extract and remove YAML front matter
            const frontMatter = this.extractFrontMatter(content);
            if (frontMatter) {
                metadata.frontMatter = frontMatter;
                content = content.replace(this.YAML_FRONT_MATTER, '');
            }

            // Perform the actual chunking
            const chunks: DocumentChunk[] = [];
            const splitContent = content.split(this.PARAGRAPH_BOUNDARY);

            let chunkIndex = 0;
            for (const paragraph of splitContent) {
                let position = 0;
                while (position < paragraph.length) {
                    const chunk = paragraph.slice(position, position + this.settings.chunkSize);
                    const adjustedChunk = chunk.trim();

                    if (adjustedChunk.length >= this.settings.minChunkSize) {
                        chunks.push({
                            content: adjustedChunk,
                            chunkIndex: chunkIndex++,
                            metadata,
                        });
                    }

                    position += this.settings.chunkSize - this.settings.chunkOverlap;
                }
            }

            return chunks;
        } catch (error) {
            throw {
                type: DocumentProcessingError.CHUNKING_ERROR,
                message: 'Error occurred during document chunking',
                details: error.message,
            };
        }
    }

    /**
     * Extracts YAML front matter from the content
     */
    private extractFrontMatter(content: string): Record<string, any> | null {
        const match = this.YAML_FRONT_MATTER.exec(content);
        if (!match) return null;

        try {
            return JSON.parse(match[1]);
        } catch (error) {
            throw {
                type: DocumentProcessingError.YAML_PARSE_ERROR,
                message: 'Failed to parse YAML front matter',
                details: error.message,
            };
        }
    }
}
