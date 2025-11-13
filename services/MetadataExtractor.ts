// src/services/MetadataExtractor.ts
import { TFile, parseYaml, Vault } from 'obsidian';
import { DocumentMetadata, DocumentProcessingError } from '../models/DocumentChunk';
import { ErrorHandler } from '../utils/ErrorHandler';

export class MetadataExtractor {
	constructor(
		private vault: Vault,
		private errorHandler: ErrorHandler
	) {}

	/**
	 * Extracts all metadata from an Obsidian file
	 */
	public async extractMetadata(file: TFile, content?: string): Promise<DocumentMetadata> {
		const fileContent = content || await file.vault.read(file);
		const frontMatter = this.extractFrontMatter(fileContent);
		const metadata: DocumentMetadata = {
			obsidianId: file.path,
			path: file.path,
			lastModified: file.stat.mtime,
			created: file.stat.ctime,
			size: file.stat.size,
			frontMatter: frontMatter,
			tags: this.extractTags(fileContent, frontMatter),
			links: this.extractLinks(fileContent),
			customMetadata: {}
		};

		// Extract optional aliases from frontmatter
                const aliases = this.extractAliases(frontMatter);
                if (aliases.length > 0) {
                        metadata.aliases = aliases;
                }

		// Extract source location if available
		const loc = this.extractSourceLocation(frontMatter);
		if (loc) {
			metadata.loc = loc;
		}

		// Add other optional frontmatter fields if present
		if (frontMatter?.source) {
			metadata.source = frontMatter.source;
		}
		if (frontMatter?.file_id) {
			metadata.file_id = frontMatter.file_id;
		}
		if (frontMatter?.blobType) {
			metadata.blobType = frontMatter.blobType;
		}

		return metadata;
	}

	/**
	 * Extracts metadata from the provided content and merges it with the given base metadata and front matter.
	 * This new method is used by the TextSplitter to enhance metadata based on parsed front matter.
	 */
	public async extractMetadataFromContent(
		content: string,
		baseMetadata: DocumentMetadata,
		frontMatter: Record<string, any> | null
	): Promise<DocumentMetadata> {
		const merged = { ...baseMetadata };
		if (frontMatter) {
			merged.frontMatter = frontMatter;
			// Merge tags from front matter
                        if (frontMatter.tags) {
                                const normalizedTags = this.normalizeFrontMatterTags(frontMatter.tags);
                                if (normalizedTags.length > 0) {
                                        merged.tags = normalizedTags;
                                }
			}
                        // Merge aliases directly into the DocumentMetadata alias field
                        const aliases = this.extractAliases(frontMatter);
                        if (aliases.length > 0) {
                                merged.aliases = aliases;
                        }
                }
                return merged;
        }

	/**
	 * Extracts YAML front matter from document content
	 */
	private extractFrontMatter(content: string): Record<string, any> | undefined {
		try {
			const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (!frontMatterMatch) return undefined;
			const yaml = frontMatterMatch[1];
			return parseYaml(yaml);
		} catch (error) {
			console.error('Error parsing frontmatter:', error);
			throw new Error(`${DocumentProcessingError.YAML_PARSE_ERROR}: ${error.message}`);
		}
	}

	/**
	 * Extracts internal links from document content.
	 */
	private extractLinks(content: string): string[] {
		const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
		const links = new Set<string>();
		let match;
		while ((match = linkRegex.exec(content)) !== null) {
			const link = match[1].split('|')[0];
			const cleanLink = this.cleanLink(link);
			if (cleanLink) {
				links.add(cleanLink);
			}
		}
		return Array.from(links);
	}

	/**
	 * Cleans and normalizes a link path.
	 */
	private cleanLink(link: string): string {
		let cleanLink = link.split('#')[0];
		cleanLink = cleanLink.split('?')[0];
		cleanLink = cleanLink.trim();
		return cleanLink;
	}

	/**
	 * Extracts tags from both content and front matter.
	 */
	private extractTags(content: string, frontMatter?: Record<string, any>): string[] {
		const tags = new Set<string>();
		const tagRegex = /#([A-Za-z0-9/_-]+)/g;
		let match;
		while ((match = tagRegex.exec(content)) !== null) {
			tags.add(match[1]);
		}
                if (frontMatter?.tags) {
                        const frontMatterTags = this.normalizeFrontMatterTags(frontMatter.tags);
                        frontMatterTags.forEach(tag => tags.add(tag));
                }
                return Array.from(tags);
        }

        /**
         * Normalizes tags defined in front matter to a consistent array representation.
         */
        private normalizeFrontMatterTags(tags: unknown): string[] {
                if (!tags) {
                        return [];
                }

                const rawTags = Array.isArray(tags) ? tags : [tags];
                const normalized = new Set<string>();

                rawTags.forEach(tagValue => {
                        if (typeof tagValue !== 'string') {
                                return;
                        }

                        tagValue
                                .split(',')
                                .map(part => part.trim())
                                .filter(part => part.length > 0)
                                .forEach(part => {
                                        const cleaned = part.startsWith('#') ? part.slice(1) : part;
                                        if (cleaned.length > 0) {
                                                normalized.add(cleaned);
                                        }
                                });
                });

                return Array.from(normalized);
        }

	/**
	 * Extracts aliases from front matter.
	 */
	private extractAliases(frontMatter?: Record<string, any>): string[] {
		if (!frontMatter?.aliases) return [];
		if (Array.isArray(frontMatter.aliases)) {
			return frontMatter.aliases.filter(alias => typeof alias === 'string');
		}
		if (typeof frontMatter.aliases === 'string') {
			return [frontMatter.aliases];
		}
		return [];
	}

	/**
	 * Extracts source location information from front matter.
	 */
	private extractSourceLocation(frontMatter?: Record<string, any>): { lines: { from: number; to: number } } | undefined {
		if (!frontMatter?.loc?.lines?.from || !frontMatter?.loc?.lines?.to) {
			return undefined;
		}
		return {
			lines: {
				from: Number(frontMatter.loc.lines.from),
				to: Number(frontMatter.loc.lines.to)
			}
		};
	}
}
