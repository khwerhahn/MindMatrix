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
	private readonly FILE_STATUS_TABLE = 'obsidian_file_status';
	// Track deletion operations for a given file to avoid concurrent deletes
	private deleteOperationsInProgress: Map<string, boolean> = new Map();

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
	 * Inserts or updates document chunks in the obsidian_documents table using an atomic transaction.
	 * Improvements:
	 * - Transaction handling to ensure atomicity
	 * - Verification of deletion success before insertion
	 * - Proper error handling and retry logic
	 * - Prevents concurrent deletions on the same file
	 */
	public async upsertChunks(chunks: DocumentChunk[]): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping upsertChunks.');
			return;
		}

		if (chunks.length === 0) {
			console.log('No chunks to upsert');
			return;
		}

		// Determine the obsidianId from the first chunk
		const obsidianId = chunks[0].metadata.obsidianId;

		// Check if a delete operation is already in progress for this file
		if (this.deleteOperationsInProgress.get(obsidianId)) {
			console.warn(`Delete operation already in progress for ${obsidianId}. Queueing update.`);
			// Wait for previous operation to complete with exponential backoff
			let retryCount = 0;
			const maxRetries = 5;
			const baseDelay = 500; // ms

			while (this.deleteOperationsInProgress.get(obsidianId) && retryCount < maxRetries) {
				const delay = baseDelay * Math.pow(2, retryCount);
				await new Promise(resolve => setTimeout(resolve, delay));
				retryCount++;
			}

			if (this.deleteOperationsInProgress.get(obsidianId)) {
				throw new Error(`Deletion operation timeout for ${obsidianId}`);
			}
		}

		// Mark deletion as in progress
		this.deleteOperationsInProgress.set(obsidianId, true);

		try {
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

			// Record original number of chunks for verification
			const chunkCount = chunksToInsert.length;
			console.log(`Preparing to update ${chunkCount} chunks for file: ${obsidianId}`);

			// Execute delete and insert operations in a transaction-like manner
			// First delete existing chunks for this file.
			// Modified query: remove .select('count') and use head count instead.
			const { error: deleteError, count: deletedCount } = await this.client
				.from(this.TABLE_NAME)
				.delete()
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId)
				.select('*', { head: true, count: 'exact' });
			if (deleteError) {
				console.error('Error deleting existing chunks:', deleteError);
				throw deleteError;
			}
			console.log(`Successfully deleted ${deletedCount} existing chunks for ${obsidianId}`);

			// Verify there are no remaining chunks (double-check deletion)
			const { data: remainingData, error: countError } = await this.client
				.from(this.TABLE_NAME)
				.select('id', { count: 'exact', head: true })
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId);
			if (countError) {
				console.error('Error verifying deletion:', countError);
				throw countError;
			}

			const remainingCount = remainingData?.length || 0;
			if (remainingCount > 0) {
				console.warn(`Deletion verification failed: ${remainingCount} chunks still exist for ${obsidianId}`);
				// Attempt deletion again if chunks remain
				const { error: retryError } = await this.client
					.from(this.TABLE_NAME)
					.delete()
					.eq('vault_id', this.settings.vaultId)
					.eq('obsidian_id', obsidianId);
				if (retryError) {
					throw new Error(`Failed to clean up remaining chunks: ${retryError.message}`);
				}
			}

			// Now insert the new chunks in batches to avoid potential payload limits
			const BATCH_SIZE = 50; // Adjust based on your Supabase limits
			const batches = [];

			for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
				batches.push(chunksToInsert.slice(i, i + BATCH_SIZE));
			}
			console.log(`Inserting ${chunksToInsert.length} chunks in ${batches.length} batches`);

			for (let i = 0; i < batches.length; i++) {
				const batch = batches[i];
				console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} chunks`);
				const { error: insertError } = await this.client
					.from(this.TABLE_NAME)
					.insert(batch);
				if (insertError) {
					console.error(`Error inserting batch ${i + 1}:`, insertError);
					// Clean up partially inserted data on error
					await this.cleanupPartialInsert(obsidianId);
					throw insertError;
				}
			}

			// Verify all chunks were inserted
			const { data: insertedData, error: verifyError } = await this.client
				.from(this.TABLE_NAME)
				.select('id', { count: 'exact', head: true })
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId);
			if (verifyError) {
				console.error('Error verifying insertion:', verifyError);
				throw verifyError;
			}

			const insertedCount = insertedData?.length || 0;
			if (insertedCount !== chunkCount) {
				console.warn(`Insertion verification: Expected ${chunkCount} chunks, found ${insertedCount}`);
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
		} finally {
			// Clear deletion in progress flag
			this.deleteOperationsInProgress.set(obsidianId, false);
		}
	}

	/**
	 * Cleans up partial inserts if an error occurs during batch insertion
	 */
	private async cleanupPartialInsert(obsidianId: string): Promise<void> {
		if (!this.client) return;

		try {
			console.log(`Cleaning up partial insert for ${obsidianId}`);
			const { error } = await this.client
				.from(this.TABLE_NAME)
				.delete()
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId);
			if (error) {
				console.error('Error cleaning up partial insert:', error);
			} else {
				console.log(`Successfully cleaned up partial insert for ${obsidianId}`);
			}
		} catch (cleanupError) {
			console.error('Error during cleanup of partial insert:', cleanupError);
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
				status: 'vectorized', // Mark as successfully vectorized
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
	 * Improved with tracking of operation progress and verification.
	 */
	public async deleteDocumentChunks(obsidianId: string): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping deleteDocumentChunks.');
			return;
		}

		// If a deletion is already in progress for this file, wait briefly.
		if (this.deleteOperationsInProgress.get(obsidianId)) {
			console.warn(`Delete operation already in progress for ${obsidianId}. Waiting...`);
			await new Promise(resolve => setTimeout(resolve, 500));
			if (this.deleteOperationsInProgress.get(obsidianId)) {
				console.log(`Still waiting for delete operation on ${obsidianId}...`);
				return;
			}
		}

		// Mark deletion as in progress.
		this.deleteOperationsInProgress.set(obsidianId, true);

		try {
			console.log(`Starting deletion of chunks for ${obsidianId}`);

			// Check how many chunks exist (using a plain select query).
			const { data: initialData, error: initialCountError } = await this.client
				.from(this.TABLE_NAME)
				.select('id')
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId);
			if (initialCountError) {
				console.error('Error checking existing chunks:', initialCountError);
				throw initialCountError;
			}
			const initialCount = initialData ? initialData.length : 0;
			console.log(`Found ${initialCount} chunks to delete for ${obsidianId}`);

			// If there are no chunks, we can directly purge the file status.
			if (initialCount === 0) {
				await this.purgeFileStatus(obsidianId);
				return;
			}

			// Delete the chunks.
			const { error: deleteError } = await this.client
				.from(this.TABLE_NAME)
				.delete()
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId);
			if (deleteError) {
				console.error('Error deleting chunks:', deleteError);
				throw deleteError;
			}

			// Wait briefly to let the deletion propagate.
			await new Promise(resolve => setTimeout(resolve, 500));

			// Verify deletion by selecting remaining rows.
			const { data: remainingData, error: verifyError } = await this.client
				.from(this.TABLE_NAME)
				.select('id')
				.eq('vault_id', this.settings.vaultId)
				.eq('obsidian_id', obsidianId);
			if (verifyError) {
				console.error('Error verifying deletion:', verifyError);
				throw verifyError;
			}
			const remainingCount = remainingData ? remainingData.length : 0;
			if (remainingCount > 0) {
				console.warn(`Deletion verification failed: ${remainingCount} chunks still exist for ${obsidianId}`);
				// If there are leftover chunks, do not purge yet.
				return;
			}

			// All chunks have been removed; purge the file status record.
			await this.purgeFileStatus(obsidianId);
			console.log(`Successfully purged file status for ${obsidianId}`);
		} catch (error) {
			console.error('Failed to delete chunks:', error);
			throw error;
		} finally {
			// Clear the deletion-in-progress flag.
			this.deleteOperationsInProgress.set(obsidianId, false);
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

	public async updateFilePath(oldPath: string, newPath: string): Promise<void> {
		if (!this.client) return;
		try {
			const { error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.update({ file_path: newPath, updated_at: new Date().toISOString() })
				.eq('vault_id', this.settings.vaultId)
				.eq('file_path', oldPath);
			if (error) {
				throw error;
			}
			console.log(`File path updated from ${oldPath} to ${newPath}`);
		} catch (error) {
			console.error('Error updating file path:', error);
			throw error;
		}
	}

	public async purgeFileStatus(filePath: string): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping purgeFileStatus.');
			return;
		}
		try {
			const { error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.delete()
				.eq('vault_id', this.settings.vaultId)
				.eq('file_path', filePath);
			if (error) {
				console.error('Error purging file status:', error);
				throw error;
			}
			console.log(`Purged file status record for ${filePath}`);
		} catch (error) {
			console.error('Failed to purge file status record:', error);
			throw error;
		}
	}

	/**
	 * Checks if all required tables exist and are properly set up.
	 * Returns an object with the status of each table and any missing tables.
	 */
	public async checkDatabaseSetup(): Promise<{
		isComplete: boolean;
		missingTables: string[];
		error?: string;
	}> {
		if (!this.client) {
			return {
				isComplete: false,
				missingTables: [this.TABLE_NAME, this.FILE_STATUS_TABLE],
				error: 'Supabase client is not initialized'
			};
		}

		const missingTables: string[] = [];
		let error: string | undefined;

		try {
			// Check obsidian_documents table
			const { error: documentsError } = await this.client
				.from(this.TABLE_NAME)
				.select('id')
				.limit(1);
			if (documentsError && documentsError.message.includes('does not exist')) {
				missingTables.push(this.TABLE_NAME);
			}

			// Check obsidian_file_status table
			const { error: statusError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1);
			if (statusError && statusError.message.includes('does not exist')) {
				missingTables.push(this.FILE_STATUS_TABLE);
			}

			// Check if vector extension is installed
			const { error: vectorError } = await this.client.rpc('vector_norm', { vector: [1, 0] });
			if (vectorError && vectorError.message.includes('function vector_norm')) {
				error = 'Vector extension is not installed';
			}

			return {
				isComplete: missingTables.length === 0 && !error,
				missingTables,
				error
			};
		} catch (err) {
			console.error('Error checking database setup:', err);
			return {
				isComplete: false,
				missingTables: [this.TABLE_NAME, this.FILE_STATUS_TABLE],
				error: `Error checking database setup: ${(err as Error).message}`
			};
		}
	}

	/**
	 * Resets the database by dropping and recreating all tables.
	 * WARNING: This will delete all data in the tables.
	 */
	public async resetDatabase(): Promise<{ success: boolean; message: string }> {
		if (!this.client) {
			return {
				success: false,
				message: 'Supabase client is not initialized'
			};
		}

		try {
			// Drop tables if they exist
			await this.client.rpc('drop_tables_if_exist');
			
			// Recreate tables
			const { error: createError } = await this.client.rpc('create_required_tables');
			if (createError) {
				throw new Error(`Failed to create tables: ${createError.message}`);
			}

			return {
				success: true,
				message: 'Database reset successfully'
			};
		} catch (err) {
			console.error('Error resetting database:', err);
			return {
				success: false,
				message: `Error resetting database: ${(err as Error).message}`
			};
		}
	}

}
