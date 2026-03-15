CREATE TABLE IF NOT EXISTS upload_sessions (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL,
    dest_path       TEXT NOT NULL,
    title           TEXT NOT NULL,
    status          TEXT NOT NULL,
    total_files     INTEGER NOT NULL,
    completed_files INTEGER NOT NULL DEFAULT 0,
    total_bytes     INTEGER NOT NULL,
    uploaded_bytes  INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upload_session_files (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    relative_path   TEXT NOT NULL,
    size            INTEGER NOT NULL,
    uploaded_bytes  INTEGER NOT NULL DEFAULT 0,
    temp_path       TEXT NOT NULL,
    status          TEXT NOT NULL,
    last_modified   INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_status
    ON upload_sessions(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_task_id
    ON upload_sessions(task_id);

CREATE INDEX IF NOT EXISTS idx_upload_session_files_session_id
    ON upload_session_files(session_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_session_files_relative_path
    ON upload_session_files(session_id, relative_path);
