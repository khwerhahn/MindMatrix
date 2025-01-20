/**
 * Represents metadata associated with a document chunk
 */
export interface DocumentMetadata {
	// Original Obsidian metadata
	obsidianId: string;
	path: string;
	lastModified: number;
	created: number;
	size: number;
	frontMatter?: Record<string, any>;
	tags?: string[];
	customMetadata?: Record<string, unknown>;

	// n8n compatibility metadata
	loc?: {
		lines: {
			from: number;
			to: number;
		}
	};
	source?: string;
	file_id?: string;
	blobType?: string;
}

/**
 * Represents a chunk of text from a document with its associated metadata
 */
export interface DocumentChunk {
	// Content of the chunk
	content: string;
	// Index of the chunk within the document
	chunkIndex: number;
	// Associated metadata
	metadata: DocumentMetadata;
	// Optional embedding vector
	embedding?: number[];
}

/**
 * Configuration options for text chunking
 */
export interface ChunkingOptions {
	// Maximum size of each chunk in characters
	chunkSize: number;
	// Minimum size of each chunk in characters
	minChunkSize: number;
	// Amount of overlap between chunks in characters
	overlap: number;
	// Whether to split on sentences when possible
	splitOnSentences: boolean;
	// Custom separator regex pattern (optional)
	separator?: RegExp;
}

/**
 * Response structure from OpenAI embeddings API
 */
export interface EmbeddingResponse {
	// Array of embedding vectors
	data: {
		embedding: number[];
		index: number;
	}[];
	// API usage information
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
	// Model used for embedding
	model: string;
}

/**
 * Error types specific to document processing
 */
export enum DocumentProcessingError {
	CHUNKING_ERROR = 'CHUNKING_ERROR',
	EMBEDDING_ERROR = 'EMBEDDING_ERROR',
	DATABASE_ERROR = 'DATABASE_ERROR',
	INVALID_METADATA = 'INVALID_METADATA',
	FILE_ACCESS_ERROR = 'FILE_ACCESS_ERROR',
	YAML_PARSE_ERROR = 'YAML_PARSE_ERROR',
	VECTOR_EXTENSION_ERROR = 'VECTOR_EXTENSION_ERROR',
	SYNC_ERROR = 'SYNC_ERROR'
}

/**
 * Constants for chunking configuration
 */
export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
	chunkSize: 1500,
	minChunkSize: 100,
	overlap: 200,
	splitOnSentences: true,
	separator: /[.!?]\s+/
};

/**
 * Utility type for database operations
 */
export interface DatabaseRecord {
	id: number;
	vault_id: string;
	obsidian_id: string;
	chunk_index: number;
	content: string;
	metadata: DocumentMetadata;
	embedding: number[];
	last_updated: string;
}

/**
 * Type guard to check if an error is a DocumentProcessingError
 */
export function isDocumentProcessingError(error: any): error is DocumentProcessingError {
	return Object.values(DocumentProcessingError).includes(error as DocumentProcessingError);
}

/**
 * Validates metadata completeness
 */
export function validateMetadata(metadata: DocumentMetadata): boolean {
	return !!(
		metadata.obsidianId &&
		metadata.path &&
		metadata.lastModified &&
		metadata.created &&
		metadata.size
	);
}
