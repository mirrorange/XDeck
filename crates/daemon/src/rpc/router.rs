use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use sqlx::SqlitePool;
use tracing::{debug, warn};

use crate::error::{error_codes, AppError};
use crate::rpc::types::{JsonRpcRequest, JsonRpcResponse};

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
#[derive(Debug, Clone)]
pub struct RequestContext {
    /// Authenticated user ID (None if not yet authenticated)
    pub user_id: Option<String>,
    /// Client IP address
    pub ip_address: Option<String>,
    /// Database pool handle
    pub pool: SqlitePool,
}

/// JSON-RPC 2.0 method router.
///
/// Routes incoming JSON-RPC requests to registered handler functions based
/// on the `method` field.
pub struct RpcRouter {
    handlers: HashMap<String, RpcHandler>,
}

impl RpcRouter {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Register a handler for a JSON-RPC method.
    pub fn register<F, Fut>(&mut self, method: &str, handler: F)
    where
        F: Fn(Option<Value>, RequestContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<Value, AppError>> + Send + 'static,
    {
        self.handlers.insert(
            method.to_string(),
            Arc::new(move |params, ctx| Box::pin(handler(params, ctx))),
        );
    }

    /// Dispatch a JSON-RPC request to the appropriate handler.
    pub async fn dispatch(
        &self,
        request: JsonRpcRequest,
        ctx: RequestContext,
    ) -> Option<JsonRpcResponse> {
        // Validate the request
        if let Err(msg) = request.validate() {
            return Some(JsonRpcResponse::error(
                request.id,
                error_codes::INVALID_REQUEST,
                msg,
            ));
        }

        debug!("RPC dispatch: {}", request.method);

        // Find the handler
        let handler = match self.handlers.get(&request.method) {
            Some(h) => h.clone(),
            None => {
                warn!("Method not found: {}", request.method);
                // If this is a notification, don't send response
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

        // Save whether this is a notification before moving fields
        let is_notification = request.is_notification();
        let id = request.id;

        // Call the handler
        let result = handler(request.params, ctx).await;

        // If this is a notification, don't send response
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

    async fn test_ctx() -> RequestContext {
        let pool = crate::db::connect_in_memory().await.unwrap();
        RequestContext {
            user_id: None,
            ip_address: None,
            pool,
        }
    }

    #[tokio::test]
    async fn test_dispatch_registered_method() {
        let mut router = RpcRouter::new();
        router.register("system.ping", |_params, _ctx| async {
            Ok(serde_json::json!({"pong": true}))
        });

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "system.ping".to_string(),
            params: None,
        };

        let resp = router.dispatch(req, test_ctx().await).await.unwrap();
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

        let resp = router.dispatch(req, test_ctx().await).await.unwrap();
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

        let resp = router.dispatch(req, test_ctx().await).await;
        assert!(resp.is_none());
    }

    #[tokio::test]
    async fn test_dispatch_bad_request_with_details() {
        let mut router = RpcRouter::new();
        router.register("process.create", |_params, _ctx| async move {
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

        let resp = router.dispatch(req, test_ctx().await).await.unwrap();
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
}
