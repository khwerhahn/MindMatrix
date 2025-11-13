// src/main.ts
import { Plugin, TFile, Notice } from 'obsidian';
import { SupabaseService } from './services/SupabaseService';
import { EmbeddingService } from './services/EmbeddingService';
import { QueueService } from './services/QueueService';
import { FileTracker } from './utils/FileTracker';
import { ErrorHandler } from './utils/ErrorHandler';
import { NotificationManager } from './utils/NotificationManager';
import { ObsidianRAGSettingsTab } from './settings/SettingsTab';
import { SyncFileManager } from './services/SyncFileManager';
import { InitialSyncManager } from './services/InitialSyncManager';
import { MetadataExtractor } from './services/MetadataExtractor';
import { StatusManager, PluginStatus } from './services/StatusManager';
import { SyncDetectionManager } from './services/SyncDetectionManager';
import { Neo4jService } from './services/Neo4jService';
import { EntityExtractor } from './services/EntityExtractor';
import {
	ObsidianRAGSettings,
	DEFAULT_SETTINGS,
	DEFAULT_OPENAI_SETTINGS,
	DEFAULT_OLLAMA_SETTINGS,
	DEFAULT_NEO4J_SETTINGS,
	DEFAULT_HYBRID_STRATEGY,
	isVaultInitialized,
	generateVaultId,
	getAllExclusions,
	SYSTEM_EXCLUSIONS
} from './settings/Settings';
import { ProcessingTask, TaskType, TaskStatus } from './models/ProcessingTask';

export default class ObsidianRAGPlugin extends Plugin {
	settings: ObsidianRAGSettings;
        private supabaseService: SupabaseService | null = null;
        private embeddingService: EmbeddingService | null = null;
        private queueService: QueueService | null = null;
        private neo4jService: Neo4jService | null = null;
        private entityExtractor: EntityExtractor | null = null;
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
	private eventsRegistered = false;

	async onload() {
		console.log('Loading Obsidian RAG Plugin...');
		try {
			// Initialize status manager first
			this.statusManager = new StatusManager(this.addStatusBarItem());
			this.statusManager.setStatus(PluginStatus.INITIALIZING, {
				message: 'Loading Obsidian RAG Plugin...'
			});

			// Load settings
			await this.loadSettings();

			// Initialize core services and vault if needed
			await this.initializeCoreServices();
			await this.initializeVaultIfNeeded();

			// Initialize FileTracker early to capture events
			this.fileTracker = new FileTracker(
				this.app.vault,
				this.errorHandler!,
				this.settings.sync.syncFilePath
			);

			// Register event handlers immediately to capture all events
			this.registerEventHandlers();

			// Add settings tab
			this.addSettingTab(new ObsidianRAGSettingsTab(this.app, this));

			if (isVaultInitialized(this.settings)) {
				this.statusManager.setStatus(PluginStatus.WAITING_FOR_SYNC, {
					message: 'Waiting for Obsidian sync to settle...'
				});
				// Create and start sync detection with improved logging
				this.syncDetectionManager = new SyncDetectionManager(
					this,
					this.statusManager,
					this.onSyncQuietPeriodReached.bind(this)
				);
				this.syncDetectionManager.startMonitoring();
			} else {
				await this.completeInitialization();
			}
		} catch (error) {
			console.error('Failed to initialize Obsidian RAG Plugin:', error);
			this.statusManager?.setStatus(PluginStatus.ERROR, {
				message: 'Failed to initialize plugin. Check console for details.',
				error: error as Error
			});
		}
	}

