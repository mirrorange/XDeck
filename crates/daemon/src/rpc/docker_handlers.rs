use std::sync::Arc;

use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::docker_manager::DockerManager;

// ── Param Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ContainerIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListContainersParams {
    #[serde(default)]
    all: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveContainerParams {
    id: String,
    #[serde(default)]
    force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ContainerLogsParams {
    id: String,
    #[serde(default)]
    tail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveImageParams {
    id: String,
    #[serde(default)]
    force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NetworkIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ComposeActionParams {
    project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AddComposeProjectParams {
    name: String,
    file_path: String,
    cwd: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveComposeProjectParams {
    id: String,
}

// ── Handler Registration ────────────────────────────────────────

pub fn register(router: &mut RpcRouter, docker_mgr: Arc<DockerManager>) {
    // -- Status / reconnect --

    let dm = docker_mgr.clone();
    router.register("docker.status", move |_params, _ctx| {
        let dm = dm.clone();
        async move {
            let status = dm.status().await;
            Ok(serde_json::to_value(&status).unwrap())
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.reconnect", move |_params, _ctx| {
        let dm = dm.clone();
        async move {
            let status = dm.reconnect().await?;
            Ok(serde_json::to_value(&status).unwrap())
        }
    });

    // -- Container operations --

    let dm = docker_mgr.clone();
    router.register("docker.container.list", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p: ListContainersParams = params
                .map(|v| serde_json::from_value(v).unwrap_or(ListContainersParams { all: true }))
                .unwrap_or(ListContainersParams { all: true });
            let containers = dm.list_containers(p.all).await?;
            Ok(serde_json::json!({ "containers": containers }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.inspect", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ContainerIdParams>(params)?;
            let detail = dm.inspect_container(&p.id).await?;
            Ok(serde_json::to_value(&detail).unwrap())
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.start", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ContainerIdParams>(params)?;
            dm.start_container(&p.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.stop", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ContainerIdParams>(params)?;
            dm.stop_container(&p.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.restart", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ContainerIdParams>(params)?;
            dm.restart_container(&p.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.remove", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<RemoveContainerParams>(params)?;
            dm.remove_container(&p.id, p.force).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.pause", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ContainerIdParams>(params)?;
            dm.pause_container(&p.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.unpause", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ContainerIdParams>(params)?;
            dm.unpause_container(&p.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.container.logs", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ContainerLogsParams>(params)?;
            let logs = dm.container_logs(&p.id, p.tail.as_deref()).await?;
            Ok(serde_json::json!({ "logs": logs }))
        }
    });

    // -- Image operations --

    let dm = docker_mgr.clone();
    router.register("docker.image.list", move |_params, _ctx| {
        let dm = dm.clone();
        async move {
            let images = dm.list_images().await?;
            Ok(serde_json::json!({ "images": images }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.image.remove", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<RemoveImageParams>(params)?;
            dm.remove_image(&p.id, p.force).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.image.prune", move |_params, _ctx| {
        let dm = dm.clone();
        async move {
            let result = dm.prune_images().await?;
            Ok(result)
        }
    });

    // -- Network operations --

    let dm = docker_mgr.clone();
    router.register("docker.network.list", move |_params, _ctx| {
        let dm = dm.clone();
        async move {
            let networks = dm.list_networks().await?;
            Ok(serde_json::json!({ "networks": networks }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.network.remove", move |params, _ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<NetworkIdParams>(params)?;
            dm.remove_network(&p.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    // -- Compose operations --

    let dm = docker_mgr.clone();
    router.register("docker.compose.list", move |_params, ctx| {
        let dm = dm.clone();
        async move {
            let projects = dm.list_compose_projects(&ctx.pool).await?;
            Ok(serde_json::json!({ "projects": projects }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.compose.add", move |params, ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<AddComposeProjectParams>(params)?;
            let project = dm
                .add_compose_project(&ctx.pool, &p.name, &p.file_path, &p.cwd)
                .await?;
            Ok(serde_json::to_value(&project).unwrap())
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.compose.remove", move |params, ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<RemoveComposeProjectParams>(params)?;
            dm.remove_compose_project(&ctx.pool, &p.id).await?;
            Ok(serde_json::json!({"success": true}))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.compose.up", move |params, ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ComposeActionParams>(params)?;
            let (cwd, file_path) = get_compose_project_paths(&ctx.pool, &p.project_id).await?;
            let output = dm.compose_up(&cwd, Some(&file_path)).await?;
            Ok(serde_json::json!({ "output": output }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.compose.down", move |params, ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ComposeActionParams>(params)?;
            let (cwd, file_path) = get_compose_project_paths(&ctx.pool, &p.project_id).await?;
            let output = dm.compose_down(&cwd, Some(&file_path)).await?;
            Ok(serde_json::json!({ "output": output }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.compose.restart", move |params, ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ComposeActionParams>(params)?;
            let (cwd, file_path) = get_compose_project_paths(&ctx.pool, &p.project_id).await?;
            let output = dm.compose_restart(&cwd, Some(&file_path)).await?;
            Ok(serde_json::json!({ "output": output }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.compose.pull", move |params, ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ComposeActionParams>(params)?;
            let (cwd, file_path) = get_compose_project_paths(&ctx.pool, &p.project_id).await?;
            let output = dm.compose_pull(&cwd, Some(&file_path)).await?;
            Ok(serde_json::json!({ "output": output }))
        }
    });

    let dm = docker_mgr.clone();
    router.register("docker.compose.ps", move |params, ctx| {
        let dm = dm.clone();
        async move {
            let p = parse_required_params::<ComposeActionParams>(params)?;
            let (cwd, file_path) = get_compose_project_paths(&ctx.pool, &p.project_id).await?;
            let services = dm.compose_ps(&cwd, Some(&file_path)).await?;
            Ok(serde_json::json!({ "services": services }))
        }
    });
}

/// Helper to get compose project paths from DB.
async fn get_compose_project_paths(
    pool: &sqlx::SqlitePool,
    project_id: &str,
) -> Result<(String, String), crate::error::AppError> {
    let row = sqlx::query_as::<_, (String, String)>(
        "SELECT cwd, file_path FROM compose_projects WHERE id = ?",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(crate::error::AppError::Database)?
    .ok_or_else(|| {
        crate::error::AppError::NotFound(format!("Compose project '{}'", project_id))
    })?;

    Ok(row)
}
