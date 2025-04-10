-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing functions to avoid conflicts
DROP FUNCTION IF EXISTS public.enable_vectors();
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), TEXT, INT);
DROP FUNCTION IF EXISTS public.init_obsidian_notes();

-- Drop the existing tables to ensure a fresh installation
DROP TABLE IF EXISTS public.obsidian_documents;
DROP TABLE IF EXISTS public.obsidian_file_status;

-------------------------------------------------
-- Create the obsidian_documents table for storing document chunks, embeddings, and metadata
-------------------------------------------------
CREATE TABLE IF NOT EXISTS public.obsidian_documents (
    id BIGSERIAL PRIMARY KEY,
    vault_id TEXT NOT NULL,
    obsidian_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT,
    metadata JSONB,
    embedding vector(1536),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    vectorized_at TIMESTAMPTZ,
    UNIQUE(vault_id, obsidian_id, chunk_index)
);

-- Create an index on vault_id and obsidian_id for faster querying of obsidian_documents
CREATE INDEX IF NOT EXISTS idx_vault_obsidian ON public.obsidian_documents(vault_id, obsidian_id);

-------------------------------------------------
-- Create the obsidian_file_status table for tracking file vectorization status
-------------------------------------------------
CREATE TABLE IF NOT EXISTS public.obsidian_file_status (
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

-- Create an index on vault_id and file_path for faster querying of obsidian_file_status
CREATE INDEX IF NOT EXISTS idx_file_status_vault_path ON public.obsidian_file_status(vault_id, file_path);

-------------------------------------------------
-- Function to ensure the vector extension is enabled (for safety)
-------------------------------------------------
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

-------------------------------------------------
-- Create the semantic search function that returns documents based on similarity
-------------------------------------------------
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
        id,
        obsidian_id,
        content,
        metadata,
        1 - (embedding <=> query_embedding) AS similarity
    FROM public.obsidian_documents
    WHERE vault_id = search_vault_id
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;

-------------------------------------------------
-- Create a placeholder initialization function for obsidian notes
-------------------------------------------------
CREATE OR REPLACE FUNCTION public.init_obsidian_notes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Placeholder for any future initialization logic
    RETURN;
END;
$$;

-------------------------------------------------
-- Grant necessary permissions to the service_role
-------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Grant execute permissions for our functions
GRANT EXECUTE ON FUNCTION public.enable_vectors() TO service_role;
GRANT EXECUTE ON FUNCTION public.init_obsidian_notes() TO service_role;
GRANT EXECUTE ON FUNCTION public.match_documents(vector(1536), TEXT, INT) TO service_role;

-- Set default privileges for future objects in the public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;
