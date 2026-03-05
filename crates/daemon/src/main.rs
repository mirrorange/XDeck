use anyhow::Result;
use clap::Parser;
use std::time::Duration;
use tracing::{error, info};

mod api;
mod config;
mod db;
mod error;
mod rpc;
mod services;

use config::AppConfig;
use services::system_monitor::SystemMonitor;

/// XDeck Daemon - Lightweight service management panel
#[derive(Parser, Debug)]
#[command(name = "xdeck-daemon", version, about)]
struct Cli {
    /// Port to listen on
    #[arg(short, long, default_value = "9210")]
    port: u16,

    /// Bind address
    #[arg(short, long, default_value = "0.0.0.0")]
    bind: String,

    /// Config file path
    #[arg(short, long, default_value = "config.toml")]
    config: String,

    /// Data directory path
    #[arg(short, long)]
    data_dir: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "xdeck_daemon=debug,tower_http=debug".into()),
        )
        .init();

    let cli = Cli::parse();

    // Load configuration
    let config = AppConfig::load_or_default(&cli.config, &cli.bind, cli.port, cli.data_dir)?;
    info!("XDeck Daemon v{}", env!("CARGO_PKG_VERSION"));
    info!("Data directory: {}", config.data_dir.display());
    info!("Listening on {}:{}", config.bind, config.port);

    // Initialize database
    let pool = db::connect(&config.data_dir.join("xdeck.db")).await?;
    db::run_migrations(&pool).await?;
    info!("Database initialized");

    // Build app state
    let app_state = api::AppState::new(config.clone(), pool);
    app_state.pty_manager.start_idle_reaper();

    // Start system monitor
    let monitor = SystemMonitor::new(app_state.event_bus.clone(), app_state.pool.clone());
    tokio::spawn(monitor.start_monitoring(Duration::from_secs(2)));
    info!("System monitor started");

    // Restore auto-start processes
    if let Err(e) = app_state.process_manager.restore_processes().await {
        error!("Failed to restore processes: {}", e);
    }

    // Build and start the server
    let app = api::build_router(app_state);

    let listener =
        tokio::net::TcpListener::bind(format!("{}:{}", config.bind, config.port)).await?;
    info!("Server started successfully");

    axum::serve(listener, app).await?;

    Ok(())
}
