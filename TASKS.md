# Implementation Plan to Align with ARCHITECTURE.md

## Important Note
All implementation tasks must strictly follow the architecture design described in ARCHITECTURE.md. The architecture defines:
- Clear separation between file status and document content
- Strict atomic changes approach
- Sequential event queue processing
- Proper Obsidian integration patterns
- Error handling and recovery procedures

Any deviation from the architecture design must be documented and justified.

## Testing and Commit Guidelines
- Each task must be tested by the user before being marked as complete
- Testing should verify both the happy path and error cases
- Each commit should have a descriptive message following the format:
  ```
  feat|fix|refactor|test|docs: [component] Brief description
  
  - Detailed explanation of changes
  - Testing performed
  - Any known limitations
  ```
- Example commit message:
  ```
  feat: [FileTracker] Implement atomic file rename sequence
  
  - Add atomic rename sequence for file operations
  - Update file status before content changes
  - Add validation for rename operations
  
  Testing:
  - Verified normal rename operation
  - Tested rename to excluded location
  - Confirmed error handling for failed renames
  
  Limitations:
  - Network errors during rename may require manual intervention
  ```

## Initialization and Setup Checks
- [ ] Plugin Initialization:
  - [ ] Check API keys in settings
    - [ ] Validate Supabase URL and API key
    - [ ] Validate OpenAI API key
    - [ ] Show clear error messages if keys are missing
    - [ ] Disable operations if keys are invalid
    - [ ] Add "Start Initial Scan" button in settings when ready
    - [ ] Test: Verify all validation cases and user feedback
  - [ ] Database State Check:
    - [ ] Query database for existing entries
    - [ ] Determine if full scan is required
    - [ ] Log database state for debugging
    - [ ] Test: Verify database state detection and logging
  - [ ] Sync File Management:
    - [ ] Check for `_mindmatrixsync.md` existence
    - [ ] Create sync file if missing
    - [ ] Reset sync file if database is empty
    - [ ] Validate sync file content
    - [ ] Test: Verify sync file creation and validation
  - [ ] Event Queue Initialization:
    - [ ] Start queue processing
    - [ ] Ensure file operations are tracked immediately
    - [ ] Queue any pending operations
    - [ ] Log queue initialization status
    - [ ] Test: Verify queue initialization and operation tracking

## File Operation Handling
- [ ] Event Queue Processing:
  - [ ] Ensure strict sequential processing
  - [ ] Implement proper event ordering
  - [ ] Add event persistence
  - [ ] Handle queue recovery
  - [ ] Test queue behavior under load
  - [ ] Test: Verify sequential processing and recovery

- [ ] File Move/Rename Operations:
  - [ ] Implement atomic rename sequence:
    1. Update file status with new path
    2. Verify update success
    3. Check new location against exclusions
    4. Remove remote data if excluded
  - [ ] Add validation for rename operations
  - [ ] Implement proper error handling
  - [ ] Test rename scenarios:
    - [ ] Normal rename
    - [ ] Rename to excluded location
    - [ ] Rename with existing file
    - [ ] Rename with network issues
  - [ ] Test: Verify all rename scenarios and error handling

## 1. Database Layer Updates
- [ ] Update `sql/setup.sql`:
  - [ ] Rename `file_id` to `file_status_id` in `obsidian_documents` table
  - [ ] Add foreign key constraint between `obsidian_documents` and `obsidian_file_status`
  - [ ] Update table comments to reflect separation of concerns
  - [ ] Add proper index on `file_status_id`
  - [ ] Test: Verify table structure and constraints
- [ ] Update `sql/reset.sql`:
  - [ ] Update table drop order to respect foreign key constraints
  - [ ] Add cleanup of orphaned records
  - [ ] Update table recreation to match new schema
  - [ ] Test: Verify reset functionality
- [ ] Update all code references to use new column name
- [ ] Update SQL queries to use proper join conditions
- [ ] Test database setup and reset scripts
- [ ] Test: Verify all code updates and query changes

