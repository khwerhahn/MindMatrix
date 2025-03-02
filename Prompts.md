# **Project Prompt**

I am working on an Obsidian plugin called **"mind-matrix"** that syncs documents with a Supabase vector database for AI-powered search. This document outlines the architectural decisions, implemented features, pending tasks, and the current state of the project. It is used to provide context for both human collaborators and AI assistants contributing to the project.

---

## **Project Overview**

The **"mind-matrix"** plugin enhances Obsidian by synchronizing notes with a Supabase vector database, enabling semantic search via OpenAI embeddings. Its primary objectives are:

1. **Document Management**: Efficiently sync document chunks to a vector database.
2. **Search Integration**: Leverage OpenAI embeddings for powerful semantic search.
3. **User Experience**: Provide clear and immediate feedback on sync progress and error conditions.
4. **Performance**: Support large vaults with robust error recovery, processing queues, and eventual optimization.

---

## **Architecture and Key Decisions**

### **1. Core Architecture**
- **Plugin Entry Point**: `main.ts` initializes core services and manages event handling.
- **Service-Oriented Design**:
  - **SupabaseService**: Handles all database interactions, including document chunk upserts, file status tracking, and semantic search queries.
  - **OpenAIService**: Manages API calls for generating embeddings with built-in rate limiting and error handling.
  - **QueueService**: Orchestrates task processing with configurable concurrency and retry logic. (Enhanced with an EventEmitter for granular UI feedback.)
  - **SyncManager**: Manages synchronization between local file state and the sync file (`_mindmatrixsync.md`), acting as a fallback when the database is not available.
  - **EventEmitter**: Provides a mechanism for inter-service communication, especially for queue status updates.
  - **StatusManager**: Centralizes plugin state tracking and UI feedback (e.g., status icons, connectivity indicators, and progress notifications).
  - **SyncDetectionManager**: Monitors Obsidian file events to detect a quiet sync period.
  - **InitialSyncManager**: Manages the initial vault synchronization, with support for resuming interrupted syncs and leveraging database state.
- **Utilities**:
  - **TextSplitter**: Splits document content into chunks based on configurable chunk size, overlap, and sentence/paragraph boundaries.
  - **ErrorHandler**: Centralizes error logging and recovery, including both console and file logging.
  - **NotificationManager**: Provides notifications and displays a fixed progress bar with percentage feedback.
  - **FileTracker**: Tracks file events and manages sync state—now updated to use the database as the primary source (with the sync file as a fallback).
  - **OfflineQueueManager**: Queues operations during offline periods and processes them upon restored connectivity.

**Important Architectural Decision Regarding User Files:**

To ensure user data integrity, **only the dedicated sync file (`_mindmatrixsync.md`) is modified by the plugin**. All state records (such as vectorization timestamps, processing metadata, and version information) are stored externally in the Supabase database and in the sync file for cross-device coordination. This design ensures that user notes remain immutable by default, avoiding unintended modifications to user content unless a user explicitly opts in.

---

## **Database Schema**

