import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DocumentChunk, DocumentMetadata } from '../models/DocumentChunk';
import { MindMatrixSettings, isVaultInitialized } from '../settings/Settings';
import { Notice } from 'obsidian';

export class SupabaseService {
    private client: SupabaseClient | null;
    private static instance: SupabaseService | null = null;
    private settings: MindMatrixSettings;
    private readonly TABLE_NAME = 'obsidian_documents';

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
                .from(this.TABLE_NAME)
                .select('id')
                .limit(1);

            if (testError && !testError.message.includes('does not exist')) {
                throw new Error(`Database connection failed: ${testError.message}`);
            }

            // Initialize the database schema
            const { error: initError } = await this.client
                .rpc('init_obsidian_documents');

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

    public async upsertChunks(chunks: DocumentChunk[]): Promise<void> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping upsertChunks.');
            return;
        }

        try {
            if (chunks.length === 0) {
                console.log('No chunks to upsert');
                return;
            }

            // Get the obsidian_id from the first chunk
            const obsidianId = chunks[0].metadata.obsidianId;

            console.log('Attempting to delete existing chunks for:', obsidianId);

            // First delete existing chunks for this file
            const { error: deleteError } = await this.client
                .from(this.TABLE_NAME)
                .delete()
                .eq('vault_id', this.settings.vaultId)
                .eq('obsidian_id', obsidianId);

            if (deleteError) {
                console.error('Error deleting existing chunks:', deleteError);
                throw deleteError;
            }

            // Prepare the new chunks for insertion
            const chunksToInsert = chunks.map(chunk => ({
                vault_id: this.settings.vaultId,
                obsidian_id: chunk.metadata.obsidianId,
                chunk_index: chunk.chunkIndex,
                content: chunk.content,
                metadata: chunk.metadata,
                embedding: chunk.embedding,
                last_updated: new Date().toISOString()
            }));

            // Insert the new chunks
            const { error: insertError } = await this.client
                .from(this.TABLE_NAME)
                .insert(chunksToInsert);

            if (insertError) {
                console.error('Error inserting new chunks:', insertError);
                throw insertError;
            }

            console.log('Successfully updated chunks:', {
                numberOfChunks: chunks.length,
                vaultId: this.settings.vaultId,
                obsidianId
            });
        } catch (error) {
            console.error('Failed to upsert chunks:', error);
            throw error;
        }
    }

    public async deleteDocumentChunks(obsidianId: string): Promise<void> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping deleteDocumentChunks.');
            return;
        }

        try {
            const { error } = await this.client
                .from(this.TABLE_NAME)
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

    public async getDocumentChunks(obsidianId: string): Promise<DocumentChunk[]> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping getDocumentChunks.');
            return [];
        }

        try {
            const { data, error } = await this.client
                .from(this.TABLE_NAME)
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

    public async testConnection(): Promise<boolean> {
        if (!this.client) {
            return false;
        }

        try {
            const { error } = await this.client
                .from(this.TABLE_NAME)
                .select('id')
                .limit(1);

            return !error;
        } catch (error) {
            return false;
        }
    }

    public async getAllDocumentIds(): Promise<string[]> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping getAllDocumentIds.');
            return [];
        }

        try {
            const { data, error } = await this.client
                .from(this.TABLE_NAME)
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
