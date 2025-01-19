import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MindMatrixPlugin from '../main';
import {
	MindMatrixSettings,
	generateVaultId,
	isVaultInitialized
} from './Settings';

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
				.setDesc('Unique identifier used to track this vault in the database. This ensures your notes are correctly synchronized.')
				.addText(text => text
					.setValue(this.settings.vaultId!)
					.setDisabled(true)
				);

			new Setting(containerEl)
				.setName('Vault Name')
				.setDesc('The current name of your Obsidian vault (displayed for reference).')
				.addText(text => text
					.setValue(this.settings.lastKnownVaultName)
					.setDisabled(true)
				);

			new Setting(containerEl)
				.setName('Reset Vault ID')
				.setDesc('Generates a new vault ID. Warning: This will disconnect the vault from its existing database entries and require a full resync.')
				.addButton(btn => btn
					.setButtonText('Reset')
					.setWarning()
					.onClick(async () => {
						const confirmed = await this.showResetConfirmation();
						if (confirmed) {
							this.settings.vaultId = generateVaultId();
							this.settings.lastKnownVaultName = this.app.vault.getName();
							await this.plugin.saveSettings();
							new Notice('Vault ID has been reset.');
							this.display();
						}
					}));
		} else {
			new Setting(containerEl)
				.setName('Initialize Vault')
				.setDesc('Generate a unique identifier for this vault to begin syncing with the database.')
				.addButton(btn => btn
					.setButtonText('Initialize')
					.onClick(async () => {
						this.settings.vaultId = generateVaultId();
						this.settings.lastKnownVaultName = this.app.vault.getName();
						await this.plugin.saveSettings();
						new Notice('Vault has been initialized.');
						this.display();
					}));
		}

		// Supabase Settings
		containerEl.createEl('h2', { text: 'Supabase Configuration' });

		new Setting(containerEl)
			.setName('Supabase URL')
			.setDesc('The URL for your Supabase project. Find this in your Supabase dashboard under Project Settings > API > Project URL. Should look like: https://xxx.supabase.co')
			.addText(text => text
				.setPlaceholder('https://your-project.supabase.co')
				.setValue(this.settings.supabase.url)
				.onChange(async (value) => {
					this.settings.supabase.url = value;
					await this.plugin.saveSettings();
					new Notice('Supabase URL updated.');
				}));

		new Setting(containerEl)
			.setName('Supabase API Key')
			.setDesc('Your Supabase project API key. Find this in Project Settings > API > Project API keys. Use the "service_role" key for full database access. Keep this key secure.')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.settings.supabase.apiKey)
				.onChange(async (value) => {
					this.settings.supabase.apiKey = value;
					await this.plugin.saveSettings();
					new Notice('Supabase API key updated.');
				}));

		// OpenAI Settings
		containerEl.createEl('h2', { text: 'OpenAI Configuration' });

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for generating embeddings. Create one at https://platform.openai.com/api-keys. Estimated cost: ~$0.0001 per page. Keep this key secure.')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.settings.openai.apiKey)
				.onChange(async (value) => {
					this.settings.openai.apiKey = value;
					await this.plugin.saveSettings();
					new Notice('OpenAI API key updated.');
				}));

		// Document Processing Settings
		containerEl.createEl('h2', { text: 'Document Processing' });

		new Setting(containerEl)
			.setName('Chunk Size')
			.setDesc('Maximum size of text chunks in characters. Larger chunks provide more context but cost more tokens. Recommended: 1000-1500 characters for optimal semantic search results.')
			.addText(text => text
				.setValue(String(this.settings.chunking.chunkSize))
				.onChange(async (value) => {
					const numValue = Number(value);
					if (!isNaN(numValue) && numValue > 0) {
						this.settings.chunking.chunkSize = numValue;
						await this.plugin.saveSettings();
						new Notice('Chunk size updated.');
					}
				}));

		new Setting(containerEl)
			.setName('Chunk Overlap')
			.setDesc('Number of characters to overlap between chunks. Helps maintain context across chunk boundaries. Recommended: 10-20% of chunk size (100-200 characters for default settings).')
			.addText(text => text
				.setValue(String(this.settings.chunking.chunkOverlap))
				.onChange(async (value) => {
					const numValue = Number(value);
					if (!isNaN(numValue) && numValue >= 0) {
						this.settings.chunking.chunkOverlap = numValue;
						await this.plugin.saveSettings();
						new Notice('Chunk overlap updated.');
					}
				}));

		// Exclusion Settings
		containerEl.createEl('h2', { text: 'Exclusions' });

		new Setting(containerEl)
			.setName('Excluded Folders')
			.setDesc('Folders to exclude from syncing. Common examples: .git, .obsidian, node_modules, attachments. Separate multiple folders with commas.')
			.addText(text => text
				.setValue(this.settings.exclusions.excludedFolders.join(', '))
				.onChange(async (value) => {
					this.settings.exclusions.excludedFolders = value.split(',').map(s => s.trim()).filter(s => s);
					await this.plugin.saveSettings();
					new Notice('Excluded folders updated.');
				}));

		new Setting(containerEl)
			.setName('Excluded File Types')
			.setDesc('File extensions to exclude from syncing (e.g., .mp3, .jpg, .png). Include the dot prefix. Only markdown files are recommended for embedding.')
			.addText(text => text
				.setValue(this.settings.exclusions.excludedFileTypes.join(', '))
				.onChange(async (value) => {
					this.settings.exclusions.excludedFileTypes = value.split(',').map(s => s.trim()).filter(s => s);
					await this.plugin.saveSettings();
					new Notice('Excluded file types updated.');
				}));

		// Queue Settings
		containerEl.createEl('h2', { text: 'Processing Queue' });

		new Setting(containerEl)
			.setName('Concurrent Tasks')
			.setDesc('Maximum number of tasks to process simultaneously. Higher values may improve speed but increase API usage. Default: 3')
			.addText(text => text
				.setValue(String(this.settings.queue.maxConcurrent))
				.onChange(async (value) => {
					const numValue = Number(value);
					if (!isNaN(numValue) && numValue > 0) {
						this.settings.queue.maxConcurrent = numValue;
						await this.plugin.saveSettings();
						new Notice('Concurrent tasks limit updated.');
					}
				}));

		new Setting(containerEl)
			.setName('Retry Attempts')
			.setDesc('Number of times to retry failed operations before giving up. Helps handle temporary API or network issues. Default: 3')
			.addText(text => text
				.setValue(String(this.settings.queue.retryAttempts))
				.onChange(async (value) => {
					const numValue = Number(value);
					if (!isNaN(numValue) && numValue >= 0) {
						this.settings.queue.retryAttempts = numValue;
						await this.plugin.saveSettings();
						new Notice('Retry attempts updated.');
					}
				}));

		// Feature Flags
		containerEl.createEl('h2', { text: 'Features' });

		new Setting(containerEl)
			.setName('Auto Sync')
			.setDesc('Automatically sync changes to the database when files are created, modified, or deleted. Disable this if you prefer to manually control when files are synced.')
			.addToggle(toggle => toggle
				.setValue(this.settings.enableAutoSync)
				.onChange(async (value) => {
					this.settings.enableAutoSync = value;
					await this.plugin.saveSettings();
					new Notice('Auto sync updated.');
				}));

		new Setting(containerEl)
			.setName('Show Notifications')
			.setDesc('Display notifications for sync events, errors, and important updates. Helps track the status of background operations.')
			.addToggle(toggle => toggle
				.setValue(this.settings.enableNotifications)
				.onChange(async (value) => {
					this.settings.enableNotifications = value;
					await this.plugin.saveSettings();
					new Notice('Notification settings updated.');
				}));

		new Setting(containerEl)
			.setName('Show Progress Bar')
			.setDesc('Display a progress bar in the status bar during sync operations. Useful for monitoring long-running tasks and large vault synchronizations.')
			.addToggle(toggle => toggle
				.setValue(this.settings.enableProgressBar)
				.onChange(async (value) => {
					this.settings.enableProgressBar = value;
					await this.plugin.saveSettings();
					new Notice('Progress bar setting updated.');
				}));

		new Setting(containerEl)
			.setName('Test Database Connection')
			.setDesc('Click to test the connection to the Supabase database.')
			.addButton(btn => btn
				.setButtonText('Test Connection')
				.onClick(async () => {
					if (this.plugin.supabaseService) {
						const isConnected = await this.plugin.supabaseService.testConnection();
						new Notice(isConnected ? 'Database connection successful!' : 'Database connection failed.');
					} else {
						new Notice('Supabase service not initialized.');
					}
				}));

		// Debug Settings
		if (this.settings.debug.enableDebugLogs) {
			containerEl.createEl('h2', { text: 'Debug Settings' });

			new Setting(containerEl)
				.setName('Log Level')
				.setDesc('Level of detail for debug logging. Higher levels include more information.')
				.addDropdown(dropdown => dropdown
					.addOption('error', 'Error')
					.addOption('warn', 'Warning')
					.addOption('info', 'Info')
					.addOption('debug', 'Debug')
					.setValue(this.settings.debug.logLevel)
					.onChange(async (value) => {
						this.settings.debug.logLevel = value as 'error' | 'warn' | 'info' | 'debug';
						await this.plugin.saveSettings();
						new Notice('Log level updated.');
					}));

			new Setting(containerEl)
				.setName('Log to File')
				.setDesc('Save debug logs to a file in your .obsidian folder.')
				.addToggle(toggle => toggle
					.setValue(this.settings.debug.logToFile)
					.onChange(async (value) => {
						this.settings.debug.logToFile = value;
						await this.plugin.saveSettings();
						new Notice('Log to file setting updated.');
					}));
		}
	}

	private async showResetConfirmation(): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = this.app.modal;
			modal.open((modal) => {
				modal.titleEl.setText('Reset Vault ID');
				modal.contentEl.setText(
					'Warning: Resetting the vault ID will disconnect this vault from its existing database entries. ' +
					'This operation cannot be undone. Are you sure you want to continue?'
				);
				modal.addButton((btn) => {
					btn.setButtonText('Cancel').onClick(() => {
						resolve(false);
						modal.close();
					});
				});
				modal.addButton((btn) => {
					btn
						.setButtonText('Reset')
						.setWarning()
						.onClick(() => {
							resolve(true);
							modal.close();
						});
				});
			});
		});
	}
}
