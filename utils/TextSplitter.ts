//TextSplitter.ts
import {
	DocumentChunk,
	DocumentMetadata,
	DocumentProcessingError,
} from '../models/DocumentChunk';
import { DEFAULT_CHUNKING_OPTIONS } from '../settings/Settings';
import { MetadataExtractor } from '../services/MetadataExtractor';
import { Vault, TFile } from 'obsidian';
import { ErrorHandler } from './ErrorHandler';

export type ChunkingOptions = {
        chunkSize: number;
        chunkOverlap: number;
        minChunkSize: number;
};

export class TextSplitter {
        private settings: ChunkingOptions;
        private metadataExtractor: MetadataExtractor;
        // Regex patterns for splitting
        private readonly SENTENCE_BOUNDARY = /[.!?]\s+/;
        private readonly PARAGRAPH_BOUNDARY = /\n\s*\n/;
        private readonly YAML_FRONT_MATTER = /^---\n([\s\S]*?)\n---/;

        constructor(
                private vault: Vault,
                private errorHandler: ErrorHandler,
                chunkOptions: Partial<ChunkingOptions> = {}
        ) {
                this.settings = { ...DEFAULT_CHUNKING_OPTIONS, ...chunkOptions };
                this.validateSettings(this.settings);
                this.metadataExtractor = new MetadataExtractor(
                        this.vault,
                        this.errorHandler
                );
        }

        /** Returns the current chunking settings. */
        public getSettings(): ChunkingOptions {
                return this.settings;
        }

