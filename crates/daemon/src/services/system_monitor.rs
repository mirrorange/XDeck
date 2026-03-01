use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sysinfo::{Disks, Networks, System};
use tokio::sync::Mutex;
use tracing::{debug, error};

use crate::db::Database;
use crate::services::event_bus::SharedEventBus;

/// System status snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    pub cpu_usage: f32,
    pub cpu_cores: usize,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_usage_percent: f32,
    pub disk_partitions: Vec<DiskPartition>,
    pub network_interfaces: Vec<NetworkInterface>,
    pub uptime: u64,
    pub load_average: [f64; 3],
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskPartition {
    pub name: String,
    pub mount_point: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub usage_percent: f32,
    pub fs_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// SystemMonitor collects system metrics and publishes them via EventBus.
pub struct SystemMonitor {
    sys: Mutex<System>,
    event_bus: SharedEventBus,
    db: Arc<Database>,
}

impl SystemMonitor {
    pub fn new(event_bus: SharedEventBus, db: Arc<Database>) -> Arc<Self> {
        let mut sys = System::new_all();
        sys.refresh_all();

        Arc::new(Self {
            sys: Mutex::new(sys),
            event_bus,
            db,
        })
    }

    /// Collect current system metrics.
    pub async fn collect_metrics(&self) -> SystemStatus {
        let mut sys = self.sys.lock().await;
        sys.refresh_all();

        let cpu_usage = sys.global_cpu_usage();
        let cpu_cores = sys.cpus().len();
        let memory_total = sys.total_memory();
        let memory_used = sys.used_memory();
        let memory_usage_percent = if memory_total > 0 {
            (memory_used as f32 / memory_total as f32) * 100.0
        } else {
            0.0
        };

        // Collect disk info using the separate Disks type
        let disks = Disks::new_with_refreshed_list();
        let disk_partitions: Vec<DiskPartition> = disks
            .list()
            .iter()
            .map(|d| {
                let total = d.total_space();
                let available = d.available_space();
                let used = total.saturating_sub(available);
                DiskPartition {
                    name: d.name().to_string_lossy().to_string(),
                    mount_point: d.mount_point().to_string_lossy().to_string(),
                    total,
                    used,
                    available,
                    usage_percent: if total > 0 {
                        (used as f32 / total as f32) * 100.0
                    } else {
                        0.0
                    },
                    fs_type: d.file_system().to_string_lossy().to_string(),
                }
            })
            .collect();

        // Collect network info using the separate Networks type
        let networks = Networks::new_with_refreshed_list();
        let network_interfaces: Vec<NetworkInterface> = networks
            .iter()
            .map(|(name, data)| NetworkInterface {
                name: name.clone(),
                rx_bytes: data.total_received(),
                tx_bytes: data.total_transmitted(),
            })
            .collect();

        let load_avg = System::load_average();

        SystemStatus {
            cpu_usage,
            cpu_cores,
            memory_total,
            memory_used,
            memory_usage_percent,
            disk_partitions,
            network_interfaces,
            uptime: System::uptime(),
            load_average: [load_avg.one, load_avg.five, load_avg.fifteen],
            os_name: System::name().unwrap_or_default(),
            os_version: System::os_version().unwrap_or_default(),
            hostname: System::host_name().unwrap_or_default(),
        }
    }

    /// Start the background monitoring loop.
    pub async fn start_monitoring(self: Arc<Self>, interval: Duration) {
        let mut tick_count = 0u64;
        let store_interval = 60 / interval.as_secs().max(1);

        loop {
            tokio::time::sleep(interval).await;

            let metrics = self.collect_metrics().await;

            // Publish to EventBus for real-time clients
            if let Ok(payload) = serde_json::to_value(&metrics) {
                self.event_bus.publish("system.metrics", payload);
            }

            // Store in DB at lower frequency (every ~60s)
            tick_count += 1;
            if tick_count % store_interval == 0 {
                if let Err(e) = self.store_metrics(&metrics) {
                    error!("Failed to store system metrics: {}", e);
                }
                if let Err(e) = self.cleanup_old_metrics() {
                    error!("Failed to cleanup old metrics: {}", e);
                }
            }

            debug!(
                "System metrics: CPU={:.1}%, MEM={:.1}%",
                metrics.cpu_usage, metrics.memory_usage_percent
            );
        }
    }

    /// Store a metrics snapshot in SQLite.
    fn store_metrics(&self, metrics: &SystemStatus) -> anyhow::Result<()> {
        let timestamp = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO system_metrics (timestamp, cpu_usage, memory_used, disk_read, disk_write, net_rx, net_tx) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    timestamp,
                    metrics.cpu_usage,
                    metrics.memory_used as i64,
                    0i64,
                    0i64,
                    metrics.network_interfaces.iter().map(|n| n.rx_bytes).sum::<u64>() as i64,
                    metrics.network_interfaces.iter().map(|n| n.tx_bytes).sum::<u64>() as i64,
                ],
            )?;
            Ok(())
        })
    }

    /// Clean up metrics older than 24 hours.
    fn cleanup_old_metrics(&self) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM system_metrics WHERE timestamp < datetime('now', '-24 hours')",
                [],
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::event_bus::EventBus;

    #[tokio::test]
    async fn test_collect_metrics() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        db.run_migrations().unwrap();
        let event_bus = Arc::new(EventBus::default());
        let monitor = SystemMonitor::new(event_bus, db);

        let metrics = monitor.collect_metrics().await;

        assert!(metrics.cpu_cores > 0);
        assert!(metrics.memory_total > 0);
        assert!(!metrics.hostname.is_empty());
    }

    #[tokio::test]
    async fn test_store_metrics() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        db.run_migrations().unwrap();
        let event_bus = Arc::new(EventBus::default());
        let monitor = SystemMonitor::new(event_bus, db.clone());

        let metrics = monitor.collect_metrics().await;
        monitor.store_metrics(&metrics).unwrap();

        let count: i64 = db
            .with_conn(|conn| {
                conn.query_row("SELECT COUNT(*) FROM system_metrics", [], |row| row.get(0))
                    .map_err(|e| e.into())
            })
            .unwrap();
        assert_eq!(count, 1);
    }
}
