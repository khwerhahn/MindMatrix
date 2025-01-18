/**
 * Configuration options for chunking text
 */
export interface ChunkSettings {
    chunkSize: number;
    chunkOverlap: number;
    minChunkSize: number;
}

/**
 * Configuration for excluded paths
 */
export interface ExclusionSettings {
    excludedFolders: string[];
    excludedFileTypes: string[];
    excludedFilePrefixes: string[];
}

/**
 * OpenAI API settings
 */
export interface OpenAISettings {
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
}

/**
 * Supabase connection settings
 */
export interface SupabaseSettings {
    url: string;
    apiKey: string;
}

/**
 * Processing queue settings
 */
export interface QueueSettings {
    maxConcurrent: number;
    retryAttempts: number;
    retryDelay: number;
}

/**
 * Debug and logging settings
 */
export interface DebugSettings {
    enableDebugLogs: boolean;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    logToFile: boolean;
}

/**
 * Main settings interface for the plugin
 */
export interface MindMatrixSettings {
    // Vault identification
    vaultId: string | null;  // null if not yet initialized
    lastKnownVaultName: string;  // for display purposes

    // API Configuration
    supabase: SupabaseSettings;
    openai: OpenAISettings;

    // Processing settings
    chunking: ChunkSettings;
    queue: QueueSettings;

    // Exclusion patterns
    exclusions: ExclusionSettings;

    // Debug settings
    debug: DebugSettings;

    // Feature flags
    enableAutoSync: boolean;
    enableNotifications: boolean;
    enableProgressBar: boolean;
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
