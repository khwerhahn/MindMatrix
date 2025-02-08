// src/services/SyncFileManager.ts

import { TFile, Vault } from 'obsidian';
import { ErrorHandler } from '../utils/ErrorHandler';
import { DocumentProcessingError } from '../models/DocumentChunk';

interface SyncState {
	isValid: boolean;
	error?: string;
}

interface SyncEntry {
	filePath: string;
	lastModified: number;
	lastSynced: number;
	hash: string;
	status: 'OK' | 'PENDING' | 'ERROR';
}

interface SyncFileContent {
	lastSync: number;
	entries: SyncEntry[];
}

export class SyncFileManager {
	private syncFilePath: string;
	private backupPath: string;
	private lastBackup: number = 0;
	private backupInterval: number;
	private syncFile: TFile | null = null;

	constructor(
		private vault: Vault,
		private errorHandler: ErrorHandler,
		syncFilePath: string = '_mindmatrixsync.md',
		backupInterval: number = 3600000 // 1 hour in milliseconds
	) {
		this.syncFilePath = syncFilePath;
		this.backupPath = `${syncFilePath}.backup`;
		this.backupInterval = backupInterval;
	}

	/**
	 * Initialize or validate the sync file
	 */
	async initialize(): Promise<void> {
		try {
			// Check if sync file exists
			const existingFile = this.vault.getAbstractFileByPath(this.syncFilePath);

			if (existingFile instanceof TFile) {
				this.syncFile = existingFile;
				// Validate existing file
				const isValid = await this.validateSyncFile();
				if (!isValid) {
					await this.repairSyncFile();
				}
			} else {
				// Create new sync file
				await this.createSyncFile();
			}

			// Create initial backup
			await this.createBackup();
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.initialize',
				metadata: { syncFilePath: this.syncFilePath }
			});
			throw error;
		}
	}

	/**
	 * Create a new sync file with initial structure
	 */
	private async createSyncFile(): Promise<void> {
		const initialContent = this.generateInitialContent();
		this.syncFile = await this.vault.create(this.syncFilePath, initialContent);
	}

	/**
	 * Generate initial content for sync file
	 */
	private generateInitialContent(): string {
		return `---
last_sync: ${Date.now()}
---

## Synced Files
| File Path | Last Modified | Last Synced | Hash | Status |
|-----------|--------------|-------------|------|--------|
`;
	}

	/**
	 * Validate sync file structure and content
	 */
	private async validateSyncFile(): Promise<boolean> {
		if (!this.syncFile) return false;

		try {
			const content = await this.vault.read(this.syncFile);

			// Check basic structure
			const hasYamlFrontmatter = /^---\n[\s\S]*?\n---/.test(content);
			const hasTableHeader = content.includes('| File Path | Last Modified | Last Synced | Hash | Status |');
			const hasTableDelimiter = content.includes('|-----------|--------------|-------------|------|--------|');

			if (!hasYamlFrontmatter || !hasTableHeader || !hasTableDelimiter) {
				return false;
			}

			// Parse and validate entries
			const entries = await this.parseSyncFile();
			for (const entry of entries) {
				if (!this.validateEntry(entry)) {
					return false;
				}
			}

			return true;
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.validateSyncFile',
				metadata: { syncFilePath: this.syncFilePath }
			});
			return false;
		}
	}

	/**
	 * Validate a single sync entry
	 */
	private validateEntry(entry: SyncEntry): boolean {
		return (
			typeof entry.filePath === 'string' &&
			typeof entry.lastModified === 'number' &&
			typeof entry.lastSynced === 'number' &&
			typeof entry.hash === 'string' &&
			['OK', 'PENDING', 'ERROR'].includes(entry.status)
		);
	}

	/**
	 * Repair corrupted sync file
	 */
	private async repairSyncFile(): Promise<void> {
		try {
			// Try to restore from backup first
			const restored = await this.restoreFromBackup();
			if (!restored) {
				// If restoration fails, create new sync file
				await this.createSyncFile();
			}
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.repairSyncFile',
				metadata: { syncFilePath: this.syncFilePath }
			});
			throw error;
		}
	}

	/**
	 * Parse sync file content
	 */
	private async parseSyncFile(): Promise<SyncEntry[]> {
		if (!this.syncFile) {
			throw new Error(DocumentProcessingError.SYNC_ERROR);
		}

		const content = await this.vault.read(this.syncFile);
		const lines = content.split('\n');
		const entries: SyncEntry[] = [];

		let tableStartIndex = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes('| File Path | Last Modified |')) {
				tableStartIndex = i + 2; // Skip header and delimiter
				break;
			}
		}

		if (tableStartIndex === -1) {
			throw new Error('Invalid sync file format');
		}

		for (let i = tableStartIndex; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line || line.startsWith('#')) continue;

			const parts = line.split('|').map(part => part.trim());
			if (parts.length >= 6) {
				entries.push({
					filePath: parts[1],
					lastModified: parseInt(parts[2]),
					lastSynced: parseInt(parts[3]),
					hash: parts[4],
					status: parts[5] as 'OK' | 'PENDING' | 'ERROR'
				});
			}
		}

		return entries;
	}

	/**
	 * Update sync status for a file
	 */
	async updateSyncStatus(
		filePath: string,
		status: 'OK' | 'PENDING' | 'ERROR',
		metadata: { lastModified: number; hash: string }
	): Promise<void> {
		try {
			if (!this.syncFile) {
				throw new Error('Sync file not initialized');
			}

			const entries = await this.parseSyncFile();
			const existingEntryIndex = entries.findIndex(e => e.filePath === filePath);
			const newEntry: SyncEntry = {
				filePath,
				lastModified: metadata.lastModified,
				lastSynced: Date.now(),
				hash: metadata.hash,
				status
			};

			if (existingEntryIndex >= 0) {
				entries[existingEntryIndex] = newEntry;
			} else {
				entries.push(newEntry);
			}

			await this.writeSyncFile(entries);

			// Create backup if needed
			if (Date.now() - this.lastBackup >= this.backupInterval) {
				await this.createBackup();
			}
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.updateSyncStatus',
				metadata: { filePath, status }
			});
			throw error;
		}
	}

	/**
	 * Write entries to sync file
	 */
	private async writeSyncFile(entries: SyncEntry[]): Promise<void> {
		if (!this.syncFile) {
			throw new Error('Sync file not initialized');
		}

		const header = `---
last_sync: ${Date.now()}
---

## Synced Files
| File Path | Last Modified | Last Synced | Hash | Status |
|-----------|--------------|-------------|------|--------|
`;

		const content = entries
			.map(entry => `| ${entry.filePath} | ${entry.lastModified} | ${entry.lastSynced} | ${entry.hash} | ${entry.status} |`)
			.join('\n');

		await this.vault.modify(this.syncFile, header + content);
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
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.createBackup'
			});
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
			return true;
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.restoreFromBackup'
			});
			return false;
		}
	}

	/**
	 * Get sync status for a file
	 */
	async getSyncStatus(filePath: string): Promise<SyncEntry | null> {
		try {
			const entries = await this.parseSyncFile();
			return entries.find(e => e.filePath === filePath) || null;
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.getSyncStatus',
				metadata: { filePath }
			});
			return null;
		}
	}

	/**
	 * Get all sync entries
	 */
	async getAllSyncEntries(): Promise<SyncEntry[]> {
		try {
			return await this.parseSyncFile();
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.getAllSyncEntries'
			});
			return [];
		}
	}

	async validateSyncState(): Promise<SyncState> {
		try {
			if (!this.syncFile) {
				return {
					isValid: false,
					error: 'Sync file not initialized'
				};
			}

			const content = await this.vault.read(this.syncFile);

			// Check basic structure
			const hasYamlFrontmatter = /^---\n[\s\S]*?\n---/.test(content);
			const hasTableHeader = content.includes('| File Path | Last Modified | Last Synced | Hash | Status |');
			const hasTableDelimiter = content.includes('|-----------|--------------|-------------|------|--------|');

			if (!hasYamlFrontmatter || !hasTableHeader || !hasTableDelimiter) {
				return {
					isValid: false,
					error: 'Invalid sync file structure'
				};
			}

			// Parse and validate entries
			const entries = await this.parseSyncFile();
			for (const entry of entries) {
				if (!this.validateEntry(entry)) {
					return {
						isValid: false,
						error: 'Invalid sync entry found'
					};
				}
			}

			return { isValid: true };
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.validateSyncState'
			});
			return {
				isValid: false,
				error: error.message
			};
		}
	}

	async attemptRecovery(): Promise<boolean> {
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
				context: 'SyncFileManager.attemptRecovery'
			});
			return false;
		}
	}

	async updateLastSync(): Promise<void> {
		try {
			if (!this.syncFile) {
				throw new Error('Sync file not initialized');
			}

			const content = await this.vault.read(this.syncFile);
			const updatedContent = content.replace(
				/^---\nlast_sync: \d+/m,
				`---\nlast_sync: ${Date.now()}`
			);

			await this.vault.modify(this.syncFile, updatedContent);
		} catch (error) {
			this.errorHandler.handleError(error, {
				context: 'SyncFileManager.updateLastSync'
			});
			throw error;
		}
	}
}
