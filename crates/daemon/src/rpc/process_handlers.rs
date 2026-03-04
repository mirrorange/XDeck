use std::sync::Arc;

use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::process_manager::{
    CreateProcessRequest, GetLogsRequest, ProcessManager, UpdateProcessRequest,
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProcessIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GroupParams {
    group_name: String,
}

pub fn register(router: &mut RpcRouter, process_mgr: Arc<ProcessManager>) {
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
            let params = parse_required_params::<ProcessIdParams>(params)?;
            let info = pm.get_process(&params.id).await?;
            Ok(serde_json::to_value(&info).unwrap())
        }
    });

    let pm = process_mgr.clone();
    router.register("process.create", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<CreateProcessRequest>(params)?;
            let info = pm.create_process(params).await?;
            Ok(serde_json::to_value(&info).unwrap())
        }
    });

    let pm = process_mgr.clone();
    router.register("process.update", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<UpdateProcessRequest>(params)?;
            let info = pm.update_process(params).await?;
            Ok(serde_json::to_value(&info).unwrap())
        }
    });

    let pm = process_mgr.clone();
    router.register("process.start", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<ProcessIdParams>(params)?;
            pm.start_process(&params.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let pm = process_mgr.clone();
    router.register("process.stop", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<ProcessIdParams>(params)?;
            pm.stop_process(&params.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let pm = process_mgr.clone();
    router.register("process.restart", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<ProcessIdParams>(params)?;
            pm.restart_process(&params.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let pm = process_mgr.clone();
    router.register("process.delete", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<ProcessIdParams>(params)?;
            pm.delete_process(&params.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let pm = process_mgr.clone();
    router.register("process.logs", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<GetLogsRequest>(params)?;
            let logs = pm.get_logs(params).await?;
            Ok(serde_json::to_value(&logs).unwrap())
        }
    });

    let pm = process_mgr.clone();
    router.register("process.group.list", move |_params, _ctx| {
        let pm = pm.clone();
        async move {
            let groups = pm.list_groups().await?;
            Ok(serde_json::to_value(&groups).unwrap())
        }
    });

    let pm = process_mgr.clone();
    router.register("process.group.start", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<GroupParams>(params)?;
            let errors = pm.start_group(&params.group_name).await?;
            Ok(serde_json::json!({
                "success": errors.is_empty(),
                "errors": if errors.is_empty() { serde_json::Value::Null } else { serde_json::json!(errors) }
            }))
        }
    });

    let pm = process_mgr.clone();
    router.register("process.group.stop", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<GroupParams>(params)?;
            let errors = pm.stop_group(&params.group_name).await?;
            Ok(serde_json::json!({
                "success": errors.is_empty(),
                "errors": if errors.is_empty() { serde_json::Value::Null } else { serde_json::json!(errors) }
            }))
        }
    });
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use serde_json::Value;

    use super::*;
    use crate::rpc::router::RequestContext;
    use crate::rpc::types::JsonRpcRequest;
    use crate::services::event_bus::EventBus;
    use crate::services::process_manager::{ProcessLogConfig, RestartPolicy};

    async fn test_ctx() -> RequestContext {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        RequestContext::new(Some("user-1".to_string()), None, pool)
    }

    #[tokio::test]
    async fn test_process_update_rpc_roundtrip() {
        let ctx = test_ctx().await;
        let event_bus = Arc::new(EventBus::default());
        let process_mgr = ProcessManager::new(
            ctx.pool.clone(),
            event_bus,
            &std::env::temp_dir().join(format!("xdeck-rpc-{}", uuid::Uuid::new_v4())),
        );

        let mut router = RpcRouter::new();
        register(&mut router, process_mgr);

        let create_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "process.create".to_string(),
            params: Some(serde_json::json!({
                "name": "rpc-update-test",
                "command": "echo",
                "args": ["hello"],
                "cwd": "/tmp",
                "env": HashMap::<String, String>::new(),
                "restart_policy": RestartPolicy::default(),
                "auto_start": false,
                "group_name": null,
                "log_config": ProcessLogConfig::default(),
                "run_as": null
            })),
        };

        let create_resp = router.dispatch(create_req, ctx.clone()).await.unwrap();
        let created = create_resp.result.unwrap();
        let id = created
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        let update_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("2".to_string())),
            method: "process.update".to_string(),
            params: Some(serde_json::json!({
                "id": id,
                "name": "rpc-update-test-renamed",
            })),
        };

        let update_resp = router.dispatch(update_req, ctx).await.unwrap();
        assert!(update_resp.error.is_none());
        let updated = update_resp.result.unwrap();
        assert_eq!(
            updated.get("name").and_then(|v| v.as_str()),
            Some("rpc-update-test-renamed")
        );
    }

    #[tokio::test]
    async fn test_process_update_rpc_can_clear_group() {
        let ctx = test_ctx().await;
        let event_bus = Arc::new(EventBus::default());
        let process_mgr = ProcessManager::new(
            ctx.pool.clone(),
            event_bus,
            &std::env::temp_dir().join(format!("xdeck-rpc-{}", uuid::Uuid::new_v4())),
        );

        let mut router = RpcRouter::new();
        register(&mut router, process_mgr);

        let create_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "process.create".to_string(),
            params: Some(serde_json::json!({
                "name": "rpc-group-clear-test",
                "command": "echo",
                "args": ["hello"],
                "cwd": "/tmp",
                "env": HashMap::<String, String>::new(),
                "restart_policy": RestartPolicy::default(),
                "auto_start": false,
                "group_name": "svc",
                "log_config": ProcessLogConfig::default(),
                "run_as": null
            })),
        };

        let create_resp = router.dispatch(create_req, ctx.clone()).await.unwrap();
        let created = create_resp.result.unwrap();
        let id = created
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        let update_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("2".to_string())),
            method: "process.update".to_string(),
            params: Some(serde_json::json!({
                "id": id,
                "group_name": null,
            })),
        };

        let update_resp = router.dispatch(update_req, ctx).await.unwrap();
        assert!(update_resp.error.is_none());
        let updated = update_resp.result.unwrap();
        assert!(updated.get("group_name").is_some_and(|v| v.is_null()));
    }
}
