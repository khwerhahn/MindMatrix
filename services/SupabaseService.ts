import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FileStatusRecord, DocumentMetadata, DocumentChunk } from '../models/DocumentChunk';
import { ObsidianRAGSettings, isVaultInitialized } from '../settings/Settings';
import { Notice } from 'obsidian';

export class SupabaseService {
	private client: SupabaseClient | null;
	private static instance: SupabaseService | null = null;
	private settings: ObsidianRAGSettings;
	private readonly TABLE_NAME = 'obsidian_documents';
	private readonly FILE_STATUS_TABLE = 'obsidian_file_status';
	// Track deletion operations for a given file to avoid concurrent deletes
	private deleteOperationsInProgress: Map<string, boolean> = new Map();

	private constructor(settings: ObsidianRAGSettings) {
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

	public static async getInstance(settings: ObsidianRAGSettings): Promise<SupabaseService | null> {
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
         * - Relies on the database function `upsert_document_chunks` to perform delete + insert atomically
         * - Simplifies error handling because PostgreSQL rolls back the entire operation on failure
         * - Prevents concurrent operations on the same file to avoid racing RPC calls
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
			// First, get or create the file status record
                        const fileStatus: Partial<FileStatusRecord> = {
                                vault_id: this.settings.vaultId!,
                                file_path: obsidianId,
                                last_modified: chunks[0].metadata.lastModified,
                                content_hash: (chunks[0].metadata.customMetadata?.contentHash as string) || '',
                                status: 'pending',
                                tags: chunks[0].metadata.tags || [],
                                aliases: chunks[0].metadata.aliases || [],
                                links: chunks[0].metadata.links || [],
                                updated_at: new Date().toISOString()
                        };

			// Upsert the file status record
			const { data: fileStatusData, error: fileStatusError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.upsert(fileStatus, { onConflict: 'vault_id,file_path' })
				.select('id')
				.single();

			if (fileStatusError) {
				console.error('Error upserting file status:', fileStatusError);
				throw fileStatusError;
			}

			if (!fileStatusData?.id) {
				throw new Error('Failed to get file status ID after upsert');
			}

			const fileStatusId = fileStatusData.id;

			// Prepare new chunk data for insertion with file_status_id
			const chunksToInsert = chunks.map(chunk => ({
				vault_id: this.settings.vaultId,
				file_status_id: fileStatusId,
				chunk_index: chunk.chunk_index,
				content: chunk.content,
				metadata: chunk.metadata,
				embedding: chunk.embedding,
				vectorized_at: chunk.vectorized_at,
				updated_at: new Date().toISOString()
			}));

                        const chunkCount = chunksToInsert.length;
                        console.log(`Preparing to update ${chunkCount} chunks for file: ${obsidianId}`);

                        const chunkPayload = chunksToInsert.map(chunk => ({
                                chunk_index: chunk.chunk_index,
                                content: chunk.content,
                                metadata: chunk.metadata,
                                embedding: chunk.embedding,
                                vectorized_at: chunk.vectorized_at,
                                updated_at: chunk.updated_at
                        }));

                        const { error: upsertError } = await this.client.rpc('upsert_document_chunks', {
                                p_vault_id: this.settings.vaultId,
                                p_file_status_id: fileStatusId,
                                p_chunks: chunkPayload
                        });

                        if (upsertError) {
                                console.error('Atomic chunk upsert failed:', upsertError);
                                throw upsertError;
                        }

                        console.log('Successfully updated chunks via transaction:', {
                                numberOfChunks: chunkCount,
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
        public async updateFileVectorizationStatus(
                metadata: DocumentMetadata,
                status: 'pending' | 'vectorized' = 'vectorized'
        ): Promise<void> {
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
                        const lastVectorized = status === 'vectorized' ? new Date().toISOString() : undefined;
                        const fileStatus: Partial<FileStatusRecord> = {
                                vault_id: this.settings.vaultId!,
                                file_path: metadata.obsidianId,
                                last_modified: metadata.lastModified,
                                last_vectorized: lastVectorized,
                                content_hash: (metadata.customMetadata?.contentHash as string) || '',
                                status,
                                tags: metadata.tags || [],
                                aliases: metadata.aliases || [],
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
	 * Deletes document chunks for a given file status ID from the obsidian_documents table.
	 * Improved with tracking of operation progress and verification.
	 */
        public async deleteDocumentChunks(fileStatusId: number): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping deleteDocumentChunks.');
			return;
		}

		const fileStatusKey = fileStatusId.toString();

		// If a deletion is already in progress for this file, wait with exponential backoff
		if (this.deleteOperationsInProgress.get(fileStatusKey)) {
			console.warn(`Delete operation already in progress for file status ID ${fileStatusId}. Waiting...`);
			let retryCount = 0;
			const maxRetries = 5;
			const baseDelay = 500; // ms

			while (this.deleteOperationsInProgress.get(fileStatusKey) && retryCount < maxRetries) {
				const delay = baseDelay * Math.pow(2, retryCount);
				await new Promise(resolve => setTimeout(resolve, delay));
				retryCount++;
			}

			if (this.deleteOperationsInProgress.get(fileStatusKey)) {
				throw new Error(`Deletion operation timeout for file status ID ${fileStatusId}`);
			}
		}

		// Mark deletion as in progress
		this.deleteOperationsInProgress.set(fileStatusKey, true);

		try {
			console.log(`Starting deletion of chunks for file status ID ${fileStatusId}`);

			// Check how many chunks exist
			const { data: initialData, error: initialCountError } = await this.client
				.from(this.TABLE_NAME)
				.select('id')
				.eq('vault_id', this.settings.vaultId)
				.eq('file_status_id', fileStatusId);

			if (initialCountError) {
				console.error('Error checking existing chunks:', initialCountError);
				throw initialCountError;
			}

			const initialCount = initialData ? initialData.length : 0;
			console.log(`Found ${initialCount} chunks to delete for file status ID ${fileStatusId}`);

			// If there are no chunks, we can return early
			if (initialCount === 0) {
				return;
			}

			// Delete the chunks with retries
			let retryCount = 0;
			const maxRetries = 3;
			let success = false;

			while (!success && retryCount < maxRetries) {
				try {
					const { error: deleteError } = await this.client
						.from(this.TABLE_NAME)
						.delete()
						.eq('vault_id', this.settings.vaultId)
						.eq('file_status_id', fileStatusId);

					if (deleteError) {
						throw deleteError;
					}

					// Wait briefly to let the deletion propagate
					await new Promise(resolve => setTimeout(resolve, 500));

					// Verify deletion
					const { data: remainingData, error: verifyError } = await this.client
						.from(this.TABLE_NAME)
						.select('id')
						.eq('vault_id', this.settings.vaultId)
						.eq('file_status_id', fileStatusId);

					if (verifyError) {
						throw verifyError;
					}

					const remainingCount = remainingData ? remainingData.length : 0;
					if (remainingCount === 0) {
						success = true;
						break;
					}

					console.warn(`Deletion verification failed: ${remainingCount} chunks still exist. Retrying...`);
					retryCount++;
					await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
				} catch (error) {
					console.error(`Delete attempt ${retryCount + 1} failed:`, error);
					retryCount++;
					if (retryCount < maxRetries) {
						await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
					} else {
						throw error;
					}
				}
			}

			if (!success) {
				throw new Error(`Failed to delete chunks after ${maxRetries} attempts`);
			}

			console.log(`Successfully deleted chunks for file status ID ${fileStatusId}`);
		} catch (error) {
			console.error('Failed to delete chunks:', error);
			throw error;
		} finally {
			// Clear the deletion-in-progress flag
			this.deleteOperationsInProgress.set(fileStatusKey, false);
		}
        }

        /**
         * Retrieves document chunks for a given file status ID.
         */
        public async getDocumentChunks(fileStatusId: number): Promise<DocumentChunk[]> {
                if (!this.client) {
                        console.warn('Supabase client is not initialized. Skipping getDocumentChunks.');
                        return [];
                }
                try {
                        const { data, error } = await this.client
                                .from(this.TABLE_NAME)
                                .select('*')
                                .eq('vault_id', this.settings.vaultId)
                                .eq('file_status_id', fileStatusId)
                                .order('chunk_index');
                        if (error) throw error;
                        return data.map(row => ({
                                vault_id: row.vault_id,
                                file_status_id: row.file_status_id,
                                chunk_index: row.chunk_index,
                                content: row.content,
                                metadata: row.metadata as DocumentMetadata,
                                embedding: row.embedding,
                                vectorized_at: row.vectorized_at,
                                updated_at: row.updated_at
                        }));
                } catch (error) {
                        console.error('Failed to get chunks:', error);
                        throw error;
                }
        }

        /**
         * Fetches the file_status_id for a given file path if it exists.
         */
        public async getFileStatusIdByPath(filePath: string): Promise<number | null> {
                if (!this.client) {
                        console.warn('[ObsidianRAG] Supabase client not initialized while fetching file status id');
                        return null;
                }

                try {
                        const { data, error } = await this.client
                                .from(this.FILE_STATUS_TABLE)
                                .select('id')
                                .eq('vault_id', this.settings?.vaultId)
                                .eq('file_path', filePath)
                                .maybeSingle();

                        if (error) {
                                if (error.code === 'PGRST116') {
                                        return null;
                                }
                                console.error('[ObsidianRAG] Error fetching file status id:', {
                                        error,
                                        filePath,
                                        vaultId: this.settings?.vaultId
                                });
                                throw error;
                        }

                        return data?.id ?? null;
                } catch (error) {
                        console.error('[ObsidianRAG] Unexpected error in getFileStatusIdByPath:', {
                                error,
                                filePath,
                                vaultId: this.settings?.vaultId
                        });
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
			// First check if the table exists
			const { error: checkError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('id')
				.limit(1)
				.maybeSingle();

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

			// Then query for the specific file
			const { data, error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('*')
				.eq('vault_id', this.settings.vaultId)
				.eq('file_path', filePath)
				.maybeSingle();

			if (error) {
				console.error('Error getting file vectorization status:', error);
				return {
					isVectorized: false,
					lastModified: 0,
					lastVectorized: null,
					contentHash: null,
					status: null
				};
			}

			if (!data) {
				return {
					isVectorized: false,
					lastModified: 0,
					lastVectorized: null,
					contentHash: null,
					status: null
				};
			}

			return {
				isVectorized: true,
				lastModified: data.last_modified || 0,
				lastVectorized: data.last_vectorized || null,
				contentHash: data.content_hash || null,
				status: data.status || null
			};
		} catch (error) {
			console.error('Error getting file vectorization status:', error);
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
				.eq('vault_id', this.settings.vaultId);
			if (error) {
				if (error.message.includes('does not exist')) {
					return [];
				}
				throw error;
			}
			// Use Set to get unique values
			const uniqueIds = new Set(data.map((row: any) => row.obsidian_id));
			return Array.from(uniqueIds);
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

	/**
	 * Purges a file status record from the obsidian_file_status table.
	 */
	public async purgeFileStatus(fileStatusId: number): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping purgeFileStatus.');
			return;
		}
		try {
			const { error } = await this.client
				.from('obsidian_file_status')
				.delete()
				.eq('id', fileStatusId);
			if (error) throw error;
		} catch (error) {
			console.error('Failed to purge file status:', error);
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

	/**
	 * Removes files from the database that match exclusion patterns
	 * @param vaultId The vault ID
	 * @param exclusions The exclusion patterns to check against
	 * @returns The number of files removed
	 */
        async removeExcludedFiles(
                vaultId: string,
                exclusions: {
                        excludedFolders: string[];
                        excludedFileTypes: string[];
                        excludedFilePrefixes: string[];
                        excludedFiles: string[];
                }
        ): Promise<number> {
                if (!this.client) {
                        console.warn('Supabase client is not initialized. Skipping removeExcludedFiles.');
                        return 0;
                }

                try {
                        const escapeLikeValue = (value: string): string =>
                                value
                                        .trim()
                                        .replace(/\\/g, '\\\\')
                                        .replace(/%/g, '\\%')
                                        .replace(/_/g, '\\_')
                                        .replace(/"/g, '\\"');

                        const escapeEqualityValue = (value: string): string =>
                                value.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');

                        const wrapInQuotes = (value: string): string => `"${value}"`;

                        const exclusionClauses: string[] = [];

                        const addClauses = (values: string[] | undefined, builder: (value: string) => string | null): void => {
                                values
                                        ?.map(value => value?.trim())
                                        .filter((value): value is string => !!value)
                                        .forEach(value => {
                                                const clause = builder(value);
                                                if (clause) {
                                                        exclusionClauses.push(clause);
                                                }
                                        });
                        };

                        addClauses(exclusions.excludedFolders, folder => {
                                const escaped = escapeLikeValue(folder);
                                return escaped ? `file_path.ilike.${wrapInQuotes(`${escaped}%`)}` : null;
                        });

                        addClauses(exclusions.excludedFileTypes, type => {
                                const normalized = type.replace(/^\./, '').toLowerCase();
                                if (!normalized) return null;
                                const escaped = escapeLikeValue(normalized);
                                return `file_path.ilike.${wrapInQuotes(`%.${escaped}`)}`;
                        });

                        addClauses(exclusions.excludedFilePrefixes, prefix => {
                                const escaped = escapeLikeValue(prefix);
                                return escaped ? `file_path.ilike.${wrapInQuotes(`${escaped}%`)}` : null;
                        });

                        addClauses(exclusions.excludedFiles, file => {
                                const escaped = escapeEqualityValue(file);
                                return escaped ? `file_path.eq.${wrapInQuotes(escaped)}` : null;
                        });

                        if (exclusionClauses.length === 0) {
                                console.info('[ObsidianRAG] removeExcludedFiles called without exclusions; skipping removal.');
                                return 0;
                        }

                        // First, find all files that match the exclusion patterns
                        const { data: filesToRemove, error: queryError } = await this.client
                                .from(this.FILE_STATUS_TABLE)
                                .select('file_path')
                                .eq('vault_id', vaultId)
                                .or(exclusionClauses.join(','));

			if (queryError) throw queryError;

			if (!filesToRemove || filesToRemove.length === 0) {
				return 0;
			}

			const filePaths = filesToRemove.map(f => f.file_path);

			// Remove from obsidian_documents table
			const { error: docError } = await this.client
				.from(this.TABLE_NAME)
				.delete()
				.eq('vault_id', vaultId)
				.in('file_path', filePaths);

			if (docError) throw docError;

			// Remove from obsidian_file_status table
			const { error: statusError } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.delete()
				.eq('vault_id', vaultId)
				.in('file_path', filePaths);

			if (statusError) throw statusError;

			return filePaths.length;
		} catch (error) {
			console.error('[ObsidianRAG] Error removing excluded files:', error);
			throw error;
		}
	}

	/**
	 * Checks if a file should be excluded based on current exclusion patterns
	 * @param filePath The path of the file to check
	 * @param exclusions The exclusion patterns to check against
	 * @returns true if the file should be excluded
	 */
	async isFileExcluded(
		filePath: string,
		exclusions: {
			excludedFolders: string[];
			excludedFileTypes: string[];
			excludedFilePrefixes: string[];
			excludedFiles: string[];
		}
	): Promise<boolean> {
		// Check if file is in an excluded folder
		if (exclusions.excludedFolders.some(folder => filePath.startsWith(folder))) {
			return true;
		}

		// Check if file has an excluded extension
		const fileExtension = filePath.split('.').pop()?.toLowerCase();
		if (fileExtension && exclusions.excludedFileTypes.includes(fileExtension)) {
			return true;
		}

		// Check if file starts with an excluded prefix
		if (exclusions.excludedFilePrefixes.some(prefix => filePath.startsWith(prefix))) {
			return true;
		}

		// Check if file is in the specific files list
		if (exclusions.excludedFiles.includes(filePath)) {
			return true;
		}

		return false;
	}

	/**
	 * Get the count of files in the database for the current vault
	 */
	public async getFileCount(): Promise<number> {
		if (!this.client || !this.settings.vaultId) {
			return 0;
		}

		try {
			const { count, error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('*', { count: 'exact', head: true })
				.eq('vault_id', this.settings.vaultId);

			if (error) {
				console.error('Error getting file count:', error);
				return 0;
			}

			return count || 0;
		} catch (error) {
			console.error('Error getting file count:', error);
			return 0;
		}
	}

	/**
	 * Gets all documents from the obsidian_documents table
	 */
	public async getAllDocuments(): Promise<any[]> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping getAllDocuments.');
			return [];
		}
		try {
			const { data, error } = await this.client
				.from(this.TABLE_NAME)
				.select('*');
			if (error) {
				console.error('Error getting all documents:', error);
				return [];
			}
			return data || [];
		} catch (error) {
			console.error('Failed to get all documents:', error);
			return [];
		}
	}

	/**
	 * Gets all file status records from the obsidian_file_status table
	 */
	public async getAllFileStatus(): Promise<any[]> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping getAllFileStatus.');
			return [];
		}
		try {
			const { data, error } = await this.client
				.from(this.FILE_STATUS_TABLE)
				.select('*');
			if (error) {
				console.error('Error getting all file status:', error);
				return [];
			}
			return data || [];
		} catch (error) {
			console.error('Failed to get all file status:', error);
			return [];
		}
	}

	/**
	 * Creates or updates a file status record
	 */
	async createOrUpdateFileStatus(
		vaultId: string,
		filePath: string,
		lastModified: number,
		contentHash: string,
		status: string,
		tags: string[] = [],
		aliases: string[] = [],
		links: string[] = []
	): Promise<FileStatusRecord | null> {
		if (!this.client) {
			console.warn('Supabase client not initialized');
			return null;
		}

		try {
			const { data: existingRecord, error: fetchError } = await this.client
				.from('obsidian_file_status')
				.select('*')
				.eq('vault_id', vaultId)
				.eq('file_path', filePath)
				.single();

			if (fetchError && fetchError.code !== 'PGRST116') {
				throw fetchError;
			}

			const now = new Date().toISOString();
			type FileStatusBase = Omit<FileStatusRecord, 'id' | 'created_at'>;
			const baseData: FileStatusBase = {
				vault_id: vaultId,
				file_path: filePath,
				last_modified: lastModified,
				last_vectorized: now,
				content_hash: contentHash,
				status,
				tags,
				aliases,
				links,
				updated_at: now
			};

			if (existingRecord) {
				const { data, error } = await this.client
					.from('obsidian_file_status')
					.update(baseData)
					.eq('vault_id', vaultId)
					.eq('file_path', filePath)
					.select()
					.single();

				if (error) throw error;
				const result: FileStatusRecord = {
					...baseData,
					id: existingRecord.id,
					created_at: existingRecord.created_at
				};
				return result;
			} else {
				const { data, error } = await this.client
					.from('obsidian_file_status')
					.insert({
						...baseData,
						created_at: now
					})
					.select()
					.single();

				if (error) throw error;
				const result: FileStatusRecord = {
					...baseData,
					id: data.id,
					created_at: now
				};
				return result;
			}
		} catch (error) {
			console.error('Error creating/updating file status:', error);
			throw error;
		}
	}

	/**
	 * Gets a file status record by path
	 */
	public async getFileStatus(filePath: string): Promise<FileStatusRecord | null> {
		if (!this.client) {
			console.warn('[ObsidianRAG] Supabase client not initialized');
			return null;
		}

		try {
			console.log(`[ObsidianRAG] Getting file status for path: ${filePath}`);
			console.log(`[ObsidianRAG] Request details:`, {
				vaultId: this.settings?.vaultId,
				filePath,
				table: 'obsidian_file_status'
			});

			const { data, error } = await this.client
				.from('obsidian_file_status')
				.select('*')
				.eq('vault_id', this.settings?.vaultId)
				.eq('file_path', filePath)
				.single();

			if (error) {
				console.error(`[ObsidianRAG] Error getting file status:`, {
					error,
					code: error.code,
					message: error.message,
					details: error.details,
					hint: error.hint,
					filePath,
					vaultId: this.settings?.vaultId
				});
				throw error;
			}

			console.log(`[ObsidianRAG] File status response:`, {
				filePath,
				data: data ? 'Found' : 'Not found',
				recordId: data?.id
			});

			return data;
		} catch (error) {
			console.error(`[ObsidianRAG] Error in getFileStatus:`, {
				error,
				filePath,
				vaultId: this.settings?.vaultId,
				stack: error instanceof Error ? error.stack : undefined
			});
			throw error;
		}
	}

	/**
	 * Creates document chunks with file_status_id
	 */
	public async createDocumentChunks(fileStatusId: number, chunks: DocumentChunk[]): Promise<void> {
		if (!this.client) {
			console.warn('Supabase client is not initialized. Skipping createDocumentChunks.');
			return;
		}
		try {
			const chunkRecords = chunks.map(chunk => ({
				vault_id: this.settings.vaultId,
				file_status_id: fileStatusId,
				chunk_index: chunk.chunk_index,
				content: chunk.content,
				metadata: chunk.metadata,
				embedding: chunk.embedding,
				vectorized_at: chunk.vectorized_at,
				updated_at: new Date().toISOString()
			}));

			const { error } = await this.client
				.from(this.TABLE_NAME)
				.insert(chunkRecords);
			if (error) throw error;
		} catch (error) {
			console.error('Failed to create chunks:', error);
			throw error;
		}
	}

}
