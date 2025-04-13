-- Drop the tables and related objects
DROP TABLE IF EXISTS public.obsidian_documents;
DROP TABLE IF EXISTS public.obsidian_file_status;

-- Drop the functions
DROP FUNCTION IF EXISTS public.enable_vectors();
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), TEXT, INT);
DROP FUNCTION IF EXISTS public.init_obsidian_notes();

-- Note: We don't drop the vector extension as it might be used by other applications 