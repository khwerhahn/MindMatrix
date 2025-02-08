// src/utils/TextSplitter.ts

import {
	DocumentChunk,
	DocumentMetadata,
	DocumentProcessingError,
} from '../models/DocumentChunk';
import { DEFAULT_CHUNKING_OPTIONS } from '../settings/Settings';
import { MetadataExtractor } from '../services/MetadataExtractor';

export class TextSplitter {
	private settings: {
		chunkSize: number;
		chunkOverlap: number;
		minChunkSize: number;
	};
	private metadataExtractor: MetadataExtractor;

	// Regex patterns for splitting
	private readonly SENTENCE_BOUNDARY = /[.!?]\s+/;
	private readonly PARAGRAPH_BOUNDARY = /\n\s*\n/;
	private readonly YAML_FRONT_MATTER = /^---\n([\s\S]*?)\n---/;

	constructor(
		settings?: { chunkSize: number; chunkOverlap: number; minChunkSize: number },
		metadataExtractor?: MetadataExtractor
	) {
		this.settings = settings || { ...DEFAULT_CHUNKING_OPTIONS };
		this.validateSettings(this.settings);
		this.metadataExtractor = metadataExtractor || new MetadataExtractor();
	}

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

	public async splitDocument(content: string, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
		try {
			console.log('Starting document split:', {
				contentLength: content.length,
				settings: this.settings
			});

			if (!content?.trim()) {
				console.log('Empty content received');
				return [];
			}

			// Extract and remove YAML front matter
			let frontMatter = null;
			const frontMatterMatch = this.YAML_FRONT_MATTER.exec(content);
			if (frontMatterMatch) {
				try {
					frontMatter = this.parseFrontMatter(frontMatterMatch[1]);
					// Enhance metadata using MetadataExtractor for the complete content
					const enhancedMetadata = await this.enhanceMetadata(content, metadata, frontMatter);
					metadata = enhancedMetadata;
					content = content.replace(this.YAML_FRONT_MATTER, '').trim();
					console.log('Front matter extracted and metadata enhanced:', { frontMatter });
				} catch (error) {
					console.warn('Failed to parse front matter:', error);
				}
			}

			// If content is smaller than chunkSize or minChunkSize, return it as a single chunk
			const trimmedContent = content.trim();
			if (trimmedContent.length <= Math.max(this.settings.minChunkSize, this.settings.chunkSize)) {
				if (trimmedContent.length === 0) {
					console.log('No content after trimming, returning empty array');
					return [];
				}

				console.log('Content is smaller than chunk size, creating single chunk:', {
					contentLength: trimmedContent.length,
					chunkSize: this.settings.chunkSize,
					minChunkSize: this.settings.minChunkSize
				});

				const singleChunk = this.createChunk(trimmedContent, 0, metadata);
				console.log('Created single chunk:', {
					chunkSize: singleChunk.content.length,
					preview: singleChunk.content.substring(0, 100)
				});

				return [singleChunk];
			}

			// Split into paragraphs first
			const paragraphs = content.split(this.PARAGRAPH_BOUNDARY)
				.map(p => p.trim())
				.filter(p => p.length > 0);

			console.log('Split into paragraphs:', {
				paragraphCount: paragraphs.length,
				paragraphs: paragraphs.map(p => p.substring(0, 100)) // Log preview of each paragraph
			});

			const chunks: DocumentChunk[] = [];
			let currentChunk = '';
			let chunkIndex = 0;

			for (const paragraph of paragraphs) {
				// If paragraph is larger than chunk size, split it
				if (paragraph.length >= this.settings.chunkSize) {
					// If we have accumulated content, create a chunk
					if (currentChunk) {
						chunks.push(this.createChunk(currentChunk, chunkIndex++, metadata));
						currentChunk = '';
					}

					// Split large paragraph into sentences
					const sentences = paragraph.split(this.SENTENCE_BOUNDARY);
					let sentenceChunk = '';

					for (const sentence of sentences) {
						const trimmedSentence = sentence.trim();
						if (!trimmedSentence) continue;

						// If adding this sentence would exceed chunk size
						if ((sentenceChunk + ' ' + trimmedSentence).length > this.settings.chunkSize) {
							if (sentenceChunk) {
								chunks.push(this.createChunk(sentenceChunk, chunkIndex++, metadata));
								sentenceChunk = trimmedSentence;
							} else {
								// Single sentence is too long, force split it
								let position = 0;
								while (position < trimmedSentence.length) {
									const chunk = trimmedSentence.slice(position,
										Math.min(position + this.settings.chunkSize, trimmedSentence.length));
									chunks.push(this.createChunk(chunk, chunkIndex++, metadata));
									position += this.settings.chunkSize;
								}
								sentenceChunk = '';
							}
						} else {
							sentenceChunk += (sentenceChunk ? ' ' : '') + trimmedSentence;
						}
					}

					// Add any remaining sentence chunk
					if (sentenceChunk) {
						chunks.push(this.createChunk(sentenceChunk, chunkIndex++, metadata));
					}
				} else {
					// Handle normal-sized paragraphs
					const potentialChunkSize = currentChunk
						? currentChunk.length + 2 + paragraph.length  // +2 for '\n\n'
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

			// Add the last chunk if there's remaining content
			if (currentChunk) {
				chunks.push(this.createChunk(currentChunk, chunkIndex++, metadata));
			}

			// Ensure we have at least one chunk if we have content
			if (chunks.length === 0 && trimmedContent.length > 0) {
				console.log('Creating fallback chunk for content:', {
					contentLength: trimmedContent.length
				});
				chunks.push(this.createChunk(trimmedContent, 0, metadata));
			}

			// Apply overlap if needed
			if (this.settings.chunkOverlap > 0 && chunks.length > 1) {
				this.applyOverlap(chunks);
			}

			console.log('Finished creating chunks:', {
				chunkCount: chunks.length,
				chunkSizes: chunks.map(c => c.content.length),
				chunkPreviews: chunks.map(c => ({
					index: c.chunkIndex,
					size: c.content.length,
					preview: c.content.substring(0, 100)
				}))
			});

			return chunks;
		} catch (error) {
			console.error('Error in splitDocument:', error);
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
			console.warn('Chunk smaller than minChunkSize:', {
				size: trimmedContent.length,
				minSize: this.settings.minChunkSize
			});
		}

		return {
			content: trimmedContent,
			chunkIndex: index,
			metadata: { ...metadata }
		};
	}

	private applyOverlap(chunks: DocumentChunk[]): void {
		if (chunks.length <= 1) return;

		for (let i = chunks.length - 1; i > 0; i--) {
			const currentChunk = chunks[i];
			const previousChunk = chunks[i - 1];

			// Get overlap text from end of previous chunk
			const overlapText = previousChunk.content.slice(-this.settings.chunkOverlap);
			if (overlapText) {
				currentChunk.content = overlapText + '\n\n' + currentChunk.content;
			}
		}
	}

	private async enhanceMetadata(
		content: string,
		baseMetadata: DocumentMetadata,
		frontMatter: Record<string, any> | null
	): Promise<DocumentMetadata> {
		// Start with the base metadata
		const enhancedMetadata = { ...baseMetadata };

		// Extract tags, links, and aliases from the content
		const tags = new Set(enhancedMetadata.tags || []);
		const links = new Set(enhancedMetadata.links || []);
		let aliases = enhancedMetadata.customMetadata?.aliases || [];

		// Extract all metadata components using MetadataExtractor
		const contentMetadata = await this.metadataExtractor.extractMetadata({
			path: baseMetadata.obsidianId,
			stat: {
				mtime: baseMetadata.lastModified,
				ctime: baseMetadata.created,
				size: baseMetadata.size
			},
			vault: baseMetadata.vault
		} as any, content);

		// Merge the extracted metadata
		contentMetadata.tags?.forEach(tag => tags.add(tag));
		contentMetadata.links?.forEach(link => links.add(link));
		if (contentMetadata.customMetadata?.aliases) {
			aliases = [...new Set([...aliases, ...contentMetadata.customMetadata.aliases])];
		}

		// Update the metadata
		enhancedMetadata.tags = Array.from(tags);
		enhancedMetadata.customMetadata = {
			...enhancedMetadata.customMetadata,
			aliases
		};
		enhancedMetadata.frontMatter = frontMatter || enhancedMetadata.frontMatter;

		return enhancedMetadata;
	}

	private parseFrontMatter(frontMatter: string): Record<string, any> {
		try {
			// Simple YAML-like parsing
			const result: Record<string, any> = {};
			const lines = frontMatter.split('\n');

			for (const line of lines) {
				const trimmedLine = line.trim();
				if (!trimmedLine || trimmedLine.startsWith('#')) continue;

				const separatorIndex = line.indexOf(':');
				if (separatorIndex === -1) continue;

				const key = line.slice(0, separatorIndex).trim();
				let value = line.slice(separatorIndex + 1).trim();

				// Remove quotes if present
				value = value.replace(/^["'](.*)["']$/, '$1');

				// Parse lists
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
			console.warn('Failed to parse front matter:', error);
			return {};
		}
	}

	public getSettings() {
		return { ...this.settings };
	}
}
