import { SupabaseService } from '../services/SupabaseService';
import { ObsidianRAGSettings } from '../settings/Settings';

async function queryTables() {
    const settings: ObsidianRAGSettings = {
        supabase: {
            url: process.env.SUPABASE_URL!,
            apiKey: process.env.SUPABASE_ANON_KEY!,
            initialized: true
        },
        vaultId: 'test-vault',
        lastKnownVaultName: 'Test Vault',
        openai: {
            apiKey: process.env.OPENAI_API_KEY!,
            model: 'text-embedding-ada-002',
            maxTokens: 8191,
            temperature: 0
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
            excludedFolders: [],
            excludedFileTypes: [],
            excludedFilePrefixes: [],
            excludedFiles: [],
            systemExcludedFolders: [],
            systemExcludedFileTypes: [],
            systemExcludedFilePrefixes: [],
            systemExcludedFiles: []
        },
        debug: {
            enableDebugLogs: true,
            logLevel: 'debug',
            logToFile: false
        },
        enableAutoSync: true,
        enableNotifications: true,
        enableProgressBar: true,
        sync: {
            syncFilePath: '.obsidian/plugins/obsidian-rag/sync.json',
            backupInterval: 3600000,
            checkInterval: 60000,
            checkAttempts: 3,
            timeout: 30000,
            requireSync: false,
            deviceId: 'test-device',
            deviceName: 'Test Device',
            knownDevices: [],
            connectionCheckInterval: 60000,
            offlineQueueEnabled: true,
            conflictResolutionStrategy: 'newest-wins'
        },
        initialSync: {
            batchSize: 10,
            maxConcurrentBatches: 2,
            enableAutoInitialSync: true,
            priorityRules: []
        },
        updateBehavior: {
            debounceTime: 1000,
            processingMode: 'delayed',
            priorityOverride: 0
        }
    };

    const service = await SupabaseService.getInstance(settings);
    if (!service) {
        console.error('Failed to initialize SupabaseService');
        return;
    }

    // Query obsidian_documents
    console.log('Querying obsidian_documents...');
    const documents = await service.getAllDocuments();
    console.log('obsidian_documents:', documents);

    // Query obsidian_file_status
    console.log('\nQuerying obsidian_file_status...');
    const fileStatus = await service.getAllFileStatus();
    console.log('obsidian_file_status:', fileStatus);
}

queryTables().catch(console.error); 