- **obsidian_documents** table for storing document chunks, embeddings, and metadata:
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
      vectorized_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(vault_id, obsidian_id, chunk_index)
  );

  CREATE INDEX idx_vault_obsidian ON obsidian_documents(vault_id, obsidian_id);
  ```

- **obsidian_file_status** table for tracking file vectorization status:
  ```sql
  CREATE TABLE obsidian_file_status (
      id BIGSERIAL PRIMARY KEY,
      vault_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      last_modified BIGINT NOT NULL,
      last_vectorized TIMESTAMPTZ,
      content_hash TEXT,
      status TEXT,
      tags TEXT[],
      aliases TEXT[],
      links TEXT[],
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(vault_id, file_path)
  );

  CREATE INDEX idx_file_status_vault_path ON obsidian_file_status(vault_id, file_path);
  ```

- **Semantic Search Function**:
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

---

## **Processing Workflow**

- **File Event Tracking**:
  - Hooks into Obsidian file events (create, modify, delete, rename) and queues them.
  - Uses the file path (TFile.path) as a unique identifier.
- **Task Queue**:
  - Supports concurrent processing with configurable limits.
  - Implements retry and backoff for failed tasks.
  - Provides detailed progress tracking and status updates via an integrated EventEmitter.
- **Chunking**:
  - Uses the TextSplitter to break documents into overlapping chunks.
  - Configurable chunk size, overlap, and splitting rules.

---

## **Synchronization Architecture**

- **Initialization Phases**:
  1. **Pre-Initialization**:
     - Load minimal core services (ErrorHandler, NotificationManager).
     - Load settings from disk.
     - Register basic event handlers.
  2. **Status Management**:
     - Initialize the StatusManager for centralized UI feedback.
     - Setup inter-service event communication.
     - Start the queue monitoring and sync detection.
  3. **Sync Readiness Check** (via SyncManager):
     - Verify the existence and integrity of the sync file (`_mindmatrixsync.md`).
     - Monitor sync status with multiple checks and timeout handling.
  4. **Services Initialization**:
     - Initialize SupabaseService with a connection check.
     - Initialize OpenAIService with API validation.
     - Setup FileTracker for an initial vault scan.
     - Create the QueueService with configured parameters.
  5. **Post-Initialization**:
     - Register file event handlers.
     - Setup command palette actions.
     - Initialize settings UI.
     - Begin normal plugin operation.
- **Sync State Management**:
  - The sync file (`_mindmatrixsync.md`) uses a simple YAML header to track cross-device coordination.
  - The database table `obsidian_file_status` is the primary source for vectorization status.
- **Multi-Device Coordination & Recovery**:
  - Compare file timestamps and content hashes.
  - Handle concurrent modifications and sync conflicts.
  - Implement backup and recovery mechanisms for the sync file.

---

## **Sync File Architecture Refactoring**

### **Current Implementation**
The `_mindmatrixsync.md` file currently serves as a comprehensive file-by-file tracking system with a YAML header and a table recording paths, modification timestamps, hashes, and sync status. This approach has scalability issues and redundancy with the database-based tracking.

### **New Approach**
The new design of the `_mindmatrixsync.md` file will focus solely on cross-device coordination:
1. **Primary Role**:
   - The database is the authoritative source for file status tracking.
   - The sync file is used for cross-device coordination, as a fallback during database outages, and for recovery after connectivity issues.
2. **Sync File Structure**:
   - **Device Information**: Tracks unique device IDs, names, platforms, and timestamps.
   - **Sync Timestamps**: Records the last successful synchronization for each device.
   - **Delta Detection**: Stores minimal metadata to detect cross-device inconsistencies.
   - **Connection Status**: Monitors online/offline status for intermittent connectivity.
3. **Size Optimization**:
   - Eliminates per-file tracking entries.
   - Focuses solely on cross-device coordination.
   - Uses a compact format for essential information.

---

## **Key Architectural Decision on Note Immutability**

The plugin is designed to **treat user notes as immutable**. In earlier versions, fields like `vectorized_last` and `vectorized_version` were injected directly into a note's front matter to track processing state. However, modifying user files without explicit consent is risky. Therefore, the architecture has been revised so that all processing state—such as vectorization timestamps, versioning, and metadata—is now stored externally in the Supabase database (in the `obsidian_file_status` table) and in the dedicated sync file (`_mindmatrixsync.md`). This ensures that user notes remain unaltered unless the user explicitly opts in to modifications.

---

## **Detailed Todo List**

### **Completed Tasks**

- [x] **Sync File Architecture Refactoring**
  - Created `SyncModels.ts` for new cross-device coordination data structures.
  - Redesigned the sync file (`_mindmatrixsync.md`) to focus solely on device synchronization.
  - Implemented device identification tracking, sync timestamp recording, and enhanced backup/recovery mechanisms.
- [x] **Settings and Metadata Handling**
  - Updated `Settings.ts` with device-specific settings and enhanced sync configuration options.
  - Refactored `ErrorHandler.ts` for improved reporting of sync and database issues.
  - Enhanced `MetadataExtractor.ts` by adding `extractMetadataFromContent` to merge front matter without modifying user files.
  - Updated `TextSplitter.ts` to include robust metadata extraction and read-only behavior.
- [x] **Database Integration**
  - Implemented file status tracking in `SupabaseService.ts` using the `obsidian_file_status` table.
  - Added bulk operations support and improved error handling in SupabaseService.
- [x] **User Data Safety**
  - Removed direct modifications to user notes.
  - All processing state is stored externally to preserve note immutability.
- [x] **SyncFileManager.ts Updates**
  - Enhanced conflict detection and resolution strategies.
  - Added an alias for `validateSyncState()` to support legacy calls.
- [x] **FileTracker.ts Updates**
  - Improved handling of edge cases (renames, deletions) and integrated basic offline mode support with an optional OfflineQueueManager.
- [x] **StatusManager.ts Updates**
  - Added clearer connectivity indicators and detailed feedback in the UI.
- [x] **InitialSyncManager.ts Updates**
  - Added support for resuming interrupted syncs.
  - Enhanced error handling for database operations.
- [x] **QueueService.ts Updates**
  - Integrated an EventEmitter for granular UI feedback.
  - Improved error handling and event emission.
- [x] **OfflineQueueManager.ts Implementation**
  - Developed a system for queuing operations during offline periods.
  - Implemented a reconciliation process to process queued operations upon restored connectivity.
- [x] **EventEmitter.ts**
  - Provided a simple mechanism for event emission and subscription.
- [x] **ErrorHandler.ts Updates**
  - Improved error normalization, logging, and specialized handling for sync and Supabase errors.
- [x] **NotificationManager.ts Updates**
  - Implemented a fixed overall progress bar that displays progress in percent.
  - Optimized notification handling to keep the UI concise.

---

### **Pending Tasks**

1. **Sync File Architecture Enhancements**
   - Further refine conflict detection and resolution strategies (e.g., automated resolution based on timestamps and content hashes).
   - Enhance real-time connection state monitoring and corresponding UI updates.
2. **Database-Based File Tracking Improvements**
   - Continue refining FileTracker and InitialSyncManager to fully rely on database status and handle edge cases.
   - Optimize database queries and consider caching or additional bulk operations.
   - Develop comprehensive unit and integration tests for database operations and state reconciliation.
3. **Enhanced Metadata Integration**
   - Further improve metadata extraction in TextSplitter and MetadataExtractor.
   - Validate the merging of metadata without affecting user file content.
   - Optionally enhance embedding processes by prepending external metadata to text chunks.
4. **Offline Mode Support**
   - Improve mechanisms to detect and handle offline scenarios.
   - Enhance the OfflineQueueManager reconciliation process.
   - Add detailed UI feedback via the StatusManager to inform users about connectivity status.
5. **Queue Status Event System Enhancements**
   - Fine-tune event emissions in QueueService and further integrate with the EventEmitter.
   - Complete wiring of the main plugin event system for real-time status updates.

---

## **Development Goals**

1. Achieve high performance even with large vaults.
2. Provide robust error recovery and task retry mechanisms.
3. Offer a seamless and intuitive user experience with clear feedback.
4. Enhance semantic search accuracy through richer metadata integration.
5. Support efficient initial vault synchronization.
6. Maintain consistent data across multiple devices while preserving user note integrity.
