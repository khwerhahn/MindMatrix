// src/services/MetadataExtractor.ts

import { TFile, parseYaml } from 'obsidian';
import { DocumentMetadata, DocumentProcessingError } from '../models/DocumentChunk';

export class MetadataExtractor {
	/**
	 * Extracts all metadata from an Obsidian file
	 */
	public async extractMetadata(file: TFile, content?: string): Promise<DocumentMetadata> {
		try {
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

			// Extract optional metadata
			const aliases = this.extractAliases(frontMatter);
			if (aliases.length > 0) {
				metadata.customMetadata.aliases = aliases;
			}

			// Extract source location if available
			const loc = this.extractSourceLocation(frontMatter);
			if (loc) {
				metadata.loc = loc;
			}

			// Add n8n compatibility metadata if present
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
		} catch (error) {
			console.error('Error extracting metadata:', error);
			throw new Error(`${DocumentProcessingError.INVALID_METADATA}: ${error.message}`);
		}
	}

	/**
	 * Extracts YAML frontmatter from document content
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
	 * Extracts internal links from document content
	 * Handles both standard links [[Page]] and aliased links [[Page|Alias]]
	 */
	private extractLinks(content: string): string[] {
		const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
		const links = new Set<string>();

		let match;
		while ((match = linkRegex.exec(content)) !== null) {
			// Extract the link target, removing any alias after |
			const link = match[1].split('|')[0];

			// Handle subpaths and clean the link
			const cleanLink = this.cleanLink(link);
			if (cleanLink) {
				links.add(cleanLink);
			}
		}

		return Array.from(links);
	}

	/**
	 * Cleans and normalizes a link path
	 */
	private cleanLink(link: string): string {
		// Remove heading/block references
		let cleanLink = link.split('#')[0];
		// Remove query parameters
		cleanLink = cleanLink.split('?')[0];
		// Trim whitespace
		cleanLink = cleanLink.trim();

		return cleanLink;
	}

	/**
	 * Extracts tags from both content and frontmatter
	 */
	private extractTags(content: string, frontMatter?: Record<string, any>): string[] {
		const tags = new Set<string>();

		// Extract inline tags
		const tagRegex = /#([A-Za-z0-9/_-]+)/g;
		let match;
		while ((match = tagRegex.exec(content)) !== null) {
			tags.add(match[1]);
		}

		// Extract frontmatter tags
		if (frontMatter?.tags) {
			const frontMatterTags = Array.isArray(frontMatter.tags)
				? frontMatter.tags
				: [frontMatter.tags];

			frontMatterTags.forEach(tag => {
				if (typeof tag === 'string') {
					// Remove leading # if present
					const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
					tags.add(cleanTag);
				}
			});
		}

		return Array.from(tags);
	}

	/**
	 * Extracts aliases from frontmatter
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
	 * Extracts source location information from frontmatter
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
