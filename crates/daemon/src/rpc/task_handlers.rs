use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::task_manager::SharedTaskManager;
use crate::services::upload_manager::SharedUploadManager;

// ── Param Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelParams {
    id: String,
}

// ── Handler Registration ────────────────────────────────────────

pub fn register(
    router: &mut RpcRouter,
    task_mgr: SharedTaskManager,
    upload_mgr: SharedUploadManager,
) {
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
    let upload_mgr = upload_mgr.clone();
    router.register("task.cancel", move |params, _ctx| {
        let mgr = mgr.clone();
        let upload_mgr = upload_mgr.clone();
        async move {
            let params = parse_required_params::<CancelParams>(params)?;
            let cancelled = if upload_mgr.cancel_session_by_task(&params.id).await? {
                true
            } else {
                mgr.cancel_task(&params.id).await
            };
            Ok(serde_json::json!({ "cancelled": cancelled }))
        }
    });
}
