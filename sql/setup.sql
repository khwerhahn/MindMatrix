-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing functions to avoid conflicts
DROP FUNCTION IF EXISTS public.enable_vectors();
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), TEXT, INT);
DROP FUNCTION IF EXISTS public.init_obsidian_notes();
DROP TABLE IF EXISTS public.obsidian_documents;

-- Create the table
CREATE TABLE IF NOT EXISTS public.obsidian_documents (
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
CREATE INDEX IF NOT EXISTS idx_vault_obsidian ON public.obsidian_documents(vault_id, obsidian_id);

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
        obsidian_documents.id,
        obsidian_documents.obsidian_id,
        obsidian_documents.content,
        obsidian_documents.metadata,
        1 - (obsidian_documents.embedding <=> query_embedding) AS similarity
    FROM obsidian_documents
    WHERE vault_id = search_vault_id
    ORDER BY obsidian_documents.embedding <=> query_embedding
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
