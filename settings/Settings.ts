/**
 * Configuration options for chunking text
 */
export interface ChunkSettings {
	chunkSize: number;       // Size of each chunk in characters
	chunkOverlap: number;    // Overlap between chunks
	minChunkSize: number;    // Minimum size of a chunk
}

/**
 * Configuration for excluded paths
 */
export interface ExclusionSettings {
	excludedFolders: string[];      // User-defined folders to exclude from processing
	excludedFileTypes: string[];    // User-defined file extensions to exclude
	excludedFilePrefixes: string[]; // User-defined file name prefixes to exclude
	excludedFiles: string[];        // User-defined specific files to exclude
	// System-level exclusions that are always applied but not shown in UI
	systemExcludedFolders: string[];
	systemExcludedFileTypes: string[];
	systemExcludedFilePrefixes: string[];
	systemExcludedFiles: string[];
}

/**
 * OpenAI API settings
 */
export interface OpenAISettings {
        apiKey: string;         // API key for OpenAI
        model: string;          // Model to use for embeddings
        maxTokens: number;      // Maximum tokens for a single request
        temperature: number;    // Sampling temperature for generation
}

/**
 * Ollama embedding settings
 */
export interface OllamaSettings {
        enabled: boolean;          // Whether Ollama should be used for embeddings
        url: string;               // Base URL of the Ollama server
        model: string;             // Model name served by Ollama
        fallbackToOpenAI: boolean; // Whether to fall back to OpenAI when Ollama fails
}

/**
 * Combined embedding provider settings
 */
export interface EmbeddingProviderSettings {
        ollama: OllamaSettings;    // Ollama configuration
        openai: OpenAISettings;    // OpenAI configuration
}

/**
 * Default provider settings
 */
export const DEFAULT_OPENAI_SETTINGS: OpenAISettings = {
        apiKey: '',
        model: 'text-embedding-3-small',
        maxTokens: 8000,
        temperature: 0.0,
};

export const DEFAULT_OLLAMA_SETTINGS: OllamaSettings = {
        enabled: true,
        url: 'http://localhost:11434',
        model: 'nomic-embed-text',
        fallbackToOpenAI: true,
};

export const DEFAULT_NEO4J_SETTINGS: Neo4jSettings = {
        url: 'bolt://localhost:7687',
        username: 'neo4j',
        password: '',
        database: 'neo4j',
        projectName: 'obsidian-rag',
};

export const DEFAULT_EMBEDDING_PROVIDER_SETTINGS: EmbeddingProviderSettings = {
        ollama: { ...DEFAULT_OLLAMA_SETTINGS },
        openai: { ...DEFAULT_OPENAI_SETTINGS },
};

/**
 * Supabase connection settings
 */
export interface SupabaseSettings {
        url: string;              // Supabase project URL
        apiKey: string;          // Supabase API key
        initialized?: boolean;    // Whether database is initialized
        lastSetupAttempt?: number; // Timestamp of last setup attempt
        setupRetries?: number;    // Number of setup attempts
}

/**
 * Neo4j graph database settings
 */
export interface Neo4jSettings {
        url: string;              // Bolt URL for the Neo4j instance
        username: string;         // Username for Neo4j authentication
        password: string;         // Password for Neo4j authentication
        database: string;         // Target Neo4j database name
        projectName: string;      // Logical project name used to isolate nodes
}

export type SyncMode = 'supabase' | 'neo4j' | 'hybrid';

export type HybridExecutionOrder = 'vector-first' | 'graph-first' | 'parallel';

export interface HybridStrategySettings {
        executionOrder: HybridExecutionOrder;
        requireDualWrites: boolean;
}

export const DEFAULT_HYBRID_STRATEGY: HybridStrategySettings = {
        executionOrder: 'vector-first',
        requireDualWrites: true,
};

/**
 * Processing queue settings
 */
export interface QueueSettings {
	maxConcurrent: number;  // Maximum concurrent tasks
	retryAttempts: number;  // Number of retry attempts
	retryDelay: number;     // Delay between retries in milliseconds
}

/**
 * Debug and logging settings
 */
export interface DebugSettings {
	enableDebugLogs: boolean;  // Enable detailed debug logs
	logLevel: 'error' | 'warn' | 'info' | 'debug';  // Logging level
	logToFile: boolean;        // Whether to log to a file
}

/**
 * Device information for cross-device coordination
 */
export interface DeviceInfo {
	deviceId: string;         // Unique identifier for the device
	name: string;             // User-friendly name for the device
	platform: string;         // Operating system/platform
	lastSeen: number;         // Timestamp when device was last active
	lastSyncTime: number;     // Timestamp of last successful sync
}

/**
 * Enhanced sync settings with cross-device coordination
 */
