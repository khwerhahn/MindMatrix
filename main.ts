import { Plugin, TFile, Notice } from 'obsidian';
import { SupabaseService } from './services/SupabaseService';
import { OpenAIService } from './services/OpenAIService';
import { QueueService } from './services/QueueService';
import { MindMatrixSettingsTab } from './settings/SettingsTab';
import {
    MindMatrixSettings,
    DEFAULT_SETTINGS,
    isVaultInitialized,
    generateVaultId
} from './settings/Settings';

export default class MindMatrixPlugin extends Plugin {
    settings: MindMatrixSettings;
    supabaseService: SupabaseService | null = null;
    openAIService: OpenAIService | null = null;
    queueService: QueueService | null = null;

    private isInitializing = false;

    async onload() {
        console.log('Loading Mind Matrix Plugin...');
        await this.loadSettings();

        // Initialize vault if needed
        await this.initializeVaultIfNeeded();

        // Add settings tab
        this.addSettingTab(new MindMatrixSettingsTab(this.app, this));

        // Initialize services if vault is ready
        try {
            if (isVaultInitialized(this.settings)) {
                await this.initializeServices();
            }

            if (!this.settings.openai.apiKey) {
                new Notice('OpenAI API key is missing. AI features are disabled. Configure it in the settings.');
            }

            if (!this.settings.supabase.url || !this.settings.supabase.apiKey) {
                new Notice('Supabase configuration is incomplete. Database features are disabled. Configure it in the settings.');
            }
        } catch (error) {
            console.error('Failed to initialize Mind Matrix Plugin:', error);
            new Notice('Mind Matrix Plugin failed to fully initialize. Check the console for details.');
        }

        // Register event handlers
        this.registerEventHandlers();

        // Add commands
        this.addCommands();
    }

    async onunload() {
        console.log('Unloading Mind Matrix Plugin...');
        this.queueService?.stop();
    }

    private async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);

        // Reinitialize services if settings have changed
        if (isVaultInitialized(this.settings)) {
            await this.initializeServices();
        }
    }

    private async initializeVaultIfNeeded() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            if (!isVaultInitialized(this.settings)) {
                this.settings.vaultId = generateVaultId();
                this.settings.lastKnownVaultName = this.app.vault.getName();
                await this.saveSettings();
            } else if (this.settings.lastKnownVaultName !== this.app.vault.getName()) {
                this.settings.lastKnownVaultName = this.app.vault.getName();
                await this.saveSettings();
            }
        } finally {
            this.isInitializing = false;
        }
    }

    private async initializeServices() {
        try {
            // Initialize Supabase service
            this.supabaseService = await SupabaseService.getInstance(this.settings);
            if (!this.supabaseService) {
                console.warn('Supabase service is not initialized due to incomplete configuration.');
            }

            // Initialize OpenAI service
            this.openAIService = new OpenAIService(this.settings.openai, this.app);

            if (!this.openAIService.isInitialized()) {
                console.warn('OpenAI service is not initialized due to missing API key.');
            }

            // Initialize queue service
            this.queueService = new QueueService(
                this.settings.queue.maxConcurrent,
                this.settings.queue.retryAttempts,
                this.supabaseService,
                this.openAIService
            );

            this.queueService.start();
        } catch (error) {
            console.error('Failed to initialize services:', error);
            throw error;
        }
    }

    private registerEventHandlers() {
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.queueFileProcessing(file, 'CREATE');
            })
        );

        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.queueFileProcessing(file, 'UPDATE');
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.queueFileProcessing(file, 'DELETE');
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.handleFileRename(file, oldPath);
            })
        );
    }

    private shouldProcessFile(file: TFile): boolean {
        if (!this.queueService || !isVaultInitialized(this.settings)) {
            return false;
        }

        if (!this.settings.enableAutoSync) {
            return false;
        }

        const filePath = file.path;

        const isExcludedFolder = this.settings.exclusions.excludedFolders.some(
            folder => filePath.startsWith(folder)
        );
        if (isExcludedFolder) return false;

        const isExcludedType = this.settings.exclusions.excludedFileTypes.some(
            ext => filePath.endsWith(ext)
        );
        if (isExcludedType) return false;

        const fileName = file.name;
        const isExcludedPrefix = this.settings.exclusions.excludedFilePrefixes.some(
            prefix => fileName.startsWith(prefix)
        );
        if (isExcludedPrefix) return false;

        return true;
    }

    private async queueFileProcessing(file: TFile, type: 'CREATE' | 'UPDATE' | 'DELETE') {
        try {
            if (!this.queueService) return;

            await this.queueService.addTask({
                id: file.path,
                type: type,
                file: file,
                priority: type === 'DELETE' ? 2 : 1
            });

            if (this.settings.enableNotifications) {
                const action = type.toLowerCase();
                new Notice(`Queued ${action} for processing: ${file.name}`);
            }
        } catch (error) {
            console.error(`Failed to queue ${type} for ${file.path}:`, error);
            if (this.settings.enableNotifications) {
                new Notice(`Failed to queue ${file.name} for processing`);
            }
        }
    }

    private async handleFileRename(file: TFile, oldPath: string) {
        try {
            if (!this.supabaseService) return;

            const chunks = await this.supabaseService.getDocumentChunks(oldPath);
            if (chunks.length > 0) {
                const updatedChunks = chunks.map(chunk => ({
                    ...chunk,
                    metadata: {
                        ...chunk.metadata,
                        obsidianId: file.path,
                        path: file.path
                    }
                }));

                await this.supabaseService.deleteDocumentChunks(oldPath);
                await this.supabaseService.upsertChunks(updatedChunks);

                if (this.settings.enableNotifications) {
                    new Notice(`Updated database entries for renamed file: ${file.name}`);
                }
            }
        } catch (error) {
            console.error(`Failed to handle rename for ${file.path}:`, error);
            if (this.settings.enableNotifications) {
                new Notice(`Failed to update database for renamed file: ${file.name}`);
            }
        }
    }

    private addCommands() {
        this.addCommand({
            id: 'force-sync-current-file',
            name: 'Force sync current file',
            checkCallback: (checking: boolean) => {
                const file = this.app.workspace.getActiveFile();
                if (file) {
                    if (!checking) {
                        this.queueFileProcessing(file, 'UPDATE');
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'force-sync-all-files',
            name: 'Force sync all files',
            callback: async () => {
                const files = this.app.vault.getMarkdownFiles();
                for (const file of files) {
                    if (this.shouldProcessFile(file)) {
                        await this.queueFileProcessing(file, 'UPDATE');
                    }
                }
            }
        });

        this.addCommand({
            id: 'clear-sync-queue',
            name: 'Clear sync queue',
            callback: () => {
                this.queueService?.clear();
                if (this.settings.enableNotifications) {
                    new Notice('Sync queue cleared');
                }
            }
        });
    }
}
