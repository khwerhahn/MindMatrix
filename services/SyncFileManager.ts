// src/services/SyncFileManager.ts
import { TFile, Vault, parseYaml, stringifyYaml } from 'obsidian';
import { ErrorHandler } from '../utils/ErrorHandler';
import { DocumentProcessingError } from '../models/DocumentChunk';
import {
	SyncFileData,
	SyncValidationResult,
	SyncErrorType,
	SyncState,
	createEmptySyncFileData,
	updateDeviceInSyncFile,
	addConnectionEvent,
	updateDatabaseStatus,
	updateDeviceSyncTime,
	trimSyncHistoryArrays,
	SyncConflict
} from '../models/SyncModels';

export class SyncFileManager {
	private syncFilePath: string;
	private backupPath: string;
	private lastBackup: number = 0;
	private backupInterval: number;
	private syncFile: TFile | null = null;
	private currentSyncData: SyncFileData | null = null;
	private vaultId: string;
	private deviceId: string;
	private deviceName: string;
	private pluginVersion: string;

	constructor(
		private vault: Vault,
		private errorHandler: ErrorHandler,
		syncFilePath: string = '_obsidianragsync.md',
		backupInterval: number = 3600000, // 1 hour in milliseconds
		vaultId: string,
		deviceId: string,
		deviceName: string,
		pluginVersion: string
	) {
		this.syncFilePath = syncFilePath;
		this.backupPath = `${syncFilePath}.backup`;
		this.backupInterval = backupInterval;
		this.vaultId = vaultId;
		this.deviceId = deviceId;
		this.deviceName = deviceName;
		this.pluginVersion = pluginVersion;
	}

