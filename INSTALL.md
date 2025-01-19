Here is the updated INSTALL.md in full markdown format for you to copy and paste:

# Installation Guide

## Prerequisites
Before installing Mind Matrix, ensure you have:
1. Latest Obsidian version
2. Supabase account and project
3. OpenAI API key for embeddings generation

---

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

---

### 2. Set Up Supabase

1. Create a new Supabase project:
   - Go to [Supabase](https://supabase.com)
   - Sign in and click "New Project"
   - Fill in project details and create the project

2. Set up the database schema:
   - Go to your Supabase project dashboard
   - Click on "SQL Editor" in the left sidebar
   - Create a "New Query"
   - Copy and paste the following SQL, then execute it:

```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the table first
CREATE TABLE IF NOT EXISTS public.obsidian_notes (
    id BIGSERIAL PRIMARY KEY,
    vault_id TEXT NOT NULL,
    obsidian_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT,
    metadata JSONB,
    embedding vector(1536),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vault_id, obsidian_id, chunk_index)
);

-- Create the index
CREATE INDEX IF NOT EXISTS idx_vault_obsidian ON public.obsidian_notes(vault_id, obsidian_id);

-- Drop existing functions to avoid conflicts
DROP FUNCTION IF EXISTS public.enable_vectors();
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), TEXT, INT);
DROP FUNCTION IF EXISTS public.init_obsidian_notes();

-- Function to enable vectors
CREATE OR REPLACE FUNCTION public.enable_vectors()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
END;
$$;

-- Create the search function
CREATE OR REPLACE FUNCTION public.match_documents(
    query_embedding vector(1536),
    search_vault_id TEXT,
    match_count INT
)
RETURNS TABLE (
    id BIGINT,
    obsidian_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        obsidian_notes.id,
        obsidian_notes.obsidian_id,
        obsidian_notes.content,
        obsidian_notes.metadata,
        1 - (obsidian_notes.embedding <=> query_embedding) AS similarity
    FROM obsidian_notes
    WHERE vault_id = search_vault_id
    ORDER BY obsidian_notes.embedding <=> query_embedding
    LIMIT match_count;
$$;

-- Create the initialization function
CREATE OR REPLACE FUNCTION public.init_obsidian_notes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Just a placeholder for future initialization needs
    RETURN;
END;
$$;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Grant specific permissions for our functions
GRANT EXECUTE ON FUNCTION public.enable_vectors TO service_role;
GRANT EXECUTE ON FUNCTION public.init_obsidian_notes TO service_role;
GRANT EXECUTE ON FUNCTION public.match_documents(vector(1536), TEXT, INT) TO service_role;

-- Grant future permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

	3.	Get your API credentials:
	•	Go to Project Settings > API
	•	Copy the Project URL and service_role API key
	•	Keep these credentials secure; you’ll need them for the plugin configuration

3. Get OpenAI API Key
	1.	Go to OpenAI API Keys
	2.	Create a new API key
	3.	Copy the key (you’ll need it for plugin configuration)

4. Configure the Plugin
	1.	Open Obsidian Settings
	2.	Go to Mind Matrix settings
	3.	Enter your API credentials:
	•	Supabase URL (Project URL)
	•	Supabase API Key (service_role key)
	•	OpenAI API Key
	4.	Configure exclusion patterns (optional):
	•	Excluded folders (e.g., .obsidian, node_modules)
	•	Excluded file types (e.g., .mp3, .jpg, .png)
	•	Excluded file prefixes (e.g., _, .)

5. Initial Setup
	1.	Initialize the vault (this generates a unique identifier)
	2.	Enable auto-sync if desired
	3.	Use the “Force sync all files” command for initial synchronization

Maintenance

Database Management

Monitor your database usage in Supabase:
	1.	Go to Database > Dashboard
	2.	Check storage usage and query performance
	3.	Monitor API usage in Project Settings > Usage

Troubleshooting

Common Issues
	1.	Database Initialization Failed
	•	Verify Supabase API credentials
	•	Check console for specific error messages
	•	Ensure SQL setup was run successfully
	2.	OpenAI API Issues
	•	Verify API key is valid
	•	Check usage limits
	•	Ensure sufficient credits
	3.	Sync Errors
	•	Check Supabase connection
	•	Verify permissions
	•	Check file exclusion settings

Getting Help

If you encounter issues:
	1.	Check GitHub Issues
	2.	Join our Discord community
	3.	Submit a new issue with:
	•	Obsidian version
	•	Error messages from console
	•	Steps to reproduce

Upgrading
	1.	Community plugins update automatically
	2.	For manual installations:
	•	Download the new version
	•	Replace files in the plugin directory
	•	Restart Obsidian
	3.	Check the changelog for any required database updates

You can now copy and paste this content into your `INSTALL.md` file. Let me know if you need further refinements! 🚀
