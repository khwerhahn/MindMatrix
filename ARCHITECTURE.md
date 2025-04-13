# MindMatrix Architecture

## Overview
MindMatrix is an Obsidian plugin that enhances note-taking by synchronizing documents with a Supabase vector database for AI-powered search. The plugin provides semantic search capabilities through OpenAI embeddings while maintaining data integrity and user experience. It operates entirely within the Obsidian environment, using remote services (Supabase and OpenAI) for data storage and processing.

The primary purpose of MindMatrix is to enable the creation of chatbots through n8n that can query and interact with your Obsidian knowledge base. By storing document embeddings in Supabase, the plugin makes your entire vault searchable and accessible to AI-powered applications, allowing you to build custom workflows and chatbots that can leverage your personal knowledge base.

## Core Components

### 1. Database Layer (Supabase)
- **PostgreSQL Database**: Stores document metadata and relationships
- **Tables**:
  - `obsidian_documents`: Stores document chunks with embeddings and metadata
    - Fields: ID, vault_id, file_id, chunk_index, content, metadata (JSONB), embedding vector (1536d), timestamps
  - `obsidian_file_status`: Tracks file vectorization status
    - Fields: ID, vault_id, file_path, modification_time, vectorization_time, content_hash, status, tags, aliases, links
- **Functions**:
  - Semantic search function for matching document embeddings
  - `get_document_metadata`: Retrieves document metadata
  - `get_related_documents`: Finds related documents
  - `update_document_status`: Updates document status

### 2. Plugin Services
- **Service-Oriented Design**:
  - **SupabaseService**: Handles all database interactions
    - Document chunk upserts
    - File status tracking
    - Semantic search queries
  - **OpenAIService**: Manages API calls for embeddings
    - Rate limiting
    - Error handling
  - **QueueService**: Orchestrates task processing
    - Configurable concurrency
    - Retry logic
    - EventEmitter for UI feedback
  - **SyncManager**: Manages synchronization
    - Local file state tracking
    - Sync file management (`_mindmatrixsync.md`)
    - Database fallback handling
  - **EventEmitter**: Inter-service communication
  - **StatusManager**: Centralizes plugin state
    - Status icons
    - Connectivity indicators
    - Progress notifications
  - **SyncDetectionManager**: Monitors file events
  - **InitialSyncManager**: Handles initial vault sync
    - Resume interrupted syncs
    - Database state leverage
- **Utilities**:
  - **TextSplitter**: Document chunking
    - Configurable size and overlap
    - Sentence/paragraph boundaries
  - **ErrorHandler**: Centralized error management
  - **NotificationManager**: Progress feedback
  - **FileTracker**: Sync state management
  - **OfflineQueueManager**: Offline operation handling

### 3. UI Layer
- **Settings Interface**: Plugin configuration and status
- **UI Components**:
  - Status indicators
  - Progress bars
  - Settings panels
- **State Management**: Handles plugin state and user preferences

### 4. Obsidian Integration
- **Obsidian API Integration**: Interfaces with Obsidian's API
- **Event Handling**: Manages Obsidian events (file changes, etc.)
- **Settings Management**: Handles plugin configuration
- **File System Integration**: Monitors and processes vault changes

## Data Flow
1. User opens Obsidian
2. Plugin initializes and connects to Supabase
3. Document changes trigger updates to database
4. Status indicators update based on sync state
5. User interactions update settings and trigger operations

## Processing Workflow
- **File Event Tracking**:
  - Hooks into Obsidian file events
  - Uses file path as unique identifier
- **Task Queue**:
  - Concurrent processing
  - Retry and backoff logic
  - Progress tracking
- **Chunking**:
  - TextSplitter for document segmentation
  - Configurable parameters

## Synchronization Architecture
- **Initialization Phases**:
  1. Pre-Initialization
  2. Status Management
  3. Sync Readiness Check
  4. Services Initialization
  5. Post-Initialization
- **Sync State Management**:
  - Sync file with YAML header
  - Database as authoritative source

## Dependencies
- Obsidian API
- Supabase PostgreSQL
- TypeScript
- OpenAI API (for embeddings) 