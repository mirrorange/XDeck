-- Snippet store sources
CREATE TABLE IF NOT EXISTS snippet_sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default official source
INSERT INTO snippet_sources (id, name, url) VALUES (
    'official',
    'XDeck Official Snippets',
    'https://raw.githubusercontent.com/mirrorange/XDeck/main/snippets/index.json'
);
