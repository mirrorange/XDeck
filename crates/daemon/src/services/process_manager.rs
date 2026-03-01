use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::event_bus::SharedEventBus;

// ── Data Structures ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStatus {
    Created,
    Starting,
    Running,
    Stopped,
    Errored,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RestartStrategy {
    Always,
    OnFailure,
    Never,
}

impl Default for RestartStrategy {
    fn default() -> Self {
        Self::OnFailure
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestartPolicy {
    #[serde(default)]
    pub strategy: RestartStrategy,
    pub max_retries: Option<u32>,
    #[serde(default = "default_delay_ms")]
    pub delay_ms: u64,
    #[serde(default = "default_backoff")]
    pub backoff_multiplier: f64,
}

fn default_delay_ms() -> u64 {
    1000
}

fn default_backoff() -> f64 {
    2.0
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            strategy: RestartStrategy::OnFailure,
            max_retries: Some(10),
            delay_ms: default_delay_ms(),
            backoff_multiplier: default_backoff(),
        }
    }
}

/// Persistent process definition (stored in DB).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessDefinition {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub restart_policy: RestartPolicy,
    pub auto_start: bool,
    pub group_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Runtime process info (in memory).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    #[serde(flatten)]
    pub definition: ProcessDefinition,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub started_at: Option<String>,
    pub exit_code: Option<i32>,
}

/// Create process request payload.
#[derive(Debug, Deserialize)]
pub struct CreateProcessRequest {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub restart_policy: RestartPolicy,
    #[serde(default = "default_true")]
    pub auto_start: bool,
    pub group_name: Option<String>,
}

fn default_true() -> bool {
    true
}

// ── Runtime State ───────────────────────────────────────────────

struct RunningProcess {
    child: Option<Child>,
    status: ProcessStatus,
    pid: Option<u32>,
    restart_count: u32,
    started_at: Option<DateTime<Utc>>,
    exit_code: Option<i32>,
    /// Sender to signal the supervisor task to stop
    cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

// ── Process Manager ─────────────────────────────────────────────

/// ProcessManager handles the lifecycle of managed processes.
pub struct ProcessManager {
    /// Runtime state of all processes
    processes: RwLock<HashMap<String, Mutex<RunningProcess>>>,
    pool: SqlitePool,
    event_bus: SharedEventBus,
}

impl ProcessManager {
    pub fn new(pool: SqlitePool, event_bus: SharedEventBus) -> Arc<Self> {
        Arc::new(Self {
            processes: RwLock::new(HashMap::new()),
            pool,
            event_bus,
        })
    }

    /// Restore processes on daemon startup.
    pub async fn restore_processes(self: &Arc<Self>) -> anyhow::Result<()> {
        let definitions = self.load_all_definitions().await?;
        let auto_start_defs: Vec<_> = definitions.into_iter().filter(|d| d.auto_start).collect();

        info!("Restoring {} auto-start processes", auto_start_defs.len());

        for def in auto_start_defs {
            let id = def.id.clone();
            // Register in runtime state
            {
                let mut procs = self.processes.write().await;
                procs.insert(
                    id.clone(),
                    Mutex::new(RunningProcess {
                        child: None,
                        status: ProcessStatus::Created,
                        pid: None,
                        restart_count: 0,
                        started_at: None,
                        exit_code: None,
                        cancel_tx: None,
                    }),
                );
            }
            // Start the process
            if let Err(e) = self.start_process_internal(&id).await {
                error!("Failed to restore process {}: {}", id, e);
            }
        }

        Ok(())
    }

    /// Create a new managed process.
    pub async fn create_process(
        self: &Arc<Self>,
        req: CreateProcessRequest,
    ) -> Result<ProcessInfo, AppError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let definition = ProcessDefinition {
            id: id.clone(),
            name: req.name,
            command: req.command,
            args: req.args,
            cwd: req.cwd,
            env: req.env,
            restart_policy: req.restart_policy,
            auto_start: req.auto_start,
            group_name: req.group_name,
            created_at: now.clone(),
            updated_at: now,
        };

