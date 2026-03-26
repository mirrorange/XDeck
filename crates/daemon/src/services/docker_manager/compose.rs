use std::path::PathBuf;

use chrono::Utc;

use crate::error::AppError;

use super::manager::DockerManager;
use super::types::{ComposeProjectInfo, ComposeServiceInfo, ContainerRuntime};

impl DockerManager {
    async fn compose_command(&self) -> Result<Vec<String>, AppError> {
        let runtime = self.runtime.read().await;

        if let Some(ContainerRuntime::Podman) = runtime.as_ref() {
            if which::which("podman-compose").is_ok() {
                return Ok(vec!["podman-compose".into()]);
            }
            if which::which("podman").is_ok() {
                return Ok(vec!["podman".into(), "compose".into()]);
            }
        }

        if which::which("docker").is_ok() {
            let output = tokio::process::Command::new("docker")
                .args(["compose", "version"])
                .output()
                .await;
            if let Ok(o) = output {
                if o.status.success() {
                    return Ok(vec!["docker".into(), "compose".into()]);
                }
            }
        }

        if which::which("docker-compose").is_ok() {
            return Ok(vec!["docker-compose".into()]);
        }

        Err(AppError::Internal(
            "No compose command found (docker compose / docker-compose / podman-compose)".into(),
        ))
    }

    pub async fn compose_up(
        &self,
        project_dir: &str,
        file: Option<&str>,
    ) -> Result<String, AppError> {
        self.run_compose_command(project_dir, file, &["up", "-d"])
            .await
    }

    pub async fn compose_down(
        &self,
        project_dir: &str,
        file: Option<&str>,
    ) -> Result<String, AppError> {
        self.run_compose_command(project_dir, file, &["down"]).await
    }

    pub async fn compose_restart(
        &self,
        project_dir: &str,
        file: Option<&str>,
    ) -> Result<String, AppError> {
        self.run_compose_command(project_dir, file, &["restart"])
            .await
    }

    pub async fn compose_pull(
        &self,
        project_dir: &str,
        file: Option<&str>,
    ) -> Result<String, AppError> {
        self.run_compose_command(project_dir, file, &["pull"]).await
    }

    async fn run_compose_command(
        &self,
        project_dir: &str,
        file: Option<&str>,
        args: &[&str],
    ) -> Result<String, AppError> {
        let cmd_parts = self.compose_command().await?;
        let mut cmd = tokio::process::Command::new(&cmd_parts[0]);
        for arg in &cmd_parts[1..] {
            cmd.arg(arg);
        }
        if let Some(f) = file {
            cmd.args(["-f", f]);
        }
        cmd.args(args);
        cmd.current_dir(project_dir);

        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run compose command: {}", e)))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(AppError::Internal(format!(
                "compose {} failed: {}",
                args.join(" "),
                stderr
            )));
        }

        Ok(format!("{}{}", stdout, stderr))
    }

    pub async fn compose_ps(
        &self,
        project_dir: &str,
        file: Option<&str>,
    ) -> Result<Vec<ComposeServiceInfo>, AppError> {
        let cmd_parts = self.compose_command().await?;
        let mut cmd = tokio::process::Command::new(&cmd_parts[0]);
        for arg in &cmd_parts[1..] {
            cmd.arg(arg);
        }
        if let Some(f) = file {
            cmd.args(["-f", f]);
        }
        cmd.args(["ps", "--format", "json", "-a"]);
        cmd.current_dir(project_dir);

        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run compose ps: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Internal(format!("compose ps failed: {}", stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        let services: Vec<ComposeServiceInfo> = stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|line| {
                let v: serde_json::Value = serde_json::from_str(line).ok()?;
                Some(ComposeServiceInfo {
                    name: v["Service"]
                        .as_str()
                        .or_else(|| v["Name"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    container_id: v["ID"].as_str().map(|s| s.to_string()),
                    state: v["State"]
                        .as_str()
                        .or_else(|| v["Status"].as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    image: v["Image"].as_str().unwrap_or("").to_string(),
                })
            })
            .collect();

        Ok(services)
    }

    pub async fn list_compose_projects(
        &self,
        pool: &sqlx::SqlitePool,
    ) -> Result<Vec<ComposeProjectInfo>, AppError> {
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT id, name, file_path, cwd, status, created_at, updated_at FROM compose_projects ORDER BY name ASC",
        )
        .fetch_all(pool)
        .await
        .map_err(AppError::Database)?;

        let mut projects = Vec::new();
        for (id, name, file_path, cwd, status, created_at, updated_at) in rows {
            let services = self
                .compose_ps(&cwd, Some(&file_path))
                .await
                .unwrap_or_default();

            projects.push(ComposeProjectInfo {
                id,
                name,
                file_path,
                cwd,
                status,
                services,
                created_at,
                updated_at,
            });
        }

        Ok(projects)
    }

    pub async fn add_compose_project(
        &self,
        pool: &sqlx::SqlitePool,
        name: &str,
        file_path: &str,
        cwd: &str,
    ) -> Result<ComposeProjectInfo, AppError> {
        let full_path = PathBuf::from(cwd).join(file_path);
        if !full_path.exists() {
            return Err(AppError::BadRequest(format!(
                "Compose file not found: {}",
                full_path.display()
            )));
        }

        let id = uuid::Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO compose_projects (id, name, file_path, cwd) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(name)
            .bind(file_path)
            .bind(cwd)
            .execute(pool)
            .await
            .map_err(AppError::Database)?;

        let services = self
            .compose_ps(cwd, Some(file_path))
            .await
            .unwrap_or_default();
        let now = Utc::now().to_rfc3339();

        Ok(ComposeProjectInfo {
            id,
            name: name.to_string(),
            file_path: file_path.to_string(),
            cwd: cwd.to_string(),
            status: "created".to_string(),
            services,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn remove_compose_project(
        &self,
        pool: &sqlx::SqlitePool,
        id: &str,
    ) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM compose_projects WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(AppError::Database)?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("Compose project '{}'", id)));
        }

        Ok(())
    }
}
