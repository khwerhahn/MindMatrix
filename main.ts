import { Plugin, TFile } from 'obsidian';
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
        // Load settings
        await this.loadSettings();

        // Initialize vault if needed
        await this.initializeVaultIfNeeded();

        // Add settings tab
        this.addSettingTab(new MindMatrixSettingsTab(this.app, this));

        // Initialize services if vault is ready
        if (isVaultInitialized(this.settings)) {
            await this.initializeServices();
        }

        // Register event handlers
        this.registerEventHandlers();

        // Add commands
        this.addCommands();
    }

    async onunload() {
        // Cleanup
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
                // Generate new vault ID
                this.settings.vaultId = generateVaultId();
                this.settings.lastKnownVaultName = this.app.vault.getName();
                await this.saveSettings();
            } else if (this.settings.lastKnownVaultName !== this.app.vault.getName()) {
                // Vault name has changed, update it
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

            // Initialize OpenAI service
            this.openAIService = new OpenAIService(this.settings.openai.apiKey);

            // Initialize queue service
            this.queueService = new QueueService(
                this.settings.queue.maxConcurrent,
                this.settings.queue.retryAttempts,
                this.supabaseService,
                this.openAIService
            );

            // Start queue processing
            this.queueService.start();

        } catch (error) {
            console.error('Failed to initialize services:', error);
            throw error;
        }
    }

    private registerEventHandlers() {
        // File created
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.queueFileProcessing(file, 'CREATE');
            })
        );

        // File modified
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.queueFileProcessing(file, 'UPDATE');
            })
        );

        // File deleted
        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.queueFileProcessing(file, 'DELETE');
            })
        );

        // File renamed
        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;
                await this.handleFileRename(file, oldPath);
            })
        );
    }

    private shouldProcessFile(file: TFile): boolean {
        // Check if services are initialized
        if (!this.queueService || !isVaultInitialized(this.settings)) {
            return false;
        }

        // Check if auto-sync is enabled
        if (!this.settings.enableAutoSync) {
            return false;
        }

        // Check exclusions
        const filePath = file.path;

        // Check excluded folders
        const isExcludedFolder = this.settings.exclusions.excludedFolders.some(
            folder => filePath.startsWith(folder)
        );
        if (isExcludedFolder) return false;

        // Check excluded file types
        const isExcludedType = this.settings.exclusions.excludedFileTypes.some(
            ext => filePath.endsWith(ext)
        );
        if (isExcludedType) return false;

        // Check excluded prefixes
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

            // Update the file path in existing chunks
            const chunks = await this.supabaseService.getDocumentChunks(oldPath);
            if (chunks.length > 0) {
                // Update metadata with new path
                const updatedChunks = chunks.map(chunk => ({
                    ...chunk,
                    metadata: {
                        ...chunk.metadata,
                        obsidianId: file.path,
                        path: file.path
                    }
                }));

                // Delete old chunks and insert updated ones
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
        // Force sync current file
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

        // Force sync all files
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

        // Clear queue
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
