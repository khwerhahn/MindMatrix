// src/main.ts
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
    generateVaultId,
    getAllExclusions,
    SYSTEM_EXCLUSIONS
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
				// Initialize sync detection using new sync file format integration
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
				message: 'Initializing sync manager with updated sync file format...'
			});

			// Initialize sync manager with new sync file parameters
			await this.initializeSyncManager();

			// Start sync process using new sync file architecture
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
				message: 'Checking sync file status with new structure...'
			});

			// Validate sync file state using new architecture
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

			this.statusManager?.setStatus(PluginStatus.INITIALIZING, {
				message: 'Initializing services...'
			});
			await this.initializeServices();

			// Start periodic sync checks using updated parameters
			this.startPeriodicSyncChecks();

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

		// Ensure that a vault ID is defined before creating the sync manager.
		if (!this.settings.vaultId) {
			this.settings.vaultId = generateVaultId();
			await this.saveSettings();
		}

		try {
			// Pass vaultId, deviceId, deviceName, and plugin version to the new SyncFileManager
			this.syncManager = new SyncFileManager(
				this.app.vault,
				this.errorHandler,
				this.settings.sync.syncFilePath,
				this.settings.sync.backupInterval,
				this.settings.vaultId, // Now guaranteed to be defined
				this.settings.sync.deviceId,
				this.settings.sync.deviceName,
				this.manifest.version
			);

			await this.syncManager.initialize();
			console.log('Sync manager initialized successfully with new sync file format');
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

		// Ensure exclusions have the expected structure
		if (!this.settings.exclusions) {
			this.settings.exclusions = { ...DEFAULT_SETTINGS.exclusions };
		}

		// Make sure all properties exist and are arrays
		if (!this.settings.exclusions.excludedFolders) {
			this.settings.exclusions.excludedFolders = [];
		}
		if (!this.settings.exclusions.excludedFileTypes) {
			this.settings.exclusions.excludedFileTypes = [];
		}
		if (!this.settings.exclusions.excludedFilePrefixes) {
			this.settings.exclusions.excludedFilePrefixes = [];
		}
		if (!this.settings.exclusions.excludedFiles) {
			this.settings.exclusions.excludedFiles = [];
		}

		// Ensure system exclusions exist
		if (!this.settings.exclusions.systemExcludedFolders) {
			this.settings.exclusions.systemExcludedFolders = [...SYSTEM_EXCLUSIONS.folders];
		}
		if (!this.settings.exclusions.systemExcludedFileTypes) {
			this.settings.exclusions.systemExcludedFileTypes = [...SYSTEM_EXCLUSIONS.fileTypes];
		}
		if (!this.settings.exclusions.systemExcludedFilePrefixes) {
			this.settings.exclusions.systemExcludedFilePrefixes = [...SYSTEM_EXCLUSIONS.filePrefixes];
		}
		if (!this.settings.exclusions.systemExcludedFiles) {
			this.settings.exclusions.systemExcludedFiles = [...SYSTEM_EXCLUSIONS.files];
		}
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

			// Initialize InitialSyncManager with proper parameters
			if (this.queueService && this.syncManager && this.metadataExtractor) {
				// Pass the combined exclusion settings to InitialSyncManager
				const initialSyncOptions = {
					...this.settings.initialSync,
					syncFilePath: this.settings.sync.syncFilePath,
					exclusions: getAllExclusions(this.settings)
				};

				this.initialSyncManager = new InitialSyncManager(
					this.app.vault,
					this.queueService,
					this.syncManager,
					this.metadataExtractor,
					this.errorHandler,
					this.notificationManager,
					this.supabaseService,
					initialSyncOptions
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
		this.registerEvent(
			this.app.vault.on('create', async (file) => {
				if (!(file instanceof TFile)) return;

				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

				if (!this.shouldProcessFile(file)) return;

				await this.fileTracker?.handleCreate(file);
				await this.queueFileProcessing(file, 'CREATE');
			})
		);

		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (!(file instanceof TFile)) return;

				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

				if (!this.shouldProcessFile(file)) return;

				await this.fileTracker?.handleModify(file);
				await this.queueFileProcessing(file, 'UPDATE');
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', async (file) => {
				if (!(file instanceof TFile)) return;

				if (file.path === this.settings.sync.syncFilePath) {
					console.log('Sync file was deleted, will recreate on next operation');
					return;
				}

				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

				if (!this.shouldProcessFile(file)) return;

				await this.fileTracker?.handleDelete(file);
				await this.queueFileProcessing(file, 'DELETE');
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				if (!(file instanceof TFile)) return;

				if (!await this.ensureSyncFileExists()) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}

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

		// Get combined exclusions (system + user)
		const allExclusions = getAllExclusions(this.settings);

		const filePath = file.path;
		const fileName = file.name;

		// Check if this is the sync file directly
		if (filePath === this.settings.sync.syncFilePath ||
			filePath === this.settings.sync.syncFilePath + '.backup') {
			console.log(`Explicitly skipping sync file: ${filePath}`);
			return false;
		}

		// Check excluded files
		if (Array.isArray(allExclusions.excludedFiles) &&
			allExclusions.excludedFiles.includes(fileName)) {
			console.log('Skipping excluded file:', fileName);
			return false;
		}

		// Check excluded folders
		if (Array.isArray(allExclusions.excludedFolders)) {
			const isExcludedFolder = allExclusions.excludedFolders.some(folder => {
				const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
				return filePath.startsWith(normalizedFolder);
			});
			if (isExcludedFolder) {
				console.log('Skipping file in excluded folder:', filePath);
				return false;
			}
		}

		// Check excluded file types
		if (Array.isArray(allExclusions.excludedFileTypes)) {
			const isExcludedType = allExclusions.excludedFileTypes.some(
				ext => filePath.toLowerCase().endsWith(ext.toLowerCase())
			);
			if (isExcludedType) {
				console.log('Skipping excluded file type:', filePath);
				return false;
			}
		}

		// Check excluded file prefixes
		if (Array.isArray(allExclusions.excludedFilePrefixes)) {
			const isExcludedPrefix = allExclusions.excludedFilePrefixes.some(
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

		this.addCommand({
			id: 'reset-file-tracker',
			name: 'Reset file tracker cache',
			callback: async () => {
				this.fileTracker?.clearQueue();
				await this.fileTracker?.initialize();
				if (this.settings.enableNotifications) {
					new Notice('File tracker cache reset');
				}
			}
		});

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
