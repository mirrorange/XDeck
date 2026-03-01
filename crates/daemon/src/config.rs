use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Application configuration loaded from TOML file or defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Bind address
    #[serde(default = "default_bind")]
    pub bind: String,

    /// Listen port
    #[serde(default = "default_port")]
    pub port: u16,

    /// Data directory for database, logs, etc.
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,

    /// JWT secret (auto-generated if not set)
    #[serde(default)]
    pub jwt_secret: Option<String>,

    /// Log configuration
    #[serde(default)]
    pub log: LogConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfig {
    /// Max log file size in bytes before rotation (default: 50MB)
    #[serde(default = "default_max_log_size")]
    pub max_file_size: u64,

    /// Number of rotated log files to keep
    #[serde(default = "default_max_log_files")]
    pub max_files: u32,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            max_file_size: default_max_log_size(),
            max_files: default_max_log_files(),
        }
    }
}

fn default_bind() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    9210
}

fn default_data_dir() -> PathBuf {
    dirs_data_dir().unwrap_or_else(|| PathBuf::from(".xdeck"))
}

fn default_max_log_size() -> u64 {
    50 * 1024 * 1024 // 50MB
}

fn default_max_log_files() -> u32 {
    10
}

/// Get the platform-appropriate data directory.
fn dirs_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join(".xdeck"))
    }
    #[cfg(target_os = "linux")]
    {
        Some(PathBuf::from("/var/lib/xdeck"))
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_local_dir().map(|d| d.join("XDeck"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Some(PathBuf::from(".xdeck"))
    }
}

impl AppConfig {
    /// Load config from file, or create a default config with CLI overrides.
    pub fn load_or_default(
        config_path: &str,
        bind: &str,
        port: u16,
        data_dir: Option<String>,
    ) -> Result<Self> {
        let mut config = if let Ok(content) = std::fs::read_to_string(config_path) {
            toml::from_str::<AppConfig>(&content)?
        } else {
            AppConfig::default()
        };

        // CLI overrides
        config.bind = bind.to_string();
        config.port = port;
        if let Some(dir) = data_dir {
            config.data_dir = PathBuf::from(dir);
        }

        // Ensure data directory exists
        std::fs::create_dir_all(&config.data_dir)?;

        Ok(config)
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            bind: default_bind(),
            port: default_port(),
            data_dir: default_data_dir(),
            jwt_secret: None,
            log: LogConfig::default(),
        }
    }
}
