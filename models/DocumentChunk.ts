export interface DocumentMetadata {
    path: string;
    created: number;
    modified: number;
    size: number;
    tags?: string[];
    frontmatter?: Record<string, unknown>;
}

export interface DocumentChunk {
    id?: number;
    obsidian_id: string;
    chunk_index: number;
    content: string;
    metadata: DocumentMetadata;
    embedding?: number[];
    last_updated?: Date;
}

export interface ChunkingOptions {
    chunkSize: number;
    chunkOverlap: number;
    minChunkSize: number;
}

export interface EmbeddingResponse {
    id: number;
    obsidian_id: string;
    similarity: number;
    content: string;
    metadata: DocumentMetadata;
}
