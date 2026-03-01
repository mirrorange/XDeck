-- XDeck Initial Schema
-- Migration: 001_initial

-- Users & Authentication
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'admin',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token_hash  TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    expires_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Process Daemon
CREATE TABLE IF NOT EXISTS processes (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    command         TEXT NOT NULL,
    args            TEXT NOT NULL DEFAULT '[]',
    cwd             TEXT NOT NULL,
    env             TEXT NOT NULL DEFAULT '{}',
    restart_policy  TEXT NOT NULL DEFAULT '{}',
    auto_start      INTEGER NOT NULL DEFAULT 1,
    group_name      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sites
CREATE TABLE IF NOT EXISTS sites (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    site_type     TEXT NOT NULL,
    domain        TEXT NOT NULL,
    config        TEXT NOT NULL DEFAULT '{}',
    ssl_enabled   INTEGER NOT NULL DEFAULT 0,
    cert_id       TEXT REFERENCES certificates(id),
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SSL Certificates
CREATE TABLE IF NOT EXISTS certificates (
    id            TEXT PRIMARY KEY,
    domain        TEXT NOT NULL,
    cert_path     TEXT NOT NULL,
    key_path      TEXT NOT NULL,
    issuer        TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    auto_renew    INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Docker Compose Projects
CREATE TABLE IF NOT EXISTS compose_projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    directory     TEXT NOT NULL,
    description   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Remote Nodes
CREATE TABLE IF NOT EXISTS nodes (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    address       TEXT NOT NULL,
    token_hash    TEXT NOT NULL,
    is_local      INTEGER NOT NULL DEFAULT 0,
    group_name    TEXT,
    last_seen_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- System Metrics History (per-minute granularity)
CREATE TABLE IF NOT EXISTS system_metrics (
    timestamp     TEXT NOT NULL PRIMARY KEY,
    cpu_usage     REAL NOT NULL,
    memory_used   INTEGER NOT NULL,
    disk_read     INTEGER,
    disk_write    INTEGER,
    net_rx        INTEGER,
    net_tx        INTEGER
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id            TEXT PRIMARY KEY,
    user_id       TEXT,
    method        TEXT NOT NULL,
    params        TEXT,
    result_code   INTEGER,
    ip_address    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- System Settings (key-value store for setup state etc.)
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
