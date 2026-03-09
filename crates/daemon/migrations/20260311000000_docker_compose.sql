-- Docker Compose Projects
CREATE TABLE IF NOT EXISTS compose_projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    cwd           TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'unknown',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
