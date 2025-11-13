-- Enable the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing functions to avoid conflicts
DROP FUNCTION IF EXISTS public.enable_vectors();
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), TEXT, INT);
DROP FUNCTION IF EXISTS public.init_obsidian_notes();
DROP FUNCTION IF EXISTS public.drop_tables_if_exist();
DROP FUNCTION IF EXISTS public.create_required_tables();

-- Drop the existing tables to ensure a fresh installation
DROP TABLE IF EXISTS public.obsidian_documents;
DROP TABLE IF EXISTS public.obsidian_file_status;

-------------------------------------------------
-- Create the obsidian_file_status table first (since obsidian_documents references it)
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

-- Create index for obsidian_file_status
CREATE INDEX IF NOT EXISTS idx_file_status_vault_path ON public.obsidian_file_status(vault_id, file_path);

-------------------------------------------------
-- Create the obsidian_documents table
-------------------------------------------------
CREATE TABLE IF NOT EXISTS public.obsidian_documents (
    id BIGSERIAL PRIMARY KEY,
    vault_id TEXT NOT NULL,
    file_status_id BIGINT NOT NULL REFERENCES obsidian_file_status(id),
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    embedding vector(1536),
    vectorized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vault_id, file_status_id, chunk_index)
);

-- Create indexes for obsidian_documents
CREATE INDEX IF NOT EXISTS idx_vault_obsidian ON public.obsidian_documents(vault_id, file_status_id);
CREATE INDEX IF NOT EXISTS idx_documents_file_status ON public.obsidian_documents(file_status_id);

-------------------------------------------------
-- Enable Row Level Security (RLS) and create policies
-------------------------------------------------

-- Enable RLS on obsidian_documents
ALTER TABLE public.obsidian_documents ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for obsidian_documents
CREATE POLICY "Users can view their own vault documents"
    ON public.obsidian_documents
    FOR SELECT
    USING (vault_id = current_setting('app.current_vault_id', true));

CREATE POLICY "Service role can do everything"
    ON public.obsidian_documents
    USING (auth.role() = 'service_role');

-- Enable RLS on obsidian_file_status
ALTER TABLE public.obsidian_file_status ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for obsidian_file_status
CREATE POLICY "Users can view their own vault file status"
    ON public.obsidian_file_status
    FOR SELECT
    USING (vault_id = current_setting('app.current_vault_id', true));

CREATE POLICY "Service role can do everything"
    ON public.obsidian_file_status
    USING (auth.role() = 'service_role');

-------------------------------------------------
-- Create the functions
-------------------------------------------------

-- Function to ensure the vector extension is enabled
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

-- Create the semantic search function
CREATE OR REPLACE FUNCTION public.match_documents(
    query_embedding vector(1536),
    search_vault_id TEXT,
    match_count INT
)
RETURNS TABLE (
    id BIGINT,
    file_status_id BIGINT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        id,
        file_status_id,
        content,
        metadata,
        1 - (embedding <=> query_embedding) AS similarity
    FROM public.obsidian_documents
    WHERE vault_id = search_vault_id
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;

-- Create a placeholder initialization function
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

-- Function to drop tables if they exist
CREATE OR REPLACE FUNCTION public.drop_tables_if_exist()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DROP TABLE IF EXISTS public.obsidian_documents;
    DROP TABLE IF EXISTS public.obsidian_file_status;
END;
$$;

-- Function to create required tables
CREATE OR REPLACE FUNCTION public.create_required_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Create obsidian_file_status table
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

    -- Create obsidian_documents table
    CREATE TABLE IF NOT EXISTS public.obsidian_documents (
        id BIGSERIAL PRIMARY KEY,
        vault_id TEXT NOT NULL,
        file_status_id BIGINT NOT NULL REFERENCES obsidian_file_status(id),
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        embedding vector(1536),
        vectorized_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(vault_id, file_status_id, chunk_index)
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_vault_obsidian ON public.obsidian_documents(vault_id, file_status_id);
    CREATE INDEX IF NOT EXISTS idx_documents_file_status ON public.obsidian_documents(file_status_id);
    CREATE INDEX IF NOT EXISTS idx_file_status_vault_path ON public.obsidian_file_status(vault_id, file_path);
END;
$$;

-- Function to atomically replace all chunks for a file inside a transaction
CREATE OR REPLACE FUNCTION public.upsert_document_chunks(
    p_vault_id TEXT,
    p_file_status_id BIGINT,
    p_chunks JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_chunks IS NULL OR jsonb_typeof(p_chunks) <> 'array' THEN
        RETURN;
    END IF;

    DELETE FROM public.obsidian_documents
    WHERE vault_id = p_vault_id
      AND file_status_id = p_file_status_id;

    INSERT INTO public.obsidian_documents (
        vault_id,
        file_status_id,
        chunk_index,
        content,
        metadata,
        embedding,
        vectorized_at,
        created_at,
        updated_at
    )
    SELECT
        p_vault_id,
        p_file_status_id,
        (chunk->>'chunk_index')::INT,
        chunk->>'content',
        chunk->'metadata',
        CASE
            WHEN chunk->'embedding' IS NULL
                OR jsonb_typeof(chunk->'embedding') <> 'array'
                OR jsonb_array_length(chunk->'embedding') = 0 THEN NULL
            ELSE (
                SELECT ARRAY_AGG(value::float4 ORDER BY ord)
                FROM jsonb_array_elements_text(chunk->'embedding') WITH ORDINALITY AS emb(value, ord)
            )::vector
        END,
        NULLIF(chunk->>'vectorized_at', '')::timestamptz,
        NOW(),
        COALESCE(NULLIF(chunk->>'updated_at', '')::timestamptz, NOW())
    FROM jsonb_array_elements(p_chunks) AS chunk;
END;
$$;

-------------------------------------------------
-- Grant necessary permissions
-------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Grant execute permissions for our functions
GRANT EXECUTE ON FUNCTION public.enable_vectors() TO service_role;
GRANT EXECUTE ON FUNCTION public.init_obsidian_notes() TO service_role;
GRANT EXECUTE ON FUNCTION public.match_documents(vector(1536), TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.drop_tables_if_exist() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_required_tables() TO service_role;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;