	/**
	 * Initialize or validate the sync file
	 */
	async initialize(): Promise<SyncValidationResult> {
		try {
			// Check if sync file exists
			const existingFile = this.vault.getAbstractFileByPath(this.syncFilePath);
			if (existingFile instanceof TFile) {
				this.syncFile = existingFile;
				// Validate existing file and parse its contents
				const validationResult = await this.validateSyncFile();
				if (!validationResult.isValid) {
					const recovered = await this.repairSyncFile();
					if (!recovered) {
						await this.createSyncFile();
					}
				}
			} else {
				// Create new sync file
				await this.createSyncFile();
			}
			// Create initial backup
			await this.createBackup();
			return await this.validateSyncFile();
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.initialize',
				metadata: { syncFilePath: this.syncFilePath }
			});
			// Try to create a new file as a last resort
			try {
				await this.createSyncFile();
				return { isValid: true };
			} catch (createError) {
				return {
					isValid: false,
					error: `Failed to initialize sync file: ${createError.message}`
				};
			}
		}
	}

	/**
	 * Create a new sync file with the new structure
	 */
	private async createSyncFile(): Promise<void> {
		console.log('Starting sync file creation with wait periods...');

		// Increased delay for safer file operations
		const FILE_OP_DELAY = 1000; // 1 second

		// First check if the file exists
		const existingFile = this.vault.getAbstractFileByPath(this.syncFilePath);

		// Create new sync data
		this.currentSyncData = createEmptySyncFileData(
			this.vaultId,
			this.deviceId,
			this.deviceName,
			this.pluginVersion
		);

		// Generate initial content
		const initialContent = this.generateSyncFileContent(this.currentSyncData);

		// If file exists, prioritize modifying it instead of deleting and recreating
		if (existingFile instanceof TFile) {
			try {
				console.log('Existing sync file found, attempting to modify it');
				this.syncFile = existingFile;
				await this.vault.modify(existingFile, initialContent);
				console.log('Successfully modified existing sync file');

				// Wait a bit to ensure file system operations complete
				await new Promise(resolve => setTimeout(resolve, FILE_OP_DELAY));
				return;
			} catch (modifyError) {
				console.warn('Failed to modify existing sync file, will try delete and recreate:', modifyError);

				// If modification fails, try delete and recreate approach
				try {
					await this.vault.delete(existingFile);
					// Longer delay after deletion
					await new Promise(resolve => setTimeout(resolve, FILE_OP_DELAY));
				} catch (deleteError) {
					console.error('Failed to delete existing sync file:', deleteError);
					throw new Error(`Cannot modify or delete sync file: ${modifyError.message}, ${deleteError.message}`);
				}
			}
		}

		// File doesn't exist or was deleted, proceed with creation
		console.log('Waiting before creating sync file...');
		await new Promise(resolve => setTimeout(resolve, FILE_OP_DELAY));

		// Multiple attempts for creation with increasing delays
		let createAttempts = 0;
		const maxAttempts = 3;

		while (createAttempts < maxAttempts) {
			try {
				this.syncFile = await this.vault.create(this.syncFilePath, initialContent);
				console.log('Sync file created successfully');
				break;
			} catch (createError) {
				createAttempts++;
				console.warn(`Create attempt ${createAttempts} failed:`, createError);

				if (createAttempts >= maxAttempts) {
					// Last resort: check if file exists despite creation error
					const finalCheck = this.vault.getAbstractFileByPath(this.syncFilePath);
					if (finalCheck instanceof TFile) {
						console.log('Sync file exists despite creation error, using it');
						this.syncFile = finalCheck;
						return;
					}

					throw new Error(`Failed to create sync file after ${maxAttempts} attempts: ${createError.message}`);
				}

				// Exponential backoff for retries
				const waitTime = FILE_OP_DELAY * (createAttempts + 1);
				console.log(`Waiting ${waitTime}ms before retry...`);
				await new Promise(resolve => setTimeout(resolve, waitTime));
			}
		}

		// Verify file exists and is readable
		const fileExists = this.vault.getAbstractFileByPath(this.syncFilePath);
		if (!fileExists) {
			throw this.errorHandler.handleSyncError(
				SyncErrorType.SYNC_FILE_MISSING,
				'Sync file creation failed - file not found after wait period',
				{ context: 'SyncFileManager.createSyncFile' },
				undefined,
				this.deviceId,
				false
			);
		}

		console.log('Sync file creation completed successfully');
	}

	/**
	 * Generate sync file content from data
	 */
	private generateSyncFileContent(data: SyncFileData): string {
		// Convert data to YAML using Obsidian's built-in function
		const yamlContent = stringifyYaml(data);
		// Return as markdown with YAML front matter
		return `---\n${yamlContent}---\n\n## Obsidian RAG Sync File\n\nThis file manages cross-device coordination for the Obsidian RAG plugin.\nDo not modify this file manually.\n`;
	}

	/**
	 * Validate sync file structure and content
	 */
	async validateSyncFile(): Promise<SyncValidationResult> {
		if (!this.syncFile) {
			return {
				isValid: false,
				error: 'Sync file not initialized'
			};
		}

		try {
			const content = await this.vault.read(this.syncFile);
			// Extract YAML front matter
			const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (!yamlMatch) {
				console.log('Invalid sync file format: Missing YAML front matter. Will recreate file.');
				// Instead of just returning an error, recreate the file
				await this.createSyncFile();
				return { isValid: true };
			}
			// Parse YAML content using Obsidian's built-in function
			const yamlContent = yamlMatch[1];
			let parsedData;
			try {
				parsedData = parseYaml(yamlContent);
			} catch (parseError) {
				console.log('Failed to parse YAML content:', parseError);
				// If parsing fails, recreate the file
				await this.createSyncFile();
				return { isValid: true };
			}
			// Validate basic structure
			if (!parsedData || typeof parsedData !== 'object') {
				console.log('Invalid sync file format: Cannot parse YAML content. Will recreate file.');
				await this.createSyncFile();
				return { isValid: true };
			}
			// Check if this is an old format sync file (has a table structure)
			if (content.includes('| File Path | Last Modified |')) {
				console.log('Detected old format sync file. Will convert to new format.');
				await this.createSyncFile();
				return { isValid: true };
			}
			// Check required fields
			if (
				!parsedData.header ||
				!parsedData.header.vaultId ||
				!parsedData.header.lastGlobalSync ||
				!parsedData.header.devices
			) {
				console.log('Invalid sync file format: Missing required fields. Will recreate file.');
				await this.createSyncFile();
				return { isValid: true };
			}
			// Verify vault ID matches
			if (parsedData.header.vaultId !== this.vaultId) {
				console.log('Vault ID mismatch. Old ID:', parsedData.header.vaultId, 'New ID:', this.vaultId);
				// Update the vault ID to match the current one
				parsedData.header.vaultId = this.vaultId;
			}
			// Store the parsed data
			this.currentSyncData = parsedData as SyncFileData;
			// Ensure all required properties exist in the data structure
			if (!this.currentSyncData.connectionEvents) this.currentSyncData.connectionEvents = [];
			if (!this.currentSyncData.pendingOperations) this.currentSyncData.pendingOperations = [];
			if (!this.currentSyncData.conflicts) this.currentSyncData.conflicts = [];
			if (!this.currentSyncData.lastDatabaseCheck) this.currentSyncData.lastDatabaseCheck = Date.now();
			if (!this.currentSyncData.databaseStatus) this.currentSyncData.databaseStatus = 'unknown';

			// Initialize fileStatuses if it doesn't exist
			if (!this.currentSyncData.header.fileStatuses) this.currentSyncData.header.fileStatuses = {};

			// Update device information
			this.currentSyncData = updateDeviceInSyncFile(
				this.currentSyncData,
				this.deviceId,
				this.deviceName,
				this.pluginVersion
			);
			// Write back the updated data
			await this.writeSyncFile(this.currentSyncData);
			return { isValid: true };
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.validateSyncFile' });
			console.log('Failed to validate sync file, will recreate:', error);
			// Try to recreate the file as a last resort
			try {
				await this.createSyncFile();
				return { isValid: true };
			} catch (createError) {
				return {
					isValid: false,
					error: `Failed to validate and recreate sync file: ${createError.message}`
				};
			}
		}
	}

	/**
	 * Alias for validateSyncFile() to support legacy calls.
	 */
	async validateSyncState(): Promise<SyncValidationResult> {
		return await this.validateSyncFile();
	}

	/**
	 * Repair corrupted sync file
	 */
	private async repairSyncFile(): Promise<boolean> {
		try {
			// Try to restore from backup first
			const restored = await this.restoreFromBackup();
			if (restored) {
				return true;
			}
			// If restoration fails, create new sync file
			await this.createSyncFile();
			return true;
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.repairSyncFile',
				metadata: { syncFilePath: this.syncFilePath }
			});
			return false;
		}
	}

	/**
	 * Read and parse the sync file
	 */
	async readSyncFile(): Promise<SyncFileData | null> {
		if (!this.syncFile) {
			throw this.errorHandler.handleSyncError(
				SyncErrorType.SYNC_FILE_MISSING,
				'Sync file not initialized',
				{ context: 'SyncFileManager.readSyncFile' },
				undefined,
				this.deviceId
			);
		}

		try {
			const content = await this.vault.read(this.syncFile);
			// Extract YAML front matter
			const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
			if (!yamlMatch) {
				throw this.errorHandler.handleSyncError(
					SyncErrorType.SYNC_FILE_CORRUPT,
					'Invalid sync file format: Missing YAML front matter',
					{ context: 'SyncFileManager.readSyncFile' },
					undefined,
					this.deviceId
				);
			}
			// Parse YAML content using Obsidian's built-in function
			const yamlContent = yamlMatch[1];
			const parsedData = parseYaml(yamlContent) as SyncFileData;
			if (!parsedData || !parsedData.header) {
				throw this.errorHandler.handleSyncError(
					SyncErrorType.SYNC_FILE_CORRUPT,
					'Invalid sync file format: Missing required fields',
					{ context: 'SyncFileManager.readSyncFile' },
					undefined,
					this.deviceId
				);
			}
			// Cache the parsed data
			this.currentSyncData = parsedData;
			return parsedData;
		} catch (error) {
			if (!this.errorHandler.isSyncError(error)) {
				throw this.errorHandler.handleSyncError(
					SyncErrorType.SYNC_FILE_CORRUPT,
					`Error reading sync file: ${error.message}`,
					{ context: 'SyncFileManager.readSyncFile' },
					undefined,
					this.deviceId
				);
			}
			throw error;
		}
	}

	/**
	 * Write sync data to the sync file
	 */
	async writeSyncFile(data: SyncFileData): Promise<void> {
		if (!this.syncFile) {
			throw this.errorHandler.handleSyncError(
				SyncErrorType.SYNC_FILE_MISSING,
				'Sync file not initialized',
				{ context: 'SyncFileManager.writeSyncFile' },
				undefined,
				this.deviceId
			);
		}

		try {
			// Update sync file content
			const content = this.generateSyncFileContent(data);
			await this.vault.modify(this.syncFile, content);
			// Update cached data
			this.currentSyncData = data;
			// Create backup if needed
			if (Date.now() - this.lastBackup >= this.backupInterval) {
				await this.createBackup();
			}
		} catch (error) {
			throw this.errorHandler.handleSyncError(
				SyncErrorType.UNKNOWN_ERROR,
				`Failed to write sync file: ${error.message}`,
				{ context: 'SyncFileManager.writeSyncFile' },
				undefined,
				this.deviceId
			);
		}
	}

	/**
	 * Create a backup of the sync file
	 */
	private async createBackup(): Promise<void> {
		if (!this.syncFile) return;

		try {
			const content = await this.vault.read(this.syncFile);
			const backupFile = this.vault.getAbstractFileByPath(this.backupPath);
			if (backupFile instanceof TFile) {
				await this.vault.modify(backupFile, content);
			} else {
				await this.vault.create(this.backupPath, content);
			}
			this.lastBackup = Date.now();
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.createBackup' });
		}
	}

	/**
	 * Restore sync file from backup
	 */
	private async restoreFromBackup(): Promise<boolean> {
		const backupFile = this.vault.getAbstractFileByPath(this.backupPath);
		if (!(backupFile instanceof TFile)) {
			return false;
		}

		try {
			const content = await this.vault.read(backupFile);
			if (this.syncFile) {
				await this.vault.modify(this.syncFile, content);
			} else {
				this.syncFile = await this.vault.create(this.syncFilePath, content);
			}
			// Try to parse the restored content
			const validationResult = await this.validateSyncFile();
			return validationResult.isValid;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.restoreFromBackup' });
			return false;
		}
	}

	/**
	 * Update the database connection status
	 */
	async updateDatabaseStatus(status: 'available' | 'unavailable' | 'unknown'): Promise<void> {
		try {
			// Read current data if not cached
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}

			if (this.currentSyncData) {
				// Update status
				const updatedData = updateDatabaseStatus(this.currentSyncData, status);
				// If status changed to unavailable, add connection event
				if (status === 'unavailable' && this.currentSyncData.databaseStatus !== 'unavailable') {
					updatedData.connectionEvents.push({
						timestamp: Date.now(),
						eventType: 'disconnected',
						deviceId: this.deviceId,
						details: 'Database connection lost'
					});
				}
				// If status changed to available, add connection event
				if (status === 'available' && this.currentSyncData.databaseStatus !== 'available') {
					updatedData.connectionEvents.push({
						timestamp: Date.now(),
						eventType: 'connected',
						deviceId: this.deviceId,
						details: 'Database connection established'
					});
				}
				// Trim arrays to prevent excessive growth
				const trimmedData = trimSyncHistoryArrays(updatedData);
				// Write updated data
				await this.writeSyncFile(trimmedData);
			}
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.updateDatabaseStatus',
				metadata: { status }
			});
		}
	}

	/**
	 * Update device sync timestamp and status
	 */
	async updateDeviceSyncTimestamp(): Promise<void> {
		try {
			// Read current data if not cached
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}
			if (this.currentSyncData) {
				// Update device sync time
				const updatedData = updateDeviceSyncTime(this.currentSyncData, this.deviceId);
				// Write updated data
				await this.writeSyncFile(updatedData);
			}
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.updateDeviceSyncTimestamp' });
		}
	}

	/**
	 * **New Method:**
	 * Updates the sync status for a given file in the sync file.
	 * This method is used as a fallback when the database isn't available.
	 */
	async updateSyncStatus(filePath: string, status: string, additionalData: Record<string, any>): Promise<void> {
		// Ensure we have the current sync data
		if (!this.currentSyncData) {
			await this.readSyncFile();
		}
		if (this.currentSyncData) {
			// Assuming your sync file header contains a fileStatuses map
			this.currentSyncData.header.fileStatuses = this.currentSyncData.header.fileStatuses || {};
			this.currentSyncData.header.fileStatuses[filePath] = {
				status,
				lastModified: additionalData.lastModified,
				hash: additionalData.hash,
				updatedAt: Date.now()
			};
			await this.writeSyncFile(this.currentSyncData);
		} else {
			throw new Error("Sync file data unavailable for updateSyncStatus");
		}
	}

	/**
	 * Gets the sync status for a specific file path.
	 */
	async getSyncStatus(path: string): Promise<{ status: string; lastModified: number; hash: string } | null> {
		try {
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}

			if (this.currentSyncData && this.currentSyncData.header.fileStatuses) {
				return this.currentSyncData.header.fileStatuses[path] || null;
			}

			return null;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.getSyncStatus', metadata: { path } });
			return null;
		}
	}

	/**
	 * Get all pending operations
	 */
	async getPendingOperations(): Promise<Array<{
		id: string;
		fileId: string;
		operationType: string;
		timestamp: number;
		deviceId: string;
		metadata?: any;
		status: string;
	}>> {
		try {
			// Read current data if not cached
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}
			return this.currentSyncData?.pendingOperations || [];
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.getPendingOperations' });
			return [];
		}
	}

	/**
	 * Get current sync state
	 */
	async getSyncState(): Promise<SyncState> {
		try {
			// Read current data if not cached
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}
			return this.currentSyncData?.header.syncState || SyncState.UNKNOWN;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.getSyncState' });
			return SyncState.UNKNOWN;
		}
	}

	/**
	 * Get information about all known devices
	 */
	async getKnownDevices(): Promise<Record<string, {
		deviceId: string;
		name: string;
		platform: string;
		lastSeen: number;
		lastSyncTime: number;
	}>> {
		try {
			// Read current data if not cached
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}
			return this.currentSyncData?.header.devices || {};
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.getKnownDevices' });
			return {};
		}
	}

	/**
	 * Check if there are conflicts that need resolution
	 */
	async detectConflicts(): Promise<SyncConflict[]> {
		try {
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}
			// Enhanced: Filter for conflicts with more detailed metadata (if needed)
			const pendingConflicts = this.currentSyncData?.conflicts.filter(
				conflict => conflict.resolutionStatus === 'pending'
			) || [];
			return pendingConflicts;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.detectConflicts' });
			return [];
		}
	}

	/**
	 * Attempt to resolve a conflict based on a given resolution strategy.
	 * Supports strategies:
	 * - "newest-wins": Automatically resolves by favoring the most recent update.
	 * - "keep-both": Marks as resolved and leaves both versions intact.
	 * - "manual": Flags the conflict for manual intervention (does not auto-resolve).
	 */
	async resolveConflict(conflictId: string, resolutionStrategy: 'newest-wins' | 'manual' | 'keep-both'): Promise<boolean> {
		try {
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}
			// Find the conflict by ID
			const conflictIndex = this.currentSyncData?.conflicts.findIndex(c => c.id === conflictId);
			if (conflictIndex === undefined || conflictIndex < 0) {
				console.warn('Conflict not found:', conflictId);
				return false;
			}
			const conflict = this.currentSyncData!.conflicts[conflictIndex];
			switch (resolutionStrategy) {
				case 'newest-wins':
					// In a real scenario, compare timestamps or content hashes here.
					conflict.resolutionStrategy = 'newest-wins';
					conflict.resolutionStatus = 'resolved';
					conflict.resolvedAt = Date.now();
					conflict.resolvedBy = this.deviceId;
					break;
				case 'keep-both':
					// Optionally, duplicate the file entry in the database and mark conflict as resolved.
					conflict.resolutionStrategy = 'keep-both';
					conflict.resolutionStatus = 'resolved';
					conflict.resolvedAt = Date.now();
					conflict.resolvedBy = this.deviceId;
					break;
				case 'manual':
					// Do not auto-resolve; flag for manual intervention.
					conflict.resolutionStrategy = 'manual';
					console.log('Manual resolution required for conflict:', conflictId);
					return false;
				default:
					throw new Error('Unsupported resolution strategy');
			}
			await this.writeSyncFile(this.currentSyncData!);
			return true;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.resolveConflict', metadata: { conflictId } });
			return false;
		}
	}

	/**
	 * Attempt to resolve all detected conflicts using a default strategy.
	 */
	async resolveAllConflicts(defaultStrategy: 'newest-wins' | 'manual' | 'keep-both' = 'newest-wins'): Promise<void> {
		try {
			const conflicts = await this.detectConflicts();
			for (const conflict of conflicts) {
				await this.resolveConflict(conflict.id, defaultStrategy);
			}
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.resolveAllConflicts' });
		}
	}

	/**
	 * Update the last sync timestamp in the sync file header.
	 */
	async updateLastSync(): Promise<void> {
		try {
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}
			if (this.currentSyncData) {
				this.currentSyncData.header.lastGlobalSync = Date.now();
				await this.writeSyncFile(this.currentSyncData);
			}
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.updateLastSync' });
		}
	}

	/**
	 * Gets all sync entries from the sync file.
	 */
	async getAllSyncEntries(): Promise<Array<{ filePath: string; status: string; lastModified: number; hash: string }>> {
		try {
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}

			if (this.currentSyncData && this.currentSyncData.header.fileStatuses) {
				return Object.entries(this.currentSyncData.header.fileStatuses).map(([filePath, data]) => ({
					filePath,
					status: data.status,
					lastModified: data.lastModified,
					hash: data.hash
				}));
			}

			return [];
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.getAllSyncEntries' });
			return [];
		}
	}

	/**
	 * Attempt recovery operations when sync issues are detected.
	 */
	async attemptRecovery(): Promise<boolean> {
		try {
			// Attempt to restore from backup
			const recovered = await this.restoreFromBackup();
			if (recovered) {
				console.log('Successfully recovered from backup');
				return true;
			}

			// If backup restoration fails, try to recreate the sync file
			console.log('Backup restoration failed, attempting to recreate sync file');
			await this.createSyncFile();

			// Verify the new file is valid
			const validationResult = await this.validateSyncFile();
			return validationResult.isValid;
		} catch (error) {
			this.errorHandler.handleError(error, { context: 'SyncFileManager.attemptRecovery' });
			return false;
		}
	}

	/**
	 * Updates the sync file to reflect exclusion changes
	 * @param exclusions The current exclusion settings
	 */
	async updateSyncFileForExclusions(exclusions: {
		excludedFolders: string[];
		excludedFileTypes: string[];
		excludedFilePrefixes: string[];
		excludedFiles: string[];
	}): Promise<void> {
		try {
			// Read current data if not cached
			if (!this.currentSyncData) {
				await this.readSyncFile();
			}

			if (this.currentSyncData) {
				// Add an exclusion event to track the change
				const event: ConnectionEvent = {
					timestamp: Date.now(),
					eventType: 'exclusion_update',
					deviceId: this.deviceId,
					details: `Exclusion settings updated. Folders: ${exclusions.excludedFolders.length}, Types: ${exclusions.excludedFileTypes.length}, Prefixes: ${exclusions.excludedFilePrefixes.length}, Files: ${exclusions.excludedFiles.length}`
				};

				// Update the sync file data
				const updatedData = {
					...this.currentSyncData,
					connectionEvents: [...this.currentSyncData.connectionEvents, event]
				};

				// Trim arrays to prevent excessive growth
				const trimmedData = trimSyncHistoryArrays(updatedData);

				// Write updated data
				await this.writeSyncFile(trimmedData);
			}
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.updateSyncFileForExclusions',
				metadata: { exclusions }
			});
		}
	}
}
