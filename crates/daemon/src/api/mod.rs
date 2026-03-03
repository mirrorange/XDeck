mod websocket;

use std::sync::Arc;

use axum::{response::Json, routing::get, Router};
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::AppConfig;
use crate::rpc::auth_handlers;
use crate::rpc::event_handlers;
use crate::rpc::process_handlers;
use crate::rpc::router::RpcRouter;
use crate::rpc::system_handlers;
use crate::services::auth::AuthService;
use crate::services::event_bus::{EventBus, SharedEventBus};
use crate::services::process_manager::ProcessManager;

/// Shared application state accessible by all handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub pool: SqlitePool,
    pub rpc_router: Arc<RpcRouter>,
    pub event_bus: SharedEventBus,
    pub auth_service: Arc<AuthService>,
    pub process_manager: Arc<ProcessManager>,
}

impl AppState {
    pub fn new(config: AppConfig, pool: SqlitePool) -> Self {
        // Determine JWT secret.
        let jwt_secret = config
            .jwt_secret
            .clone()
            .unwrap_or_else(AuthService::generate_secret);

        let auth_service = Arc::new(AuthService::new(jwt_secret));
        let event_bus = Arc::new(EventBus::default());
        let process_manager =
            ProcessManager::new(pool.clone(), event_bus.clone(), &config.data_dir);
        let rpc_router = Arc::new(Self::build_rpc_router(
            auth_service.clone(),
            process_manager.clone(),
        ));

        Self {
            config,
            pool,
            rpc_router,
            event_bus,
            auth_service,
            process_manager,
        }
    }

    /// Build the JSON-RPC router with all method handlers registered.
    fn build_rpc_router(auth: Arc<AuthService>, process_mgr: Arc<ProcessManager>) -> RpcRouter {
        let mut router = RpcRouter::new();

        system_handlers::register(&mut router);
        auth_handlers::register(&mut router, auth);
        event_handlers::register(&mut router);
        process_handlers::register(&mut router, process_mgr);

        router
    }
}

/// Build the Axum router with all routes.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/ws", get(websocket::ws_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Health check endpoint.
async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