export interface SyncSettings {
        syncFilePath: string;           // Path to the sync file
        backupInterval: number;         // Time between backups (ms)
        checkInterval: number;          // Time between sync checks (ms)
        checkAttempts: number;          // Number of sync check attempts
        timeout: number;                // Timeout for sync operations (ms)
        requireSync: boolean;           // Whether sync is required before startup
        mode: SyncMode;                 // Determines whether Supabase, Neo4j, or both are used
        hybridStrategy: HybridStrategySettings; // Defines execution preferences when both backends are enabled
        // New cross-device settings
        deviceId: string;               // Unique identifier for current device
        deviceName: string;             // User-configurable device name
	knownDevices: DeviceInfo[];     // Information about all known devices
	connectionCheckInterval: number; // How often to check database connection
	offlineQueueEnabled: boolean;   // Whether to queue operations when offline
	conflictResolutionStrategy: 'newest-wins' | 'manual' | 'keep-both'; // How to handle conflicts
}

/**
 * Initial sync settings
 */
export interface InitialSyncSettings {
	batchSize: number;             // Number of files per batch
	maxConcurrentBatches: number;  // Maximum concurrent batch processing
	enableAutoInitialSync: boolean; // Auto-start initial sync
	priorityRules: PriorityRule[]; // Rules for file processing priority
}

export interface PriorityRule {
	pattern: string;   // Pattern to match in file path
	priority: number;  // Priority level (higher = processed first)
}

/**
 * New update behavior settings for file processing
 */
export interface UpdateBehaviorSettings {
    debounceTime: number;              // Debounce delay in milliseconds for update operations
    processingMode: 'instant' | 'delayed';  // Whether updates are processed instantly or after a delay
    priorityOverride: number;          // Default processing priority override for update tasks
}

/**
 * Main settings interface for the plugin
 */
export interface ObsidianRAGSettings {
        // Vault identification
        vaultId: string | null;      // Unique identifier for the vault
        lastKnownVaultName: string;  // Last known name of the vault
        // API Configuration
        supabase: SupabaseSettings;  // Supabase configuration
        neo4j: Neo4jSettings;        // Neo4j configuration
        openai?: OpenAISettings;     // Deprecated: OpenAI configuration (kept for backward compatibility)
        embeddings: EmbeddingProviderSettings; // Embedding provider configuration
	// Processing settings
	chunking: ChunkSettings;     // Text chunking settings
	queue: QueueSettings;        // Queue processing settings
	// Exclusion patterns
	exclusions: ExclusionSettings;  // Paths and file types to exclude
	// Debug settings
	debug: DebugSettings;        // Debugging and logging configuration
	// Feature flags
	enableAutoSync: boolean;      // Enable automatic synchronization
	enableNotifications: boolean; // Show notifications for actions
	enableProgressBar: boolean;   // Show a progress bar during tasks
	// Sync settings
	sync: SyncSettings;
	// Initial sync settings
	initialSync: InitialSyncSettings;
	// New update behavior settings
	updateBehavior: UpdateBehaviorSettings;
}

/**
 * Default chunking options for text processing
 */
export const DEFAULT_CHUNKING_OPTIONS: ChunkSettings = {
	chunkSize: 1000,       // Default size of each chunk in characters
	chunkOverlap: 200,     // Default overlap between chunks
	minChunkSize: 100,     // Minimum chunk size to ensure usability
};

/**
 * Default update behavior settings
 */
export const DEFAULT_UPDATE_BEHAVIOR: UpdateBehaviorSettings = {
    debounceTime: 1000,             // 1 second debounce delay by default
    processingMode: 'instant',      // Process updates instantly by default
    priorityOverride: 1             // Default priority level for update operations
};

/**
 * Generate a unique device identifier
 */
export function generateDeviceId(): string {
	return crypto.randomUUID();
}

/**
 * Get platform information
 */
export function getPlatformInfo(): string {
	const userAgent = window.navigator.userAgent;
	if (userAgent.indexOf('Win') !== -1) return 'Windows';
	if (userAgent.indexOf('Mac') !== -1) return 'macOS';
	if (userAgent.indexOf('iPhone') !== -1 || userAgent.indexOf('iPad') !== -1) return 'iOS';
	if (userAgent.indexOf('Android') !== -1) return 'Android';
	if (userAgent.indexOf('Linux') !== -1) return 'Linux';
	return 'Unknown';
}

/**
 * System-level exclusions that are always applied but not shown in UI
 */
export const SYSTEM_EXCLUSIONS = {
	folders: [
		'.obsidian',           // Obsidian config folder
		'.trash',              // Obsidian trash folder
		'.git',                // Git folder if used
		'node_modules'         // Node modules if used
	],
	fileTypes: [
		'.mp3', '.jpg', '.png', '.pdf', // Non-markdown files
		'.excalidraw'                    // Excalidraw files
	],
	filePrefixes: ['_', '.'],   // Hidden and special files
	files: [
		'_obsidianragsync.md',           // Sync file
		'_obsidianragsync.md.backup'     // Sync backup file
	]
};

