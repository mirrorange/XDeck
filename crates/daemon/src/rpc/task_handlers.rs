use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::task_manager::SharedTaskManager;

// ── Param Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelParams {
    id: String,
}

// ── Handler Registration ────────────────────────────────────────

pub fn register(router: &mut RpcRouter, task_mgr: SharedTaskManager) {
    // task.list — List all tasks
    let mgr = task_mgr.clone();
    router.register("task.list", move |_params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let tasks = mgr.list_tasks().await;
            Ok(serde_json::json!({
                "tasks": tasks,
                "total": tasks.len(),
            }))
        }
    });

    // task.cancel — Cancel a running task
    let mgr = task_mgr.clone();
    router.register("task.cancel", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<CancelParams>(params)?;
            let cancelled = mgr.cancel_task(&params.id).await;
            Ok(serde_json::json!({ "cancelled": cancelled }))
        }
    });
}
