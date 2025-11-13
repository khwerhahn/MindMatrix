/**
 * DocumentChunk.ts
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
    aliases?: string[];  // New field for aliases
    links?: string[];    // New field for internal links
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
    graphDocumentId?: string; // Optional ID used for graph synchronization
}

/**
 * Represents a chunk of text from a document with its associated metadata
 */
export interface DocumentChunk {
    id?: number;
    vault_id: string;
    file_status_id: number;
    chunk_index: number;
    content: string;
    metadata: Record<string, any>;
    embedding: number[];
    vectorized_at: string;
    created_at?: string;
    updated_at?: string;
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
    chunkOverlap: number;
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
    chunkOverlap: 200,
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
    vectorized_at?: string;  // New field for tracking embedding generation
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
        // Note: Not including optional fields in validation
    );
}

/**
 * Represents a file status record in the database
 */
export interface FileStatusRecord {
    id: number;
    vault_id: string;
    file_path: string;
    last_modified: number;
    last_vectorized: string;
    content_hash: string;
    status: string;
    tags: string[];
    aliases: string[];
    links: string[];
    created_at: string;
    updated_at: string;
}

/**
 * Represents a document record in the database
 */
export interface DocumentRecord {
    id: number;
    vault_id: string;
    file_status_id: number;
    chunk_index: number;
    content: string;
    metadata: DocumentMetadata;
    embedding: number[];
    last_updated: string;
    vectorized_at?: string;
}
