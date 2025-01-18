/**
 * Represents metadata associated with a document chunk
 */
export interface DocumentMetadata {
    // Unique identifier from Obsidian (TFile.path)
    obsidianId: string;
    // Original file path within the vault
    path: string;
    // Last modified timestamp
    lastModified: number;
    // Creation timestamp
    created: number;
    // File size in bytes
    size: number;
    // Additional custom metadata (tags, frontmatter, etc.)
    customMetadata?: Record<string, unknown>;
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
 * Error types specific to document processing
 */
export enum DocumentProcessingError {
    CHUNKING_ERROR = 'CHUNKING_ERROR',
    EMBEDDING_ERROR = 'EMBEDDING_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    INVALID_METADATA = 'INVALID_METADATA',
    FILE_ACCESS_ERROR = 'FILE_ACCESS_ERROR'
}
