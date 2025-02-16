import { Plugin, TFile, Notice } from 'obsidian';
import { SupabaseService } from './services/SupabaseService';
import { OpenAIService } from './services/OpenAIService';
import { QueueService } from './services/QueueService';
import { FileTracker } from './utils/FileTracker';
import { ErrorHandler } from './utils/ErrorHandler';
import { NotificationManager } from './utils/NotificationManager';
import { MindMatrixSettingsTab } from './settings/SettingsTab';
import { SyncFileManager } from './services/SyncFileManager';
import { InitialSyncManager } from './services/InitialSyncManager';
import { MetadataExtractor } from './services/MetadataExtractor';
import { StatusManager, PluginStatus } from './services/StatusManager';
import { SyncDetectionManager } from './services/SyncDetectionManager';

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
	private syncManager: SyncFileManager | null = null;
	private syncCheckInterval: NodeJS.Timeout | null = null;
	private initializationTimeout: NodeJS.Timeout | null = null;
	private syncCheckAttempts = 0;
	private initialSyncManager: InitialSyncManager | null = null;
	private metadataExtractor: MetadataExtractor | null = null;
	private statusManager: StatusManager | null = null;
	private syncDetectionManager: SyncDetectionManager | null = null;

	async onload() {
		console.log('Loading Mind Matrix Plugin...');

		try {
			// Initialize status manager first
			this.statusManager = new StatusManager(this.addStatusBarItem());
			this.statusManager.setStatus(PluginStatus.INITIALIZING, {
				message: 'Loading Mind Matrix Plugin...'
			});

			// Load settings
			await this.loadSettings();

			// Initialize core services
			await this.initializeCoreServices();

			// Initialize vault if needed
			await this.initializeVaultIfNeeded();

			// Add settings tab
			this.addSettingTab(new MindMatrixSettingsTab(this.app, this));

			if (isVaultInitialized(this.settings)) {
				// Initialize sync detection
				this.statusManager.setStatus(PluginStatus.WAITING_FOR_SYNC, {
					message: 'Waiting for Obsidian sync to settle...'
				});

				// Create and start sync detection
				this.syncDetectionManager = new SyncDetectionManager(
					this,
					this.statusManager,
					this.onSyncQuietPeriodReached.bind(this)
				);
				this.syncDetectionManager.startMonitoring();
			} else {
				// If vault isn't initialized, proceed normally
				await this.completeInitialization();
			}

		} catch (error) {
			console.error('Failed to initialize Mind Matrix Plugin:', error);
			this.statusManager?.setStatus(PluginStatus.ERROR, {
				message: 'Failed to initialize plugin. Check console for details.',
				error: error as Error
			});
		}
	}

	private async onSyncQuietPeriodReached(): Promise<void> {
		try {
			// Stop monitoring as we've reached quiet period
			this.syncDetectionManager?.stopMonitoring();

			this.statusManager?.setStatus(PluginStatus.CHECKING_FILE, {
				message: 'Initializing sync manager...'
			});

			// Initialize sync manager
			await this.initializeSyncManager();
			await this.startSyncProcess();

			// Complete remaining initialization
			await this.completeInitialization();

		} catch (error) {
			console.error('Error during quiet period initialization:', error);
			this.statusManager?.setStatus(PluginStatus.ERROR, {
				message: 'Failed to initialize after sync quiet period',
				error: error as Error
			});
		}
	}

	private async completeInitialization(): Promise<void> {
		try {
			// Register event handlers and commands
			this.registerEventHandlers();
			this.addCommands();

			// Update status to ready
			this.statusManager?.setStatus(PluginStatus.READY, {
				message: 'Mind Matrix is ready'
			});
		} catch (error) {
			console.error('Error completing initialization:', error);
			this.statusManager?.setStatus(PluginStatus.ERROR, {
				message: 'Failed to complete initialization',
				error: error as Error
			});
		}
	}

	async onunload() {
		console.log('Unloading Mind Matrix Plugin...');

		// Stop sync detection
		this.syncDetectionManager?.stopMonitoring();

		if (this.initializationTimeout) {
			clearTimeout(this.initializationTimeout);
		}
		if (this.syncCheckInterval) {
			clearInterval(this.syncCheckInterval);
		}

		this.queueService?.stop();
		this.notificationManager?.clear();
		this.initialSyncManager?.stop();
	}

	private async startSyncProcess(): Promise<void> {
		if (!this.syncManager) {
			throw new Error('Sync manager not initialized');
		}

		try {
			this.statusManager?.setStatus(PluginStatus.CHECKING_FILE, {
				message: 'Checking sync file status...'
			});

			// Initial sync check
			const syncStatus = await this.syncManager.validateSyncState();

			if (!syncStatus.isValid) {
				if (this.settings.sync.requireSync) {
					this.statusManager?.setStatus(PluginStatus.ERROR, {
						message: `Sync validation failed: ${syncStatus.error}`
					});
					throw new Error(`Sync validation failed: ${syncStatus.error}`);
				} else {
					console.warn(`Sync validation warning: ${syncStatus.error}`);
					new Notice(`Sync warning: ${syncStatus.error}`);
				}
			}

			// Initialize remaining services
			this.statusManager?.setStatus(PluginStatus.INITIALIZING, {
				message: 'Initializing services...'
			});
			await this.initializeServices();

			// Start periodic sync checks
			this.startPeriodicSyncChecks();

			// Start initial sync if enabled
			if (this.settings.initialSync.enableAutoInitialSync && this.initialSyncManager) {
				this.statusManager?.setStatus(PluginStatus.INITIALIZING, {
					message: 'Starting initial vault sync...'
				});
				await this.initialSyncManager.startSync();
			}

			this.statusManager?.setStatus(PluginStatus.READY, {
				message: 'Sync process completed'
			});

		} catch (error) {
			if (this.settings.sync.requireSync) {
				this.statusManager?.setStatus(PluginStatus.ERROR, {
					message: 'Sync process failed',
					error: error as Error
				});
				throw error;
			} else {
				console.error('Sync process error:', error);
				new Notice('Sync process error. Continuing with limited functionality.');
				await this.initializeServices();
			}
		}
	}


	private async initializeSyncManager(): Promise<void> {
		if (!this.errorHandler) {
			throw new Error('Error handler must be initialized before sync manager');
		}

		try {
			this.syncManager = new SyncFileManager(
				this.app.vault,
				this.errorHandler,
				this.settings.sync.syncFilePath,
				this.settings.sync.backupInterval
			);

			await this.syncManager.initialize();
			console.log('Sync manager initialized successfully');

		} catch (error) {
			console.error('Failed to initialize sync manager:', error);
			if (this.settings.enableNotifications) {
				new Notice('Failed to initialize sync system. Some features may be unavailable.');
			}
			throw error;
		}
	}

	private async initializeCoreServices(): Promise<void> {
		this.statusManager?.setStatus(PluginStatus.INITIALIZING, {
			message: 'Initializing core services...'
		});

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

		this.statusManager?.setStatus(PluginStatus.INITIALIZING, {
			message: 'Core services initialized'
		});
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

	private startPeriodicSyncChecks(): void {
		if (this.syncCheckInterval) {
			clearInterval(this.syncCheckInterval);
		}

		this.syncCheckInterval = setInterval(async () => {
			await this.performSyncCheck();
		}, this.settings.sync.checkInterval);
	}

	private async performSyncCheck(): Promise<void> {
		if (!this.syncManager) return;

		try {
			const syncStatus = await this.syncManager.validateSyncState();

			if (!syncStatus.isValid) {
				console.warn(`Sync check failed: ${syncStatus.error}`);

				if (this.settings.enableNotifications) {
					new Notice(`Sync issue detected: ${syncStatus.error}`);
				}

				// Attempt recovery
				const recovered = await this.syncManager.attemptRecovery();
				if (!recovered && this.settings.sync.requireSync) {
					// If recovery failed and sync is required, restart services
					await this.restartServices();
				}
			}

			// Update last sync timestamp
			await this.syncManager.updateLastSync();

		} catch (error) {
			this.errorHandler?.handleError(error, {
				context: 'performSyncCheck',
				metadata: { timestamp: Date.now() }
			});
		}
	}

	private async restartServices(): Promise<void> {
		// Stop existing services
		this.queueService?.stop();

		// Clear intervals
		if (this.syncCheckInterval) {
			clearInterval(this.syncCheckInterval);
		}

		try {
			// Reinitialize everything
			await this.initializeSyncManager();
			await this.startSyncProcess();
		} catch (error) {
			console.error('Failed to restart services:', error);
			if (this.settings.enableNotifications) {
				new Notice('Failed to restart services after sync error');
			}
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
			this.fileTracker = new FileTracker(this.app.vault, this.errorHandler, this.settings.sync.syncFilePath);
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

			this.metadataExtractor = new MetadataExtractor();
			console.log('MetadataExtractor initialized.');

			// Initialize InitialSyncManager
			if (this.queueService && this.syncManager && this.metadataExtractor) {
				this.initialSyncManager = new InitialSyncManager(
					this.app.vault,
					this.queueService,
					this.syncManager,
					this.metadataExtractor,
					this.errorHandler,
					this.notificationManager,
					this.settings.initialSync
				);
				console.log('InitialSyncManager initialized.');
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

				// Ensure sync file exists before processing
				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

				if (!this.shouldProcessFile(file)) return;

				await this.fileTracker?.handleCreate(file);
				await this.queueFileProcessing(file, 'CREATE');
			}));

		// File modification events
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (!(file instanceof TFile)) return;

				// Ensure sync file exists before processing
				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

				if (!this.shouldProcessFile(file)) return;

				await this.fileTracker?.handleModify(file);
				await this.queueFileProcessing(file, 'UPDATE');
			}));

		// File deletion events
		this.registerEvent(
			this.app.vault.on('delete', async (file) => {
				if (!(file instanceof TFile)) return;

				// Special handling for sync file deletion
				if (file.path === this.settings.sync.syncFilePath) {
					console.log('Sync file was deleted, will recreate on next operation');
					return;
				}

				// Ensure sync file exists before processing
				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

				if (!this.shouldProcessFile(file)) return;

				await this.fileTracker?.handleDelete(file);
				await this.queueFileProcessing(file, 'DELETE');
			}));

		// File rename events
		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				if (!(file instanceof TFile)) return;

				// Ensure sync file exists before processing
				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

				if (!this.shouldProcessFile(file)) return;

				await this.fileTracker?.handleRename(file, oldPath);
				await this.handleFileRename(file, oldPath);
			}));
	}

	private shouldProcessFile(file: TFile): boolean {
		// First check if basic requirements are met
		if (!this.queueService || !isVaultInitialized(this.settings)) {
			return false;
		}

		if (!this.settings.enableAutoSync) {
			return false;
		}

		// Ensure exclusions settings exist with fallbacks
		const exclusions = this.settings.exclusions || {
			excludedFiles: [],
			excludedFolders: [],
			excludedFileTypes: [],
			excludedFilePrefixes: []
		};

		const filePath = file.path;
		const fileName = file.name;

		// Check specific excluded files
		if (Array.isArray(exclusions.excludedFiles) &&
			exclusions.excludedFiles.includes(fileName)) {
			console.log('Skipping excluded file:', fileName);
			return false;
		}

		// Check excluded folders
		if (Array.isArray(exclusions.excludedFolders)) {
			const isExcludedFolder = exclusions.excludedFolders.some(folder => {
				const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
				return filePath.startsWith(normalizedFolder);
			});
			if (isExcludedFolder) {
				console.log('Skipping file in excluded folder:', filePath);
				return false;
			}
		}

		// Check excluded file types
		if (Array.isArray(exclusions.excludedFileTypes)) {
			const isExcludedType = exclusions.excludedFileTypes.some(
				ext => filePath.toLowerCase().endsWith(ext.toLowerCase())
			);
			if (isExcludedType) {
				console.log('Skipping excluded file type:', filePath);
				return false;
			}
		}

		// Check excluded file prefixes
		if (Array.isArray(exclusions.excludedFilePrefixes)) {
			const isExcludedPrefix = exclusions.excludedFilePrefixes.some(
				prefix => fileName.startsWith(prefix)
			);
			if (isExcludedPrefix) {
				console.log('Skipping file with excluded prefix:', fileName);
				return false;
			}
		}

		return true;
	}

	private async ensureSyncFileExists(): Promise<boolean> {
		if (!this.syncManager) {
			console.error('Sync manager not initialized');
			return false;
		}

		try {
			const syncFile = this.app.vault.getAbstractFileByPath(this.settings.sync.syncFilePath);
			if (!syncFile) {
				console.log('Sync file missing, recreating...');
				await this.syncManager.initialize();
				new Notice('Recreated sync file');
				return true;
			}
			return true;
		} catch (error) {
			console.error('Error ensuring sync file exists:', error);
			return false;
		}
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

		// Start initial sync
		this.addCommand({
			id: 'start-initial-sync',
			name: 'Start initial vault sync',
			callback: async () => {
				if (this.initialSyncManager) {
					await this.initialSyncManager.startSync();
				} else {
					new Notice('Initial sync manager not initialized');
				}
			}
		});

		// Stop initial sync
		this.addCommand({
			id: 'stop-initial-sync',
			name: 'Stop initial vault sync',
			callback: () => {
				this.initialSyncManager?.stop();
				new Notice('Initial sync stopped');
			}
		});
	}
}
