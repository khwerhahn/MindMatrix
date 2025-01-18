import { App, PluginSettingTab, Setting } from 'obsidian';
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
                .setDesc('Unique identifier for this vault. This is used to track your vault in the database.')
                .addText(text => text
                    .setValue(this.settings.vaultId!)
                    .setDisabled(true)
                );

            new Setting(containerEl)
                .setName('Vault Name')
                .setDesc('Current vault name (for reference only)')
                .addText(text => text
                    .setValue(this.settings.lastKnownVaultName)
                    .setDisabled(true)
                );

            new Setting(containerEl)
                .setName('Reset Vault ID')
                .setDesc('Warning: This will disconnect this vault from existing database entries.')
                .addButton(btn => btn
                    .setButtonText('Reset')
                    .setWarning()
                    .onClick(async () => {
                        const confirmed = await this.showResetConfirmation();
                        if (confirmed) {
                            this.settings.vaultId = generateVaultId();
                            this.settings.lastKnownVaultName = this.app.vault.getName();
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    }));
        } else {
            new Setting(containerEl)
                .setName('Initialize Vault')
                .setDesc('Generate a unique identifier for this vault')
                .addButton(btn => btn
                    .setButtonText('Initialize')
                    .onClick(async () => {
                        this.settings.vaultId = generateVaultId();
                        this.settings.lastKnownVaultName = this.app.vault.getName();
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        }

        // Supabase Settings
        containerEl.createEl('h2', { text: 'Supabase Configuration' });

        new Setting(containerEl)
            .setName('Supabase URL')
            .setDesc('Your Supabase project URL')
            .addText(text => text
                .setPlaceholder('https://your-project.supabase.co')
                .setValue(this.settings.supabase.url)
                .onChange(async (value) => {
                    this.settings.supabase.url = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Supabase API Key')
            .setDesc('Your Supabase project API key')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.settings.supabase.apiKey)
                .onChange(async (value) => {
                    this.settings.supabase.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        // OpenAI Settings
        containerEl.createEl('h2', { text: 'OpenAI Configuration' });

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Your OpenAI API key')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.settings.openai.apiKey)
                .onChange(async (value) => {
                    this.settings.openai.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        // Chunking Settings
        containerEl.createEl('h2', { text: 'Document Processing' });

        new Setting(containerEl)
            .setName('Chunk Size')
            .setDesc('Maximum size of text chunks (in characters)')
            .addText(text => text
                .setValue(String(this.settings.chunking.chunkSize))
                .onChange(async (value) => {
                    const numValue = Number(value);
                    if (!isNaN(numValue) && numValue > 0) {
                        this.settings.chunking.chunkSize = numValue;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Chunk Overlap')
            .setDesc('Number of characters to overlap between chunks')
            .addText(text => text
                .setValue(String(this.settings.chunking.chunkOverlap))
                .onChange(async (value) => {
                    const numValue = Number(value);
                    if (!isNaN(numValue) && numValue >= 0) {
                        this.settings.chunking.chunkOverlap = numValue;
                        await this.plugin.saveSettings();
                    }
                }));

        // Exclusion Settings
        containerEl.createEl('h2', { text: 'Exclusions' });

        new Setting(containerEl)
            .setName('Excluded Folders')
            .setDesc('Folders to exclude (comma-separated)')
            .addText(text => text
                .setValue(this.settings.exclusions.excludedFolders.join(', '))
                .onChange(async (value) => {
                    this.settings.exclusions.excludedFolders = value.split(',').map(s => s.trim()).filter(s => s);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Excluded File Types')
            .setDesc('File extensions to exclude (comma-separated)')
            .addText(text => text
                .setValue(this.settings.exclusions.excludedFileTypes.join(', '))
                .onChange(async (value) => {
                    this.settings.exclusions.excludedFileTypes = value.split(',').map(s => s.trim()).filter(s => s);
                    await this.plugin.saveSettings();
                }));

        // Feature Flags
        containerEl.createEl('h2', { text: 'Features' });

        new Setting(containerEl)
            .setName('Auto Sync')
            .setDesc('Automatically sync changes to the database')
            .addToggle(toggle => toggle
                .setValue(this.settings.enableAutoSync)
                .onChange(async (value) => {
                    this.settings.enableAutoSync = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Notifications')
            .setDesc('Display sync status notifications')
            .addToggle(toggle => toggle
                .setValue(this.settings.enableNotifications)
                .onChange(async (value) => {
                    this.settings.enableNotifications = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Progress Bar')
            .setDesc('Display progress bar during sync operations')
            .addToggle(toggle => toggle
                .setValue(this.settings.enableProgressBar)
                .onChange(async (value) => {
                    this.settings.enableProgressBar = value;
                    await this.plugin.saveSettings();
                }));
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
