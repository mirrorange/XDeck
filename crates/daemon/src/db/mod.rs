mod migrations;

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tracing::info;

/// Database wrapper providing thread-safe access to SQLite.
pub struct Database {
    conn: Mutex<Connection>,
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish()
    }
}

impl Database {
    /// Create a new database connection at the given path.
    pub fn new(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::configure(conn)
    }

    /// Create an in-memory database (for testing).
    pub fn new_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::configure(conn)
    }

    fn configure(conn: Connection) -> Result<Self> {
        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        // Enable foreign keys
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Run all pending migrations.
    pub fn run_migrations(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        migrations::run_all(&conn)?;
        info!("Database migrations completed");
        Ok(())
    }

    /// Execute a closure with a reference to the database connection.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        let conn = self.conn.lock().unwrap();
        f(&conn)
    }
}
