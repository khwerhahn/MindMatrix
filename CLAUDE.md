# DEPRICATED: Obsidian RAG Architecture

This Project uses OpenAi Codex AGENTS.md file for this purpose.

## Overview

Obsidian RAG is an Obsidian plugin that enhances note-taking by synchronizing documents with a Supabase vector database for AI-powered search. The plugin generates embeddings through a local-first Ollama integration with automatic OpenAI fallback while maintaining data integrity and user experience. It operates entirely within the Obsidian environment, leveraging remote services (Supabase and optional OpenAI) alongside self-hosted Ollama for data storage and processing.

The primary purpose of Obsidian RAG is to enable users to create chatbots through n8n that can query and interact with their Obsidian knowledge base. By storing document embeddings in Supabase, the plugin makes the entire vault searchable and accessible to AI-powered applications, allowing users to build custom workflows and chatbots that leverage their personal knowledge base.

The plugin implements a worker actor model with an in-memory event queue to ensure immediate response to user actions while maintaining data consistency. When a user starts typing in Obsidian, the plugin immediately detects these changes and queues them for processing, even while initialization and system startup procedures are running in the background.

## Design Principles

- **Worker Actor Model**: Clear separation of concerns between file event detection and processing
- **Atomic Processing**: Maintaining strict sequential processing to ensure data consistency
- **Offline Resilience**: Robust operation even when connectivity is interrupted
- **Performance**: Minimizing impact on Obsidian while efficiently handling large vaults
- **Reliability**: Comprehensive error handling and recovery mechanisms
- **Testability**: Architecture designed to support comprehensive testing

## Core Components

### 1. Actor System

- **File Watcher Actor**:
  - Hooks into Obsidian file system events
  - Detects file creation, modification, deletion, and moves
  - Generates file change events with metadata
  - Adds events to the in-memory processing queue immediately
  - Operates with minimal latency to capture user changes

- **Startup Scanner Actor**:
  - Activates once during plugin initialization
  - Runs non-blockingly in the background
  - Queries remote database for file statuses and hashes
  - Scans local vault files and calculates hashes
  - Identifies differences between local and remote state
  - Adds files needing synchronization to the queue
  - Respects file exclusion settings

- **Worker Actor**:
  - Runs in a separate Web Worker thread
  - Polls the event queue for new tasks
  - Processes events sequentially to maintain atomicity
  - Calculates file hashes when processing events
  - Handles connectivity to external services
  - Implements retry logic for failed operations
  - Reports progress back to main thread

- **Coordinator**:
  - Manages initialization and shutdown sequences
  - Maintains communication between actors
  - Handles plugin lifecycle events
  - Provides synchronization primitives
  - Manages service connections and state

### 2. Event Queue System

- **Queue Management**:
  - Pure in-memory event queue (no persistence)
  - Strict FIFO (First-In-First-Out) ordering
  - Timestamps for all events to maintain chronology
  - Lightweight implementation for performance
  - Support for priority events (e.g., manual rescans)

- **Event Types**:
  - `FILE_CREATED`: New file detected
  - `FILE_MODIFIED`: Existing file changed
  - `FILE_DELETED`: File removed from vault
  - `FILE_MOVED`: File path changed
  - `RESCAN_REQUESTED`: Manual rescan triggered
  - `VAULT_SCAN`: Full vault scan requested

- **Event Processing States**:
  - `QUEUED`: Added to queue, awaiting processing
  - `PROCESSING`: Currently being processed
  - `COMPLETED`: Successfully processed
  - `FAILED`: Processing failed, pending retry
  - `RETRYING`: Being retried after failure

### 3. File Tracking System

- **File State Management**:
  - Content hash calculation (SHA-256)
  - Path and metadata tracking
  - Change detection based on hash comparison
  - Obsidian metadata extraction (frontmatter, tags, links)
  - Exclusion rule application

