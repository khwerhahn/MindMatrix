// src/services/SupabaseService.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DocumentChunk, DocumentMetadata } from '../models/DocumentChunk';
import { MindMatrixSettings, isVaultInitialized } from '../settings/Settings';
import { Notice } from 'obsidian';

/**
 * Represents a record from obsidian_file_status.
 */
interface FileStatusRecord {
	vault_id: string;
	file_path: string;
	last_modified: number;
	last_vectorized?: string;
	content_hash?: string;
	status?: string;
	tags?: string[];
	aliases?: string[];
	links?: string[];
	created_at?: string;
	updated_at?: string;
}

export class SupabaseService {
	private client: SupabaseClient | null;
	private static instance: SupabaseService | null = null;
	private settings: MindMatrixSettings;
	private readonly TABLE_NAME = 'obsidian_documents';
	private readonly FILE_STATUS_TABLE = 'obsidian_file_status'; // Table for tracking file status

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
			// Verify connection by selecting from obsidian_documents
			const { error: testError } = await this.client
				.from(this.TABLE_NAME)
				.select('id')
				.limit(1);
			if (testError && !testError.message.includes('does not exist')) {
				throw new Error(`Database connection failed: ${testError.message}`);
			}
			// Ensure the file status table exists
			await this.initializeFileStatusTable();
			new Notice('Database connection verified');
			this.settings.supabase.initialized = true;
		} catch (error) {
			console.error('Database initialization error:', error);
			new Notice(`Database error: ${(error as Error).message}`);
			throw error;
		}
	}

	/**
	 * Ensures that obsidian_file_status table exists.
	 */
	private async initializeFileStatusTable(): Promise<void> {
		if (!this.client) return;
		try {
			// Check if file status table exists
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (checkError && checkError.message.includes('does not exist')) {
				console.log('File status table missing. Please create it manually or run setup SQL.');
				new Notice('Some database tables are missing. Plugin will work with limited functionality.', 5000);
			} else {
				console.log('File status table exists and is accessible');
			}
		} catch (error) {
			console.error('Error initializing file status table:', error);
			throw new Error(`Failed to initialize file status table: ${(error as Error).message}`);
		}
	}

	/**
	 * Inserts or updates document chunks in the obsidian_documents table.
	 */
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
			// Determine the obsidianId from the first chunk
			const obsidianId = chunks[0].metadata.obsidianId;
			// Delete existing chunks for this file first
			const { error: deleteError } = await this.client
				.from(this.TABLE_NAME)
				.delete()
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId);
			if (deleteError) {
				console.error('Error deleting existing chunks:', deleteError);
				throw deleteError;
			}
			// Prepare new chunk data for insertion
			const chunksToInsert = chunks.map(chunk => ({
				vault_id: this.settings.vaultId,
				obsidian_id: chunk.metadata.obsidianId,
				chunk_index: chunk.chunkIndex,
				content: chunk.content,
				metadata: chunk.metadata,
				embedding: chunk.embedding,
				last_updated: new Date().toISOString(),
				vectorized_at: new Date().toISOString()
			}));
			// Insert new chunks
			const { error: insertError } = await this.client
				.from(this.TABLE_NAME)
				.insert(chunksToInsert);
			if (insertError) {
				console.error('Error inserting new chunks:', insertError);
				throw insertError;
			}
			// Update file status to track vectorization
			await this.updateFileVectorizationStatus(chunks[0].metadata);
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

	/**
	 * Bulk upsert method for file status records.
	 * Improves performance for large vaults.
	 */
	public async bulkUpsertFileStatuses(statuses: FileStatusRecord[]): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping bulkUpsertFileStatuses.');
			return;
		}
		try {
			if (statuses.length === 0) return;
			const { error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.upsert(statuses, { onConflict: 'vault_id,file_path' });
			if (error) {
				console.error('Error during bulk upsert of file statuses:', error);
				throw error;
			}
			console.log(`Bulk upsert of ${statuses.length} file statuses successful.`);
		} catch (error) {
			console.error('Failed to bulk upsert file statuses:', error);
			throw error;
		}
	}

	/**
	 * Creates or updates a record in the obsidian_file_status table
	 * to reflect the latest file status using provided metadata.
	 */
	public async updateFileVectorizationStatus(metadata: DocumentMetadata): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping updateFileVectorizationStatus.');
			return;
		}
		try {
			// Check if file status table exists
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (checkError && checkError.message.includes('does not exist')) {
				console.warn('File status table does not exist. Skipping status update.');
				return;
			}
			// Construct a FileStatusRecord
			const fileStatus: FileStatusRecord = {
				vault_id: this.settings.vaultId!,
				file_path: metadata.obsidianId,
				last_modified: metadata.lastModified,
				last_vectorized: new Date().toISOString(),
				content_hash: metadata.customMetadata?.contentHash || '',
				status: 'PENDING',
				tags: metadata.tags || [],
				aliases: metadata.customMetadata?.aliases || [],
				links: metadata.links || [],
				updated_at: new Date().toISOString()
			};
			// Upsert the record into the file status table
			const { error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.upsert(fileStatus, { onConflict: 'vault_id,file_path' });
			if (error) {
				console.error('Error updating file vectorization status:', error);
				throw error;
			}
			console.log('File vectorization status updated:', metadata.obsidianId);
		} catch (error) {
			console.error('Failed to update file vectorization status:', error);
			// Non-critical, so just log the error
		}
	}

	/**
	 * Marks a file as deleted in the obsidian_file_status table.
	 */
	public async updateFileStatusOnDelete(filePath: string): Promise<void> {
		if (!this.client) return;
		try {
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (checkError && checkError.message.includes('does not exist')) {
				console.warn('File status table does not exist. Skipping status update on delete.');
				return;
			}
			const { error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.update({
					status: 'deleted',
					updated_at: new Date().toISOString()
				})
				.eq('vault_id', this.settings.vaultId)
				.eq('file_path', filePath);
			if (error) {
				console.error('Error updating file status on delete:', error);
				throw error;
			}
		} catch (error) {
			console.error('Failed to update file status on delete:', error);
		}
	}

	/**
	 * Deletes document chunks for a given obsidianId from the obsidian_documents table.
	 */
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
			if (error) throw error;
			// Also mark file as deleted in the file status table
			await this.updateFileStatusOnDelete(obsidianId);
		} catch (error) {
			console.error('Failed to delete chunks:', error);
			throw error;
		}
	}

	/**
	 * Retrieves document chunks for a given obsidianId.
	 */
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
			if (error) throw error;
			return data.map(row => ({
				content: row.content,
				chunkIndex: row.chunk_index,
				metadata: row.metadata as DocumentMetadata,
				embedding: row.embedding,
				vectorized_at: row.vectorized_at
			}));
		} catch (error) {
			console.error('Failed to get chunks:', error);
			throw error;
		}
	}

	/**
	 * Checks if a file has been vectorized based on the obsidian_file_status table.
	 */
	public async isFileVectorized(filePath: string): Promise<boolean> {
		if (!this.client) return false;
		try {
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (checkError && checkError.message.includes('does not exist')) {
				console.warn('File status table does not exist. Assuming file is not vectorized.');
				return false;
			}
			const { data, error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('status, last_vectorized')
				.eq('vault_id', this.settings.vaultId)
				.eq('file_path', filePath)
				.single();
			if (error) {
				if (error.code === 'PGRST116') {
					// Row not found
					return false;
				}
				throw error;
			}
			return data && data.status === 'vectorized' && !!data.last_vectorized;
		} catch (error) {
			console.error('Failed to check if file is vectorized:', error);
			return false;
		}
	}

	/**
	 * Retrieves the vectorization status of a file from the database.
	 */
	public async getFileVectorizationStatus(filePath: string): Promise<{
		isVectorized: boolean;
		lastModified: number;
		lastVectorized: string | null;
		contentHash: string | null;
		status: string | null;
	}> {
		if (!this.client) {
			return {
				isVectorized: false,
				lastModified: 0,
				lastVectorized: null,
				contentHash: null,
				status: null
			};
		}
		try {
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (checkError && checkError.message.includes('does not exist')) {
				console.warn('File status table does not exist. Returning default status.');
				return {
					isVectorized: false,
					lastModified: 0,
					lastVectorized: null,
					contentHash: null,
					status: null
				};
			}
			const { data, error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('*')
				.eq('vault_id', this.settings.vaultId)
				.eq('file_path', filePath)
				.single();
			if (error) {
				if (error.code === 'PGRST116') {
					return {
						isVectorized: false,
						lastModified: 0,
						lastVectorized: null,
						contentHash: null,
						status: null
					};
				}
				throw error;
			}
			return {
				isVectorized: data.status === 'vectorized',
				lastModified: data.last_modified,
				lastVectorized: data.last_vectorized,
				contentHash: data.content_hash,
				status: data.status
			};
		} catch (error) {
			console.error('Failed to get file vectorization status:', error);
			return {
				isVectorized: false,
				lastModified: 0,
				lastVectorized: null,
				contentHash: null,
				status: null
			};
		}
	}

	/**
	 * Determines if a file needs vectorizing based on last_modified and content_hash.
	 */
	public async needsVectorizing(
		filePath: string,
		lastModified: number,
		contentHash: string
	): Promise<boolean> {
		if (!this.client) return true;
		try {
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (checkError && checkError.message.includes('does not exist')) {
				console.warn('File status table does not exist. Assuming file needs vectorizing.');
				return true;
			}
			const status = await this.getFileVectorizationStatus(filePath);
			if (!status.status) {
				return true; // No record means it needs vectorizing
			}
			if (status.contentHash !== contentHash) {
				return true; // Content has changed
			}
			if (lastModified > status.lastModified) {
				return true; // File modified since last vectorization
			}
			return false;
		} catch (error) {
			console.error('Failed to check if file needs vectorizing:', error);
			return true; // Default to needing vectorization on errors
		}
	}

	/**
	 * Retrieves all files that do not have a status of 'vectorized' in the database.
	 */
	public async getFilesNeedingVectorization(): Promise<string[]> {
		if (!this.client) return [];
		try {
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (checkError && checkError.message.includes('does not exist')) {
				console.warn('File status table does not exist. Unable to determine files needing vectorization.');
				return [];
			}
			const { data, error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('file_path')
				.eq('vault_id', this.settings.vaultId)
				.not('status', 'eq', 'vectorized');
			if (error) throw error;
			return data.map((row: { file_path: string }) => row.file_path);
		} catch (error) {
			console.error('Failed to get files needing vectorization:', error);
			return [];
		}
	}

	/**
	 * Performs a semantic search using the match_documents function.
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
			if (error) throw error;
			return data.map((row: any) => ({
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
	 * Tests the connection by selecting from the obsidian_documents table.
	 */
	public async testConnection(): Promise<boolean> {
		if (!this.client) return false;
		try {
			const { error } = await this.client
				.from(this.TABLE_NAME)
				.select('id')
				.limit(1);
			// Consider connected even if table doesn't exist
			if (error && error.message && error.message.includes('does not exist')) {
				return true;
			}
			return !error;
		} catch {
			return false;
		}
	}

	/**
	 * Returns all unique obsidian_ids from the obsidian_documents table for the current vault.
	 */
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
				if (error.message.includes('does not exist')) {
					return [];
				}
				throw error;
			}
			return data.map((row: any) => row.obsidian_id);
		} catch (error) {
			console.error('Failed to get document IDs:', error);
			throw error;
		}
	}

	/**
	 * Creates the required database tables if needed (manual invocation).
	 */
	public async createRequiredTables(): Promise<{ success: boolean; message: string }> {
		if (!this.client) {
			return {
				success: false,
				message: 'Supabase client not initialized'
			};
		}
		try {
			// Attempt to create the file status table
			const createFileStatusTableSQL = `
				CREATE TABLE IF NOT EXISTS ${this.FILE_STATUS_TABLE} (
					id BIGSERIAL PRIMARY KEY,
					vault_id TEXT NOT NULL,
					file_path TEXT NOT NULL,
					last_modified BIGINT NOT NULL,
					last_vectorized TIMESTAMPTZ,
					content_hash TEXT,
					status TEXT,
					tags TEXT[],
					aliases TEXT[],
					links TEXT[],
					created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(vault_id, file_path)
				);
				CREATE INDEX IF NOT EXISTS idx_file_status_vault_path ON ${this.FILE_STATUS_TABLE}(vault_id, file_path);
			`;
			// Execute via a Postgres RPC; note that this may require elevated privileges.
			const { error } = await this.client.rpc('run_sql', { sql: createFileStatusTableSQL });
			if (error) {
				return { success: false, message: `Could not create tables: ${error.message}` };
			}
			return { success: true, message: 'Tables created successfully' };
		} catch (error) {
			return { success: false, message: `Error creating tables: ${(error as Error).message}` };
		}
	}
}
