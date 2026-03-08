use serde::{Deserialize, Serialize};

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;

// ── Data Structures ─────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SnippetExecutionMode {
    #[default]
    PasteAndRun,
    PasteOnly,
    ExecuteAsScript,
}

impl SnippetExecutionMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::PasteAndRun => "paste_and_run",
            Self::PasteOnly => "paste_only",
            Self::ExecuteAsScript => "execute_as_script",
        }
    }

    fn from_db(value: &str) -> Self {
        match value {
            "paste_only" => Self::PasteOnly,
            "execute_as_script" => Self::ExecuteAsScript,
            _ => Self::PasteAndRun,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub tags: Vec<String>,
    pub execution_mode: SnippetExecutionMode,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SnippetIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateSnippetParams {
    name: String,
    command: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    execution_mode: SnippetExecutionMode,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateSnippetParams {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    execution_mode: Option<SnippetExecutionMode>,
}

// ── Helpers ─────────────────────────────────────────────────────

fn row_to_snippet(
    id: String,
    name: String,
    command: String,
    tags_json: String,
    execution_mode: String,
    created_at: String,
    updated_at: String,
) -> SnippetInfo {
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    SnippetInfo {
        id,
        name,
        command,
        tags,
        execution_mode: SnippetExecutionMode::from_db(&execution_mode),
        created_at,
        updated_at,
    }
}

// ── Handler Registration ────────────────────────────────────────

pub fn register(router: &mut RpcRouter) {
    router.register("snippet.list", move |_params, ctx| async move {
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT id, name, command, tags, execution_mode, created_at, updated_at FROM snippets ORDER BY updated_at DESC",
        )
        .fetch_all(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let snippets: Vec<SnippetInfo> = rows
            .into_iter()
            .map(|(id, name, command, tags, execution_mode, created_at, updated_at)| {
                row_to_snippet(id, name, command, tags, execution_mode, created_at, updated_at)
            })
            .collect();

        Ok(serde_json::json!({ "snippets": snippets }))
    });

    router.register("snippet.create", move |params, ctx| async move {
        let params = parse_required_params::<CreateSnippetParams>(params)?;

        if params.name.trim().is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "Snippet name is required".into(),
            ));
        }
        if params.command.is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "Snippet command is required".into(),
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let tags_json = serde_json::to_string(&params.tags).unwrap_or_else(|_| "[]".into());

        sqlx::query(
            "INSERT INTO snippets (id, name, command, tags, execution_mode) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&params.name)
        .bind(&params.command)
        .bind(&tags_json)
        .bind(params.execution_mode.as_str())
        .execute(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let row = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT id, name, command, tags, execution_mode, created_at, updated_at FROM snippets WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let snippet = row_to_snippet(row.0, row.1, row.2, row.3, row.4, row.5, row.6);
        Ok(serde_json::to_value(&snippet).unwrap())
    });

    router.register("snippet.update", move |params, ctx| async move {
        let params = parse_required_params::<UpdateSnippetParams>(params)?;

        // Verify snippet exists
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM snippets WHERE id = ?",
        )
        .bind(&params.id)
        .fetch_one(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        if exists == 0 {
            return Err(crate::error::AppError::NotFound(format!(
                "Snippet '{}'",
                params.id
            )));
        }

        if let Some(ref name) = params.name {
            if name.trim().is_empty() {
                return Err(crate::error::AppError::BadRequest(
                    "Snippet name cannot be empty".into(),
                ));
            }
            sqlx::query("UPDATE snippets SET name = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(name)
                .bind(&params.id)
                .execute(&ctx.pool)
                .await
                .map_err(crate::error::AppError::Database)?;
        }

        if let Some(ref command) = params.command {
            sqlx::query(
                "UPDATE snippets SET command = ?, updated_at = datetime('now') WHERE id = ?",
            )
            .bind(command)
            .bind(&params.id)
            .execute(&ctx.pool)
            .await
            .map_err(crate::error::AppError::Database)?;
        }

        if let Some(ref tags) = params.tags {
            let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".into());
            sqlx::query("UPDATE snippets SET tags = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(&tags_json)
                .bind(&params.id)
                .execute(&ctx.pool)
                .await
                .map_err(crate::error::AppError::Database)?;
        }

        if let Some(execution_mode) = params.execution_mode {
            sqlx::query(
                "UPDATE snippets SET execution_mode = ?, updated_at = datetime('now') WHERE id = ?",
            )
            .bind(execution_mode.as_str())
            .bind(&params.id)
            .execute(&ctx.pool)
            .await
            .map_err(crate::error::AppError::Database)?;
        }

        let row = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT id, name, command, tags, execution_mode, created_at, updated_at FROM snippets WHERE id = ?",
        )
        .bind(&params.id)
        .fetch_one(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let snippet = row_to_snippet(row.0, row.1, row.2, row.3, row.4, row.5, row.6);
        Ok(serde_json::to_value(&snippet).unwrap())
    });

    router.register("snippet.delete", move |params, ctx| async move {
        let params = parse_required_params::<SnippetIdParams>(params)?;

        let result = sqlx::query("DELETE FROM snippets WHERE id = ?")
            .bind(&params.id)
            .execute(&ctx.pool)
            .await
            .map_err(crate::error::AppError::Database)?;

        if result.rows_affected() == 0 {
            return Err(crate::error::AppError::NotFound(format!(
                "Snippet '{}'",
                params.id
            )));
        }

        Ok(serde_json::json!({"success": true}))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    use crate::rpc::router::RequestContext;
    use crate::rpc::types::JsonRpcRequest;

    async fn test_pool() -> sqlx::SqlitePool {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        pool
    }

    fn test_request(method: &str, params: serde_json::Value) -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: method.to_string(),
            params: Some(params),
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
    async fn test_snippet_create_defaults_to_paste_and_run() {
        let pool = test_pool().await;
        let mut router = RpcRouter::new();
        register(&mut router);

        let result = dispatch(
            &router,
            pool,
            test_request(
                "snippet.create",
                serde_json::json!({
                    "name": "List files",
                    "command": "ls -la",
                    "tags": ["shell"],
                }),
            ),
        )
        .await;

        let snippet: SnippetInfo = serde_json::from_value(result).unwrap();
        assert_eq!(snippet.execution_mode, SnippetExecutionMode::PasteAndRun);
    }

    #[tokio::test]
    async fn test_snippet_list_returns_persisted_execution_mode() {
        let pool = test_pool().await;
        let mut router = RpcRouter::new();
        register(&mut router);

        dispatch(
            &router,
            pool.clone(),
            test_request(
                "snippet.create",
                serde_json::json!({
                    "name": "Deploy",
                    "command": "echo deploy",
                    "execution_mode": "execute_as_script",
                }),
            ),
        )
        .await;

        let result = dispatch(
            &router,
            pool,
            test_request("snippet.list", serde_json::json!({})),
        )
        .await;
        let snippets: Vec<SnippetInfo> =
            serde_json::from_value(result.get("snippets").cloned().unwrap()).unwrap();

        assert_eq!(snippets.len(), 1);
        assert_eq!(
            snippets[0].execution_mode,
            SnippetExecutionMode::ExecuteAsScript
        );
    }

    #[tokio::test]
    async fn test_snippet_update_changes_execution_mode() {
        let pool = test_pool().await;
        let mut router = RpcRouter::new();
        register(&mut router);

        let created = dispatch(
            &router,
            pool.clone(),
            test_request(
                "snippet.create",
                serde_json::json!({
                    "name": "Build",
                    "command": "cargo build",
                }),
            ),
        )
        .await;
        let snippet: SnippetInfo = serde_json::from_value(created).unwrap();

        let updated = dispatch(
            &router,
            pool,
            test_request(
                "snippet.update",
                serde_json::json!({
                    "id": snippet.id,
                    "execution_mode": "paste_only",
                }),
            ),
        )
        .await;

        let snippet: SnippetInfo = serde_json::from_value(updated).unwrap();
        assert_eq!(snippet.execution_mode, SnippetExecutionMode::PasteOnly);
    }
}