- **Hashing Strategy**:
  - Full content hash for change detection
  - Incremental hashing for large files
  - Hash comparison with remote database
  - Hash caching for performance
  - Hash verification on processing

- **Metadata Extraction**:
  - YAML frontmatter parsing
  - Tag detection and normalization
  - Internal link extraction
  - Document structure analysis
  - Content type detection

### 4. Processing Pipeline

- **Initialization**:
  - Plugin startup sequence
  - Service connection establishment
  - Worker thread creation
  - Event listener registration
  - State restoration

- **Document Processing**:
  - File content reading
  - Content chunking with configurable strategies
  - Metadata extraction and normalization
  - Embedding generation via Ollama with OpenAI fallback
  - Supabase database synchronization

- **Synchronization**:
  - Remote hash comparison
  - Atomic database operations
  - Transaction management
  - Conflict resolution
  - State verification

### 5. Database Integration (Supabase)

- **Tables**:
  - `obsidian_documents`: Document chunks and embeddings
    - ID, file_status_id, chunk_index, content
    - Metadata (JSONB), embedding vector (1536d)
    - Timestamps and versioning
  - `obsidian_file_status`: File tracking
    - ID, file_path, content_hash
    - Modification time, status
    - Metadata, tags, links

- **Operations**:
  - Atomic file status updates
  - Chunk creation and deletion
  - Path updates for moved files
  - Batch operation support
  - Transaction management

### 6. Worker Thread Implementation

- **Worker Lifecycle**:
  - Created during plugin initialization
  - Starts processing loop immediately
  - Continues running throughout plugin lifecycle
  - Graceful termination on plugin disable

- **Processing Loop**:
  - Infinite `while(true)` loop pattern
  - Polling with configurable intervals
  - Sleep periods to prevent CPU thrashing
  - Dynamic polling interval adjustment
  - Connectivity state awareness

- **Task Processing**:
  - Single task execution at a time
  - Complete processing before moving to next task
  - Progress reporting to main thread
  - Error handling with intelligent retry
  - Service state management

### 7. Settings Management

- **Configuration Options**:
  - API credentials (Supabase, Ollama, optional OpenAI)
  - Processing parameters
  - Exclusion patterns
  - Chunking strategies
  - Hash algorithm selection

- **Rescan Options**:
  - Manual trigger for single file rescan
  - Full vault rescan functionality
  - Scheduled rescans
  - Verification scans
  - Partial rescans based on paths

## Data Flow

### Plugin Startup Sequence

1. **Initialization**:
   - Plugin loads and immediately initializes file watcher
   - Empty in-memory queue is created
   - File Watcher Actor begins listening for changes

2. **Non-blocking Startup Scan**:
   - Separate Startup Scan Worker activates in background
   - Queries remote Supabase database for file entries and hashes
   - Scans local vault files and calculates hashes
   - Compares local and remote hashes
   - Adds files with differences to processing queue
   - Runs concurrently without blocking UI or file watcher

### Runtime Processing

1. **File Event Detection**:
   - Obsidian emits file system event
   - File Watcher Actor captures event immediately
   - Event is timestamped and validated
   - Event is queued for processing
   - Hash calculation is deferred to processing phase

2. **Event Processing**:
   - Worker Actor polls queue for next event
   - Event is marked as "processing"
   - File content is read and hash is calculated
   - Remote database is queried for existing file status
   - Hash comparison determines required action

3. **Content Processing**:
   - File is chunked according to strategy
   - Metadata is extracted from content
   - Embedding service requests vectors from Ollama, falling back to OpenAI when necessary
   - Chunks and embeddings are prepared for storage

4. **Database Synchronization**:
   - Transaction is created for atomic operations
   - Existing entries are updated or deleted
   - New entries are inserted
   - File status is updated
   - Transaction is committed

5. **Completion and Reporting**:
   - Event is marked as "completed"
   - Main thread is notified of completion
   - UI is updated with status
   - Worker returns to polling for next event

## Testing Strategy

### Unit Tests

