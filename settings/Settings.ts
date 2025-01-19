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
    excludedFolders: string[];      // Folders to exclude from processing
    excludedFileTypes: string[];    // File extensions to exclude
    excludedFilePrefixes: string[]; // File name prefixes to exclude
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
        excludedFolders: ['.git', '.obsidian', 'node_modules'],
        excludedFileTypes: ['.mp3', '.jpg', '.png'],
        excludedFilePrefixes: ['_', '.'],
    },

    debug: {
        enableDebugLogs: false,
        logLevel: 'info',
        logToFile: false,
    },

    enableAutoSync: true,
    enableNotifications: true,
    enableProgressBar: true,
};

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

    return errors;
}

/**
 * Reset settings to defaults
 */
export function resetSettings(settings: MindMatrixSettings): void {
    Object.assign(settings, DEFAULT_SETTINGS);
    settings.vaultId = null; // Ensure vault needs to be reinitialized
    settings.supabase.initialized = false; // Force database reinitialization
}
