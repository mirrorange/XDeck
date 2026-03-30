-- Rename auto_start column to enabled for clearer semantics
-- in daemon + schedule mixed usage.
ALTER TABLE processes RENAME COLUMN auto_start TO enabled;