- **Service Components**:
  - Test individual services in isolation
  - Mock external dependencies
  - Verify correct behavior for each function
  - Test error handling paths
  - Validate proper state management

- **Utility Functions**:
  - Test hashing functions
  - Validate chunking algorithms
  - Verify metadata extraction
  - Test queue management
  - Validate path normalization

- **In-memory Queue**:
  - Test event ordering by timestamp
  - Verify priority event handling
  - Test concurrent additions to queue
  - Validate queue statistics reporting
  - Test queue state transitions

### Integration Tests

- **Worker Process**:
  - Test end-to-end processing
  - Verify event handling
  - Validate database operations
  - Test service interactions
  - Verify state consistency

- **Database Integration**:
  - Test connection handling
  - Verify transaction management
  - Validate query performance
  - Test error recovery
  - Verify data integrity

### Snapshot Tests

- **File Processing**:
  - Process sample files
  - Capture database state
  - Compare with expected outputs
  - Verify consistency across runs
  - Test with different configurations

- **API Integration**:
  - Test Ollama endpoint interactions
  - Test OpenAI fallback flows
  - Verify embedding generation and dimensionality
  - Test rate limiting handling
  - Verify error recovery

## Obsidian Integration

### Plugin Lifecycle

- **Loading**:
  - Initialize plugin components
  - Restore saved state
  - Connect to services
  - Start worker thread
  - Register event listeners

- **Running**:
  - Process file events
  - Update database
  - Provide user feedback
  - Handle settings changes
  - Manage error states

- **Unloading**:
  - Complete pending operations
  - Save queue state
  - Terminate worker thread
  - Clean up resources
  - Disconnect from services

### User Interface

- **Status Indicator**:
  - Show queue status
  - Display processing state
  - Indicate connection status
  - Show error notifications
  - Enable manual actions

- **Settings Panel**:
  - API configurations
  - Processing parameters
  - Exclusion patterns
  - Rescan options
  - Debug settings

## Database Operations

### Database Structure

- **Tables**:
  - `obsidian_documents`: Stores document chunks and embeddings
  - `obsidian_file_status`: Tracks file metadata and sync status

- **Key Operations**:
  - File status updates
  - Document chunk management
  - Vector embeddings storage
  - Metadata indexing

### Database Verification Checklist

The following checklist should be used to verify the database setup is correct before deploying or troubleshooting:

- [ ] **Table Structure**: Verify tables exist with correct schema
  ```bash
  # Check tables in public schema
  psql -h <host> -p 5432 -d postgres -U <user> -c "\dt public.*"

  # Examine table structure
  psql -h <host> -p 5432 -d postgres -U <user> -c "\d+ public.obsidian_documents"
  psql -h <host> -p 5432 -d postgres -U <user> -c "\d+ public.obsidian_file_status"
  ```

- [ ] **Row-Level Security**: Ensure RLS policies are correctly configured
  ```bash
  # Check RLS policies
  psql -h <host> -p 5432 -d postgres -U <user> -c "SELECT * FROM pg_policies WHERE schemaname = 'public';"
  ```

- [ ] **Indexes**: Verify proper indexes for performance
  ```bash
  # Check indexes
  psql -h <host> -p 5432 -d postgres -U <user> -c "\di public.*"
  ```

- [ ] **Functions**: Confirm any required functions exist
  ```bash
  # List functions
  psql -h <host> -p 5432 -d postgres -U <user> -c "\df public.*"
  ```

- [ ] **Permissions**: Validate correct permissions for the application user
  ```bash
  # Check permissions
  psql -h <host> -p 5432 -d postgres -U <user> -c "\dp public.*"
  ```

- [ ] **Vector Extension**: Confirm pgvector extension is installed and configured
  ```bash
  # Check extensions
  psql -h <host> -p 5432 -d postgres -U <user> -c "\dx"
  ```

