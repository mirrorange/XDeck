use std::sync::Arc;

use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::process_manager::{CreateProcessRequest, GetLogsRequest, ProcessManager};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProcessIdParams {
    id: String,
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

    let pm = process_mgr;
    router.register("process.logs", move |params, _ctx| {
        let pm = pm.clone();
        async move {
            let params = parse_required_params::<GetLogsRequest>(params)?;
            let logs = pm.get_logs(params).await?;
            Ok(serde_json::to_value(&logs).unwrap())
        }
    });
}
