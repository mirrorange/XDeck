use std::sync::Arc;

use serde::Deserialize;

use crate::error::AppError;
use crate::rpc::params::{parse_required_params, require_ws_session};
use crate::rpc::router::RpcRouter;
use crate::services::auth::AuthService;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthSetupParams {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthLoginParams {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthAuthenticateParams {
    token: String,
}

pub fn register(router: &mut RpcRouter, auth: Arc<AuthService>) {
    router.register_public("auth.setup_status", |_params, ctx| async move {
        let is_setup = AuthService::is_setup_complete(&ctx.pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(serde_json::json!({ "setup_complete": is_setup }))
    });

    router.register_public("auth.setup", |params, ctx| async move {
        let params = parse_required_params::<AuthSetupParams>(params)?;

        if params.password.len() < 6 {
            return Err(AppError::BadRequest(
                "Password must be at least 6 characters".into(),
            ));
        }

        AuthService::setup_admin(&ctx.pool, &params.username, &params.password).await?;
        Ok(serde_json::json!({"success": true}))
    });

    let auth_login = auth.clone();
    router.register_public("auth.login", move |params, ctx| {
        let auth = auth_login.clone();
        async move {
            let params = parse_required_params::<AuthLoginParams>(params)?;
            let token = auth
                .login(&ctx.pool, &params.username, &params.password)
                .await?;
            Ok(serde_json::json!({ "token": token }))
        }
    });

    let auth_authenticate = auth;
    router.register_public("auth.authenticate", move |params, ctx| {
        let auth = auth_authenticate.clone();
        async move {
            let session = require_ws_session(&ctx)?;
            let params = parse_required_params::<AuthAuthenticateParams>(params)?;

            let claims = auth.verify_token(&params.token)?;

            if let Some(existing_user_id) = session.get_authenticated_user() {
                if existing_user_id != claims.sub {
                    return Err(AppError::Unauthorized);
                }
            }

            session.set_authenticated_user(claims.sub.clone());

            Ok(serde_json::json!({
                "authenticated": true,
                "user_id": claims.sub,
            }))
        }
    });
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    use serde_json::Value;

    use super::*;
    use crate::rpc::router::{RequestContext, SessionAccess};
    use crate::rpc::types::JsonRpcRequest;

    #[derive(Default)]
    struct MockSession {
        authenticated_user: Mutex<Option<String>>,
        topics: Mutex<HashSet<String>>,
    }

    impl SessionAccess for MockSession {
        fn set_authenticated_user(&self, user_id: String) {
            *self.authenticated_user.lock().unwrap() = Some(user_id);
        }

        fn get_authenticated_user(&self) -> Option<String> {
            self.authenticated_user.lock().unwrap().clone()
        }

        fn subscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError> {
            let mut current = self.topics.lock().unwrap();
            for topic in topics {
                current.insert(topic);
            }
            Ok(())
        }

        fn unsubscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError> {
            let mut current = self.topics.lock().unwrap();
            if topics.is_empty() {
                current.clear();
                return Ok(());
            }

            for topic in topics {
                current.remove(&topic);
            }
            Ok(())
        }

        fn get_subscribed_topics(&self) -> Vec<String> {
            self.topics.lock().unwrap().iter().cloned().collect()
        }

        fn is_subscribed_to(&self, topic: &str) -> bool {
            self.topics.lock().unwrap().contains(topic)
        }
    }

    async fn setup_auth() -> (sqlx::SqlitePool, Arc<AuthService>, String) {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();

        let auth = Arc::new(AuthService::new("test-secret".to_string()));
        AuthService::setup_admin(&pool, "admin", "mypassword")
            .await
            .unwrap();
        let token = auth.login(&pool, "admin", "mypassword").await.unwrap();

        (pool, auth, token)
    }

    #[tokio::test]
    async fn test_auth_authenticate_via_router_updates_session() {
        let (pool, auth, token) = setup_auth().await;

        let mut router = RpcRouter::new();
        register(&mut router, auth);

        let session = Arc::new(MockSession::default());
        let ctx = RequestContext::with_session(None, None, pool, session.clone());

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "auth.authenticate".to_string(),
            params: Some(serde_json::json!({"token": token})),
        };

        let resp = router.dispatch(req, ctx).await.unwrap();
        assert!(resp.error.is_none());

        let user_id = resp
            .result
            .unwrap()
            .get("user_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        assert_eq!(session.get_authenticated_user(), Some(user_id));
    }

    #[tokio::test]
    async fn test_auth_authenticate_requires_websocket_session() {
        let (pool, auth, token) = setup_auth().await;

        let mut router = RpcRouter::new();
        register(&mut router, auth);

        let ctx = RequestContext::new(None, None, pool);

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "auth.authenticate".to_string(),
            params: Some(serde_json::json!({"token": token})),
        };

        let resp = router.dispatch(req, ctx).await.unwrap();
        let err = resp.error.expect("expected error");

        assert_eq!(err.code, crate::error::error_codes::INVALID_PARAMS);
        assert!(err.message.contains("Only available over WebSocket"));
    }
}
