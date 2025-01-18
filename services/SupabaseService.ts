import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DocumentChunk, DocumentMetadata } from '../models/DocumentChunk';
import { MindMatrixSettings, isVaultInitialized } from '../settings/Settings';
import { Notice } from 'obsidian';

/**
 * Service class for handling all Supabase database operations
 */
export class SupabaseService {
    private client: SupabaseClient | null;
    private static instance: SupabaseService | null = null;
    private settings: MindMatrixSettings;

    private static readonly CREATE_TABLE_SQL = `
        CREATE TABLE IF NOT EXISTS obsidian_notes (
            id BIGSERIAL PRIMARY KEY,
            vault_id TEXT NOT NULL,
            obsidian_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT,
            metadata JSONB,
            embedding VECTOR(1536),
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(vault_id, obsidian_id, chunk_index)
        );

        CREATE INDEX IF NOT EXISTS idx_vault_obsidian ON obsidian_notes(vault_id, obsidian_id);
    `;

    private static readonly CREATE_FUNCTION_SQL = `
        CREATE OR REPLACE FUNCTION match_documents(query_embedding VECTOR(1536), vault_id TEXT, match_count INT)
        RETURNS TABLE (
            id BIGINT,
            obsidian_id TEXT,
            content TEXT,
            metadata JSONB,
            similarity FLOAT
        )
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RETURN QUERY
            SELECT
                id,
                obsidian_id,
                content,
                metadata,
                1 - (obsidian_notes.embedding <=> query_embedding) AS similarity
            FROM obsidian_notes
            WHERE vault_id = vault_id
            ORDER BY obsidian_notes.embedding <=> query_embedding
            LIMIT match_count;
        END;
        $$;
    `;

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
        this.client = createClient(settings.supabase.url, settings.supabase.apiKey, {
            auth: {
                persistSession: false
            }
        });
    }

    /**
     * Get singleton instance of SupabaseService
     */
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

    /**
     * Initialize database schema if it doesn't exist
     */
    private async initializeDatabase(): Promise<void> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping database initialization.');
            return;
        }

        try {
            const schemaExists = await this.checkSchemaExists();

            if (schemaExists) {
                const vaultExists = await this.verifyVaultExists();
                if (!vaultExists) {
                    new Notice('First time connecting this vault to the database');
                }
                return;
            }

            const vectorExtensionExists = await this.checkVectorExtension();

            if (!vectorExtensionExists) {
                throw new Error(
                    'pgvector extension is not available. Please ensure it is installed on your database.'
                );
            }

            new Notice('Initializing database schema...');

            const { error: tableError } = await this.client.rpc('exec_sql', {
                sql: SupabaseService.CREATE_TABLE_SQL
            });

            if (tableError) {
                throw new Error(`Failed to create table: ${tableError.message}`);
            }

            const { error: functionError } = await this.client.rpc('exec_sql', {
                sql: SupabaseService.CREATE_FUNCTION_SQL
            });

            if (functionError) {
                throw new Error(`Failed to create search function: ${functionError.message}`);
            }

            new Notice('Database schema initialized successfully');
        } catch (error) {
            new Notice(`Database initialization failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check if database schema exists
     */
    private async checkSchemaExists(): Promise<boolean> {
        if (!this.client) return false;

        try {
            const { data, error } = await this.client
                .from('obsidian_notes')
                .select('id')
                .limit(1);

            return !error;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if vector extension is available
     */
    private async checkVectorExtension(): Promise<boolean> {
        if (!this.client) return false;

        try {
            const { data, error } = await this.client
                .from('pg_extension')
                .select('extname')
                .eq('extname', 'vector')
                .single();

            return !error && data;
        } catch (error) {
            return false;
        }
    }

    /**
     * Verify vault exists in database
     */
    private async verifyVaultExists(): Promise<boolean> {
        if (!this.client) return false;

        try {
            const { data, error } = await this.client
                .from('obsidian_notes')
                .select('id')
                .eq('vault_id', this.settings.vaultId)
                .limit(1);

            return !error && data && data.length > 0;
        } catch (error) {
            return false;
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
            new Notice(`Failed to upsert chunks: ${error.message}`);
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
            new Notice(`Failed to delete chunks: ${error.message}`);
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
            new Notice(`Failed to get chunks: ${error.message}`);
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
            const { data, error } = await this.client
                .rpc('match_documents', {
                    query_embedding: embedding,
                    vault_id: this.settings.vaultId,
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
            new Notice(`Failed to perform semantic search: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all unique document IDs for this vault
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
            new Notice(`Failed to get document IDs: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clean up orphaned entries for this vault
     */
    public async cleanupOrphanedEntries(activeIds: string[]): Promise<number> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping cleanupOrphanedEntries.');
            return 0;
        }

        try {
            const { data, error } = await this.client
                .from('obsidian_notes')
                .delete()
                .eq('vault_id', this.settings.vaultId)
                .not('obsidian_id', 'in', `(${activeIds.map(id => `'${id}'`).join(',')})`);

            if (error) {
                throw error;
            }

            return data?.length || 0;
        } catch (error) {
            new Notice(`Failed to cleanup orphaned entries: ${error.message}`);
            throw error;
        }
    }

    /**
     * Test database connection and vault access
     */
    public async testConnection(): Promise<boolean> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping testConnection.');
            return false;
        }

        try {
            const { data, error } = await this.client
                .from('obsidian_notes')
                .select('id')
                .eq('vault_id', this.settings.vaultId)
                .limit(1);

            return !error;
        } catch (error) {
            return false;
        }
    }

    /**
     * Transfer data from one vault ID to another
     */
    public async transferVaultData(oldVaultId: string, newVaultId: string): Promise<void> {
        if (!this.client) {
            console.warn('Supabase client is not initialized. Skipping transferVaultData.');
            return;
        }

        try {
            const { error } = await this.client.rpc('transfer_vault_data', {
                old_vault_id: oldVaultId,
                new_vault_id: newVaultId
            });

            if (error) {
                throw error;
            }
        } catch (error) {
            new Notice(`Failed to transfer vault data: ${error.message}`);
            throw error;
        }
    }
}
