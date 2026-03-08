ALTER TABLE snippets
ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'paste_and_run';

UPDATE snippets
SET execution_mode = 'paste_and_run'
WHERE execution_mode IS NULL OR execution_mode = '';