	private async onSyncQuietPeriodReached(): Promise<void> {
		try {
			// Stop monitoring as we've reached a quiet period
			this.syncDetectionManager?.stopMonitoring();

			// Check if the vault has already been synced
			if (this.syncManager && this.supabaseService) {
				const syncStatus = await this.syncManager.validateSyncState();
				if (syncStatus.isValid) {
					// Perform a quick integrity check with the database
					const fileCount = await this.supabaseService.getFileCount();
					if (fileCount > 0) {
						console.log('[ObsidianRAG] Database contains files, skipping initial sync');
						await this.completeInitialization();
						return;
					}
				}
			}

			this.statusManager?.setStatus(PluginStatus.CHECKING_FILE, {
				message: 'Initializing sync manager with updated sync file format...'
			});
			// Initialize sync manager
			await this.initializeSyncManager();
			// Start sync process
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
			// Wait for services to be initialized
			await this.initializeServices();

			// Ensure FileTracker is initialized before registering event handlers
			if (!this.fileTracker?.getInitializationStatus()) {
				console.warn('[ObsidianRAG] FileTracker not initialized. Waiting for initialization...');
				await new Promise<void>((resolve) => {
					const checkInterval = setInterval(() => {
						if (this.fileTracker?.getInitializationStatus()) {
							clearInterval(checkInterval);
							resolve();
						}
					}, 100);
					// Timeout after 10 seconds
					setTimeout(() => {
						clearInterval(checkInterval);
						resolve();
					}, 10000);
				});
			}

			// Register commands after services are ready
			this.addCommands();
			
			// Update status to ready
			this.statusManager?.setStatus(PluginStatus.READY, {
				message: 'Obsidian RAG is ready'
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
		console.log('Unloading Obsidian RAG Plugin...');
		// Stop sync detection and clear any intervals/timeouts
		this.syncDetectionManager?.stopMonitoring();
		if (this.initializationTimeout) clearTimeout(this.initializationTimeout);
		if (this.syncCheckInterval) clearInterval(this.syncCheckInterval);
		this.queueService?.stop();
		this.notificationManager?.clear();
		this.initialSyncManager?.stop();
		this.eventsRegistered = false;
	}

	private async startSyncProcess(): Promise<void> {
		if (!this.syncManager) throw new Error('Sync manager not initialized');
		try {
			this.statusManager?.setStatus(PluginStatus.CHECKING_FILE, {
				message: 'Checking sync file status with new structure...'
			});
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
			// Start periodic sync checks
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
		if (!this.errorHandler) throw new Error('Error handler must be initialized before sync manager');
		if (!this.settings.vaultId) {
			this.settings.vaultId = generateVaultId();
			await this.saveSettings();
		}
		try {
			this.syncManager = new SyncFileManager(
				this.app.vault,
				this.errorHandler,
				this.settings.sync.syncFilePath,
				this.settings.sync.backupInterval,
				this.settings.vaultId,
				this.settings.sync.deviceId,
				this.settings.sync.deviceName,
				this.manifest.version
			);
			await this.syncManager.initialize();
			console.log('Sync manager initialized successfully with new sync file format');
		} catch (error) {
			console.error('Failed to initialize sync manager:', error);
			if (this.settings.enableNotifications) new Notice('Failed to initialize sync system. Some features may be unavailable.');
			throw error;
		}
	}

	private async initializeCoreServices(): Promise<void> {
		this.statusManager?.setStatus(PluginStatus.INITIALIZING, { message: 'Initializing core services...' });
		// Initialize error handler
		this.errorHandler = new ErrorHandler(this.settings?.debug ?? DEFAULT_SETTINGS.debug);
		// Initialize notification manager
		this.notificationManager = new NotificationManager(
			this.addStatusBarItem(),
			this.settings?.enableNotifications ?? true,
			this.settings?.enableProgressBar ?? true
		);
		this.statusManager?.setStatus(PluginStatus.INITIALIZING, { message: 'Core services initialized' });
	}

        private async loadSettings() {
                const storedSettings = await this.loadData();
                this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);

                if (!this.settings.neo4j) {
                        this.settings.neo4j = { ...DEFAULT_NEO4J_SETTINGS };
                } else {
                        this.settings.neo4j = { ...DEFAULT_NEO4J_SETTINGS, ...this.settings.neo4j };
                }

                // Ensure embedding settings exist and merge defaults
                if (!this.settings.embeddings) {
                        const legacyOpenAI = storedSettings?.openai || this.settings.openai;
                        this.settings.embeddings = {
                                ollama: { ...DEFAULT_OLLAMA_SETTINGS },
                                openai: {
                                        ...DEFAULT_OPENAI_SETTINGS,
                                        ...(legacyOpenAI || {}),
                                },
                        };
                } else {
                        this.settings.embeddings.ollama = {
                                ...DEFAULT_OLLAMA_SETTINGS,
                                ...(this.settings.embeddings.ollama || {}),
                        };
                        this.settings.embeddings.openai = {
                                ...DEFAULT_OPENAI_SETTINGS,
                                ...(this.settings.embeddings.openai || {}),
                        };
                }

                // Maintain deprecated openai field for backwards compatibility
                this.settings.openai = {
                        ...DEFAULT_OPENAI_SETTINGS,
                        ...(this.settings.openai || {}),
                        ...this.settings.embeddings.openai,
                };
                this.settings.embeddings.openai = { ...this.settings.openai };

                // Ensure exclusions have the expected structure
                if (!this.settings.exclusions) this.settings.exclusions = { ...DEFAULT_SETTINGS.exclusions };
                if (!this.settings.exclusions.excludedFolders) this.settings.exclusions.excludedFolders = [];
                if (!this.settings.exclusions.excludedFileTypes) this.settings.exclusions.excludedFileTypes = [];
                if (!this.settings.exclusions.excludedFilePrefixes) this.settings.exclusions.excludedFilePrefixes = [];
		if (!this.settings.exclusions.excludedFiles) this.settings.exclusions.excludedFiles = [];
		if (!this.settings.exclusions.systemExcludedFolders) this.settings.exclusions.systemExcludedFolders = [...SYSTEM_EXCLUSIONS.folders];
		if (!this.settings.exclusions.systemExcludedFileTypes) this.settings.exclusions.systemExcludedFileTypes = [...SYSTEM_EXCLUSIONS.fileTypes];
		if (!this.settings.exclusions.systemExcludedFilePrefixes) this.settings.exclusions.systemExcludedFilePrefixes = [...SYSTEM_EXCLUSIONS.filePrefixes];
                if (!this.settings.exclusions.systemExcludedFiles) this.settings.exclusions.systemExcludedFiles = [...SYSTEM_EXCLUSIONS.files];

		if (!this.settings.sync.mode) {
			this.settings.sync.mode = 'supabase';
		}

		if (!this.settings.sync.hybridStrategy) {
			this.settings.sync.hybridStrategy = { ...DEFAULT_HYBRID_STRATEGY };
		} else {
			this.settings.sync.hybridStrategy = {
				...DEFAULT_HYBRID_STRATEGY,
				...this.settings.sync.hybridStrategy
			};
		}
}

		async saveSettings() {
			this.settings.openai = { ...this.settings.embeddings.openai };
			await this.saveData(this.settings);
			// Update service settings after saving
			this.notificationManager?.updateSettings(this.settings.enableNotifications, this.settings.enableProgressBar);
			this.errorHandler?.updateSettings(this.settings.debug);
			this.embeddingService?.updateSettings(this.settings.embeddings);
			this.entityExtractor?.updateSettings(this.settings.embeddings, this.settings.neo4j.projectName);
			this.queueService?.updateHybridPreferences(this.settings.sync.hybridStrategy, this.settings.sync.mode);
			if (isVaultInitialized(this.settings)) await this.initializeServices();
		}

		private startPeriodicSyncChecks(): void {
		if (this.syncCheckInterval) clearInterval(this.syncCheckInterval);
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
				if (this.settings.enableNotifications) new Notice(`Sync issue detected: ${syncStatus.error}`);
				const recovered = await this.syncManager.attemptRecovery();
				if (!recovered && this.settings.sync.requireSync) await this.restartServices();
			}
			await this.syncManager.updateLastSync();
		} catch (error) {
			this.errorHandler?.handleError(error, { context: 'performSyncCheck', metadata: { timestamp: Date.now() } });
		}
	}

	private async restartServices(): Promise<void> {
		this.queueService?.stop();
		if (this.syncCheckInterval) clearInterval(this.syncCheckInterval);
		try {
			await this.initializeSyncManager();
			await this.startSyncProcess();
		} catch (error) {
			console.error('Failed to restart services:', error);
			if (this.settings.enableNotifications) new Notice('Failed to restart services after sync error');
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
				if (this.settings.enableNotifications) new Notice('Vault initialized with new ID');
			} else if (this.settings.lastKnownVaultName !== this.app.vault.getName()) {
				this.settings.lastKnownVaultName = this.app.vault.getName();
				await this.saveSettings();
			}
		} finally {
			this.isInitializing = false;
		}
	}