- [ ] **Test Queries**: Run test queries to verify functionality
  ```bash
  # Test vector search
  psql -h <host> -p 5432 -d postgres -U <user> -c "SELECT id FROM obsidian_documents ORDER BY embedding <-> '[0.1, 0.2, ...]'::vector LIMIT 5;"
  ```

## Development Approach

## Project Structure

The Obsidian RAG plugin follows a simple, flat file structure organized by function:

- **`models/`**: Data models and type definitions for domain objects
- **`services/`**: Business logic and core functionality
- **`types/`**: TypeScript definitions
  - Interface definitions
  - Type aliases
  - Enums for system states

- **`utils/`**: Helper utilities
  - Hash calculation
  - Path manipulation
  - YAML frontmatter parsing
  - Error handling
- **`sql/`**: Database scripts
  - `setup.sql`: Initial database setup
  - `reset.sql`: Database reset script
- **`tests/`**: Test suite
- **Root Directory**:
  - `main.ts`: Plugin entry point
  - `manifest.json`: Plugin metadata
  - `TASKS.md`: Current task planning document
  - `README.md`: Project documentation
  - `CLAUDE.md`: Architecture documentation

### Test-Driven Development

- **TASKS.md Planning**:
  - Maintain a central TASKS.md file for project planning
  - Document all current tasks, priorities, and progress
  - Update the file at the beginning of each work session
  - Track dependencies between tasks
  - Record completed tasks with completion dates
  - Use as a communication tool between team members

- **Test-First Methodology**:
  - Write tests before implementing features
  - Define expected behavior clearly
  - Use tests as living documentation
  - Ensure edge cases are covered
  - Create integration tests for critical paths

- **Feature Completion Cycle**:
  - Feature request or issue is created and added to TASKS.md
  - Tasks are broken down into testable components
  - Tests are written to define acceptance criteria
  - Implementation is developed to pass tests
  - Code review with test validation
  - User testing and feedback is collected
  - Feature is only marked complete when:
    1. All tests pass
    2. Code review is approved
    3. User explicitly confirms functionality works as expected
  - Completed feature is marked in TASKS.md with date and version

### Collaborative Problem-Solving

- **Critical Thinking Process**:
  - Clearly define problems before attempting solutions
  - Consider multiple approaches and their tradeoffs
  - Evaluate solutions against requirements and constraints
  - Document decision-making process and rationale
  - Remain flexible to pivot when new information emerges

- **User Collaboration**:
  - Regular feedback sessions with users
  - Prioritize user experience over technical elegance
  - Validate assumptions with real-world usage patterns
  - Incorporate user insights into design decisions
  - Use user feedback to refine and improve solutions

- **Research-Based Approach**:
  - Use Perplexity and other tools to research best practices
  - Reference official documentation for all technologies
  - Study similar implementations for insights
  - Benchmark different approaches when performance critical
  - Stay current with library and framework updates

### Git Workflow

- **Feature Branch Strategy**:
  - Create dedicated branch for each feature or fix
  - Use descriptive branch names (feature/file-watcher, fix/queue-ordering)
  - Keep branches focused and limited in scope
  - Regular rebasing to incorporate upstream changes

- **Commit Practices**:
  - Atomic, focused commits with clear messages
  - Include test additions/changes in separate commits
  - Reference issue numbers in commit messages
  - Include brief explanation of "why" not just "what"

- **Code Review Process**:
  - All changes reviewed before merging
  - Automated checks must pass before review
  - Focus on maintainability and clarity
  - Consider performance implications
  - Verify test coverage

- **Release Cycle**:
  - Feature-based releases with semantic versioning
  - Comprehensive release notes
  - Beta testing for major changes
  - Staged rollout for critical components

## Conclusion

The Obsidian RAG architecture provides a robust, scalable solution for synchronizing Obsidian vaults with Supabase vector databases. By implementing a worker actor model with strict event ordering and atomic processing, the plugin ensures data consistency while maintaining performance. The hash-based change detection minimizes unnecessary processing and API calls, while the event queue system ensures reliable operation even during connectivity issues.
