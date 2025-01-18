/**
 * Configuration options for chunking text
 */
export interface ChunkSettings {
    chunkSize: number; // Size of each chunk in characters
    chunkOverlap: number; // Overlap between chunks
    minChunkSize: number; // Minimum size of a chunk
}

/**
 * Configuration for excluded paths
 */
export interface ExclusionSettings {
    excludedFolders: string[]; // Folders to exclude from processing
    excludedFileTypes: string[]; // File extensions to exclude
    excludedFilePrefixes: string[]; // File name prefixes to exclude
}

/**
 * OpenAI API settings
 */
export interface OpenAISettings {
    apiKey: string; // API key for OpenAI
    model: string; // Model to use for OpenAI operations
    maxTokens: number; // Maximum tokens for a single request
    temperature: number; // Sampling temperature for generation
}

/**
 * Supabase connection settings
 */
export interface SupabaseSettings {
    url: string; // Supabase project URL
    apiKey: string; // Supabase API key
}

/**
 * Processing queue settings
 */
export interface QueueSettings {
    maxConcurrent: number; // Maximum concurrent tasks
    retryAttempts: number; // Number of retry attempts
    retryDelay: number; // Delay between retries in milliseconds
}

/**
 * Debug and logging settings
 */
export interface DebugSettings {
    enableDebugLogs: boolean; // Enable detailed debug logs
    logLevel: 'error' | 'warn' | 'info' | 'debug'; // Logging level
    logToFile: boolean; // Whether to log to a file
}

/**
 * Main settings interface for the plugin
 */
export interface MindMatrixSettings {
    // Vault identification
    vaultId: string | null; // Unique identifier for the vault
    lastKnownVaultName: string; // Last known name of the vault

    // API Configuration
    supabase: SupabaseSettings; // Supabase configuration
    openai: OpenAISettings; // OpenAI configuration

    // Processing settings
    chunking: ChunkSettings; // Text chunking settings
    queue: QueueSettings; // Queue processing settings

    // Exclusion patterns
    exclusions: ExclusionSettings; // Paths and file types to exclude

    // Debug settings
    debug: DebugSettings; // Debugging and logging configuration

    // Feature flags
    enableAutoSync: boolean; // Enable automatic synchronization
    enableNotifications: boolean; // Show notifications for actions
    enableProgressBar: boolean; // Show a progress bar during tasks
}

/**
 * Default settings when plugin is first initialized
 */
export const DEFAULT_SETTINGS: MindMatrixSettings = {
    vaultId: null,
    lastKnownVaultName: '',

    supabase: {
        url: '',
        apiKey: ''
    },

    openai: {
        apiKey: '',
        model: 'text-embedding-ada-002',
        maxTokens: 8000,
        temperature: 0.0
    },

    chunking: {
        chunkSize: 1000,
        chunkOverlap: 200,
        minChunkSize: 100
    },

    queue: {
        maxConcurrent: 3,
        retryAttempts: 3,
        retryDelay: 1000
    },

    exclusions: {
        excludedFolders: ['.git', '.obsidian', 'node_modules'],
        excludedFileTypes: ['.mp3', '.jpg', '.png'],
        excludedFilePrefixes: ['_', '.']
    },

    debug: {
        enableDebugLogs: false,
        logLevel: 'info',
        logToFile: false
    },

    enableAutoSync: true,
    enableNotifications: true,
    enableProgressBar: true
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