        private async initializeServices(): Promise<void> {
                console.log('[ObsidianRAG] Initializing services...', {
                        hasVault: !!this.app.vault,
                        hasErrorHandler: !!this.errorHandler
                });

                if (!this.errorHandler) {
                        throw new Error('Error handler must be initialized before services');
                }

                const useSupabase = this.shouldUseSupabase();
                const useNeo4j = this.shouldUseNeo4j();

                try {
                        if (useSupabase) {
                                this.supabaseService = await SupabaseService.getInstance(this.settings);
                                if (!this.supabaseService) {
                                        throw new Error('Failed to initialize Supabase service');
                                }
                                console.log('[ObsidianRAG] Supabase service initialized.');
                        } else {
                                this.supabaseService = null;
                        }

                        if (useNeo4j) {
                                this.neo4jService = await Neo4jService.getInstance(this.settings);
                                if (!this.neo4jService) {
                                        throw new Error('Failed to initialize Neo4j service');
                                }
                                console.log('[ObsidianRAG] Neo4j service initialized.');
                        } else {
                                this.neo4jService = null;
                        }

                        this.embeddingService = useSupabase
                                ? new EmbeddingService(this.settings.embeddings, this.errorHandler)
                                : null;
                        if (this.embeddingService) {
                                console.log('[ObsidianRAG] Embedding service initialized.');
                        }

                        this.entityExtractor = useNeo4j
                                ? new EntityExtractor(this.settings.embeddings, this.errorHandler, this.settings.neo4j.projectName)
                                : null;

                        const notificationManager = this.notificationManager || new NotificationManager(
                                this.addStatusBarItem(),
                                this.settings.enableNotifications,
                                this.settings.enableProgressBar
                        );

			this.queueService = new QueueService(
				this.settings.queue.maxConcurrent,
				this.settings.queue.retryAttempts,
				this.supabaseService,
				this.embeddingService,
				this.errorHandler,
				notificationManager,
				this.app.vault,
				this.settings.chunking,
				{
					vectorSyncEnabled: useSupabase,
					graphSyncEnabled: useNeo4j,
					neo4jService: this.neo4jService,
					entityExtractor: this.entityExtractor,
					hybridStrategy: this.settings.sync.hybridStrategy,
					syncMode: this.settings.sync.mode,
				}
			);
                        await this.queueService.start();
                        console.log('[ObsidianRAG] Queue service initialized and started.');

                        // Initialize FileTracker
                        this.fileTracker = new FileTracker(
                                this.app.vault,
                                this.errorHandler,
                                this.settings.sync.syncFilePath,
                                this.supabaseService
                        );
                        await this.fileTracker.initialize(this.settings, this.supabaseService, this.queueService);
                        console.log('[ObsidianRAG] FileTracker initialized.');

			// Initialize MetadataExtractor
			this.metadataExtractor = new MetadataExtractor(this.app.vault, this.errorHandler);
			console.log('[ObsidianRAG] MetadataExtractor initialized.');

			// Initialize InitialSyncManager
			if (!this.syncManager) {
				throw new Error('SyncManager must be initialized before InitialSyncManager');
			}
			if (!this.queueService) {
				throw new Error('QueueService must be initialized before InitialSyncManager');
			}
			if (!this.metadataExtractor) {
				throw new Error('MetadataExtractor must be initialized before InitialSyncManager');
			}
			if (!this.errorHandler) {
				throw new Error('ErrorHandler must be initialized before InitialSyncManager');
			}
			if (!this.notificationManager) {
				throw new Error('NotificationManager must be initialized before InitialSyncManager');
			}
                        this.initialSyncManager = new InitialSyncManager(
                                this.app.vault,
                                this.queueService,
                                this.embeddingService,
                                this.syncManager,
                                this.metadataExtractor,
                                this.errorHandler,
                                this.notificationManager,
                                this.supabaseService,
				{
					batchSize: this.settings.initialSync.batchSize || 50,
					maxConcurrentBatches: this.settings.initialSync.maxConcurrentBatches || 3,
					enableAutoInitialSync: this.settings.initialSync.enableAutoInitialSync,
					priorityRules: this.settings.initialSync.priorityRules || [],
					syncFilePath: this.settings.sync.syncFilePath,
					exclusions: {
						excludedFolders: this.settings.exclusions.excludedFolders || [],
						excludedFileTypes: this.settings.exclusions.excludedFileTypes || [],
						excludedFilePrefixes: this.settings.exclusions.excludedFilePrefixes || [],
						excludedFiles: this.settings.exclusions.excludedFiles || []
					}
				}
			);
			console.log('[ObsidianRAG] InitialSyncManager initialized.');
		} catch (error) {
			console.error('[ObsidianRAG] Error initializing services:', error);
			this.errorHandler.handleError(error, { context: 'ObsidianRAGPlugin.initializeServices' });
			throw error;
		}
	}

