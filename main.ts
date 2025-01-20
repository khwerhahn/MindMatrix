import { Plugin, TFile, Notice } from 'obsidian';
import { SupabaseService } from './services/SupabaseService';
import { OpenAIService } from './services/OpenAIService';
import { QueueService } from './services/QueueService';
import { FileTracker } from './utils/FileTracker';
import { ErrorHandler } from './utils/ErrorHandler';
import { NotificationManager } from './utils/NotificationManager';
import { MindMatrixSettingsTab } from './settings/SettingsTab';
import {
    MindMatrixSettings,
    DEFAULT_SETTINGS,
    isVaultInitialized,
    generateVaultId
} from './settings/Settings';

export default class MindMatrixPlugin extends Plugin {
    settings: MindMatrixSettings;
    private supabaseService: SupabaseService | null = null;
    private openAIService: OpenAIService | null = null;
    private queueService: QueueService | null = null;
    private fileTracker: FileTracker | null = null;
    private errorHandler: ErrorHandler | null = null;
    private notificationManager: NotificationManager | null = null;
    private isInitializing = false;

    async onload() {
        console.log('Loading Mind Matrix Plugin...');

        try {
            // Initialize core services
            await this.initializeCoreServices();

            // Load and initialize settings
            await this.loadSettings();
            await this.initializeVaultIfNeeded();

            // Add settings tab
            this.addSettingTab(new MindMatrixSettingsTab(this.app, this));

            // Initialize remaining services if vault is ready
            if (isVaultInitialized(this.settings)) {
                await this.initializeServices();
            }

            // Check and notify about missing configurations
            this.checkRequiredConfigurations();

            // Register event handlers and commands
            this.registerEventHandlers();
            this.addCommands();

        } catch (error) {
            console.error('Failed to initialize Mind Matrix Plugin:', error);
            new Notice('Mind Matrix Plugin failed to initialize. Check the console for details.');
        }
    }

    async onunload() {
        console.log('Unloading Mind Matrix Plugin...');
        this.queueService?.stop();
        this.notificationManager?.clear();
    }

    private async initializeCoreServices(): Promise<void> {
        // Initialize error handler
        this.errorHandler = new ErrorHandler(
            this.settings?.debug ?? DEFAULT_SETTINGS.debug,
            this.app.vault.adapter.getBasePath()
        );

        // Initialize notification manager
        this.notificationManager = new NotificationManager(
            this.addStatusBarItem(),
            this.settings?.enableNotifications ?? true,
            this.settings?.enableProgressBar ?? true
        );
    }

