use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use sysinfo::{Disks, Networks, System};
use tokio::sync::Mutex;
use tracing::{debug, error};

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
    pub disk_read_speed: u64,
    pub disk_write_speed: u64,
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
    /// Receive speed in bytes per second (delta since last refresh).
    pub rx_speed: u64,
    /// Transmit speed in bytes per second (delta since last refresh).
    pub tx_speed: u64,
}

/// Internal state for computing deltas between refresh cycles.
struct MonitorState {
    sys: System,
    networks: Networks,
    /// How many seconds between each refresh cycle, used to convert deltas to per-second rates.
    interval_secs: u64,
}

/// SystemMonitor collects system metrics and publishes them via EventBus.
pub struct SystemMonitor {
    state: Mutex<MonitorState>,
    event_bus: SharedEventBus,
    pool: SqlitePool,
}

impl SystemMonitor {
    pub fn new(event_bus: SharedEventBus, pool: SqlitePool) -> Arc<Self> {
        let mut sys = System::new_all();
        sys.refresh_all();

        // Initial refresh so subsequent calls get meaningful deltas.
        let networks = Networks::new_with_refreshed_list();

        Arc::new(Self {
            state: Mutex::new(MonitorState {
                sys,
                networks,
                interval_secs: 5, // default, updated when start_monitoring is called
            }),
            event_bus,
            pool,
        })
    }

    /// Collect current system metrics.
    pub async fn collect_metrics(&self) -> SystemStatus {
        let mut state = self.state.lock().await;
        state.sys.refresh_all();

        // Refresh networks to get delta values (received/transmitted since last refresh).
        state.networks.refresh(true);

        let interval = state.interval_secs.max(1);

        let cpu_usage = state.sys.global_cpu_usage();
        let cpu_cores = state.sys.cpus().len();
        let memory_total = state.sys.total_memory();
        let memory_used = state.sys.used_memory();
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

        // Compute disk I/O speed from process-level stats.
        // sysinfo provides per-process disk_usage() which gives delta read/write bytes.
        let mut disk_read: u64 = 0;
        let mut disk_write: u64 = 0;
        for process in state.sys.processes().values() {
            let du = process.disk_usage();
            disk_read += du.read_bytes;
            disk_write += du.written_bytes;
        }
        let disk_read_speed = disk_read / interval;
        let disk_write_speed = disk_write / interval;

        // Collect network info with speed (delta since last refresh).
        let network_interfaces: Vec<NetworkInterface> = state
            .networks
            .iter()
            .map(|(name, data)| NetworkInterface {
                name: name.clone(),
                rx_bytes: data.total_received(),
                tx_bytes: data.total_transmitted(),
                rx_speed: data.received() / interval,
                tx_speed: data.transmitted() / interval,
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
            disk_read_speed,
            disk_write_speed,
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
        // Update the interval_secs so speed calculations are correct.
        {
            let mut state = self.state.lock().await;
            state.interval_secs = interval.as_secs().max(1);
        }

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
                if let Err(e) = self.store_metrics(&metrics).await {
                    error!("Failed to store system metrics: {}", e);
                }
                if let Err(e) = self.cleanup_old_metrics().await {
                    error!("Failed to cleanup old metrics: {}", e);
                }
            }

            debug!(
                "System metrics: CPU={:.1}%, MEM={:.1}%, NET_RX={}/s, NET_TX={}/s, DISK_R={}/s, DISK_W={}/s",
                metrics.cpu_usage,
                metrics.memory_usage_percent,
                metrics.network_interfaces.iter().map(|n| n.rx_speed).sum::<u64>(),
                metrics.network_interfaces.iter().map(|n| n.tx_speed).sum::<u64>(),
                metrics.disk_read_speed,
                metrics.disk_write_speed,
            );
        }
    }

    /// Store a metrics snapshot in SQLite.
    async fn store_metrics(&self, metrics: &SystemStatus) -> anyhow::Result<()> {
        let timestamp = chrono::Utc::now().to_rfc3339();
        let net_rx = metrics
            .network_interfaces
            .iter()
            .map(|n| n.rx_bytes)
            .sum::<u64>() as i64;
        let net_tx = metrics
            .network_interfaces
            .iter()
            .map(|n| n.tx_bytes)
            .sum::<u64>() as i64;

        sqlx::query(
            "INSERT OR REPLACE INTO system_metrics (timestamp, cpu_usage, memory_used, disk_read, disk_write, net_rx, net_tx) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&timestamp)
        .bind(metrics.cpu_usage)
        .bind(metrics.memory_used as i64)
        .bind(metrics.disk_read_speed as i64)
        .bind(metrics.disk_write_speed as i64)
        .bind(net_rx)
        .bind(net_tx)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Clean up metrics older than 24 hours.
    async fn cleanup_old_metrics(&self) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM system_metrics WHERE timestamp < datetime('now', '-24 hours')")
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::event_bus::EventBus;

    #[tokio::test]
    async fn test_collect_metrics() {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        let event_bus = Arc::new(EventBus::default());
        let monitor = SystemMonitor::new(event_bus, pool);

        let metrics = monitor.collect_metrics().await;

        assert!(metrics.cpu_cores > 0);
        assert!(metrics.memory_total > 0);
        assert!(!metrics.hostname.is_empty());
        // New fields should be present (can be 0 on first collect)
        let _disk_read = metrics.disk_read_speed;
        let _disk_write = metrics.disk_write_speed;
        for iface in &metrics.network_interfaces {
            let _rx = iface.rx_speed;
            let _tx = iface.tx_speed;
        }
    }

    #[tokio::test]
    async fn test_store_metrics() {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        let event_bus = Arc::new(EventBus::default());
        let monitor = SystemMonitor::new(event_bus, pool.clone());

        let metrics = monitor.collect_metrics().await;
        monitor.store_metrics(&metrics).await.unwrap();

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM system_metrics")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);
    }
}