/**
 * Default settings when plugin is first initialized
 */
export const DEFAULT_SETTINGS: ObsidianRAGSettings = {
        vaultId: null,
        lastKnownVaultName: '',
        supabase: {
                url: '',
                apiKey: '',
                initialized: false,
                lastSetupAttempt: 0,
                setupRetries: 0,
        },
        neo4j: { ...DEFAULT_NEO4J_SETTINGS },
        openai: { ...DEFAULT_OPENAI_SETTINGS },
        embeddings: {
                ollama: { ...DEFAULT_OLLAMA_SETTINGS },
                openai: { ...DEFAULT_OPENAI_SETTINGS },
        },
        chunking: { ...DEFAULT_CHUNKING_OPTIONS },
	queue: {
		maxConcurrent: 3,
		retryAttempts: 3,
		retryDelay: 1000,
	},
	exclusions: {
		excludedFolders: [],
		excludedFileTypes: [],
		excludedFilePrefixes: [],
		excludedFiles: [],
		systemExcludedFolders: [...SYSTEM_EXCLUSIONS.folders],
		systemExcludedFileTypes: [...SYSTEM_EXCLUSIONS.fileTypes],
		systemExcludedFilePrefixes: [...SYSTEM_EXCLUSIONS.filePrefixes],
		systemExcludedFiles: [...SYSTEM_EXCLUSIONS.files]
	},
	debug: {
		enableDebugLogs: false,
		logLevel: 'info',
		logToFile: false,
	},
	enableAutoSync: true,
	enableNotifications: true,
	enableProgressBar: true,
        sync: {
                syncFilePath: '_obsidianragsync.md',
                backupInterval: 3600000,  // 1 hour in milliseconds
                checkInterval: 300000,    // 5 minutes in milliseconds
                checkAttempts: 3,
                timeout: 40000,
                requireSync: true,
                mode: 'supabase',
                hybridStrategy: { ...DEFAULT_HYBRID_STRATEGY },
                deviceId: generateDeviceId(),
                deviceName: `Device-${Math.floor(Math.random() * 1000)}`,
                knownDevices: [],
                connectionCheckInterval: 60000, // 1 minute
                offlineQueueEnabled: true,
		conflictResolutionStrategy: 'newest-wins'
	},
	initialSync: {
		batchSize: 50,
		maxConcurrentBatches: 3,
		enableAutoInitialSync: true,
		priorityRules: [
			{ pattern: 'daily/', priority: 3 },
			{ pattern: 'projects/', priority: 2 },
			{ pattern: 'archive/', priority: 1 }
		]
	},
	updateBehavior: {
		...DEFAULT_UPDATE_BEHAVIOR
	}
};

/**
 * Returns a combined list of all exclusions (system + user) used for processing.
 * Note: This function is used internally for file processing and combines both user-defined and system-level exclusions.
 */
export function getAllExclusions(settings: ObsidianRAGSettings): {
	excludedFolders: string[],
	excludedFileTypes: string[],
	excludedFilePrefixes: string[],
	excludedFiles: string[]
} {
	const exclusions = settings.exclusions;
	return {
		excludedFolders: [
			...exclusions.systemExcludedFolders || SYSTEM_EXCLUSIONS.folders,
			...exclusions.excludedFolders || []
		],
		excludedFileTypes: [
			...exclusions.systemExcludedFileTypes || SYSTEM_EXCLUSIONS.fileTypes,
			...exclusions.excludedFileTypes || []
		],
		excludedFilePrefixes: [
			...exclusions.systemExcludedFilePrefixes || SYSTEM_EXCLUSIONS.filePrefixes,
			...exclusions.excludedFilePrefixes || []
		],
		excludedFiles: [
			...exclusions.systemExcludedFiles || SYSTEM_EXCLUSIONS.files,
			...exclusions.excludedFiles || []
		]
	};
}

/**
 * Returns only the user-defined exclusions (without system-level defaults).
 * This helper can be used in UI components to ensure that system exclusions remain hidden.
 */
export function getUserExclusions(settings: ObsidianRAGSettings): {
	excludedFolders: string[],
	excludedFileTypes: string[],
	excludedFilePrefixes: string[],
	excludedFiles: string[]
} {
	const exclusions = settings.exclusions;
	return {
		excludedFolders: exclusions.excludedFolders || [],
		excludedFileTypes: exclusions.excludedFileTypes || [],
		excludedFilePrefixes: exclusions.excludedFilePrefixes || [],
		excludedFiles: exclusions.excludedFiles || []
	};
}

/**
 * Type guard to check if a vault is initialized.
 */
export function isVaultInitialized(settings: ObsidianRAGSettings): boolean {
	return settings.vaultId !== null && settings.vaultId !== undefined && settings.vaultId !== '';
}

/**
 * Helper to create a new vault ID.
 */
export function generateVaultId(): string {
	return crypto.randomUUID();
}