        private validateSettings(settings: ChunkingOptions): void {
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
	 * Splits a document into chunks while enhancing metadata.
	 * Extracts YAML front matter if present, and then uses the MetadataExtractor
	 * to merge additional metadata (e.g., tags, aliases, links) into the base metadata.
	 *
	 * @param content The full text content of the document.
	 * @param metadata Base metadata for the document.
	 * @param abortSignal Optional AbortSignal to cancel the operation.
	 * @returns An array of DocumentChunk.
	 */
	public async splitDocument(
		content: string,
		metadata: DocumentMetadata,
		abortSignal?: AbortSignal
	): Promise<DocumentChunk[]> {
		const performanceMetrics: Record<string, number> = {};
		const overallStart = performance.now();

		try {
			console.log('Starting document split', { contentLength: content.length, settings: this.settings });

			if (abortSignal?.aborted) {
				throw new Error('Document splitting aborted before start');
			}

			if (!content?.trim()) {
				console.log('Empty content received');
				return [];
			}

			// Attempt to extract YAML front matter without altering the original content.
			let frontMatter = null;
			const frontMatterMatch = this.YAML_FRONT_MATTER.exec(content);
			if (frontMatterMatch) {
				try {
					frontMatter = this.parseFrontMatter(frontMatterMatch[1]);
					// Enhance metadata using MetadataExtractor with extracted front matter.
					const enhancedMetadata = await this.metadataExtractor.extractMetadataFromContent(
						content,
						metadata,
						frontMatter
					);
					metadata = { ...metadata, ...enhancedMetadata };
					console.log('Front matter extracted and metadata enhanced', { frontMatter });
				} catch (error) {
					console.warn('Failed to parse front matter', error);
				}
			}

			const trimmedContent = content.trim();
			if (abortSignal?.aborted) {
				throw new Error('Document splitting aborted after front matter processing');
			}

			// If content is smaller than the chunk size, return as a single chunk.
			if (trimmedContent.length <= Math.max(this.settings.minChunkSize, this.settings.chunkSize)) {
				if (trimmedContent.length === 0) {
					console.log('No content after trimming, returning empty array');
					return [];
				}
				console.log('Content is smaller than chunk size, creating single chunk', {
					contentLength: trimmedContent.length,
					chunkSize: this.settings.chunkSize,
					minChunkSize: this.settings.minChunkSize,
				});
				const singleChunk = this.createChunk(trimmedContent, 0, metadata);
				performanceMetrics.singleChunkTime = performance.now() - overallStart;
				console.log('Created single chunk', { chunkSize: singleChunk.content.length, preview: singleChunk.content.substring(0, 100) });
				console.log(`Document split completed in ${performance.now() - overallStart} ms`, performanceMetrics);
				return [singleChunk];
			}

			// Split content into paragraphs.
			const paragraphs = content.split(this.PARAGRAPH_BOUNDARY)
				.map(p => p.trim())
				.filter(p => p.length > 0);
			console.log('Split into paragraphs', { paragraphCount: paragraphs.length, paragraphs: paragraphs.map(p => p.substring(0, 100)) });

			if (abortSignal?.aborted) {
				throw new Error('Document splitting aborted after paragraph split');
			}

			let chunks: DocumentChunk[] = [];
			let currentChunk = '';
			let chunkIndex = 0;

			// Process each paragraph
			for (const paragraph of paragraphs) {
				if (abortSignal?.aborted) {
					// Cleanup any partial results if aborted
					chunks = [];
					throw new Error('Document splitting aborted during processing');
				}
				// If paragraph is larger than the chunk size, split it into sentences.
				if (paragraph.length >= this.settings.chunkSize) {
					if (currentChunk) {
						chunks.push(this.createChunk(currentChunk, chunkIndex++, metadata));
						currentChunk = '';
					}
					const sentences = paragraph.split(this.SENTENCE_BOUNDARY);
					let sentenceChunk = '';
					for (const sentence of sentences) {
						if (abortSignal?.aborted) {
							chunks = [];
							throw new Error('Document splitting aborted during sentence processing');
						}
						const trimmedSentence = sentence.trim();
						if (!trimmedSentence) continue;
						if ((sentenceChunk + ' ' + trimmedSentence).length > this.settings.chunkSize) {
							if (sentenceChunk) {
								chunks.push(this.createChunk(sentenceChunk, chunkIndex++, metadata));
								sentenceChunk = trimmedSentence;
							} else {
								// For very long sentences, force split.
								let position = 0;
								while (position < trimmedSentence.length) {
									const chunkText = trimmedSentence.slice(
										position,
										Math.min(position + this.settings.chunkSize, trimmedSentence.length)
									);
									chunks.push(this.createChunk(chunkText, chunkIndex++, metadata));
									position += this.settings.chunkSize;
								}
								sentenceChunk = '';
							}
						} else {
							sentenceChunk += (sentenceChunk ? ' ' : '') + trimmedSentence;
						}
					}
					if (sentenceChunk) {
						chunks.push(this.createChunk(sentenceChunk, chunkIndex++, metadata));
					}
				} else {
					// Accumulate paragraphs until reaching chunk size.
					const potentialChunkSize = currentChunk
						? currentChunk.length + 2 + paragraph.length
						: paragraph.length;
					if (potentialChunkSize <= this.settings.chunkSize) {
						currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
					} else {
						if (currentChunk) {
							chunks.push(this.createChunk(currentChunk, chunkIndex++, metadata));
						}
						currentChunk = paragraph;
					}
				}
			}
			if (currentChunk) {
				chunks.push(this.createChunk(currentChunk, chunkIndex++, metadata));
			}
			if (chunks.length === 0 && trimmedContent.length > 0) {
				console.log('Creating fallback chunk for content', { contentLength: trimmedContent.length });
				chunks.push(this.createChunk(trimmedContent, 0, metadata));
			}
			// Apply overlap between chunks if configured.
			if (this.settings.chunkOverlap > 0 && chunks.length > 1) {
				chunks = this.applyOverlap(chunks);
			}

			performanceMetrics.totalSplittingTime = performance.now() - overallStart;
			console.log('Finished creating chunks', {
				chunkCount: chunks.length,
				chunkSizes: chunks.map(c => c.content.length),
				chunkPreviews: chunks.map(c => ({
					index: c.chunk_index,
					size: c.content.length,
					preview: c.content.substring(0, 100),
				})),
				performanceMetrics
			});
			return chunks;
		} catch (error: any) {
			console.error('Error in splitDocument', error);
			// Ensure any partial results are cleaned up
			throw {
				type: DocumentProcessingError.CHUNKING_ERROR,
				message: 'Error occurred during document chunking',
				details: error.message,
			};
		}
	}

	private createChunk(content: string, index: number, metadata: DocumentMetadata): DocumentChunk {
		const trimmedContent = content.trim();
		if (trimmedContent.length < this.settings.minChunkSize) {
			console.warn('Chunk smaller than minChunkSize', {
				size: trimmedContent.length,
				minSize: this.settings.minChunkSize,
			});
		}
		return {
			content: trimmedContent,
			chunk_index: index,
			metadata: { ...metadata },
			vault_id: metadata.obsidianId,
			file_status_id: 0, // This will be set by the caller
			embedding: [],
			vectorized_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		};
	}

	private applyOverlap(chunks: DocumentChunk[]): DocumentChunk[] {
		if (chunks.length <= 1) return chunks;
		const chunksWithOverlap = [...chunks];
		for (let i = chunksWithOverlap.length - 1; i > 0; i--) {
			const currentChunk = { ...chunksWithOverlap[i] };
			const previousChunk = chunksWithOverlap[i - 1];
			const overlapText = currentChunk.content.substring(0, this.settings.chunkOverlap);
			previousChunk.content += '\n' + overlapText;
		}
		return chunksWithOverlap;
	}

	private parseFrontMatter(frontMatter: string): Record<string, any> {
		try {
			const result: Record<string, any> = {};
			const lines = frontMatter.split('\n');
			for (const line of lines) {
				const trimmedLine = line.trim();
				if (!trimmedLine || trimmedLine.startsWith('#')) continue;
				const separatorIndex = line.indexOf(':');
				if (separatorIndex === -1) continue;
				const key = line.slice(0, separatorIndex).trim();
				let value = line.slice(separatorIndex + 1).trim();
				value = value.replace(/^["'](.*)["']$/, '$1');
				if (value.startsWith('- ')) {
					result[key] = value
						.split('\n')
						.map(item => item.replace('- ', '').trim())
						.filter(Boolean);
				} else {
					result[key] = value;
				}
			}
			return result;
		} catch (error) {
			console.warn('Failed to parse front matter', error);
			return {};
		}
	}
}
