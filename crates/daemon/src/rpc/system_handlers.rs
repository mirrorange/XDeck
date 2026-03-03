use std::sync::Arc;

use crate::error::AppError;
use crate::rpc::router::RpcRouter;
use crate::services::event_bus::EventBus;
use crate::services::system_monitor::SystemMonitor;

pub fn register(router: &mut RpcRouter) {
    router.register_public("system.ping", |_params, _ctx| async {
        Ok(serde_json::json!({"pong": true}))
    });

    router.register_public("system.info", |_params, _ctx| async {
        let os_type = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        };

        Ok(serde_json::json!({
            "name": "XDeck Daemon",
            "version": env!("CARGO_PKG_VERSION"),
            "os_type": os_type,
        }))
    });

    // system.status requires authentication.
    router.register("system.status", |_params, ctx| async move {
        let monitor = SystemMonitor::new(Arc::new(EventBus::new(1)), ctx.pool.clone());
        let status = monitor.collect_metrics().await;
        serde_json::to_value(&status)
            .map_err(|e| AppError::Internal(format!("Failed to serialize system status: {}", e)))
    });
}
