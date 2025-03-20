// src/settings/SettingsTab.ts
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MindMatrixPlugin from '../main';
import { MindMatrixSettings, generateVaultId, isVaultInitialized } from './Settings';

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

		// Exclusion Settings Section - Now only showing user-defined exclusions
		containerEl.createEl('h2', { text: 'Exclusions' });
		new Setting(containerEl)
			.setName('Additional Excluded Folders')
			.setDesc('Comma-separated list of additional folders to exclude from syncing.')
			.addText(text =>
				text.setValue((this.settings.exclusions?.excludedFolders || []).join(', '))
					.onChange(async (value) => {
						this.settings.exclusions.excludedFolders = value.split(',').map(s => s.trim()).filter(s => s);
						await this.plugin.saveSettings();
						new Notice('Additional excluded folders updated.');
					})
			);
		new Setting(containerEl)
			.setName('Additional Excluded File Types')
			.setDesc('Comma-separated list of additional file extensions to exclude (e.g., .mp3, .jpg).')
			.addText(text =>
				text.setValue(this.settings.exclusions.excludedFileTypes.join(', '))
					.onChange(async (value) => {
						this.settings.exclusions.excludedFileTypes = value.split(',').map(s => s.trim()).filter(s => s);
						await this.plugin.saveSettings();
						new Notice('Additional excluded file types updated.');
					})
			);
		new Setting(containerEl)
			.setName('Additional Excluded File Prefixes')
			.setDesc('Comma-separated list of file name prefixes to exclude.')
			.addText(text =>
				text.setValue(this.settings.exclusions.excludedFilePrefixes.join(', '))
					.onChange(async (value) => {
						this.settings.exclusions.excludedFilePrefixes = value.split(',').map(s => s.trim()).filter(s => s);
						await this.plugin.saveSettings();
						new Notice('Additional excluded file prefixes updated.');
					})
			);
		new Setting(containerEl)
			.setName('Additional Excluded Files')
			.setDesc('Comma-separated list of specific files to exclude from syncing.')
			.addText(text =>
				text.setValue(this.settings.exclusions.excludedFiles.join(', '))
					.onChange(async (value) => {
						this.settings.exclusions.excludedFiles = value.split(',').map(s => s.trim()).filter(s => s);
						await this.plugin.saveSettings();
						new Notice('Additional excluded files updated.');
					})
			);

		// Info text about default exclusions
		const infoDiv = containerEl.createEl('div', { cls: 'setting-item-description' });
		infoDiv.innerHTML = 'The following are automatically excluded: <br>' +
			'• Folders: .obsidian, .trash, .git, node_modules<br>' +
			'• File types: .mp3, .jpg, .png, .pdf, .excalidraw<br>' +
			'• File prefixes: _, .<br>' +
			'• Files: _mindmatrixsync.md, _mindmatrixsync.md.backup';

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
