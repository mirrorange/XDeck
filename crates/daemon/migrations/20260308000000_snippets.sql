-- Snippets: reusable command snippets synced across clients
CREATE TABLE IF NOT EXISTS snippets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    command     TEXT NOT NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
