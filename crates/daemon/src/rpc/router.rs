use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{debug, warn};

use crate::error::{error_codes, AppError};
use crate::rpc::types::{JsonRpcRequest, JsonRpcResponse};

/// Session access interface for WebSocket-aware handlers.
pub trait SessionAccess: Send + Sync {
    /// Set the authenticated user ID for this session.
    fn set_authenticated_user(&self, user_id: String);

    /// Get the authenticated user ID for this session.
    fn get_authenticated_user(&self) -> Option<String>;

    /// Subscribe this session to event topics.
    fn subscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError>;

    /// Unsubscribe this session from event topics.
    fn unsubscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError>;

    /// Return all subscribed topics.
    fn get_subscribed_topics(&self) -> Vec<String>;

    /// Check whether this session is subscribed to a topic.
    fn is_subscribed_to(&self, topic: &str) -> bool;
}

/// Handler function type for JSON-RPC methods.
pub type RpcHandler = Arc<
    dyn Fn(
            Option<Value>,
            RequestContext,
        ) -> futures_util::future::BoxFuture<'static, Result<Value, AppError>>
        + Send
        + Sync,
>;

/// Context provided to each RPC handler.
#[derive(Clone)]
pub struct RequestContext {
    /// Authenticated user ID (None if not yet authenticated)
    pub user_id: Option<String>,
    /// Client IP address
    pub ip_address: Option<String>,
    /// Database pool handle
    pub pool: SqlitePool,
    /// Session access for WebSocket contexts.
    session: Option<Arc<dyn SessionAccess>>,
}

impl RequestContext {
    #[cfg(test)]
    pub fn new(user_id: Option<String>, ip_address: Option<String>, pool: SqlitePool) -> Self {
        Self {
            user_id,
            ip_address,
            pool,
            session: None,
        }
    }

    pub fn with_session(
        user_id: Option<String>,
        ip_address: Option<String>,
        pool: SqlitePool,
        session: Arc<dyn SessionAccess>,
    ) -> Self {
        Self {
            user_id,
            ip_address,
            pool,
            session: Some(session),
        }
    }

    pub fn session(&self) -> Option<&dyn SessionAccess> {
        self.session.as_deref()
    }
}

/// Metadata associated with each registered RPC method.
struct MethodMeta {
    handler: RpcHandler,
    requires_auth: bool,
}

/// JSON-RPC 2.0 method router.
///
/// Routes incoming JSON-RPC requests to registered handler functions based
/// on the `method` field.
pub struct RpcRouter {
    handlers: HashMap<String, MethodMeta>,
}

