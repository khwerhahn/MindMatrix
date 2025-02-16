Here's the complete updated Prompts.md file:

# **Project Prompt**

I am working on an Obsidian plugin called **"mind-matrix"** that syncs documents with a Supabase vector database for AI-powered search. To ensure the AI has the right context for contributing to the project, this prompt includes architecture decisions, implemented features, pending tasks, and the current state of the project.

---

## **Project Overview**

The **"mind-matrix"** plugin enhances Obsidian by syncing notes with a Supabase vector database, enabling semantic search through OpenAI embeddings. Its primary objectives are:

1. **Document Management**: Efficiently sync document chunks to a vector database.
2. **Search Integration**: Use OpenAI embeddings for powerful semantic searches.
3. **User Experience**: Provide clear feedback on sync progress and errors.
4. **Performance**: Handle large vaults with robust error recovery and processing queues.

---

## **Architecture and Key Decisions**

### **1. Core Architecture**
- **Plugin Entry Point**: `main.ts` initializes services and manages event handling.
- **Service-Oriented Design**:
  - `SupabaseService` handles all database interactions.
  - `OpenAIService` manages API calls for embeddings.
  - `QueueService` orchestrates task processing with concurrency and retries.
  - `SyncManager` manages multi-device synchronization and status tracking.
- **Utilities**:
  - `TextSplitter` ensures efficient document chunking.
  - `ErrorHandler` centralizes error logging and recovery.
  - `NotificationManager` provides feedback through notifications and progress bars.
  - `FileTracker` handles file event tracking and sync state.

### **2. Database Schema**
- A PostgreSQL table for storing document chunks, embeddings, and metadata:
  ```sql
  CREATE TABLE obsidian_documents (
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

  CREATE INDEX idx_vault_obsidian ON obsidian_documents(vault_id, obsidian_id);
  ```

- Function for semantic search:
  ```sql
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
          1 - (obsidian_documents.embedding <=> query_embedding) AS similarity
      FROM obsidian_documents
      WHERE vault_id = vault_id
      ORDER BY obsidian_documents.embedding <=> query_embedding
      LIMIT match_count;
  END;
  $$ LANGUAGE plpgsql;
  ```

### **3. Processing Workflow**
- **File Event Tracking**:
  - Hooks into Obsidian events (create, modify, delete, rename) to queue tasks.
  - Uses TFile.path as a unique identifier for tracking changes.
- **Task Queue**:
  - Supports concurrent processing with configurable limits.
  - Handles retries and backoff for failed tasks.
  - Provides task-specific progress feedback.
- **Chunking**:
  - Uses TextSplitter to split documents into overlapping chunks for embedding.
  - Configurable parameters for chunk size, overlap, and splitting behavior.

### **4. Synchronization Architecture**
- **Plugin Initialization Phases**:
  1. **Pre-Initialization** (main.ts -> onload()):
     - Load minimal core services (ErrorHandler, NotificationManager)
     - Initialize settings from disk
     - Register basic event handlers

  2. **Sync Readiness Check** (SyncManager):
     - Verify `_mindmatrixsync.md` existence/create if missing
     - Monitor Obsidian sync status (3 checks, 10s intervals)
     - Handle sync timeout after 40s
     - Maintain sync state between checks

  3. **Services Initialization**:
     - Initialize SupabaseService with connection check
     - Initialize OpenAIService with API validation
     - Setup FileTracker with initial vault scan
     - Create QueueService with configured parameters

  4. **Post-Initialization**:
     - Register file event handlers
     - Setup command palette actions
     - Initialize settings tab
     - Begin normal operation

- **Sync State Management**:
  - **Sync File Structure** (`_mindmatrixsync.md`):
    ```markdown
    ---
    last_sync: timestamp
    ---

    ## Synced Files
    | File Path | Last Modified | Last Synced | Hash | Status |
    |-----------|--------------|-------------|------|--------|
    | doc1.md   | timestamp    | timestamp   | hash | OK     |
    ```
  - **Sync File Components**:
    - **YAML Header**: Contains only last_sync timestamp
    - **Table Structure**:
      - File Path: Relative path within vault
      - Last Modified: File's last modification time
      - Last Synced: Timestamp of last successful sync
      - Hash: Content hash for change detection
      - Status: Current sync state (OK, PENDING, ERROR)

  - **State Validation**:
    - Validate YAML frontmatter
    - Verify table structure and columns
    - Check timestamp formats and validity
    - Ensure hash consistency
    - Handle table corruption recovery

- **Multi-Device Coordination**:
  - Compare file timestamps with sync records
  - Track changes through content hashes
  - Handle concurrent modifications
  - Resolve sync conflicts based on timestamps

- **Recovery Mechanisms**:
  - Automatic backup before modifications
  - Table structure repair
  - Re-hash on corruption detection
  - Partial sync state recovery

