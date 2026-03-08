use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;

// ── Data Structures ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetSourceInfo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// A single snippet entry from a remote source index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSnippet {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub command: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_execution_mode")]
    pub execution_mode: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
}

fn default_execution_mode() -> String {
    "paste_and_run".into()
}

/// Remote source index JSON format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSnippetIndex {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub snippets: Vec<RemoteSnippet>,
}

/// Response combining source info with fetched snippets.
#[derive(Debug, Clone, Serialize)]
pub struct SourceWithSnippets {
    pub source: SnippetSourceInfo,
    pub snippets: Vec<RemoteSnippet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Param Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AddSourceParams {
    name: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceIdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct InstallSnippetParams {
    name: String,
    command: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default = "default_execution_mode")]
    execution_mode: String,
}

// ── Handler Registration ────────────────────────────────────────

pub fn register(router: &mut RpcRouter) {
    // List all snippet sources
    router.register("snippet_store.list_sources", move |_params, ctx| async move {
        let rows = sqlx::query_as::<_, (String, String, String, i32, String, String)>(
            "SELECT id, name, url, enabled, created_at, updated_at FROM snippet_sources ORDER BY created_at ASC",
        )
        .fetch_all(&ctx.pool)
        .await
        .map_err(AppError::Database)?;

        let sources: Vec<SnippetSourceInfo> = rows
            .into_iter()
            .map(|(id, name, url, enabled, created_at, updated_at)| SnippetSourceInfo {
                id,
                name,
                url,
                enabled: enabled != 0,
                created_at,
                updated_at,
            })
            .collect();

        Ok(serde_json::json!({ "sources": sources }))
    });

    // Add a new snippet source
    router.register("snippet_store.add_source", move |params, ctx| async move {
        let params = parse_required_params::<AddSourceParams>(params)?;

        if params.name.trim().is_empty() {
            return Err(AppError::BadRequest("Source name is required".into()));
        }
        if params.url.trim().is_empty() {
            return Err(AppError::BadRequest("Source URL is required".into()));
        }

        // Validate URL format
        if !params.url.starts_with("https://") && !params.url.starts_with("http://") {
            return Err(AppError::BadRequest("Source URL must start with http:// or https://".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO snippet_sources (id, name, url) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(&params.name)
            .bind(&params.url)
            .execute(&ctx.pool)
            .await
            .map_err(|e| {
                if let sqlx::Error::Database(ref db_err) = e {
                    if db_err.message().contains("UNIQUE") {
                        return AppError::BadRequest("A source with this URL already exists".into());
                    }
                }
                AppError::Database(e)
            })?;

        let row = sqlx::query_as::<_, (String, String, String, i32, String, String)>(
            "SELECT id, name, url, enabled, created_at, updated_at FROM snippet_sources WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&ctx.pool)
        .await
        .map_err(AppError::Database)?;

        let source = SnippetSourceInfo {
            id: row.0,
            name: row.1,
            url: row.2,
            enabled: row.3 != 0,
            created_at: row.4,
            updated_at: row.5,
        };

        Ok(serde_json::to_value(&source).unwrap())
    });

    // Remove a snippet source
    router.register("snippet_store.remove_source", move |params, ctx| async move {
        let params = parse_required_params::<SourceIdParams>(params)?;

        if params.id == "official" {
            return Err(AppError::BadRequest("Cannot remove the official source".into()));
        }

        let result = sqlx::query("DELETE FROM snippet_sources WHERE id = ?")
            .bind(&params.id)
            .execute(&ctx.pool)
            .await
            .map_err(AppError::Database)?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("Source '{}'", params.id)));
        }

        Ok(serde_json::json!({ "ok": true }))
    });

    // Fetch snippets from all enabled sources
    router.register("snippet_store.fetch_snippets", move |_params, ctx| async move {
        let rows = sqlx::query_as::<_, (String, String, String, i32, String, String)>(
            "SELECT id, name, url, enabled, created_at, updated_at FROM snippet_sources WHERE enabled = 1 ORDER BY created_at ASC",
        )
        .fetch_all(&ctx.pool)
        .await
        .map_err(AppError::Database)?;

        let sources: Vec<SnippetSourceInfo> = rows
            .into_iter()
            .map(|(id, name, url, enabled, created_at, updated_at)| SnippetSourceInfo {
                id,
                name,
                url,
                enabled: enabled != 0,
                created_at,
                updated_at,
            })
            .collect();

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::Internal(format!("Failed to create HTTP client: {e}")))?;

        let mut results: Vec<SourceWithSnippets> = Vec::new();

        for source in sources {
            match client.get(&source.url).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        match resp.json::<RemoteSnippetIndex>().await {
                            Ok(index) => {
                                results.push(SourceWithSnippets {
                                    source,
                                    snippets: index.snippets,
                                    error: None,
                                });
                            }
                            Err(e) => {
                                results.push(SourceWithSnippets {
                                    source,
                                    snippets: vec![],
                                    error: Some(format!("Failed to parse index: {e}")),
                                });
                            }
                        }
                    } else {
                        results.push(SourceWithSnippets {
                            source,
                            snippets: vec![],
                            error: Some(format!("HTTP {}", resp.status())),
                        });
                    }
                }
                Err(e) => {
                    results.push(SourceWithSnippets {
                        source,
                        snippets: vec![],
                        error: Some(format!("Failed to fetch: {e}")),
                    });
                }
            }
        }

        Ok(serde_json::json!({ "results": results }))
    });

    // Install a snippet from the store (creates a local snippet)
    router.register("snippet_store.install", move |params, ctx| async move {
        let params = parse_required_params::<InstallSnippetParams>(params)?;

        if params.name.trim().is_empty() {
            return Err(AppError::BadRequest("Snippet name is required".into()));
        }
        if params.command.is_empty() {
            return Err(AppError::BadRequest("Snippet command is required".into()));
        }

        let valid_modes = ["paste_and_run", "paste_only", "execute_as_script"];
        let execution_mode = if valid_modes.contains(&params.execution_mode.as_str()) {
            params.execution_mode.clone()
        } else {
            "paste_and_run".to_string()
        };

        let id = uuid::Uuid::new_v4().to_string();
        let tags_json =
            serde_json::to_string(&params.tags).unwrap_or_else(|_| "[]".into());

        sqlx::query(
            "INSERT INTO snippets (id, name, command, tags, execution_mode) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&params.name)
        .bind(&params.command)
        .bind(&tags_json)
        .bind(&execution_mode)
        .execute(&ctx.pool)
        .await
        .map_err(AppError::Database)?;

        let row = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT id, name, command, tags, execution_mode, created_at, updated_at FROM snippets WHERE id = ?",
        )
        .bind(&id)
        .fetch_one(&ctx.pool)
        .await
        .map_err(AppError::Database)?;

        let tags: Vec<String> = serde_json::from_str(&row.3).unwrap_or_default();
        let snippet = serde_json::json!({
            "id": row.0,
            "name": row.1,
            "command": row.2,
            "tags": tags,
            "execution_mode": row.4,
            "created_at": row.5,
            "updated_at": row.6,
        });

        Ok(snippet)
    });
}
