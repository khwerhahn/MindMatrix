# MindMatrix Architecture

## Overview
MindMatrix is an Obsidian plugin that enhances note-taking by synchronizing documents with a Supabase vector database for AI-powered search. The plugin provides semantic search capabilities through OpenAI embeddings while maintaining data integrity and user experience.

## Core Components

### 1. Database Layer
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

### 2. Backend Layer
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

### 3. Frontend Layer
- **Matrix View**: Visual representation of documents and relationships
- **UI Components**:
  - Document nodes
  - Relationship lines
  - Controls for filtering and layout
- **State Management**: Handles document selection and view state

### 4. Integration Layer
- **Obsidian API Integration**: Interfaces with Obsidian's API
- **Event Handling**: Manages Obsidian events (file changes, etc.)
- **Settings Management**: Handles plugin configuration

## Data Flow
1. User opens Obsidian
2. Plugin initializes and connects to database
3. Document changes trigger updates to database
4. Matrix view updates based on database state
5. User interactions update view and database

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
- React (for UI components)
- TypeScript
- OpenAI API (for embeddings) 