use std::sync::Arc;

use bollard::Docker;
use tokio::sync::RwLock;

use crate::services::event_bus::SharedEventBus;

use super::types::ContainerRuntime;

pub struct DockerManager {
    pub(super) client: RwLock<Option<Docker>>,
    pub(super) event_bus: SharedEventBus,
    pub(super) runtime: RwLock<Option<ContainerRuntime>>,
    pub(super) socket_path: RwLock<Option<String>>,
}

impl DockerManager {
    pub fn new(event_bus: SharedEventBus) -> Arc<Self> {
        let mgr = Arc::new(Self {
            client: RwLock::new(None),
            event_bus,
            runtime: RwLock::new(None),
            socket_path: RwLock::new(None),
        });

        let mgr_clone = mgr.clone();
        tokio::spawn(async move {
            if let Err(e) = mgr_clone.auto_detect().await {
                tracing::warn!("Docker auto-detection failed: {}", e);
            }
        });

        mgr
    }

    pub(super) async fn emit_container_event(&self, container_id: &str, action: &str) {
        let data = serde_json::json!({
            "container_id": container_id,
            "action": action,
        });

        self.event_bus.publish("docker.container.state", data);
    }
}
