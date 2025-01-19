import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DocumentChunk, DocumentMetadata } from '../models/DocumentChunk';
import { MindMatrixSettings, isVaultInitialized } from '../settings/Settings';
import { Notice } from 'obsidian';

export class SupabaseService {
    private client: SupabaseClient | null;
    private static instance: SupabaseService | null = null;
    private settings: MindMatrixSettings;

    private constructor(settings: MindMatrixSettings) {
        if (!settings.supabase.url || !settings.supabase.apiKey) {
            console.warn('Supabase configuration is incomplete. Supabase service will not be initialized.');
            this.client = null;
            return;
        }

        if (!isVaultInitialized(settings)) {
            throw new Error('Vault is not initialized');
        }

        this.settings = settings;
        this.client = createClient(settings.supabase.url, settings.supabase.apiKey);
    }

    public static async getInstance(settings: MindMatrixSettings): Promise<SupabaseService | null> {
        if (!settings.supabase.url || !settings.supabase.apiKey) {
            console.warn('Supabase configuration is incomplete. Returning null.');
            return null;
        }

        if (!SupabaseService.instance) {
            SupabaseService.instance = new SupabaseService(settings);
            await SupabaseService.instance.initializeDatabase();
        } else if (
            SupabaseService.instance.settings.supabase.url !== settings.supabase.url ||
            SupabaseService.instance.settings.supabase.apiKey !== settings.supabase.apiKey ||
            SupabaseService.instance.settings.vaultId !== settings.vaultId
        ) {
            SupabaseService.instance = new SupabaseService(settings);
            await SupabaseService.instance.initializeDatabase();
        }
        return SupabaseService.instance;
    }

    private async initializeDatabase(): Promise<void> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping database initialization.');
            return;
        }

        try {
            new Notice('Checking database connection...');

            // Verify we can access the database
            const { data: testData, error: testError } = await this.client
                .from('obsidian_notes')
                .select('id')
                .limit(1);

            if (testError && !testError.message.includes('does not exist')) {
                throw new Error(`Database connection failed: ${testError.message}`);
            }

            // Initialize the database schema
            const { error: initError } = await this.client
                .rpc('init_obsidian_notes');

            if (initError) {
                throw new Error(`Failed to initialize database: ${initError.message}`);
            }

            new Notice('Database connection verified');
            this.settings.supabase.initialized = true;

        } catch (error) {
            console.error('Database initialization error:', error);
            new Notice(`Database error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Insert or update document chunks in the database
     */
    public async upsertChunks(chunks: DocumentChunk[]): Promise<void> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping upsertChunks.');
            return;
        }

        try {
            const { error } = await this.client
                .from('obsidian_notes')
                .upsert(
                    chunks.map(chunk => ({
                        vault_id: this.settings.vaultId,
                        obsidian_id: chunk.metadata.obsidianId,
                        chunk_index: chunk.chunkIndex,
                        content: chunk.content,
                        metadata: chunk.metadata,
                        embedding: chunk.embedding,
                        last_updated: new Date().toISOString()
                    }))
                );

            if (error) {
                throw error;
            }
        } catch (error) {
            console.error('Failed to upsert chunks:', error);
            throw error;
        }
    }

    /**
     * Delete document chunks by obsidian_id
     */
    public async deleteDocumentChunks(obsidianId: string): Promise<void> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping deleteDocumentChunks.');
            return;
        }

        try {
            const { error } = await this.client
                .from('obsidian_notes')
                .delete()
                .eq('vault_id', this.settings.vaultId)
                .eq('obsidian_id', obsidianId);

            if (error) {
                throw error;
            }
        } catch (error) {
            console.error('Failed to delete chunks:', error);
            throw error;
        }
    }

    /**
     * Get all chunks for a document
     */
    public async getDocumentChunks(obsidianId: string): Promise<DocumentChunk[]> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping getDocumentChunks.');
            return [];
        }

        try {
            const { data, error } = await this.client
                .from('obsidian_notes')
                .select('*')
                .eq('vault_id', this.settings.vaultId)
                .eq('obsidian_id', obsidianId)
                .order('chunk_index');

            if (error) {
                throw error;
            }

            return data.map(row => ({
                content: row.content,
                chunkIndex: row.chunk_index,
                metadata: row.metadata as DocumentMetadata,
                embedding: row.embedding
            }));
        } catch (error) {
            console.error('Failed to get chunks:', error);
            throw error;
        }
    }

    /**
     * Semantic search using embeddings
     */
    public async semanticSearch(embedding: number[], limit: number = 5): Promise<Array<{
        content: string;
        metadata: DocumentMetadata;
        similarity: number;
    }>> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping semanticSearch.');
            return [];
        }

        try {
            const { data, error } = await this.client.rpc('match_documents', {
                query_embedding: embedding,
                search_vault_id: this.settings.vaultId,
                match_count: limit
            });

            if (error) {
                throw error;
            }

            return data.map(row => ({
                content: row.content,
                metadata: row.metadata as DocumentMetadata,
                similarity: row.similarity
            }));
        } catch (error) {
            console.error('Failed to perform semantic search:', error);
            throw error;
        }
    }

    /**
     * Test database connection
     */
    public async testConnection(): Promise<boolean> {
        if (!this.client) {
            return false;
        }

        try {
            const { error } = await this.client
                .from('obsidian_notes')
                .select('id')
                .limit(1);

            return !error;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get all document IDs for this vault
     */
    public async getAllDocumentIds(): Promise<string[]> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping getAllDocumentIds.');
            return [];
        }

        try {
            const { data, error } = await this.client
                .from('obsidian_notes')
                .select('obsidian_id')
                .eq('vault_id', this.settings.vaultId)
                .distinct();

            if (error) {
                throw error;
            }

            return data.map(row => row.obsidian_id);
        } catch (error) {
            console.error('Failed to get document IDs:', error);
            throw error;
        }
    }
}
