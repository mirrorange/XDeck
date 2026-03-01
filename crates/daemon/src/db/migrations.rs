use anyhow::Result;
use rusqlite::Connection;
use tracing::info;

/// All migration SQL statements, ordered by version.
const MIGRATIONS: &[(&str, &str)] = &[
    ("001_initial", include_str!("../../migrations/001_initial.sql")),
];

/// Run all pending migrations.
pub fn run_all(conn: &Connection) -> Result<()> {
    // Create migrations tracking table if it doesn't exist
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    for (version, sql) in MIGRATIONS {
        let already_applied: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE version = ?1",
            [version],
            |row| row.get(0),
        )?;

        if !already_applied {
            info!("Applying migration: {}", version);
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO _migrations (version) VALUES (?1)",
                [version],
            )?;
        }
    }

    Ok(())
}