    private async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);

        // Update service settings
        this.notificationManager?.updateSettings(
            this.settings.enableNotifications,
            this.settings.enableProgressBar
        );
        this.errorHandler?.updateSettings(this.settings.debug);

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

                if (this.settings.enableNotifications) {
                    new Notice('Vault initialized with new ID');
                }
            } else if (this.settings.lastKnownVaultName !== this.app.vault.getName()) {
                this.settings.lastKnownVaultName = this.app.vault.getName();
                await this.saveSettings();
            }
        } finally {
            this.isInitializing = false;
        }
    }

    private async initializeServices() {
        console.log('Initializing services...', {
            hasVault: !!this.app.vault,
            hasErrorHandler: !!this.errorHandler
        });

        if (!this.errorHandler) {
            throw new Error('Core services not initialized');
        }

        try {
            // Initialize FileTracker
            this.fileTracker = new FileTracker(this.app.vault, this.errorHandler);
            await this.fileTracker.initialize();
            console.log('FileTracker initialized.');

            // Initialize Supabase service
            try {
                this.supabaseService = await SupabaseService.getInstance(this.settings);
                if (!this.supabaseService) {
                    new Notice('Supabase service not initialized. Please configure your API settings.');
                    console.error('Supabase service initialization failed: Missing configuration.');
                    return;
                }
                console.log('Supabase service initialized.');
            } catch (error) {
                console.error('Supabase initialization error:', error);
                new Notice(`Failed to initialize Supabase service: ${error.message}`);
                return;
            }

            // Initialize OpenAI service
            this.openAIService = new OpenAIService(this.settings.openai, this.errorHandler);
            console.log('OpenAI service initialized.');

            // Verify vault access
            if (!this.app.vault) {
                throw new Error('Vault is not available');
            }

            // Initialize queue service
            if (this.notificationManager && this.supabaseService && this.openAIService) {
                try {
                    this.queueService = new QueueService(
                        this.settings.queue.maxConcurrent,
                        this.settings.queue.retryAttempts,
                        this.supabaseService,
                        this.openAIService,
                        this.errorHandler,
                        this.notificationManager,
                        this.app.vault,
                        this.settings.chunking
                    );

                    // Start the queue service
                    this.queueService.start();
                    console.log('Queue service initialized and started.');
                } catch (error) {
                    console.error('Failed to initialize QueueService:', error);
                    new Notice(`Failed to initialize queue service: ${error.message}`);
                    throw error;
                }
            } else {
                throw new Error('Required services not available for QueueService initialization');
            }
        } catch (error) {
            console.error('Failed to initialize services:', error);
            throw error;
        }
    }

    private checkRequiredConfigurations(): void {
        if (!this.settings.openai.apiKey) {
            new Notice('OpenAI API key is missing. AI features are disabled. Configure it in the settings.');
        }

        if (!this.settings.supabase.url || !this.settings.supabase.apiKey) {
            new Notice('Supabase configuration is incomplete. Database features are disabled. Configure it in the settings.');
        }
    }

    private registerEventHandlers() {
        // File creation events
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;

                await this.fileTracker?.handleCreate(file);
                await this.queueFileProcessing(file, 'CREATE');
            })
        );

        // File modification events
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;

                await this.fileTracker?.handleModify(file);
                await this.queueFileProcessing(file, 'UPDATE');
            })
        );

        // File deletion events
        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;

                await this.fileTracker?.handleDelete(file);
                await this.queueFileProcessing(file, 'DELETE');
            })
        );

        // File rename events
        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (!(file instanceof TFile)) return;
                if (!this.shouldProcessFile(file)) return;

                await this.fileTracker?.handleRename(file, oldPath);
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

        // Check excluded file prefixes
        const fileName = file.name;
        const isExcludedPrefix = this.settings.exclusions.excludedFilePrefixes.some(
            prefix => fileName.startsWith(prefix)
        );
        if (isExcludedPrefix) return false;

        return true;
    }

    private async queueFileProcessing(file: TFile, type: 'CREATE' | 'UPDATE' | 'DELETE') {
        try {
            if (!this.queueService || !this.fileTracker) {
                console.error('Required services not initialized:', {
                    queueService: !!this.queueService,
                    fileTracker: !!this.fileTracker
                });
                return;
            }

            console.log('Starting file processing:', {
                fileName: file.name,
                type: type,
                path: file.path
            });

            const metadata = await this.fileTracker.createFileMetadata(file);
            console.log('Created metadata:', metadata);

            const task = {
                id: file.path,
                type: type,
                priority: type === 'DELETE' ? 2 : 1,
                maxRetries: this.settings.queue.retryAttempts,
                retryCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                status: 'PENDING',
                metadata,
                data: {}
            };

            console.log('Created task:', task);
            await this.queueService.addTask(task);
            console.log('Task added to queue');

            if (this.settings.enableNotifications) {
                const action = type.toLowerCase();
                new Notice(`Queued ${action} for processing: ${file.name}`);
            }
        } catch (error) {
            console.error('Error in queueFileProcessing:', error);
            this.errorHandler?.handleError(error, {
                context: 'queueFileProcessing',
                metadata: { filePath: file.path, type }
            });

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
            this.errorHandler?.handleError(error, {
                context: 'handleFileRename',
                metadata: { filePath: file.path, oldPath }
            });

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

        // Clear sync queue
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

        // Reset file tracker cache
        this.addCommand({
            id: 'reset-file-tracker',
            name: 'Reset file tracker cache',
            callback: async () => {
                this.fileTracker?.clearCache();
                await this.fileTracker?.initialize();
                if (this.settings.enableNotifications) {
                    new Notice('File tracker cache reset');
                }
            }
        });
    }
}
