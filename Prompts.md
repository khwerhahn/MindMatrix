# Project Prompt

I am working on an Obsidian plugin called "mind-matrix" that syncs documents with a Supabase vector database for AI-powered search. To continue helping effectively, please share the current state of your files.

1. Base setup is from the Obsidian sample plugin template with following files:
   - main.ts (containing basic plugin structure)
   - package.json with initial dependencies and metadata (author: khwerhahn)

2. Project goal: Create an Obsidian plugin that:
   - Syncs notes with Supabase vector database
   - Handles document creation and updates
   - Uses OpenAI embeddings for vectorization
   - Supports configurable folder exclusions
   - Provides progress feedback to users
   - Optimizes performance for large vaults
   - Maintains reliable file tracking between Obsidian and database

3. Database schema is defined:
```sql
CREATE TABLE obsidian_notes (
    id BIGSERIAL PRIMARY KEY,
    vault_id TEXT NOT NULL,
    obsidian_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT,
    metadata JSONB,
    embedding VECTOR(1536),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vault_id, obsidian_id, chunk_index)
);

-- Create index for faster lookups
CREATE INDEX idx_vault_obsidian ON obsidian_notes(vault_id, obsidian_id);

CREATE FUNCTION match_documents(query_embedding VECTOR(1536), vault_id TEXT, match_count INT)
RETURNS TABLE (
    id BIGINT,
    obsidian_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        id,
        obsidian_id,
        content,
        metadata,
        1 - (obsidian_notes.embedding <=> query_embedding) AS similarity
    FROM obsidian_notes
    WHERE vault_id = vault_id
    ORDER BY obsidian_notes.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
```

4. Project structure:
```
mind-matrix/
├── src/
│   ├── main.ts                    # Plugin entry point
│   ├── settings/
│   │   ├── SettingsTab.ts        # Settings UI
│   │   └── Settings.ts           # Settings interface
│   ├── services/
│   │   ├── SupabaseService.ts    # Database operations
│   │   ├── OpenAIService.ts      # API integration
│   │   └── QueueService.ts       # Processing queue
│   ├── utils/
│   │   ├── TextSplitter.ts       # Text processing
│   │   ├── NotificationManager.ts # User feedback
│   │   ├── ErrorHandler.ts       # Centralized error handling
│   │   └── FileTracker.ts        # File event tracking logic
│   └── models/
│       ├── DocumentChunk.ts      # Data structures
│       └── ProcessingTask.ts     # Queue interface
├── tests/
├── docs/
└── types/
```

5. Features to implement:
   - Document chunking with recursive character splitter
   - Progress notifications for users
   - Performance optimizations for large vaults
   - Batch processing and rate limiting
   - Settings UI for configuration
   - Error handling and recovery:
     * Network failures during sync
     * Database connection issues
     * OpenAI API rate limits
     * Partial sync recovery
     * Data consistency checks
   - Reliable file tracking between Obsidian and database:
     * Use TFile.path as obsidian_id
     * Track file moves/renames through Obsidian's file events
     * Maintain chunk ordering with chunk_index
     * Clean up orphaned database entries

6. Implemented Files and Components:

A. Models (Completed):
- DocumentChunk.ts:
  * DocumentMetadata interface
  * DocumentChunk interface
  * ChunkingOptions interface
  * EmbeddingResponse interface
- ProcessingTask.ts:
  * TaskType enum
  * TaskStatus enum
  * ProcessingTask interface
  * TaskProgress interface
  * QueueStats interface

B. Settings (Completed):
- Settings.ts:
```typescript
export interface MindMatrixSettings {
    // Vault identification
    vaultId: string | null;
    lastKnownVaultName: string;

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
```

C. Services (Partially Completed):
- SupabaseService.ts (Complete)
  * Vault-aware database operations
  * Safe initialization
  * Error handling
- main.ts (Complete)
  * Plugin initialization
  * Event handling
  * Settings management
  * Service orchestration

D. Still To Implement:
- OpenAIService.ts
- QueueService.ts
- Utils folder:
  * TextSplitter.ts
  * NotificationManager.ts
  * ErrorHandler.ts
  * FileTracker.ts
- Tests
- Documentation

7. Package Management & Configuration:
   - Using Yarn Berry (4.6.0)
   - Configuration files:
     * .yarnrc.yml:
       ```yaml
       nodeLinker: node-modules
       enableGlobalCache: true
       npmRegistryServer: "https://registry.npmjs.org"
       yarnPath: .yarn/releases/yarn-4.6.0.cjs
       logFilters:
         - code: YN0013
           level: discard
       compressionLevel: mixed
       enableTelemetry: false
       defaultSemverRangePrefix: ""
       supportedArchitectures:
         cpu:
           - current
         os:
           - current
       ```
     * package.json:
       ```json
       {
           "name": "mind-matrix",
           "version": "0.0.1",
           "description": "Sync your notes with a postgres vector database and integrate it with your personal AI assistant.",
           "main": "main.js",
           "scripts": {
               "dev": "node esbuild.config.mjs",
               "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
               "version": "node version-bump.mjs && git add manifest.json versions.json",
               "test": "jest",
               "lint": "eslint . --ext .ts"
           },
           "keywords": ["obsidian", "vector", "postgres", "ai", "notes", "sync", "assistant"],
           "author": "khwerhahn",
           "license": "MIT",
           "packageManager": "yarn@4.6.0",
           "devDependencies": {
               "@types/jest": "^29.5.0",
               "@types/node": "^16.11.6",
               "@typescript-eslint/eslint-plugin": "5.29.0",
               "@typescript-eslint/parser": "5.29.0",
               "builtin-modules": "3.3.0",
               "esbuild": "0.17.3",
               "jest": "^29.5.0",
               "obsidian": "latest",
               "ts-jest": "^29.1.0",
               "tslib": "2.4.0",
               "typescript": "4.7.4"
           },
           "dependencies": {
               "@supabase/supabase-js": "^2.39.0",
               "@types/uuid": "^9.0.0",
               "dotenv": "^16.3.1",
               "openai": "^4.0.0",
               "postgres": "^3.4.3",
               "uuid": "^9.0.0"
           }
       }
       ```

8. Please provide the current state of your files by pasting:
   - The content of any files you've already created/modified
   - Any new files you've added to the structure
   - Any dependencies you've added to package.json
   - Any configuration files you've modified

This will help ensure we continue from the right point and maintain consistency in the implementation.
Please help continue the implementation of this plugin, following the established structure and goals.

