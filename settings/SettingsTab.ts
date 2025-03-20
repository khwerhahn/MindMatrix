//SettingsTab.ts
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MindMatrixPlugin from '../main';
import { MindMatrixSettings, generateVaultId, isVaultInitialized, getUserExclusions, SYSTEM_EXCLUSIONS } from './Settings';

export class MindMatrixSettingsTab extends PluginSettingTab {
	plugin: MindMatrixPlugin;
	settings: MindMatrixSettings;

	constructor(app: App, plugin: MindMatrixPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = plugin.settings;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Debugging: Log all exclusion settings to console
		console.log("DEBUG - All Exclusion Settings:", {
			userSettings: this.settings.exclusions,
			systemDefaults: SYSTEM_EXCLUSIONS
		});

		// Vault Identification Section
		containerEl.createEl('h2', { text: 'Vault Identification' });

		if (isVaultInitialized(this.settings)) {
			new Setting(containerEl)
				.setName('Vault ID')
				.setDesc('Unique identifier for this vault in the database.')
				.addText(text =>
					text.setValue(this.settings.vaultId!)
						.setDisabled(true)
				);

			new Setting(containerEl)
				.setName('Vault Name')
				.setDesc('The name of your current vault.')
				.addText(text =>
					text.setValue(this.settings.lastKnownVaultName)
						.setDisabled(true)
				);

			new Setting(containerEl)
				.setName('Reset Vault ID')
				.setDesc('Generate a new vault ID (requires full resync).')
				.addButton(btn =>
					btn.setButtonText('Reset')
						.setWarning()
						.onClick(async () => {
							const confirmed = await this.showResetConfirmation();
							if (confirmed) {
								this.settings.vaultId = generateVaultId();
								this.settings.lastKnownVaultName = this.app.vault.getName();
								await this.plugin.saveSettings();
								new Notice('Vault ID has been reset. Please resync your vault.');
								this.display();
							}
						})
				);
		} else {
			new Setting(containerEl)
				.setName('Initialize Vault')
				.setDesc('Generate a unique identifier for this vault to begin syncing.')
				.addButton(btn =>
					btn.setButtonText('Initialize')
						.onClick(async () => {
							this.settings.vaultId = generateVaultId();
							this.settings.lastKnownVaultName = this.app.vault.getName();
							await this.plugin.saveSettings();
							new Notice('Vault has been initialized.');
							this.display();
						})
				);
		}

		// Supabase Settings Section
		containerEl.createEl('h2', { text: 'Supabase Configuration' });
		new Setting(containerEl)
			.setName('Supabase URL')
			.setDesc('The URL of your Supabase project (e.g., https://your-project.supabase.co).')
			.addText(text =>
				text.setPlaceholder('https://your-project.supabase.co')
					.setValue(this.settings.supabase.url)
					.onChange(async (value) => {
						this.settings.supabase.url = value;
						await this.plugin.saveSettings();
						new Notice('Supabase URL updated.');
					})
			);
		new Setting(containerEl)
			.setName('Supabase API Key')
			.setDesc('Your Supabase API key (found in your Supabase dashboard).')
			.addText(text =>
				text.setPlaceholder('Enter your API key')
					.setValue(this.settings.supabase.apiKey)
					.onChange(async (value) => {
						this.settings.supabase.apiKey = value;
						await this.plugin.saveSettings();
						new Notice('Supabase API key updated.');
					})
			);

		// OpenAI Settings Section
		containerEl.createEl('h2', { text: 'OpenAI Configuration' });
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for generating embeddings.')
			.addText(text =>
				text.setPlaceholder('Enter your API key')
					.setValue(this.settings.openai.apiKey)
					.onChange(async (value) => {
						this.settings.openai.apiKey = value;
						await this.plugin.saveSettings();
						new Notice('OpenAI API key updated.');
					})
			);

		// Document Processing Settings Section
		containerEl.createEl('h2', { text: 'Document Processing' });
		new Setting(containerEl)
			.setName('Chunk Size')
			.setDesc('Maximum size of text chunks (in characters).')
			.addText(text =>
				text.setValue(String(this.settings.chunking.chunkSize))
					.onChange(async (value) => {
						const numValue = Number(value);
						if (!isNaN(numValue) && numValue > 0) {
							this.settings.chunking.chunkSize = numValue;
							await this.plugin.saveSettings();
							new Notice('Chunk size updated.');
						}
					})
			);
		new Setting(containerEl)
			.setName('Chunk Overlap')
			.setDesc('Overlap between text chunks (in characters).')
			.addText(text =>
				text.setValue(String(this.settings.chunking.chunkOverlap))
					.onChange(async (value) => {
						const numValue = Number(value);
						if (!isNaN(numValue) && numValue >= 0) {
							this.settings.chunking.chunkOverlap = numValue;
							await this.plugin.saveSettings();
							new Notice('Chunk overlap updated.');
						}
					})
			);

		// Exclusion Settings Section - Only showing user-defined exclusions
		containerEl.createEl('h2', { text: 'Exclusions' });

		// Get only user-defined exclusions for UI display
		const userExclusions = getUserExclusions(this.settings);

		// Debug: Log user exclusions from the function
		console.log("DEBUG - User Exclusions from getUserExclusions():", userExclusions);

		// Filter out any system exclusions that might have been accidentally saved in user lists
		const systemFolders = new Set(SYSTEM_EXCLUSIONS.folders);
		const systemFileTypes = new Set(SYSTEM_EXCLUSIONS.fileTypes);
		const systemFilePrefixes = new Set(SYSTEM_EXCLUSIONS.filePrefixes);
		const systemFiles = new Set(SYSTEM_EXCLUSIONS.files);

		// Debug: Log the system exclusion sets
		console.log("DEBUG - System Exclusion Sets:", {
			folders: Array.from(systemFolders),
			fileTypes: Array.from(systemFileTypes),
			filePrefixes: Array.from(systemFilePrefixes),
			files: Array.from(systemFiles)
		});

		// Filter out system items from user exclusions
		const filteredUserFolders = userExclusions.excludedFolders.filter(folder => !systemFolders.has(folder));
		const filteredUserFileTypes = userExclusions.excludedFileTypes.filter(type => !systemFileTypes.has(type));
		const filteredUserFilePrefixes = userExclusions.excludedFilePrefixes.filter(prefix => !systemFilePrefixes.has(prefix));
		const filteredUserFiles = userExclusions.excludedFiles.filter(file => !systemFiles.has(file));

		// Debug: Log the filtered exclusions
		console.log("DEBUG - Filtered User Exclusions:", {
			folders: filteredUserFolders,
			fileTypes: filteredUserFileTypes,
			filePrefixes: filteredUserFilePrefixes,
			files: filteredUserFiles
		});

		new Setting(containerEl)
			.setName('Excluded Folders')
			.setDesc('Folders to exclude from syncing (comma-separated).')
			.addText(text => {
				const value = filteredUserFolders.join(', ');
				console.log("DEBUG - Setting excluded folders field value:", value);
				return text.setPlaceholder('folder1, folder2')
					.setValue(value)
					.onChange(async (value) => {
						console.log("DEBUG - Folders onChange event value:", value);
						// Save only user-defined folders, ensuring we don't duplicate system folders
						const userFolders = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFolders = userFolders.filter(folder => !systemFolders.has(folder));
						console.log("DEBUG - Final folders to save:", finalFolders);
						this.settings.exclusions.excludedFolders = finalFolders;
						await this.plugin.saveSettings();
						new Notice('Excluded folders updated.');
					});
			});

		new Setting(containerEl)
			.setName('Excluded File Types')
			.setDesc('File extensions to exclude (comma-separated, include the dot).')
			.addText(text => {
				const value = filteredUserFileTypes.join(', ');

				return text.setPlaceholder('.type1, .type2')
					.setValue(value)
					.onChange(async (value) => {
						const userFileTypes = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFileTypes = userFileTypes.filter(type => !systemFileTypes.has(type));
						this.settings.exclusions.excludedFileTypes = finalFileTypes;
						await this.plugin.saveSettings();
						new Notice('Excluded file types updated.');
					});
			});

		new Setting(containerEl)
			.setName('Excluded File Prefixes')
			.setDesc('File name prefixes to exclude (comma-separated).')
			.addText(text => {
				const value = filteredUserFilePrefixes.join(', ');
				console.log("DEBUG - Setting excluded file prefixes field value:", value);
				return text.setPlaceholder('temp, draft')
					.setValue(value)
					.onChange(async (value) => {
						console.log("DEBUG - File prefixes onChange event value:", value);
						// Save only user-defined prefixes, ensuring we don't duplicate system prefixes
						const userFilePrefixes = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFilePrefixes = userFilePrefixes.filter(prefix => !systemFilePrefixes.has(prefix));
						console.log("DEBUG - Final file prefixes to save:", finalFilePrefixes);
						this.settings.exclusions.excludedFilePrefixes = finalFilePrefixes;
						await this.plugin.saveSettings();
						new Notice('Excluded file prefixes updated.');
					});
			});

		new Setting(containerEl)
			.setName('Excluded Files')
			.setDesc('Specific files to exclude from syncing (comma-separated).')
			.addText(text => {
				const value = filteredUserFiles.join(', ');
				console.log("DEBUG - Setting excluded files field value:", value);
				return text.setPlaceholder('file1.md, file2.md')
					.setValue(value)
					.onChange(async (value) => {
						console.log("DEBUG - Files onChange event value:", value);
						// Save only user-defined files, ensuring we don't duplicate system files
						const userFiles = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFiles = userFiles.filter(file => !systemFiles.has(file));
						console.log("DEBUG - Final files to save:", finalFiles);
						this.settings.exclusions.excludedFiles = finalFiles;
						await this.plugin.saveSettings();
						new Notice('Excluded files updated.');
					});
			});

		// Improved info text about system defaults
		const infoDiv = containerEl.createEl('div', { cls: 'setting-item-description' });
		infoDiv.innerHTML = `
			<p><strong>Note:</strong> The following items are automatically excluded by the system:</p>
			<p><strong>Folders:</strong> ${SYSTEM_EXCLUSIONS.folders.join(', ')}</p>
			<p><strong>File Types:</strong> ${SYSTEM_EXCLUSIONS.fileTypes.join(', ')}</p>
			<p><strong>File Prefixes:</strong> ${SYSTEM_EXCLUSIONS.filePrefixes.join(', ')}</p>
			<p><strong>Files:</strong> ${SYSTEM_EXCLUSIONS.files.join(', ')}</p>
		`;

		// Queue & Sync Settings Section
		containerEl.createEl('h2', { text: 'Queue & Sync Settings' });
		new Setting(containerEl)
			.setName('Auto Sync')
			.setDesc('Automatically sync changes to the database when files are modified.')
			.addToggle(toggle =>
				toggle.setValue(this.settings.enableAutoSync)
					.onChange(async (value) => {
						this.settings.enableAutoSync = value;
						await this.plugin.saveSettings();
						new Notice('Auto sync updated.');
					})
			);
		new Setting(containerEl)
			.setName('Sync File Path')
			.setDesc('The path for the dedicated sync file.')
			.addText(text =>
				text.setValue(this.settings.sync.syncFilePath)
					.onChange(async (value) => {
						this.settings.sync.syncFilePath = value;
						// Also update the system excluded files
						const systemFiles = this.settings.exclusions.systemExcludedFiles;
						// Remove old sync file references
						const oldSyncFileIndex = systemFiles.findIndex(f => f === '_mindmatrixsync.md');
						const oldSyncBackupIndex = systemFiles.findIndex(f => f === '_mindmatrixsync.md.backup');
						if (oldSyncFileIndex !== -1) systemFiles.splice(oldSyncFileIndex, 1);
						if (oldSyncBackupIndex !== -1) systemFiles.splice(oldSyncBackupIndex, 1);
						// Add new sync file references
						systemFiles.push(value);
						systemFiles.push(value + '.backup');
						await this.plugin.saveSettings();
						new Notice('Sync file path updated.');
					})
			);

		// Debug Settings Section
		containerEl.createEl('h2', { text: 'Debug Settings' });
		new Setting(containerEl)
			.setName('Enable Debug Logs')
			.setDesc('Enable detailed debug logs in the console.')
			.addToggle(toggle =>
				toggle.setValue(this.settings.debug.enableDebugLogs)
					.onChange(async (value) => {
						this.settings.debug.enableDebugLogs = value;
						await this.plugin.saveSettings();
						new Notice('Debug logs setting updated.');
					})
			);
		new Setting(containerEl)
			.setName('Log Level')
			.setDesc('Select the level of detail for debug logging.')
			.addDropdown(dropdown =>
				dropdown.addOption('error', 'Error')
					.addOption('warn', 'Warning')
					.addOption('info', 'Info')
					.addOption('debug', 'Debug')
					.setValue(this.settings.debug.logLevel)
					.onChange(async (value) => {
						this.settings.debug.logLevel = value as 'error' | 'warn' | 'info' | 'debug';
						await this.plugin.saveSettings();
						new Notice('Log level updated.');
					})
			);
		new Setting(containerEl)
			.setName('Log to File')
			.setDesc('Save debug logs to a file in your vault.')
			.addToggle(toggle =>
				toggle.setValue(this.settings.debug.logToFile)
					.onChange(async (value) => {
						this.settings.debug.logToFile = value;
						await this.plugin.saveSettings();
						new Notice('Log to file setting updated.');
					})
			);
	}

	private async showResetConfirmation(): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = this.app.modal;
			modal.open((modal) => {
				modal.titleEl.setText('Reset Vault ID');
				modal.contentEl.setText(
					'Warning: Resetting the vault ID will disconnect this vault from its existing database entries. This operation cannot be undone. Are you sure you want to continue?'
				);
				modal.addButton((btn) => {
					btn.setButtonText('Cancel').onClick(() => {
						resolve(false);
						modal.close();
					});
				});
				modal.addButton((btn) => {
					btn.setButtonText('Reset').setWarning().onClick(() => {
						resolve(true);
						modal.close();
					});
				});
			});
		});
	}
}
