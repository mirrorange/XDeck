use serde::{Deserialize, Serialize};

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;

// ── Data Structures ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetInfo {
    pub id: String,
    pub name: String,
    pub command: String,
    pub tags: Vec<String>,
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
}

// ── Helpers ─────────────────────────────────────────────────────

fn row_to_snippet(
    id: String,
    name: String,
    command: String,
    tags_json: String,
    created_at: String,
    updated_at: String,
) -> SnippetInfo {
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    SnippetInfo {
        id,
        name,
        command,
        tags,
        created_at,
        updated_at,
    }
}

// ── Handler Registration ────────────────────────────────────────

pub fn register(router: &mut RpcRouter) {
    router.register("snippet.list", move |_params, ctx| async move {
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String)>(
            "SELECT id, name, command, tags, created_at, updated_at FROM snippets ORDER BY updated_at DESC",
        )
        .fetch_all(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let snippets: Vec<SnippetInfo> = rows
            .into_iter()
            .map(|(id, name, command, tags, created_at, updated_at)| {
                row_to_snippet(id, name, command, tags, created_at, updated_at)
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
            "INSERT INTO snippets (id, name, command, tags) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&params.name)
        .bind(&params.command)
        .bind(&tags_json)
        .execute(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let row = sqlx::query_as::<_, (String, String, String, String, String, String)>(
            "SELECT id, name, command, tags, created_at, updated_at FROM snippets WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let snippet = row_to_snippet(row.0, row.1, row.2, row.3, row.4, row.5);
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

        let row = sqlx::query_as::<_, (String, String, String, String, String, String)>(
            "SELECT id, name, command, tags, created_at, updated_at FROM snippets WHERE id = ?",
        )
        .bind(&params.id)
        .fetch_one(&ctx.pool)
        .await
        .map_err(crate::error::AppError::Database)?;

        let snippet = row_to_snippet(row.0, row.1, row.2, row.3, row.4, row.5);
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
