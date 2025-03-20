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
Check the following tasks against the code base to make sure they have been implemented correctly:
### **Pending Tasks (Findings & Improvements)**

1. **Thorough Testing**:
   - Conduct extensive testing with large vaults and concurrent operations.
   - Implement automated tests for core services and edge cases.
   - Create tests that create an .md file with content and then ckeck the database contents to verify the data is stored correctly.
   - Modify the file and check the database again to verify the data is updated correctly.
   - Delete the file and check the database to verify the data is deleted correctly.
2. **Settings UI**:
   - The user sees in the plugin UI the ".git, .obsidian, node_modules" which should not be shown in the UI.
   - Also don't show in the ".mp3, .jpg, .png" in the exclude file types in the UI.

---

## **Development Goals**

1. Achieve high performance even with large vaults.
2. Provide robust error recovery and task retry mechanisms.
3. Offer a seamless and intuitive user experience with clear feedback.
4. Enhance semantic search accuracy through richer metadata integration.
5. Support efficient initial vault synchronization.
6. Maintain consistent data across multiple devices while preserving user note integrity.

---
