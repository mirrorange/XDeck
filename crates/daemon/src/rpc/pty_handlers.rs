use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;

use crate::error::AppError;
use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::pty_manager::{CreatePtyRequest, PtyManager, PtySessionType};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreatePtyParams {
    name: Option<String>,
    shell: Option<String>,
    cwd: Option<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default = "default_cols")]
    cols: u16,
    #[serde(default = "default_rows")]
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionParams {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResizeParams {
    session_id: String,
    cols: u16,
    rows: u16,
}

fn default_cols() -> u16 {
    80
}

fn default_rows() -> u16 {
    24
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

fn validate_shell(shell: &str) -> Result<(), AppError> {
    if shell.trim().is_empty() {
        return Err(AppError::BadRequest("shell must not be empty".to_string()));
    }

    let shell_path = Path::new(shell);
    if shell_path.is_absolute() {
        if !shell_path.exists() {
            return Err(AppError::BadRequest(format!("shell not found: {}", shell)));
        }
    } else if which::which(shell).is_err() {
        return Err(AppError::BadRequest(format!(
            "shell not found in PATH: {}",
            shell
        )));
    }
    Ok(())
}

fn validate_cwd(cwd: Option<String>) -> Result<Option<String>, AppError> {
    let Some(cwd) = cwd else {
        return Ok(None);
    };

    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(AppError::BadRequest(format!(
            "working directory does not exist: {}",
            trimmed
        )));
    }
    if !path.is_dir() {
        return Err(AppError::BadRequest(format!(
            "working directory is not a directory: {}",
            trimmed
        )));
    }

    Ok(Some(trimmed.to_string()))
}

pub fn register(router: &mut RpcRouter, pty_mgr: Arc<PtyManager>) {
    let mgr = pty_mgr.clone();
    router.register("pty.create", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<CreatePtyParams>(params)?;
            if params.cols == 0 || params.rows == 0 {
                return Err(AppError::BadRequest(
                    "cols and rows must be greater than 0".to_string(),
                ));
            }

            let shell = params.shell.unwrap_or_else(default_shell);
            validate_shell(&shell)?;
            let cwd = validate_cwd(params.cwd)?;

            let info = mgr
                .create_session(CreatePtyRequest {
                    name: params.name,
                    session_type: PtySessionType::Terminal,
                    command: shell,
                    args: vec![],
                    cwd,
                    env: params.env,
                    cols: params.cols,
                    rows: params.rows,
                })
                .await?;

            Ok(serde_json::to_value(&info).unwrap())
        }
    });

    let mgr = pty_mgr.clone();
    router.register("pty.list", move |_params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let sessions = mgr.list_sessions();
            Ok(serde_json::json!({ "sessions": sessions }))
        }
    });

    let mgr = pty_mgr.clone();
    router.register("pty.get", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<SessionParams>(params)?;
            let session = mgr.get_session(&params.session_id).ok_or_else(|| {
                AppError::NotFound(format!("PTY session not found: {}", params.session_id))
            })?;
            Ok(serde_json::to_value(&session).unwrap())
        }
    });

    let mgr = pty_mgr.clone();
    router.register("pty.resize", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<ResizeParams>(params)?;
            mgr.resize_session(&params.session_id, params.cols, params.rows)?;
            Ok(serde_json::json!({ "success": true }))
        }
    });

    router.register("pty.close", move |params, _ctx| {
        let mgr = pty_mgr.clone();
        async move {
            let params = parse_required_params::<SessionParams>(params)?;
            mgr.close_session(&params.session_id).await?;
            Ok(serde_json::json!({ "success": true }))
        }
    });
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::Value;

    use super::*;
    use crate::rpc::router::RequestContext;
    use crate::rpc::types::JsonRpcRequest;
    use crate::services::event_bus::EventBus;

    async fn test_ctx() -> RequestContext {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        RequestContext::new(Some("user-1".to_string()), pool)
    }

    fn test_pty_mgr() -> Arc<PtyManager> {
        PtyManager::new(
            Arc::new(EventBus::default()),
            std::time::Duration::from_secs(30 * 60),
        )
    }

    #[tokio::test]
    async fn test_pty_create_rpc() {
        let ctx = test_ctx().await;
        let mut router = RpcRouter::new();
        register(&mut router, test_pty_mgr());

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "pty.create".to_string(),
            params: Some(serde_json::json!({
                "name": "rpc-pty-create",
                "cols": 80,
                "rows": 24
            })),
        };

        let resp = router.dispatch(req, ctx).await.unwrap();
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert!(result
            .get("session_id")
            .and_then(|v| v.as_str())
            .is_some_and(|v| !v.is_empty()));
    }

    #[tokio::test]
    async fn test_pty_list_rpc() {
        let ctx = test_ctx().await;
        let mgr = test_pty_mgr();
        let mut router = RpcRouter::new();
        register(&mut router, mgr.clone());

        let created = mgr
            .create_session(CreatePtyRequest {
                name: Some("rpc-pty-list".to_string()),
                session_type: PtySessionType::Terminal,
                command: default_shell(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("2".to_string())),
            method: "pty.list".to_string(),
            params: None,
        };
        let resp = router.dispatch(req, ctx).await.unwrap();
        assert!(resp.error.is_none());
        let created_session_id = created.session_id.clone();

        let sessions = resp
            .result
            .unwrap()
            .get("sessions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            sessions
                .iter()
                .any(|item| item.get("session_id")
                    == Some(&Value::String(created_session_id.clone())))
        );
    }

    #[tokio::test]
    async fn test_pty_close_rpc() {
        let ctx = test_ctx().await;
        let mgr = test_pty_mgr();
        let mut router = RpcRouter::new();
        register(&mut router, mgr.clone());

        let created = mgr
            .create_session(CreatePtyRequest {
                name: Some("rpc-pty-close".to_string()),
                session_type: PtySessionType::Terminal,
                command: default_shell(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();

        let close_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("3".to_string())),
            method: "pty.close".to_string(),
            params: Some(serde_json::json!({
                "session_id": created.session_id
            })),
        };

        let close_resp = router.dispatch(close_req, ctx).await.unwrap();
        assert!(close_resp.error.is_none());
        assert!(mgr.get_session(&created.session_id).is_none());
    }
}
