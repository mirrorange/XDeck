use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::task_manager::{DismissTaskResult, SharedTaskManager};
use crate::services::upload_manager::SharedUploadManager;

// ── Param Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DismissParams {
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

    // task.dismiss — Remove a finished task from history
    let mgr = task_mgr.clone();
    router.register("task.dismiss", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<DismissParams>(params)?;
            let result = mgr.dismiss_task(&params.id).await;

            let (removed, reason) = match result {
                DismissTaskResult::Dismissed => (true, None),
                DismissTaskResult::Active => (false, Some("active")),
                DismissTaskResult::NotFound => (false, Some("not_found")),
            };

            Ok(serde_json::json!({
                "removed": removed,
                "reason": reason,
            }))
        }
    });

    // task.clear_completed — Remove all finished tasks from history
    let mgr = task_mgr.clone();
    router.register("task.clear_completed", move |_params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let removed = mgr.clear_finished_tasks().await;
            Ok(serde_json::json!({ "removed": removed }))
        }
    });
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::Value;
    use uuid::Uuid;

    use super::*;
    use crate::rpc::router::RequestContext;
    use crate::rpc::types::JsonRpcRequest;
    use crate::services::event_bus::EventBus;
    use crate::services::task_manager::{self, TaskType};
    use crate::services::upload_manager;

    async fn test_pool() -> sqlx::SqlitePool {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        pool
    }

    async fn test_router() -> (
        RpcRouter,
        SharedTaskManager,
        SharedUploadManager,
        sqlx::SqlitePool,
    ) {
        let pool = test_pool().await;
        let event_bus = Arc::new(EventBus::new(32));
        let task_mgr = task_manager::new_shared(event_bus);
        let upload_mgr = upload_manager::new_shared(
            pool.clone(),
            task_mgr.clone(),
            std::env::temp_dir().join(format!("xdeck-task-rpc-{}", Uuid::new_v4())),
        )
        .unwrap();

        let mut router = RpcRouter::new();
        register(&mut router, task_mgr.clone(), upload_mgr.clone());

        (router, task_mgr, upload_mgr, pool)
    }

    fn test_request(method: &str, params: Option<serde_json::Value>) -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: method.to_string(),
            params,
        }
    }

    async fn dispatch(
        router: &RpcRouter,
        pool: sqlx::SqlitePool,
        request: JsonRpcRequest,
    ) -> serde_json::Value {
        let response = router
            .dispatch(
                request,
                RequestContext::new(Some("user-1".to_string()), None, pool),
            )
            .await
            .unwrap();

        assert!(
            response.error.is_none(),
            "unexpected error: {:?}",
            response.error
        );
        response.result.unwrap()
    }

    #[tokio::test]
    async fn test_task_dismiss_rpc_removes_finished_task() {
        let (router, task_mgr, _upload_mgr, pool) = test_router().await;
        let handle = task_manager::create_task(&task_mgr, TaskType::Compress, "Done".into()).await;
        handle.complete(None).await;

        let result = dispatch(
            &router,
            pool,
            test_request(
                "task.dismiss",
                Some(serde_json::json!({ "id": handle.id() })),
            ),
        )
        .await;

        assert_eq!(result["removed"], true);
        assert_eq!(result["reason"], Value::Null);
        assert!(task_mgr.list_tasks().await.is_empty());
    }

    #[tokio::test]
    async fn test_task_dismiss_rpc_keeps_active_task() {
        let (router, task_mgr, _upload_mgr, pool) = test_router().await;
        let handle =
            task_manager::create_task(&task_mgr, TaskType::Download, "Still active".into()).await;

        let result = dispatch(
            &router,
            pool,
            test_request(
                "task.dismiss",
                Some(serde_json::json!({ "id": handle.id() })),
            ),
        )
        .await;

        assert_eq!(result["removed"], false);
        assert_eq!(result["reason"], "active");
        assert_eq!(task_mgr.list_tasks().await.len(), 1);
    }

    #[tokio::test]
    async fn test_task_clear_completed_rpc_removes_only_finished_tasks() {
        let (router, task_mgr, _upload_mgr, pool) = test_router().await;

        let active =
            task_manager::create_task(&task_mgr, TaskType::Upload, "Active upload".into()).await;
        let completed =
            task_manager::create_task(&task_mgr, TaskType::Compress, "Finished zip".into()).await;
        completed.complete(None).await;

        let cancelled =
            task_manager::create_task(&task_mgr, TaskType::Extract, "Cancelled extract".into())
                .await;
        assert!(task_mgr.cancel_task(cancelled.id()).await);

        let result = dispatch(&router, pool, test_request("task.clear_completed", None)).await;

        assert_eq!(result["removed"], 2);
        let tasks = task_mgr.list_tasks().await;
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, active.id());
    }
}