	private checkRequiredConfigurations(): void {
                const hasOllama = this.settings.embeddings?.ollama?.enabled;
                const hasOpenAIApiKey = !!this.settings.embeddings?.openai?.apiKey;
                const shouldFallbackToOpenAI = this.settings.embeddings?.ollama?.fallbackToOpenAI;

                if (!hasOllama && !hasOpenAIApiKey) {
                        new Notice('No embedding provider configured. Enable Ollama or provide an OpenAI API key.');
                } else if (shouldFallbackToOpenAI && !hasOpenAIApiKey) {
                        new Notice('OpenAI fallback is enabled but the API key is missing. Configure it in the settings.');
                }
                const requiresSupabase = this.shouldUseSupabase();
                const requiresNeo4j = this.shouldUseNeo4j();
                if (requiresSupabase && (!this.settings.supabase.url || !this.settings.supabase.apiKey)) {
                        new Notice('Supabase configuration is incomplete. Database features are disabled. Configure it in the settings.');
                }
                if (requiresNeo4j && (!this.settings.neo4j.url || !this.settings.neo4j.username || !this.settings.neo4j.password)) {
                        new Notice('Neo4j configuration is incomplete. Graph features are disabled until credentials are provided.');
                }
        }

	private registerEventHandlers() {
		if (this.eventsRegistered) {
			console.log('[ObsidianRAG] Event handlers already registered, skipping.');
			return;
		}
		this.eventsRegistered = true;
		// Enhanced file event handlers with improved debouncing and logging

		this.registerEvent(
			this.app.vault.on('create', async (file) => {
				if (!(file instanceof TFile)) return;
				if (!(await this.ensureSyncFileExists())) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}
				if (!this.shouldProcessFile(file)) return;
				console.log(`File created: ${file.path}`);
				await this.fileTracker?.handleCreate(file);
				await this.queueFileProcessing(file, TaskType.CREATE);
			})
		);

		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (!(file instanceof TFile)) return;
				if (!(await this.ensureSyncFileExists())) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}
				if (!this.shouldProcessFile(file)) return;
				console.log(`File modified: ${file.path}`);
				// Enhanced debouncing is handled in FileTracker.handleModify
				await this.fileTracker?.handleModify(file);
				await this.queueFileProcessing(file, TaskType.UPDATE);
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', async (file) => {
				if (!(file instanceof TFile)) return;
				if (file.path === this.settings.sync.syncFilePath) {
					console.log('Sync file was deleted, will recreate on next operation');
					return;
				}
				if (!(await this.ensureSyncFileExists())) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}
				if (!this.shouldProcessFile(file)) return;
				console.log(`File deleted: ${file.path}`);
				await this.fileTracker?.handleDelete(file);
				await this.queueFileProcessing(file, TaskType.DELETE);
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', async (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				if (!(await this.ensureSyncFileExists())) {
					new Notice('Failed to create sync file. Plugin functionality limited.');
					return;
				}
				if (!this.shouldProcessFile(file)) return;
				console.log(`File renamed from ${oldPath} to ${file.path}`);
				await this.fileTracker?.handleRename(file, oldPath);
			})
		);
	}

        private shouldProcessFile(file: TFile): boolean {
                if (!this.queueService || !isVaultInitialized(this.settings)) return false;
                if (!this.settings.enableAutoSync) return false;

		const allExclusions = getAllExclusions(this.settings);
		const filePath = file.path;
		const fileName = file.name;

		if (filePath === this.settings.sync.syncFilePath || filePath === this.settings.sync.syncFilePath + '.backup') {
			console.log(`Skipping sync file: ${filePath}`);
			return false;
		}
		if (Array.isArray(allExclusions.excludedFiles) && allExclusions.excludedFiles.includes(fileName)) {
			console.log('Skipping excluded file:', fileName);
			return false;
		}
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
		if (Array.isArray(allExclusions.excludedFileTypes)) {
			const isExcludedType = allExclusions.excludedFileTypes.some(ext => filePath.toLowerCase().endsWith(ext.toLowerCase()));
			if (isExcludedType) {
				console.log('Skipping excluded file type:', filePath);
				return false;
			}
		}
		if (Array.isArray(allExclusions.excludedFilePrefixes)) {
			const isExcludedPrefix = allExclusions.excludedFilePrefixes.some(prefix => fileName.startsWith(prefix));
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

        private async queueFileProcessing(file: TFile, type: TaskType.CREATE | TaskType.UPDATE | TaskType.DELETE): Promise<void> {
		try {
			if (!this.queueService || !this.fileTracker) {
				console.error('Required services not initialized:', { queueService: !!this.queueService, fileTracker: !!this.fileTracker });
				return;
			}
			console.log('Queueing file processing:', { fileName: file.name, type, path: file.path });
			const metadata = await this.fileTracker.createFileMetadata(file);
			console.log('Created metadata:', metadata);
			const task: ProcessingTask = {
				id: file.path,
				type: type,
				priority: type === TaskType.DELETE ? 2 : 1,
				maxRetries: this.settings.queue.retryAttempts,
				retryCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				status: TaskStatus.PENDING,
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
			this.errorHandler?.handleError(error, { context: 'queueFileProcessing', metadata: { filePath: file.path, type } });
			if (this.settings.enableNotifications) {
				new Notice(`Failed to queue ${file.name} for processing`);
        }

        private shouldUseSupabase(): boolean {
                const mode = this.settings.sync.mode || 'supabase';
                return mode === 'supabase' || mode === 'hybrid';
        }

        private shouldUseNeo4j(): boolean {
                const mode = this.settings.sync.mode || 'supabase';
                return mode === 'neo4j' || mode === 'hybrid';
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
						this.queueFileProcessing(file, TaskType.UPDATE);
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
						await this.queueFileProcessing(file, TaskType.UPDATE);
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
				if (this.fileTracker && this.settings && this.supabaseService && this.queueService) {
					await this.fileTracker.initialize(this.settings, this.supabaseService, this.queueService);
				}
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
