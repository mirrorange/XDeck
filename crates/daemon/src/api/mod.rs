mod websocket;

use std::sync::Arc;

use axum::{response::Json, routing::get, Router};
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::AppConfig;
use crate::error::AppError;
use crate::rpc::router::RpcRouter;
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
        // Determine JWT secret
        let jwt_secret = config
            .jwt_secret
            .clone()
            .unwrap_or_else(AuthService::generate_secret);

        let auth_service = Arc::new(AuthService::new(jwt_secret));
        let event_bus = Arc::new(EventBus::default());
        let process_manager = ProcessManager::new(pool.clone(), event_bus.clone());
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

        // === System methods ===
        router.register("system.ping", |_params, _ctx| async {
            Ok(serde_json::json!({"pong": true}))
        });

        router.register("system.info", |_params, _ctx| async {
            Ok(serde_json::json!({
                "name": "XDeck Daemon",
                "version": env!("CARGO_PKG_VERSION"),
            }))
        });

        // system.status — on-demand metrics
        router.register("system.status", |_params, _ctx| async {
            use crate::services::event_bus::EventBus;
            use crate::services::system_monitor::SystemMonitor;

            let dummy_bus = std::sync::Arc::new(EventBus::new(1));
            let dummy_pool = crate::db::connect_in_memory().await.unwrap();
            let monitor = SystemMonitor::new(dummy_bus, dummy_pool);
            let status = monitor.collect_metrics().await;
            Ok(serde_json::to_value(&status).unwrap())
        });

        // === Auth methods ===
        router.register("auth.setup_status", |_params, ctx| async move {
            let is_setup = AuthService::is_setup_complete(&ctx.pool)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            Ok(serde_json::json!({ "setup_complete": is_setup }))
        });

        router.register("auth.setup", |params, ctx| async move {
            let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
            let username = params["username"]
                .as_str()
                .ok_or_else(|| AppError::BadRequest("Missing username".into()))?;
            let password = params["password"]
                .as_str()
                .ok_or_else(|| AppError::BadRequest("Missing password".into()))?;

            if password.len() < 6 {
                return Err(AppError::BadRequest(
                    "Password must be at least 6 characters".into(),
                ));
            }

            AuthService::setup_admin(&ctx.pool, username, password).await?;
            Ok(serde_json::json!({"success": true}))
        });

        let auth_login = auth.clone();
        router.register("auth.login", move |params, ctx| {
            let auth = auth_login.clone();
            async move {
                let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
                let username = params["username"]
                    .as_str()
                    .ok_or_else(|| AppError::BadRequest("Missing username".into()))?;
                let password = params["password"]
                    .as_str()
                    .ok_or_else(|| AppError::BadRequest("Missing password".into()))?;
                let token = auth.login(&ctx.pool, username, password).await?;
                Ok(serde_json::json!({ "token": token }))
            }
        });

        // === Process management methods ===
        let pm = process_mgr.clone();
        router.register("process.list", move |_params, _ctx| {
            let pm = pm.clone();
            async move {
                let processes = pm.list_processes().await?;
                Ok(serde_json::to_value(&processes).unwrap())
            }
        });

        let pm = process_mgr.clone();
        router.register("process.get", move |params, _ctx| {
            let pm = pm.clone();
            async move {
                let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
                let id = params["id"]
                    .as_str()
                    .ok_or_else(|| AppError::BadRequest("Missing id".into()))?;
                let info = pm.get_process(id).await?;
                Ok(serde_json::to_value(&info).unwrap())
            }
        });

        let pm = process_mgr.clone();
        router.register("process.create", move |params, _ctx| {
            let pm = pm.clone();
            async move {
                let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
                let req: crate::services::process_manager::CreateProcessRequest =
                    serde_json::from_value(params)
                        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))?;
                let info = pm.create_process(req).await?;
                Ok(serde_json::to_value(&info).unwrap())
            }
        });

        let pm = process_mgr.clone();
        router.register("process.start", move |params, _ctx| {
            let pm = pm.clone();
            async move {
                let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
                let id = params["id"]
                    .as_str()
                    .ok_or_else(|| AppError::BadRequest("Missing id".into()))?;
                pm.start_process(id).await?;
                Ok(serde_json::json!({"success": true}))
            }
        });

        let pm = process_mgr.clone();
        router.register("process.stop", move |params, _ctx| {
            let pm = pm.clone();
            async move {
                let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
                let id = params["id"]
                    .as_str()
                    .ok_or_else(|| AppError::BadRequest("Missing id".into()))?;
                pm.stop_process(id).await?;
                Ok(serde_json::json!({"success": true}))
            }
        });

        let pm = process_mgr.clone();
        router.register("process.restart", move |params, _ctx| {
            let pm = pm.clone();
            async move {
                let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
                let id = params["id"]
                    .as_str()
                    .ok_or_else(|| AppError::BadRequest("Missing id".into()))?;
                pm.restart_process(id).await?;
                Ok(serde_json::json!({"success": true}))
            }
        });

        let pm = process_mgr.clone();
        router.register("process.delete", move |params, _ctx| {
            let pm = pm.clone();
            async move {
                let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
                let id = params["id"]
                    .as_str()
                    .ok_or_else(|| AppError::BadRequest("Missing id".into()))?;
                pm.delete_process(id).await?;
                Ok(serde_json::json!({"success": true}))
            }
        });

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