- **Initialization Flow Detail**:
  ```
  onload()
  ├─► Load Core Services
  │   └─► Settings, ErrorHandler, NotificationManager
  │
  ├─► Begin Sync Check (SyncManager)
  │   ├─► Check 1 (t=0s):
  │   │   ├─► Verify _mindmatrixsync.md exists
  │   │   ├─► Validate file structure
  │   │   └─► Check Obsidian sync status
  │   │
  │   ├─► Check 2 (t=10s):
  │   │   ├─► Verify sync completed
  │   │   └─► Update sync status
  │   │
  │   ├─► Check 3 (t=20s):
  │   │   ├─► Final sync verification
  │   │   └─► Confirm sync stability
  │   │
  │   └─► Timeout (t=40s):
  │       └─► Force continue if needed
  │
  ├─► Initialize Services
  │   ├─► Database connection (Supabase)
  │   ├─► API services (OpenAI)
  │   ├─► File tracking system
  │   └─► Processing queue
  │
  └─► Complete Initialization
      ├─► Register event handlers
      ├─► Setup commands
      └─► Begin normal operation
  ```

## **Project Structure**

```
mind-matrix/
├── src/
│   ├── main.ts                     # Plugin entry point
│   ├── settings/
│   │   ├── SettingsTab.ts         # Settings UI
│   │   └── Settings.ts            # Settings interface
│   ├── services/
│   │   ├── SupabaseService.ts     # Database operations
│   │   ├── OpenAIService.ts       # API integration
│   │   ├── QueueService.ts        # Task queue management
│   │   └── SyncManager.ts         # Sync status management
│   ├── utils/
│   │   ├── TextSplitter.ts        # Document chunking
│   │   ├── NotificationManager.ts # Notifications and progress
│   │   ├── ErrorHandler.ts        # Centralized error handling
│   │   └── FileTracker.ts         # File event tracking
│   └── models/
│       ├── DocumentChunk.ts       # Data structures
│       └── ProcessingTask.ts      # Task queue interface
├── tests/
├── docs/
└── types/
```

## **Implemented Features**

1. **Document Chunking (TextSplitter)**
   - Splits documents into chunks based on:
     - Maximum chunk size.
     - Overlap between chunks.
     - Sentence or paragraph boundaries.

2. **Task Queue Management (QueueService)**
   - Manages tasks with:
     - Concurrent processing.
     - Retry logic for failed tasks.
     - Detailed progress reporting.

3. **Semantic Search (SupabaseService)**
   - Inserts, updates, and queries document chunks and embeddings in the database.
   - Supports semantic search with vector similarity.

4. **OpenAI Integration (OpenAIService)**
   - Generates embeddings for document chunks.
   - Includes rate limiting and error handling.

5. **User Feedback**
   - Notifications for sync events and errors.
   - Progress bars for ongoing tasks.

## **Next Implementation Tasks**

### **1. Enhanced Metadata Integration**
- Update TextSplitter to:
  - Extract and parse tags array from frontmatter
  - Extract and parse aliases array
  - Extract created_at timestamp
  - Parse **Links** section for internal document links
  - Create metadata-enriched version of content

- Enhance embedding process:
  - Prepend metadata before generating embeddings
  - Format: "Tags: #tag1, #tag2\nAliases: alias1, alias2\nLinks: [[link1]], [[link2]]\nCreated: timestamp\n\n[content]"

- Modify database schema:
  - Add columns for tags (array)
  - Add columns for aliases (array)
  - Add columns for linked_documents (array)
  - Add created_at and vectorized_at timestamps

### **2. Initial Vault Sync Implementation**
- Add new settings:
  - Enable/disable automatic initial sync
  - Configure batch size
  - Set priority rules

- Create Initial Sync Manager:
  - Scan vault for markdown files
  - Track vectorization status using frontmatter
  - Compare vectorized_last with last_modified
  - Implement batch processing
  - Add progress tracking

- Update file processing:
  - Manage vectorized_last in frontmatter
  - Implement delta detection
  - Handle missing frontmatter cases
  - Ensure atomic updates

### **3. Improved File Exclusion System**
Update exclusion logic to focus on Obsidian-specific patterns:
- Handle Obsidian's special directories (.obsidian)
- Focus on markdown and related attachment files
- Implement proper path matching for excluded directories
- Add support for glob patterns in exclusion rules

Revise default exclusion settings:
- Remove non-Obsidian related patterns (node_modules, .git)
- Add Obsidian-specific patterns
- Consider common attachment directories
- Add patterns for system files (.DS_Store, Thumbs.db)

Add exclusion validation:
- Validate exclusion patterns at startup
- Provide feedback for invalid patterns
- Add path normalization for cross-platform compatibility
- Implement testing for exclusion rules

### **4. Multi-Device Synchronization**
- **Sync Manager Implementation**:
  - Create SyncManager service
  - Implement sync status checking
  - Add sync file management
  - Handle concurrent device access