        // Store in database
        self.save_definition(&definition).await?;

        // Register in runtime state
        {
            let mut procs = self.processes.write().await;
            procs.insert(
                id.clone(),
                Mutex::new(RunningProcess {
                    child: None,
                    status: ProcessStatus::Created,
                    pid: None,
                    restart_count: 0,
                    started_at: None,
                    exit_code: None,
                    cancel_tx: None,
                }),
            );
        }

        info!("Created process: {} ({})", definition.name, id);

        Ok(ProcessInfo {
            definition,
            status: ProcessStatus::Created,
            pid: None,
            restart_count: 0,
            started_at: None,
            exit_code: None,
        })
    }

    /// Start a process by ID.
    pub async fn start_process(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        // Verify the process exists
        let procs = self.processes.read().await;
        if !procs.contains_key(id) {
            return Err(AppError::NotFound(format!("Process {} not found", id)));
        }
        drop(procs);

        self.start_process_internal(id).await
    }

    /// Internal: Actually spawn the child process and set up monitoring.
    async fn start_process_internal(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        let def = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;

        let procs = self.processes.read().await;
        let proc_mutex = procs
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        let mut proc = proc_mutex.lock().await;

        // Don't start if already running
        if proc.status == ProcessStatus::Running {
            return Err(AppError::AlreadyExists(format!(
                "Process {} is already running",
                id
            )));
        }

        proc.status = ProcessStatus::Starting;

        // Build the command
        let mut cmd = Command::new(&def.command);
        cmd.args(&def.args);
        cmd.current_dir(&def.cwd);
        for (k, v) in &def.env {
            cmd.env(k, v);
        }
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Spawn
        match cmd.spawn() {
            Ok(mut child) => {
                let pid = child.id();
                proc.pid = pid;
                proc.status = ProcessStatus::Running;
                proc.started_at = Some(Utc::now());
                proc.exit_code = None;

                // Set up log streaming for stdout
                let event_bus = self.event_bus.clone();
                let process_id = id.to_string();

                if let Some(stdout) = child.stdout.take() {
                    let bus = event_bus.clone();
                    let pid_str = process_id.clone();
                    tokio::spawn(async move {
                        let reader = BufReader::new(stdout);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            bus.publish(
                                "process.log",
                                serde_json::json!({
                                    "process_id": pid_str,
                                    "stream": "stdout",
                                    "line": line,
                                }),
                            );
                        }
                    });
                }

                if let Some(stderr) = child.stderr.take() {
                    let bus = event_bus.clone();
                    let pid_str = process_id.clone();
                    tokio::spawn(async move {
                        let reader = BufReader::new(stderr);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            bus.publish(
                                "process.log",
                                serde_json::json!({
                                    "process_id": pid_str,
                                    "stream": "stderr",
                                    "line": line,
                                }),
                            );
                        }
                    });
                }

                proc.child = Some(child);

                // Publish status event
                self.event_bus.publish(
                    "process.status_changed",
                    serde_json::json!({
                        "process_id": id,
                        "status": "running",
                        "pid": pid,
                    }),
                );

                info!("Started process: {} (PID: {:?})", def.name, pid);

                // Spawn supervisor task for auto-restart
                let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
                proc.cancel_tx = Some(cancel_tx);
                drop(proc);
                drop(procs);

                let mgr = self.clone();
                let proc_id = id.to_string();
                tokio::spawn(mgr.supervise_process(proc_id, cancel_rx));

                Ok(())
            }
            Err(e) => {
                proc.status = ProcessStatus::Errored;
                error!("Failed to start process {}: {}", def.name, e);
                Err(AppError::Internal(format!("Failed to start: {}", e)))
            }
        }
    }

    /// Supervise a running process — wait for exit and handle restart policy.
    async fn supervise_process(
        self: Arc<Self>,
        id: String,
        mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    ) {
        loop {
            // Take the child out so we don't hold locks while waiting
            let mut child = {
                let procs = self.processes.read().await;
                let Some(proc_mutex) = procs.get(&id) else {
                    return;
                };
                let mut proc = proc_mutex.lock().await;
                match proc.child.take() {
                    Some(c) => c,
                    None => return,
                }
            };

            // Wait for process exit or cancellation without holding any locks
            let exit_status = tokio::select! {
                result = child.wait() => result.ok(),
                _ = &mut cancel_rx => {
                    debug!("Supervisor cancelled for process {}", id);
                    // Stop requests can arrive while the supervisor owns `child`.
                    // In that case, the supervisor must terminate and reap it.
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return;
                }
            };

            let exit_code = exit_status.and_then(|s| s.code());
            let success = exit_status.map(|s| s.success()).unwrap_or(false);

            info!("Process {} exited with code: {:?}", id, exit_code);

            // Load definition for restart policy
            let def = match self.load_definition(&id).await {
                Ok(Some(d)) => d,
                _ => return,
            };

            // Update runtime state and determine if we should restart
            let should_restart = {
                let procs = self.processes.read().await;
                let Some(proc_mutex) = procs.get(&id) else {
                    return;
                };
                let mut proc = proc_mutex.lock().await;
                proc.child = None;
                proc.pid = None;
                proc.exit_code = exit_code;

                if success {
                    proc.status = ProcessStatus::Stopped;
                } else {
                    proc.status = ProcessStatus::Errored;
                }

                self.event_bus.publish(
                    "process.status_changed",
                    serde_json::json!({
                        "process_id": id,
                        "status": format!("{:?}", proc.status).to_lowercase(),
                        "exit_code": exit_code,
                    }),
                );

                let policy = &def.restart_policy;
                match policy.strategy {
                    RestartStrategy::Always => policy
                        .max_retries
                        .map_or(true, |max| proc.restart_count < max),
                    RestartStrategy::OnFailure => {
                        if success {
                            false
                        } else {
                            policy
                                .max_retries
                                .map_or(true, |max| proc.restart_count < max)
                        }
                    }
                    RestartStrategy::Never => false,
                }
            };

            if !should_restart {
                // Mark as Failed if process errored and we're not restarting
                let procs = self.processes.read().await;
                if let Some(proc_mutex) = procs.get(&id) {
                    let mut proc = proc_mutex.lock().await;
                    if proc.status == ProcessStatus::Errored {
                        proc.status = ProcessStatus::Failed;
                        self.event_bus.publish(
                            "process.status_changed",
                            serde_json::json!({
                                "process_id": id,
                                "status": "failed",
                                "message": "Max restart retries exceeded",
                            }),
                        );
                    }
                }
                return;
            }

            // Calculate backoff delay
            let delay = {
                let procs = self.processes.read().await;
                let proc_mutex = procs.get(&id).unwrap();
                let mut proc = proc_mutex.lock().await;
                proc.restart_count += 1;
                let base_delay = def.restart_policy.delay_ms;
                let multiplier = def.restart_policy.backoff_multiplier;
                let delay_ms = (base_delay as f64
                    * multiplier.powi(proc.restart_count.saturating_sub(1) as i32))
                    as u64;
                Duration::from_millis(delay_ms.min(30_000))
            };

            info!("Restarting process {} in {:?}", def.name, delay);
            tokio::time::sleep(delay).await;

            // Inline restart: spawn the child process directly
            let mut cmd = Command::new(&def.command);
            cmd.args(&def.args);
            cmd.current_dir(&def.cwd);
            for (k, v) in &def.env {
                cmd.env(k, v);
            }
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());

            match cmd.spawn() {
                Ok(mut child) => {
                    let pid = child.id();

                    // Set up log streaming
                    if let Some(stdout) = child.stdout.take() {
                        let bus = self.event_bus.clone();
                        let pid_str = id.clone();
                        tokio::spawn(async move {
                            let reader = BufReader::new(stdout);
                            let mut lines = reader.lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                bus.publish(
                                    "process.log",
                                    serde_json::json!({
                                        "process_id": pid_str,
                                        "stream": "stdout",
                                        "line": line,
                                    }),
                                );
                            }
                        });
                    }
                    if let Some(stderr) = child.stderr.take() {
                        let bus = self.event_bus.clone();
                        let pid_str = id.clone();
                        tokio::spawn(async move {
                            let reader = BufReader::new(stderr);
                            let mut lines = reader.lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                bus.publish(
                                    "process.log",
                                    serde_json::json!({
                                        "process_id": pid_str,
                                        "stream": "stderr",
                                        "line": line,
                                    }),
                                );
                            }
                        });
                    }

                    // Update state
                    let (new_cancel_tx, new_cancel_rx) = tokio::sync::oneshot::channel();
                    {
                        let procs = self.processes.read().await;
                        if let Some(proc_mutex) = procs.get(&id) {
                            let mut proc = proc_mutex.lock().await;
                            proc.child = Some(child);
                            proc.pid = pid;
                            proc.status = ProcessStatus::Running;
                            proc.started_at = Some(Utc::now());
                            proc.exit_code = None;
                            proc.cancel_tx = Some(new_cancel_tx);
                        }
                    }

                    self.event_bus.publish(
                        "process.status_changed",
                        serde_json::json!({
                            "process_id": id,
                            "status": "running",
                            "pid": pid,
                        }),
                    );

                    info!("Restarted process: {} (PID: {:?})", def.name, pid);

                    // Replace cancel_rx for next iteration
                    cancel_rx = new_cancel_rx;
                    // Continue the loop to supervise the new child
                }
                Err(e) => {
                    error!("Failed to restart process {}: {}", def.name, e);
                    let procs = self.processes.read().await;
                    if let Some(proc_mutex) = procs.get(&id) {
                        let mut proc = proc_mutex.lock().await;
                        proc.status = ProcessStatus::Failed;
                    }
                    return;
                }
            }
        }
    }

    /// Stop a process by ID.
    pub async fn stop_process(&self, id: &str) -> Result<(), AppError> {
        let procs = self.processes.read().await;
        let proc_mutex = procs
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        let mut proc = proc_mutex.lock().await;

        // Cancel the supervisor
        if let Some(cancel_tx) = proc.cancel_tx.take() {
            let _ = cancel_tx.send(());
        }

        // Kill the process
        if let Some(child) = proc.child.as_mut() {
            let _ = child.kill().await;
        }

        proc.child = None;
        proc.pid = None;
        proc.status = ProcessStatus::Stopped;

        self.event_bus.publish(
            "process.status_changed",
            serde_json::json!({
                "process_id": id,
                "status": "stopped",
            }),
        );

        info!("Stopped process: {}", id);
        Ok(())
    }

    /// Restart a process by ID.
    pub async fn restart_process(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        self.stop_process(id).await?;
        tokio::time::sleep(Duration::from_millis(200)).await;
        self.start_process(id).await
    }

    /// Delete a process by ID. Stops it first if running.
    pub async fn delete_process(&self, id: &str) -> Result<(), AppError> {
        // Stop if running
        let _ = self.stop_process(id).await;

        // Remove from runtime
        {
            let mut procs = self.processes.write().await;
            procs.remove(id);
        }

        // Remove from database
        sqlx::query("DELETE FROM processes WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        info!("Deleted process: {}", id);
        Ok(())
    }

    /// List all processes with their current status.
    pub async fn list_processes(&self) -> Result<Vec<ProcessInfo>, AppError> {
        let definitions = self.load_all_definitions().await?;
        let procs = self.processes.read().await;

        let mut result = Vec::new();
        for def in definitions {
            let (status, pid, restart_count, started_at, exit_code) =
                if let Some(proc_mutex) = procs.get(&def.id) {
                    let proc = proc_mutex.lock().await;
                    (
                        proc.status.clone(),
                        proc.pid,
                        proc.restart_count,
                        proc.started_at.map(|t| t.to_rfc3339()),
                        proc.exit_code,
                    )
                } else {
                    (ProcessStatus::Created, None, 0, None, None)
                };

            result.push(ProcessInfo {
                definition: def,
                status,
                pid,
                restart_count,
                started_at,
                exit_code,
            });
        }

        Ok(result)
    }

    /// Get a single process by ID.
    pub async fn get_process(&self, id: &str) -> Result<ProcessInfo, AppError> {
        let def = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;

        let procs = self.processes.read().await;
        let (status, pid, restart_count, started_at, exit_code) =
            if let Some(proc_mutex) = procs.get(id) {
                let proc = proc_mutex.lock().await;
                (
                    proc.status.clone(),
                    proc.pid,
                    proc.restart_count,
                    proc.started_at.map(|t| t.to_rfc3339()),
                    proc.exit_code,
                )
            } else {
                (ProcessStatus::Created, None, 0, None, None)
            };

        Ok(ProcessInfo {
            definition: def,
            status,
            pid,
            restart_count,
            started_at,
            exit_code,
        })
    }

    // ── Database Operations ─────────────────────────────────────

    async fn save_definition(&self, def: &ProcessDefinition) -> Result<(), AppError> {
        let args_json = serde_json::to_string(&def.args).unwrap();
        let env_json = serde_json::to_string(&def.env).unwrap();
        let policy_json = serde_json::to_string(&def.restart_policy).unwrap();

        sqlx::query(
            "INSERT OR REPLACE INTO processes (id, name, command, args, cwd, env, restart_policy, auto_start, group_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(&def.id)
        .bind(&def.name)
        .bind(&def.command)
        .bind(&args_json)
        .bind(&def.cwd)
        .bind(&env_json)
        .bind(&policy_json)
        .bind(def.auto_start as i32)
        .bind(&def.group_name)
        .bind(&def.created_at)
        .bind(&def.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn load_definition(&self, id: &str) -> Result<Option<ProcessDefinition>, AppError> {
        let row: Option<(
            String, String, String, String, String,
            String, String, i32, Option<String>, String, String,
        )> = sqlx::query_as(
            "SELECT id, name, command, args, cwd, env, restart_policy, auto_start, group_name, created_at, updated_at FROM processes WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| ProcessDefinition {
            id: r.0,
            name: r.1,
            command: r.2,
            args: serde_json::from_str(&r.3).unwrap_or_default(),
            cwd: r.4,
            env: serde_json::from_str(&r.5).unwrap_or_default(),
            restart_policy: serde_json::from_str(&r.6).unwrap_or_default(),
            auto_start: r.7 != 0,
            group_name: r.8,
            created_at: r.9,
            updated_at: r.10,
        }))
    }

    async fn load_all_definitions(&self) -> Result<Vec<ProcessDefinition>, AppError> {
        let rows: Vec<(
            String, String, String, String, String,
            String, String, i32, Option<String>, String, String,
        )> = sqlx::query_as(
            "SELECT id, name, command, args, cwd, env, restart_policy, auto_start, group_name, created_at, updated_at FROM processes ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await?;

        let defs = rows
            .into_iter()
            .map(|r| ProcessDefinition {
                id: r.0,
                name: r.1,
                command: r.2,
                args: serde_json::from_str(&r.3).unwrap_or_default(),
                cwd: r.4,
                env: serde_json::from_str(&r.5).unwrap_or_default(),
                restart_policy: serde_json::from_str(&r.6).unwrap_or_default(),
                auto_start: r.7 != 0,
                group_name: r.8,
                created_at: r.9,
                updated_at: r.10,
            })
            .collect();

        Ok(defs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::event_bus::EventBus;

    #[cfg(unix)]
    fn process_exists(pid: u32) -> bool {
        std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("kill -0 {} 2>/dev/null", pid))
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    async fn test_pm() -> (Arc<ProcessManager>, SqlitePool) {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        let event_bus = Arc::new(EventBus::default());
        let pm = ProcessManager::new(pool.clone(), event_bus);
        (pm, pool)
    }

    #[tokio::test]
    async fn test_create_process() {
        let (pm, _pool) = test_pm().await;

        let info = pm
            .create_process(CreateProcessRequest {
                name: "test-echo".to_string(),
                command: "echo".to_string(),
                args: vec!["hello".to_string()],
                cwd: "/tmp".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy::default(),
                auto_start: false,
                group_name: None,
            })
            .await
            .unwrap();

        assert_eq!(info.definition.name, "test-echo");
        assert_eq!(info.status, ProcessStatus::Created);
    }

    #[tokio::test]
    async fn test_start_and_stop_process() {
        let (pm, _pool) = test_pm().await;

        let info = pm
            .create_process(CreateProcessRequest {
                name: "test-sleep".to_string(),
                command: "sleep".to_string(),
                args: vec!["60".to_string()],
                cwd: "/tmp".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy {
                    strategy: RestartStrategy::Never,
                    ..Default::default()
                },
                auto_start: false,
                group_name: None,
            })
            .await
            .unwrap();

        let id = info.definition.id;

        // Start
        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;

        let proc = pm.get_process(&id).await.unwrap();
        assert_eq!(proc.status, ProcessStatus::Running);
        assert!(proc.pid.is_some());
        #[cfg(unix)]
        let pid = proc.pid.unwrap();

        // Stop
        pm.stop_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;

        let proc = pm.get_process(&id).await.unwrap();
        assert_eq!(proc.status, ProcessStatus::Stopped);
        assert!(proc.pid.is_none());

        #[cfg(unix)]
        {
            // Give the runtime a moment to deliver cancellation and reap.
            for _ in 0..20 {
                if !process_exists(pid) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            assert!(
                !process_exists(pid),
                "process {} should be terminated after stop_process",
                pid
            );
        }
    }

    #[tokio::test]
    async fn test_list_processes() {
        let (pm, _pool) = test_pm().await;

        pm.create_process(CreateProcessRequest {
            name: "proc-1".to_string(),
            command: "echo".to_string(),
            args: vec![],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy::default(),
            auto_start: false,
            group_name: None,
        })
        .await
        .unwrap();

        pm.create_process(CreateProcessRequest {
            name: "proc-2".to_string(),
            command: "echo".to_string(),
            args: vec![],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy::default(),
            auto_start: false,
            group_name: None,
        })
        .await
        .unwrap();

        let list = pm.list_processes().await.unwrap();
        assert_eq!(list.len(), 2);
    }

    #[tokio::test]
    async fn test_delete_process() {
        let (pm, _pool) = test_pm().await;

        let info = pm
            .create_process(CreateProcessRequest {
                name: "to-delete".to_string(),
                command: "echo".to_string(),
                args: vec![],
                cwd: "/tmp".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy::default(),
                auto_start: false,
                group_name: None,
            })
            .await
            .unwrap();

        pm.delete_process(&info.definition.id).await.unwrap();

        let list = pm.list_processes().await.unwrap();
        assert_eq!(list.len(), 0);
    }

    #[test]
    fn test_restart_policy_defaults() {
        let policy = RestartPolicy::default();
        assert_eq!(policy.strategy, RestartStrategy::OnFailure);
        assert_eq!(policy.max_retries, Some(10));
        assert_eq!(policy.delay_ms, 1000);
        assert_eq!(policy.backoff_multiplier, 2.0);
    }
}