impl RpcRouter {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Register an authenticated handler for a JSON-RPC method.
    pub fn register<F, Fut>(&mut self, method: &str, handler: F)
    where
        F: Fn(Option<Value>, RequestContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<Value, AppError>> + Send + 'static,
    {
        self.register_with_auth(method, true, handler);
    }

    /// Register a public handler for a JSON-RPC method.
    pub fn register_public<F, Fut>(&mut self, method: &str, handler: F)
    where
        F: Fn(Option<Value>, RequestContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<Value, AppError>> + Send + 'static,
    {
        self.register_with_auth(method, false, handler);
    }

    fn register_with_auth<F, Fut>(&mut self, method: &str, requires_auth: bool, handler: F)
    where
        F: Fn(Option<Value>, RequestContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<Value, AppError>> + Send + 'static,
    {
        self.handlers.insert(
            method.to_string(),
            MethodMeta {
                handler: Arc::new(move |params, ctx| Box::pin(handler(params, ctx))),
                requires_auth,
            },
        );
    }

    /// Dispatch a JSON-RPC request to the appropriate handler.
    pub async fn dispatch(
        &self,
        request: JsonRpcRequest,
        ctx: RequestContext,
    ) -> Option<JsonRpcResponse> {
        // Validate the request.
        if let Err(msg) = request.validate() {
            return Some(JsonRpcResponse::error(
                request.id,
                error_codes::INVALID_REQUEST,
                msg,
            ));
        }

        debug!("RPC dispatch: {}", request.method);

        let method = request.method.clone();
        let meta = match self.handlers.get(&request.method) {
            Some(meta) => meta,
            None => {
                warn!("Method not found: {}", request.method);
                if request.is_notification() {
                    return None;
                }
                return Some(JsonRpcResponse::error(
                    request.id,
                    error_codes::METHOD_NOT_FOUND,
                    format!("Method not found: {}", request.method),
                ));
            }
        };

        // Save metadata before moving request fields.
        let is_notification = request.is_notification();
        let id = request.id;

        if meta.requires_auth && ctx.user_id.is_none() {
            warn!("Unauthorized RPC access attempt: {}", method);
            if is_notification {
                return None;
            }
            return Some(JsonRpcResponse::error(
                id,
                error_codes::UNAUTHORIZED,
                AppError::Unauthorized.to_string(),
            ));
        }

        let handler = meta.handler.clone();

        // Call the handler.
        let result = handler(request.params, ctx).await;

        if is_notification {
            return None;
        }

        Some(match result {
            Ok(value) => JsonRpcResponse::success(id, value),
            Err(err) => {
                if let Some(data) = err.error_data() {
                    JsonRpcResponse::error_with_data(id, err.error_code(), err.to_string(), data)
                } else {
                    JsonRpcResponse::error(id, err.error_code(), err.to_string())
                }
            }
        })
    }

    /// Get list of registered method names.
    pub fn methods(&self) -> Vec<&str> {
        self.handlers.keys().map(|s| s.as_str()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_ctx(user_id: Option<String>) -> RequestContext {
        let pool = crate::db::connect_in_memory().await.unwrap();
        RequestContext::new(user_id, None, pool)
    }

    #[tokio::test]
    async fn test_dispatch_registered_method() {
        let mut router = RpcRouter::new();
        router.register_public("system.ping", |_params, _ctx| async {
            Ok(serde_json::json!({"pong": true}))
        });

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "system.ping".to_string(),
            params: None,
        };

        let resp = router.dispatch(req, test_ctx(None).await).await.unwrap();
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[tokio::test]
    async fn test_dispatch_unknown_method() {
        let router = RpcRouter::new();

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "unknown.method".to_string(),
            params: None,
        };

        let resp = router.dispatch(req, test_ctx(None).await).await.unwrap();
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, error_codes::METHOD_NOT_FOUND);
    }

    #[tokio::test]
    async fn test_notification_no_response() {
        let router = RpcRouter::new();

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: None, // notification
            method: "unknown.method".to_string(),
            params: None,
        };

        let resp = router.dispatch(req, test_ctx(None).await).await;
        assert!(resp.is_none());
    }

    #[tokio::test]
    async fn test_dispatch_bad_request_with_details() {
        let mut router = RpcRouter::new();
        router.register_public("process.create", |_params, _ctx| async move {
            Err(AppError::bad_request_with_details(
                "Invalid process.create params",
                vec![
                    crate::error::ValidationIssue::new("name", "must not be empty"),
                    crate::error::ValidationIssue::new(
                        "restart_policy.delay_ms",
                        "must be greater than 0",
                    ),
                ],
            ))
        });

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "process.create".to_string(),
            params: Some(serde_json::json!({})),
        };

        let resp = router.dispatch(req, test_ctx(None).await).await.unwrap();
        let err = resp.error.unwrap();
        assert_eq!(err.code, error_codes::INVALID_PARAMS);
        assert!(err.data.is_some());
        assert!(err
            .data
            .as_ref()
            .unwrap()
            .get("details")
            .and_then(|v| v.as_array())
            .is_some());
    }

    #[tokio::test]
    async fn test_protected_method_requires_authentication() {
        let mut router = RpcRouter::new();
        router.register("process.list", |_params, _ctx| async {
            Ok(serde_json::json!([]))
        });

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "process.list".to_string(),
            params: None,
        };

        let resp = router.dispatch(req, test_ctx(None).await).await.unwrap();
        let err = resp.error.expect("expected unauthorized error");
        assert_eq!(err.code, error_codes::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_protected_method_accepts_authenticated_context() {
        let mut router = RpcRouter::new();
        router.register("process.list", |_params, _ctx| async {
            Ok(serde_json::json!([{"id": "p1"}]))
        });

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "process.list".to_string(),
            params: None,
        };

        let resp = router
            .dispatch(req, test_ctx(Some("user-1".to_string())).await)
            .await
            .unwrap();

        assert!(resp.error.is_none());
        assert!(resp.result.is_some());
    }

    #[tokio::test]
    async fn test_public_method_does_not_require_authentication() {
        let mut router = RpcRouter::new();
        router.register_public("system.info", |_params, _ctx| async {
            Ok(serde_json::json!({"name": "xdeck"}))
        });

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "system.info".to_string(),
            params: None,
        };

        let resp = router.dispatch(req, test_ctx(None).await).await.unwrap();
        assert!(resp.error.is_none());
        assert!(resp.result.is_some());
    }

    #[tokio::test]
    async fn test_context_without_session_can_still_dispatch() {
        let mut router = RpcRouter::new();
        router.register_public("system.ping", |_params, ctx| async move {
            Ok(serde_json::json!({"has_session": ctx.session().is_some()}))
        });

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "system.ping".to_string(),
            params: None,
        };

        let resp = router.dispatch(req, test_ctx(None).await).await.unwrap();
        assert_eq!(resp.result.unwrap()["has_session"], false);
    }
}
