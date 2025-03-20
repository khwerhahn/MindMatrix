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

    // New cross-device coordination settings
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
 * Main settings interface for the plugin
 */
export interface MindMatrixSettings {
    // Vault identification
    vaultId: string | null;      // Unique identifier for the vault
    lastKnownVaultName: string;  // Last known name of the vault

    // API Configuration
    supabase: SupabaseSettings;  // Supabase configuration
    openai: OpenAISettings;      // OpenAI configuration

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
        '_mindmatrixsync.md',           // Sync file
        '_mindmatrixsync.md.backup'     // Sync backup file
    ]
};

/**
 * Default settings when plugin is first initialized
 */
export const DEFAULT_SETTINGS: MindMatrixSettings = {
    vaultId: null,
    lastKnownVaultName: '',

    supabase: {
        url: '',
        apiKey: '',
        initialized: false,
        lastSetupAttempt: 0,
        setupRetries: 0,
    },

    openai: {
        apiKey: '',
        model: 'text-embedding-ada-002',
        maxTokens: 8000,
        temperature: 0.0,
    },

    chunking: { ...DEFAULT_CHUNKING_OPTIONS }, // Use default chunking options

    queue: {
        maxConcurrent: 3,
        retryAttempts: 3,
        retryDelay: 1000,
    },

    exclusions: {
        // User-facing exclusions (initially empty)
        excludedFolders: [],
        excludedFileTypes: [],
        excludedFilePrefixes: [],
        excludedFiles: [],

        // System exclusions (hidden from UI)
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
        syncFilePath: '_mindmatrixsync.md',
        backupInterval: 3600000,  // 1 hour in milliseconds
        checkInterval: 300000,    // 5 minutes in milliseconds
        checkAttempts: 3,
        timeout: 40000,
        requireSync: true,

        // New cross-device settings
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
    }
};

/**
 * Get a combined list of all exclusions (system + user)
 */
export function getAllExclusions(settings: MindMatrixSettings): {
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
 * Type guard to check if a vault is initialized
 */
export function isVaultInitialized(settings: MindMatrixSettings): boolean {
    return settings.vaultId !== null && settings.vaultId !== undefined && settings.vaultId !== '';
}

/**
 * Helper to create a new vault ID
 */
export function generateVaultId(): string {
    return crypto.randomUUID();
}

/**
 * Helper to check if database initialization is needed
 */
export function needsDatabaseSetup(settings: MindMatrixSettings): boolean {
    if (!settings.supabase.initialized) return true;

    // If last attempt was more than an hour ago and we haven't exceeded retry limit
    const oneHour = 60 * 60 * 1000; // ms
    const timeSinceLastAttempt = Date.now() - (settings.supabase.lastSetupAttempt || 0);
    return timeSinceLastAttempt > oneHour && (settings.supabase.setupRetries || 0) < 3;
}

/**
 * Helper to update database setup status
 */
export function updateDatabaseSetupStatus(settings: MindMatrixSettings, success: boolean): void {
    settings.supabase.lastSetupAttempt = Date.now();
    if (success) {
        settings.supabase.initialized = true;
        settings.supabase.setupRetries = 0;
    } else {
        settings.supabase.setupRetries = (settings.supabase.setupRetries || 0) + 1;
    }
}

/**
 * Validate settings
 */
export function validateSettings(settings: MindMatrixSettings): string[] {
    const errors: string[] = [];

    // Check chunk settings
    if (settings.chunking.chunkSize < settings.chunking.minChunkSize) {
        errors.push('Chunk size must be greater than minimum chunk size');
    }
    if (settings.chunking.chunkOverlap >= settings.chunking.chunkSize) {
        errors.push('Chunk overlap must be less than chunk size');
    }

    // Check queue settings
    if (settings.queue.maxConcurrent < 1) {
        errors.push('Maximum concurrent tasks must be at least 1');
    }
    if (settings.queue.retryAttempts < 0) {
        errors.push('Retry attempts cannot be negative');
    }
    if (settings.queue.retryDelay < 0) {
        errors.push('Retry delay cannot be negative');
    }

    // Check initial sync settings
    if (settings.initialSync.batchSize < 1) {
        errors.push('Initial sync batch size must be at least 1');
    }
    if (settings.initialSync.maxConcurrentBatches < 1) {
        errors.push('Maximum concurrent batches must be at least 1');
    }

    return errors;
}

/**
 * Validate exclusion settings
 */
export function validateExclusionSettings(settings: ExclusionSettings): string[] {
    const errors: string[] = [];

    // Validate folder paths
    settings.excludedFolders.forEach(folder => {
        if (folder.includes('..')) {
            errors.push(`Invalid folder path: ${folder} (cannot contain ..)`);
        }
    });

    // Validate file extensions
    settings.excludedFileTypes.forEach(ext => {
        if (!ext.startsWith('.')) {
            errors.push(`Invalid file extension: ${ext} (must start with .)`);
        }
    });

    // Ensure sync files are always excluded (in system exclusions)
    const requiredExclusions = ['_mindmatrixsync.md', '_mindmatrixsync.md.backup'];
    requiredExclusions.forEach(file => {
        if (!settings.systemExcludedFiles.includes(file)) {
            settings.systemExcludedFiles.push(file);
        }
    });

    return errors;
}

/**
 * Reset settings to defaults
 */
export function resetSettings(settings: MindMatrixSettings): void {
    // Preserve system exclusions if they exist
    const systemExclusions = {
        systemExcludedFolders: settings.exclusions?.systemExcludedFolders || SYSTEM_EXCLUSIONS.folders,
        systemExcludedFileTypes: settings.exclusions?.systemExcludedFileTypes || SYSTEM_EXCLUSIONS.fileTypes,
        systemExcludedFilePrefixes: settings.exclusions?.systemExcludedFilePrefixes || SYSTEM_EXCLUSIONS.filePrefixes,
        systemExcludedFiles: settings.exclusions?.systemExcludedFiles || SYSTEM_EXCLUSIONS.files
    };

    Object.assign(settings, DEFAULT_SETTINGS);

    // Restore system exclusions
    settings.exclusions = {
        ...settings.exclusions,
        ...systemExclusions
    };

    settings.vaultId = null; // Ensure vault needs to be reinitialized
    settings.supabase.initialized = false; // Force database reinitialization
}

/**
 * Register current device in the known devices list
 */
export function registerCurrentDevice(settings: MindMatrixSettings): void {
    const now = Date.now();
    const platform = getPlatformInfo();

    // Check if this device is already registered
    const existingDevice = settings.sync.knownDevices.find(
        device => device.deviceId === settings.sync.deviceId
    );

    if (existingDevice) {
        // Update existing device
        existingDevice.lastSeen = now;
        existingDevice.platform = platform;
        existingDevice.name = settings.sync.deviceName;
    } else {
        // Add new device
        settings.sync.knownDevices.push({
            deviceId: settings.sync.deviceId,
            name: settings.sync.deviceName,
            platform: platform,
            lastSeen: now,
            lastSyncTime: now
        });
    }
}

/**
 * Update device sync timestamp
 */
export function updateDeviceSyncTime(settings: MindMatrixSettings): void {
    const now = Date.now();

    // Find and update current device
    const currentDevice = settings.sync.knownDevices.find(
        device => device.deviceId === settings.sync.deviceId
    );

    if (currentDevice) {
        currentDevice.lastSyncTime = now;
        currentDevice.lastSeen = now;
    } else {
        // Register device if not found
        registerCurrentDevice(settings);
    }
}