- **Sync File Structure**:
  - Design sync file format
  - Implement atomic operations
  - Add file validation
  - Create backup mechanisms

- **Initialization Flow**:
  - Add delayed startup logic
  - Implement sync status checks
  - Add sync file verification
  - Create recovery procedures

- **Error Handling**:
  - Add sync-specific error types
  - Implement recovery mechanisms
  - Handle partial sync scenarios
  - Add conflict resolution

## **Settings and Configuration**

### **1. Default Settings**

```typescript
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

    sync: {
        checkAttempts: 3,         // Number of sync status checks
        checkInterval: 10000,     // 10 seconds between checks
        timeout: 40000,          // Maximum wait time
        requireSync: true,       // Whether to require sync check
        syncFilePath: '_mindmatrixsync.md',  // Sync state file location
        enableBackup: true,      // Enable sync file backup
        backupInterval: 3600000  // Backup every hour
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
```

### **2. Configurable Options**
- **Chunking**: Size, overlap, and splitting rules.
- **Exclusions**: Obsidian directories and files to exclude due to privacy reasons. '_' prefixed files are also excluded.
- **Debugging**: Logging and verbosity levels.
- **Notifications**: Progress bars and sync events.
- **Sync Settings**: Sync check behavior and file management.

## **Development Goals**

1. Ensure high performance with large vaults.
2. Provide robust error recovery and task retries.
3. Offer a seamless user experience with clear feedback mechanisms.
4. Enhance search accuracy through metadata integration.
5. Support efficient initial vault synchronization.
6. Maintain data consistency across multiple devices.


# Mind Matrix Implementation Task List

## Priority Tasks ⚡
### Enhance Sync Initialization System
✅ Implement Status Management System
- Created StatusManager for centralized state tracking
- Added UI feedback through status bar
- Implemented event system for status changes

✅ Implement Sync Detection System
- Created SyncDetectionManager
- Added 5-second quiet period detection
- Integrated with main plugin flow

⏳ Enhance SyncFileManager (In Progress)
- Implement 20-second wait for file creation
- Add 5-second wait after file creation
- Improve file existence checking
- Enhance error recovery mechanisms
- Add detailed logging

🔄 Update Sync Settings
- Add configurable thresholds
- Implement settings validation
- Create settings migration system

## Phase 2: Core Features
### Multi-Device Sync 🔄
1. Sync Status Checking
- Design sync status data structure
- Implement status checking logic
- Add status validation system

2. Device Identification
- Create device ID generation
- Implement device tracking
- Add device validation

3. Sync State Tracking
- Design sync state schema
- Implement state persistence
- Add state recovery mechanisms

4. File Locking Mechanism
- Design locking protocol
- Implement lock acquisition
- Add lock timeout handling
- Create lock recovery system

5. Enhanced Status Reporting
- Design detailed status format
- Implement status updates
- Add progress tracking
- Create status history

## Phase 3: Advanced Features
### Delta Detection System 🔄
1. Change Detection
- Implement file diffing
- Create change categorization
- Add metadata comparison
- Design partial update detection

2. Diff Generation
- Implement chunk-level diffing
- Create efficient diff storage
- Add diff compression
- Design diff validation

3. Smart Processing
- Implement partial updates
- Create update prioritization
- Add batch processing
- Design update optimization

### Conflict Resolution 🔄
1. Basic Resolution
- Implement timestamp comparison
- Create version tracking
- Add conflict detection
- Design resolution workflow

2. Advanced Resolution
- Implement merge strategies
- Create conflict visualization
- Add manual resolution UI
- Design resolution history

## Dependencies & Sequence
1. Current Focus (⏳ In Progress)
   - Complete SyncFileManager enhancements
   - Implement remaining sync initialization features
   - Add configuration options

2. Next Steps
   - Begin Multi-Device sync implementation
   - Design device identification system
   - Create sync state tracking

3. Future Work
   - Delta detection system
   - Conflict resolution
   - Advanced features

## Critical Path
1. ⏳ Complete Sync Initialization
2. 🔄 Implement Multi-Device Sync
3. 🔄 Add Delta Detection
4. 🔄 Create Conflict Resolution

## Notes
- Status Management System is now handling plugin state ✅
- Sync Detection is managing quiet periods ✅
- SyncFileManager enhancements are next priority ⏳
- Multi-Device sync depends on completed initialization
- Delta detection requires stable sync system
- Conflict resolution needs all previous systems

Legend:
✅ Completed
⏳ In Progress
🔄 Not Started
⚡ High Priority

Sanity check the code and the todo list to see if the the list is up to date.

Dependencies and Considerations:
1. The database schema must be updated first as it affects all other components
2. Metadata extraction needs to be in place before enhancing document processing
3. Sync file management must be implemented before multi-device sync
4. Initial vault sync depends on both metadata extraction and sync file management
5. Delta detection requires both enhanced document processing and initial sync
6. Conflict resolution depends on all other systems being in place

