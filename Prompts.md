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
  - **QueueService**: Orchestrates task processing with configurable concurrency and retry logic (enhanced with an EventEmitter for granular UI feedback).
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

The database schema comprises two main tables and a semantic search function. The details are defined in the [sql/setup.sql](sql/setup.sql) file. In summary:

- **obsidian_documents**:
  Stores document chunks along with their embeddings and metadata. Fields include a unique ID, vault identifier, Obsidian file identifier, chunk index, content, metadata (in JSONB), the embedding vector (configured for 1536 dimensions), and timestamps for last update and vectorization.

- **obsidian_file_status**:
  Tracks file vectorization status for each document. Fields include a unique ID, vault identifier, file path, file modification timestamp, last vectorization timestamp, content hash, status, arrays for tags, aliases, and links, plus created and updated timestamps.

- **Semantic Search Function**:
  Provides a database-side function for matching document embeddings against a query embedding, returning matching documents along with their similarity scores.

---

## **Processing Workflow**

- **File Event Tracking**:
  - Hooks into Obsidian file events (create, modify, delete, rename) and queues them.
  - Uses the file path (`TFile.path`) as a unique identifier.
- **Task Queue**:
  - Supports concurrent processing with configurable limits.
  - Implements retry and backoff for failed tasks.
  - Provides detailed progress tracking and status updates via an integrated EventEmitter.
- **Chunking**:
  - Uses the TextSplitter to break documents into overlapping chunks.
  - Allows configuration of chunk size, overlap, and splitting rules.

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
  - The sync file (`_mindmatrixsync.md`) uses a YAML header to track cross-device coordination.
  - The database table `obsidian_file_status` is the authoritative source for file vectorization status.
- **Multi-Device Coordination & Recovery**:
  - Compare file timestamps and content hashes.
  - Handle concurrent modifications and sync conflicts.
  - Implement backup and recovery mechanisms for the sync file.

---

## **Sync File Architecture Refactoring**

### **Current Implementation**
The `_mindmatrixsync.md` file currently functions as a comprehensive file-by-file tracking system with a YAML header, containing a table that records file paths, modification timestamps, hashes, and sync status. This design has scalability issues and creates redundancy with database-based tracking.

### **New Approach**
The revised design focuses on cross-device coordination:
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

The plugin is designed to **treat user notes as immutable**. In earlier versions, fields like `vectorized_last` and `vectorized_version` were injected directly into a note's front matter to track processing state. To avoid the risks of modifying user files without explicit consent, all processing state—such as vectorization timestamps, versioning, and metadata—is stored externally in the Supabase database (in the `obsidian_file_status` table) and in the dedicated sync file (`_mindmatrixsync.md`).

---

## **Detailed Todo List**

### **Completed Tasks**

- **Sync File Architecture Refactoring**
  - Created `SyncModels.ts` for new cross-device coordination data structures.
  - Redesigned the sync file (`_mindmatrixsync.md`) to focus solely on device synchronization.
  - Implemented device identification tracking, sync timestamp recording, and enhanced backup/recovery mechanisms.
- **Settings and Metadata Handling**
  - Updated `Settings.ts` with device-specific settings and enhanced sync configuration options.
  - Refactored `ErrorHandler.ts` for improved reporting of sync and database issues.
  - Enhanced `MetadataExtractor.ts` by adding `extractMetadataFromContent` to merge front matter without modifying user files.
  - Updated `TextSplitter.ts` to include robust metadata extraction and read-only behavior.
- **Database Integration**
  - Implemented file status tracking in `SupabaseService.ts` using the `obsidian_file_status` table.
  - Added bulk operations support and improved error handling in SupabaseService.
- **User Data Safety**
  - Removed direct modifications to user notes.
  - All processing state is stored externally to preserve note immutability.
- **SyncFileManager.ts Updates**
  - Enhanced conflict detection and resolution strategies.
  - Added an alias for `validateSyncState()` to support legacy calls.
- **FileTracker.ts Updates**
  - Improved handling of edge cases (renames, deletions) and integrated basic offline mode support with an optional OfflineQueueManager.
- **StatusManager.ts Updates**
  - Added clearer connectivity indicators and detailed feedback in the UI.
- **InitialSyncManager.ts Updates**
  - Added support for resuming interrupted syncs.
  - Enhanced error handling for database operations.
- **QueueService.ts Updates**
  - Integrated an EventEmitter for granular UI feedback.
  - Improved error handling and event emission.
- **OfflineQueueManager.ts Implementation**
  - Developed a system for queuing operations during offline periods.
  - Implemented a reconciliation process to process queued operations upon restored connectivity.
- **EventEmitter.ts**
  - Provided a simple mechanism for event emission and subscription.
- **ErrorHandler.ts Updates**
  - Improved error normalization, logging, and specialized handling for sync and Supabase errors.
- **NotificationManager.ts Updates**
  - Implemented a fixed overall progress bar that displays progress in percent.
  - Optimized notification handling to keep the UI concise.

---

### **Pending Tasks (Findings & Improvements)**

1. **Sync File Architecture Enhancements**
   - Refine conflict detection and resolution strategies (e.g., automated resolution based on timestamps and content hashes).
   - Enhance real-time connection state monitoring with corresponding UI updates.

2. **Database-Based File Tracking Improvements**
   - Continue refining FileTracker and InitialSyncManager to fully rely on database status and handle edge cases (especially for file renames and deletions).
   - Optimize database queries (consider caching or bulk operations) to improve performance in large vaults.
   - Develop comprehensive unit and integration tests for database operations and state reconciliation.

3. **Enhanced Metadata Integration**
   - Further improve metadata extraction in TextSplitter and MetadataExtractor.
   - Validate that merging metadata does not affect user file content.
   - Optionally enhance the embedding process by allowing external metadata to be prepended to text chunks.

4. **Offline Mode Support**
   - Improve mechanisms to detect and handle offline scenarios.
   - Enhance the OfflineQueueManager reconciliation process.
   - Add detailed UI feedback (via StatusManager) to inform users about connectivity status and offline operation processing.

5. **Queue Status Event System Enhancements**
   - Fine-tune event emissions in QueueService and further integrate with the EventEmitter.
   - Complete wiring of the main plugin event system to ensure real-time status updates are consistently delivered to the UI.

6. **Code Quality and Maintainability Improvements**
   - Consider formalizing dependency injection for service instantiation to improve testability and service decoupling.
   - Separate complex service responsibilities (e.g., in SyncFileManager) into smaller, more focused modules.
   - Standardize naming conventions and increase inline documentation for clarity.
   - Add or improve unit and integration tests, especially for critical modules (database operations, sync file management, and queue processing).

---

## **Development Goals**

1. Achieve high performance even with large vaults.
2. Provide robust error recovery and task retry mechanisms.
3. Offer a seamless and intuitive user experience with clear feedback.
4. Enhance semantic search accuracy through richer metadata integration.
5. Support efficient initial vault synchronization.
6. Maintain consistent data across multiple devices while preserving user note integrity.
