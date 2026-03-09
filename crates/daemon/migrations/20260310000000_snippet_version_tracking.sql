-- Add version tracking fields to snippets for store integration
ALTER TABLE snippets ADD COLUMN store_snippet_id TEXT DEFAULT NULL;
ALTER TABLE snippets ADD COLUMN store_version TEXT DEFAULT NULL;

-- Index for quick lookup by store_snippet_id
CREATE INDEX IF NOT EXISTS idx_snippets_store_snippet_id ON snippets(store_snippet_id);
