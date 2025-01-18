# Installation Guide
## Prerequisites
Before installing Mind Matrix, ensure you have:
1. Latest Obsidian version
2. PostgreSQL 14+ with vector extension installed
3. Sufficient database permissions to create tables and indexes

## Installation Steps

### 1. Install the Plugin
#### From Obsidian Community Plugins
1. Open Obsidian Settings
2. Go to Community Plugins
3. Search for "Mind Matrix"
4. Click Install, then Enable

#### Manual Installation
1. Download the latest release from the GitHub releases page
2. Extract the files to your vault's plugins directory:
   `.obsidian/plugins/mind-matrix/`
3. Restart Obsidian
4. Enable the plugin in Community Plugins settings

### 2. Set Up PostgreSQL

1. Verify PostgreSQL extensions:
   ```sql
   -- Check required extensions
   SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector');

   -- Install if missing
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

2. Create a new database and user:
   ```sql
   -- Create database
   CREATE DATABASE mindmatrix;

   -- Create user with necessary permissions
   CREATE USER mindmatrix WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE mindmatrix TO mindmatrix;
   GRANT USAGE ON SCHEMA public TO mindmatrix;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO mindmatrix;
   ```

3. Create necessary tables and functions:
   ```sql
   -- Create main table
   CREATE TABLE obsidian_notes (
       id BIGSERIAL PRIMARY KEY,
       obsidian_id TEXT NOT NULL,
       chunk_index INTEGER NOT NULL,
       content TEXT,
       metadata JSONB,
       embedding VECTOR(1536),
       last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(obsidian_id, chunk_index)
   );

   -- Create index for faster lookups
   CREATE INDEX idx_obsidian_id ON obsidian_notes(obsidian_id);

   -- Create similarity search function
   CREATE FUNCTION match_documents(query_embedding VECTOR(1536), match_count INT)
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
       ORDER BY obsidian_notes.embedding <=> query_embedding
       LIMIT match_count;
   END;
   $$ LANGUAGE plpgsql;

   -- Enable row-level security (optional)
   ALTER TABLE obsidian_notes ENABLE ROW LEVEL SECURITY;
   ```

### 3. Configure the Plugin
1. Open Obsidian Settings
2. Go to Mind Matrix settings
3. Enter your PostgreSQL connection details:
   - Host
   - Port
   - Database name
   - Username
   - Password
4. Configure exclusion patterns (optional):
   - File patterns to ignore (e.g., `*.excalidraw`)
   - Directories to ignore (e.g., `.obsidian/`)

### 4. Initial Sync
1. Click the Mind Matrix ribbon icon
2. Select "Sync All Notes"
3. Wait for the initial sync to complete

## Database Maintenance
Regular maintenance can help ensure optimal performance:

1. **Vacuum the database periodically:**
   ```sql
   VACUUM ANALYZE obsidian_notes;
   ```

2. **Monitor table size:**
   ```sql
   SELECT pg_size_pretty(pg_total_relation_size('obsidian_notes'));
   ```

3. **Check index usage:**
   ```sql
   SELECT schemaname, relname, idx_scan, idx_tup_read, idx_tup_fetch
   FROM pg_stat_user_indexes
   WHERE relname = 'obsidian_notes';
   ```

4. **Backup your data:**
   ```sql
   pg_dump -t obsidian_notes mindmatrix > obsidian_notes_backup.sql
   ```

## Troubleshooting

### Common Issues
1. **Connection Failed**
   - Verify PostgreSQL is running
   - Check connection details
   - Ensure firewall allows connection

2. **Sync Errors**
   - Check database permissions
   - Verify vector extension is installed
   - Ensure sufficient disk space

3. **Plugin Not Working**
   - Check Obsidian Console for errors
   - Verify plugin is enabled
   - Try restarting Obsidian

### Getting Help
If you encounter issues not covered here:
1. Check GitHub Issues
2. Join our Discord community
3. Submit a new issue with:
   - Obsidian version
   - PostgreSQL version
   - Error messages
   - Steps to reproduce

## Upgrading
1. For community plugins, updates will appear automatically
2. For manual installations:
   - Download new version
   - Replace files in plugin directory
   - Restart Obsidian