## 2. Atomic Operations Implementation
- [ ] Audit all database operations for atomicity
- [ ] Implement proper transaction blocks for:
  - File status updates
  - Document content updates
  - Combined operations
- [ ] Add rollback mechanisms for failed operations
- [ ] Ensure file status and document operations are atomic
- [ ] Add validation checks for atomic operations

## 3. Event Queue Processing
- [ ] Review QueueService implementation
- [ ] Implement strict single-threaded processing
- [ ] Add event persistence mechanism
- [ ] Implement proper event ordering
- [ ] Add queue state tracking
- [ ] Add queue recovery mechanisms
- [ ] Test queue behavior under various scenarios

## 4. File Status vs Document Content Separation
- [ ] Audit all file operations
- [ ] Separate file status updates from content updates
- [ ] Ensure file status is updated before content
- [ ] Add validation for file status existence
- [ ] Implement proper cleanup of orphaned records
- [ ] Test separation of concerns

## 5. Obsidian Integration Optimization
- [ ] Review event handling implementation
- [ ] Optimize file system operations
- [ ] Implement proper cleanup procedures
- [ ] Add performance monitoring
- [ ] Test integration with Obsidian's features
- [ ] Ensure compatibility with Obsidian updates

## 6. Error Handling and Recovery
- [ ] Implement comprehensive error handling
- [ ] Add retry mechanisms with exponential backoff
- [ ] Add state recovery procedures
- [ ] Implement proper logging system
- [ ] Add error reporting mechanisms
- [ ] Test error scenarios and recovery

## 7. State Consistency
- [ ] Implement proper state tracking
- [ ] Add validation checks for state consistency
- [ ] Ensure consistent state across operations
- [ ] Add recovery mechanisms for inconsistent states
- [ ] Test state management under various conditions

## 8. Performance Optimization
- [ ] Review file operations for optimization
- [ ] Implement batch processing where possible
- [ ] Add performance monitoring
- [ ] Optimize database queries
- [ ] Test with large vaults
- [ ] Implement cleanup procedures

## Testing Strategy
- [ ] Unit tests for atomic operations
- [ ] Integration tests for queue processing
- [ ] Performance tests with large vaults
- [ ] Error scenario tests
- [ ] Recovery procedure tests
- [ ] State consistency tests
- [ ] Initialization tests:
  - [ ] API key validation
  - [ ] Database state detection
  - [ ] Sync file management
  - [ ] Queue initialization
- [ ] File operation tests:
  - [ ] Move/rename operations
  - [ ] Exclusion handling
  - [ ] Queue processing order
  - [ ] Error recovery

## Implementation Phases

### Phase 1: Database Structure
- [ ] Update SQL setup and reset files
- [ ] Update table relationships
- [ ] Add necessary constraints
- [ ] Test database setup and reset
- [ ] Document schema changes

### Phase 2: Atomic Operations
- [ ] Implement transaction blocks
- [ ] Add rollback mechanisms
- [ ] Test atomicity
- [ ] Add validation
- [ ] Document procedures

### Phase 3: Event Queue
- [ ] Implement strict sequencing
- [ ] Add persistence
- [ ] Add state tracking
- [ ] Test queue behavior
- [ ] Document queue implementation

### Phase 4: Error Handling
- [ ] Implement retry mechanisms
- [ ] Add recovery procedures
- [ ] Improve logging
- [ ] Test error scenarios
- [ ] Document error handling

### Phase 5: Performance
- [ ] Optimize operations
- [ ] Add monitoring
- [ ] Implement cleanup
- [ ] Test with large vaults
- [ ] Document optimizations

## Notes
- Each task must be tested by the user before being marked as complete
- Testing should include both success and failure scenarios
- Each commit must have a descriptive message following the format above
- Document any limitations or edge cases discovered during testing
- Performance metrics should be collected before and after changes
- Error handling should be comprehensive and well-documented
- All file operations must follow atomic change sequence
- Queue processing must be strictly sequential
- Initialization checks must be thorough and user-friendly