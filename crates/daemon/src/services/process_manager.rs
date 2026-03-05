use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, error, info, warn};
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

/// Per-process log configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcessLogConfig {
    /// Max log file size in bytes before rotation (default: 10MB)
    #[serde(default = "default_log_max_size")]
    pub max_file_size: u64,
    /// Number of rotated log files to keep (default: 5)
    #[serde(default = "default_log_max_files")]
    pub max_files: u32,
}

fn default_log_max_size() -> u64 {
    10 * 1024 * 1024 // 10MB
}

fn default_log_max_files() -> u32 {
    5
}

impl Default for ProcessLogConfig {
    fn default() -> Self {
        Self {
            max_file_size: default_log_max_size(),
            max_files: default_log_max_files(),
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
    #[serde(default)]
    pub log_config: ProcessLogConfig,
    /// Run as a specific user (username or UID). Unix only.
    /// Ignored on Windows or when daemon is not running as root.
    pub run_as: Option<String>,
    #[serde(default = "default_instance_count")]
    pub instance_count: u32,
    pub created_at: String,
    pub updated_at: String,
}

fn default_instance_count() -> u32 {
    1
}

/// Per-instance runtime process info (in memory).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInfo {
    pub index: u32,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub started_at: Option<String>,
    pub exit_code: Option<i32>,
}

/// Runtime process info (definition + instance states).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    #[serde(flatten)]
    pub definition: ProcessDefinition,
    pub instances: Vec<InstanceInfo>,
}

/// Create process request payload.
#[derive(Debug, Clone)]
pub struct CreateProcessRequest {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub restart_policy: RestartPolicy,
    pub auto_start: bool,
    pub group_name: Option<String>,
    pub log_config: ProcessLogConfig,
    /// Run as a specific user (username or UID). Unix only.
    pub run_as: Option<String>,
    pub instance_count: u32,
}

/// Update process request payload (PATCH semantics).
#[derive(Debug, Clone)]
pub struct UpdateProcessRequest {
    pub id: String,
    pub name: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub restart_policy: Option<RestartPolicy>,
    pub auto_start: Option<bool>,
    /// `Some(None)` clears group_name.
    pub group_name: Option<Option<String>>,
    pub log_config: Option<ProcessLogConfig>,
    /// `Some(None)` clears run_as.
    pub run_as: Option<Option<String>>,
    pub instance_count: Option<u32>,
}

#[derive(Debug, Clone, Copy)]
pub enum LogStream {
    Stdout,
    Stderr,
    All,
}

impl LogStream {
    fn as_slices(self) -> &'static [&'static str] {
        match self {
            Self::Stdout => &["stdout"],
            Self::Stderr => &["stderr"],
            Self::All => &["stdout", "stderr"],
        }
    }
}

/// Request payload for fetching process logs.
#[derive(Debug, Clone)]
pub struct GetLogsRequest {
    pub id: String,
    /// Which stream to fetch.
    pub stream: LogStream,
    /// Number of lines to return from the tail.
    pub lines: usize,
    /// Offset from the end for pagination.
    pub offset: usize,
    /// Instance index.
    pub instance: u32,
}

fn trimmed_non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Response for log retrieval.
#[derive(Debug, Serialize)]
pub struct LogsResponse {
    pub process_id: String,
    pub instance: u32,
    pub lines: Vec<LogLine>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
pub struct LogLine {
    pub stream: String,
    pub line: String,
    pub timestamp: Option<String>,
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
    /// Runtime state of all process instances: (process_id, instance_index) -> state
    instances: RwLock<HashMap<(String, u32), Mutex<RunningProcess>>>,
    pool: SqlitePool,
    event_bus: SharedEventBus,
    /// Root directory for process log files
    log_dir: PathBuf,
}

impl ProcessManager {
    pub fn new(pool: SqlitePool, event_bus: SharedEventBus, data_dir: &Path) -> Arc<Self> {
        let log_dir = data_dir.join("logs").join("processes");
        // Ensure log directory exists
        if let Err(e) = std::fs::create_dir_all(&log_dir) {
            error!("Failed to create process log directory: {}", e);
        }
        Arc::new(Self {
            instances: RwLock::new(HashMap::new()),
            pool,
            event_bus,
            log_dir,
        })
    }

    /// Restore processes on daemon startup.
    pub async fn restore_processes(self: &Arc<Self>) -> anyhow::Result<()> {
        let definitions = self.load_all_definitions().await?;
        info!("Restoring {} process definitions", definitions.len());

        for def in &definitions {
            self.ensure_runtime_instances(&def.id, def.instance_count)
                .await;
        }

        let auto_start_defs: Vec<_> = definitions.into_iter().filter(|d| d.auto_start).collect();
        info!("Auto-starting {} processes", auto_start_defs.len());

        for def in auto_start_defs {
            if let Err(e) = self.start_process_internal(&def.id).await {
                error!("Failed to restore process {}: {}", def.id, e);
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

        // Ensure process log directory
        let proc_log_dir = self.log_dir.join(&id);
        std::fs::create_dir_all(&proc_log_dir)
            .map_err(|e| AppError::Internal(format!("Failed to create log dir: {}", e)))?;
        for idx in 0..req.instance_count {
            let instance_dir = proc_log_dir.join(format!("instance-{}", idx));
            std::fs::create_dir_all(&instance_dir).map_err(|e| {
                AppError::Internal(format!("Failed to create instance log dir: {}", e))
            })?;
        }

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
            log_config: req.log_config,
            run_as: req.run_as,
            instance_count: req.instance_count,
            created_at: now.clone(),
            updated_at: now,
        };

        // Store in database
        self.save_definition(&definition).await?;

        // Register in runtime state
        self.ensure_runtime_instances(&id, definition.instance_count)
            .await;

        info!("Created process: {} ({})", definition.name, id);

        self.get_process(&definition.id).await
    }

    /// Update an existing managed process definition.
    pub async fn update_process(
        self: &Arc<Self>,
        req: UpdateProcessRequest,
    ) -> Result<ProcessInfo, AppError> {
        let existing = self
            .load_definition(&req.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", req.id.as_str())))?;

        let mut updated = existing.clone();
        let mut changed_fields = Vec::new();

        if let Some(name) = req.name {
            if updated.name != name {
                updated.name = name;
                changed_fields.push("name");
            }
        }
        if let Some(command) = req.command {
            if updated.command != command {
                updated.command = command;
                changed_fields.push("command");
            }
        }
        if let Some(args) = req.args {
            if updated.args != args {
                updated.args = args;
                changed_fields.push("args");
            }
        }
        if let Some(cwd) = req.cwd {
            if updated.cwd != cwd {
                updated.cwd = cwd;
                changed_fields.push("cwd");
            }
        }
        if let Some(env) = req.env {
            if updated.env != env {
                updated.env = env;
                changed_fields.push("env");
            }
        }
        if let Some(restart_policy) = req.restart_policy {
            if updated.restart_policy != restart_policy {
                updated.restart_policy = restart_policy;
                changed_fields.push("restart_policy");
            }
        }
        if let Some(auto_start) = req.auto_start {
            if updated.auto_start != auto_start {
                updated.auto_start = auto_start;
                changed_fields.push("auto_start");
            }
        }
        if let Some(group_name) = req.group_name {
            if updated.group_name != group_name {
                updated.group_name = group_name;
                changed_fields.push("group_name");
            }
        }
        if let Some(log_config) = req.log_config {
            if updated.log_config != log_config {
                updated.log_config = log_config;
                changed_fields.push("log_config");
            }
        }
        if let Some(run_as) = req.run_as {
            if updated.run_as != run_as {
                updated.run_as = run_as;
                changed_fields.push("run_as");
            }
        }
        if let Some(instance_count) = req.instance_count {
            if updated.instance_count != instance_count {
                updated.instance_count = instance_count;
                changed_fields.push("instance_count");
            }
        }

        let launch_param_changed = changed_fields.iter().any(|field| {
            matches!(
                *field,
                "command" | "args" | "cwd" | "env" | "run_as" | "instance_count"
            )
        });
        let is_running = self.is_running(&req.id).await;

        updated.updated_at = Utc::now().to_rfc3339();
        self.save_definition(&updated).await?;

        if existing.instance_count != updated.instance_count {
            self.ensure_runtime_instances(&updated.id, updated.instance_count)
                .await;
            self.trim_runtime_instances(&updated.id, updated.instance_count)
                .await;
        }

        let restarted = if is_running && launch_param_changed {
            self.restart_process(&req.id).await?;
            true
        } else {
            false
        };

        self.event_bus.publish(
            "process.config_updated",
            serde_json::json!({
                "process_id": req.id,
                "restarted": restarted,
                "changed_fields": changed_fields,
            }),
        );

        self.get_process(&updated.id).await
    }

    /// Start a process by ID.
    pub async fn start_process(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        let def = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        self.ensure_runtime_instances(id, def.instance_count).await;

        self.start_process_internal(id).await
    }

    /// Build a `Command` from a `ProcessDefinition`, applying user switching on Unix.
    fn build_command(def: &ProcessDefinition) -> Command {
        let mut cmd = Command::new(&def.command);
        cmd.args(&def.args);
        let cwd = if def.cwd.is_empty() || def.cwd == "." {
            ".".to_string()
        } else {
            def.cwd.clone()
        };
        cmd.current_dir(&cwd);
        for (k, v) in &def.env {
            cmd.env(k, v);
        }
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Unix: set user if run_as is specified and we are root
        #[cfg(unix)]
        {
            if let Some(ref run_as) = def.run_as {
                let is_root = unsafe { libc::geteuid() } == 0;
                if is_root {
                    // Try parsing as UID first, then as username
                    if let Ok(uid) = run_as.parse::<u32>() {
                        info!("Running process {} as UID {}", def.name, uid);
                        cmd.uid(uid);
                    } else {
                        // Resolve username to UID via libc
                        match resolve_username(run_as) {
                            Some((uid, gid)) => {
                                info!(
                                    "Running process {} as user {} (UID={}, GID={})",
                                    def.name, run_as, uid, gid
                                );
                                cmd.uid(uid);
                                cmd.gid(gid);
                            }
                            None => {
                                warn!(
                                    "User '{}' not found, ignoring run_as for process {}",
                                    run_as, def.name
                                );
                            }
                        }
                    }
                } else {
                    warn!(
                        "Not running as root, ignoring run_as='{}' for process {}",
                        run_as, def.name
                    );
                }
            }
        }

        cmd
    }

    /// Spawn log-streaming tasks for stdout/stderr. Writes to files and publishes to event bus.
    fn spawn_log_tasks(
        event_bus: &SharedEventBus,
        child: &mut Child,
        process_id: &str,
        instance_idx: u32,
        log_dir: &Path,
        log_config: &ProcessLogConfig,
    ) {
        if let Some(stdout) = child.stdout.take() {
            let bus = event_bus.clone();
            let pid_str = process_id.to_string();
            let log_path = log_dir.join("stdout.log");
            let max_size = log_config.max_file_size;
            let max_files = log_config.max_files;
            tokio::spawn(async move {
                stream_to_file_and_bus(
                    stdout,
                    &bus,
                    &pid_str,
                    instance_idx,
                    "stdout",
                    &log_path,
                    max_size,
                    max_files,
                )
                .await;
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let bus = event_bus.clone();
            let pid_str = process_id.to_string();
            let log_path = log_dir.join("stderr.log");
            let max_size = log_config.max_file_size;
            let max_files = log_config.max_files;
            tokio::spawn(async move {
                stream_to_file_and_bus(
                    stderr,
                    &bus,
                    &pid_str,
                    instance_idx,
                    "stderr",
                    &log_path,
                    max_size,
                    max_files,
                )
                .await;
            });
        }
    }

    /// Internal: Actually spawn the child process and set up monitoring.
    async fn start_process_internal(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        let def = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        self.ensure_runtime_instances(id, def.instance_count).await;

        let mut errors = Vec::new();
        for instance_idx in 0..def.instance_count {
            if let Err(err) = self.start_instance(&def, instance_idx).await {
                errors.push(format!("instance {}: {}", instance_idx, err));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(AppError::Internal(format!(
                "Failed to start all instances for {}: {}",
                id,
                errors.join("; ")
            )))
        }
    }

    async fn start_instance(
        self: &Arc<Self>,
        def: &ProcessDefinition,
        instance_idx: u32,
    ) -> Result<(), AppError> {
        let key = (def.id.clone(), instance_idx);
        let instances = self.instances.read().await;
        let instance_mutex = instances
            .get(&key)
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", def.id)))?;
        let mut proc = instance_mutex.lock().await;

        if proc.status == ProcessStatus::Running {
            return Ok(());
        }

        proc.status = ProcessStatus::Starting;

        let mut cmd = Self::build_command(def);
        let proc_log_dir = self
            .log_dir
            .join(&def.id)
            .join(format!("instance-{}", instance_idx));
        let _ = std::fs::create_dir_all(&proc_log_dir);

        match cmd.spawn() {
            Ok(mut child) => {
                let pid = child.id();
                proc.pid = pid;
                proc.status = ProcessStatus::Running;
                proc.started_at = Some(Utc::now());
                proc.exit_code = None;

                Self::spawn_log_tasks(
                    &self.event_bus,
                    &mut child,
                    &def.id,
                    instance_idx,
                    &proc_log_dir,
                    &def.log_config,
                );

                proc.child = Some(child);
                self.event_bus.publish(
                    "process.status_changed",
                    serde_json::json!({
                        "process_id": def.id,
                        "instance": instance_idx,
                        "status": "running",
                        "pid": pid,
                    }),
                );

                info!(
                    "Started process: {} instance={} (PID: {:?})",
                    def.name, instance_idx, pid
                );

                let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
                proc.cancel_tx = Some(cancel_tx);
                drop(proc);
                drop(instances);

                let mgr = self.clone();
                let proc_id = def.id.clone();
                tokio::spawn(mgr.supervise_process(proc_id, instance_idx, cancel_rx));
                Ok(())
            }
            Err(e) => {
                proc.status = ProcessStatus::Errored;
                error!(
                    "Failed to start process {} instance {}: {}",
                    def.name, instance_idx, e
                );
                Err(AppError::Internal(format!("Failed to start: {}", e)))
            }
        }
    }

    /// Supervise a running process — wait for exit and handle restart policy.
    async fn supervise_process(
        self: Arc<Self>,
        id: String,
        instance_idx: u32,
        mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    ) {
        loop {
            // Take the child out so we don't hold locks while waiting
            let mut child = {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let Some(proc_mutex) = instances.get(&key) else {
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
                    debug!("Supervisor cancelled for process {} instance {}", id, instance_idx);
                    // Stop requests can arrive while the supervisor owns `child`.
                    // In that case, the supervisor must terminate and reap it.
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return;
                }
            };

            let exit_code = exit_status.and_then(|s| s.code());
            let success = exit_status.map(|s| s.success()).unwrap_or(false);

            info!(
                "Process {} instance {} exited with code: {:?}",
                id, instance_idx, exit_code
            );

            // Load definition for restart policy
            let def = match self.load_definition(&id).await {
                Ok(Some(d)) => d,
                _ => return,
            };

            // Update runtime state and determine if we should restart
            let should_restart = {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let Some(proc_mutex) = instances.get(&key) else {
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
                        "instance": instance_idx,
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
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                if let Some(proc_mutex) = instances.get(&key) {
                    let mut proc = proc_mutex.lock().await;
                    if proc.status == ProcessStatus::Errored {
                        proc.status = ProcessStatus::Failed;
                        self.event_bus.publish(
                            "process.status_changed",
                            serde_json::json!({
                                "process_id": id,
                                "instance": instance_idx,
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
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let proc_mutex = instances.get(&key).unwrap();
                let mut proc = proc_mutex.lock().await;
                proc.restart_count += 1;
                let base_delay = def.restart_policy.delay_ms;
                let multiplier = def.restart_policy.backoff_multiplier;
                let delay_ms = (base_delay as f64
                    * multiplier.powi(proc.restart_count.saturating_sub(1) as i32))
                    as u64;
                Duration::from_millis(delay_ms.min(30_000))
            };

            info!(
                "Restarting process {} instance {} in {:?}",
                def.name, instance_idx, delay
            );
            tokio::time::sleep(delay).await;

            // Inline restart: spawn the child process directly
            let mut cmd = Self::build_command(&def);

            let proc_log_dir = self
                .log_dir
                .join(&id)
                .join(format!("instance-{}", instance_idx));
            let _ = std::fs::create_dir_all(&proc_log_dir);

            match cmd.spawn() {
                Ok(mut child) => {
                    let pid = child.id();

                    // Set up log streaming (file + event bus)
                    Self::spawn_log_tasks(
                        &self.event_bus,
                        &mut child,
                        &id,
                        instance_idx,
                        &proc_log_dir,
                        &def.log_config,
                    );

                    // Update state
                    let (new_cancel_tx, new_cancel_rx) = tokio::sync::oneshot::channel();
                    {
                        let instances = self.instances.read().await;
                        let key = (id.clone(), instance_idx);
                        if let Some(proc_mutex) = instances.get(&key) {
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
                            "instance": instance_idx,
                            "status": "running",
                            "pid": pid,
                        }),
                    );

                    info!(
                        "Restarted process: {} instance={} (PID: {:?})",
                        def.name, instance_idx, pid
                    );

                    // Replace cancel_rx for next iteration
                    cancel_rx = new_cancel_rx;
                    // Continue the loop to supervise the new child
                }
                Err(e) => {
                    error!(
                        "Failed to restart process {} instance {}: {}",
                        def.name, instance_idx, e
                    );
                    let instances = self.instances.read().await;
                    let key = (id.clone(), instance_idx);
                    if let Some(proc_mutex) = instances.get(&key) {
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
        let keys = self.instance_keys(id).await;
        if keys.is_empty() {
            return Err(AppError::NotFound(format!("Process {} not found", id)));
        }

        for (_, instance_idx) in keys {
            self.stop_instance(id, instance_idx).await?;
        }

        info!("Stopped process: {}", id);
        Ok(())
    }

    async fn stop_instance(&self, id: &str, instance_idx: u32) -> Result<(), AppError> {
        let instances = self.instances.read().await;
        let key = (id.to_string(), instance_idx);
        let instance_mutex = instances
            .get(&key)
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        let mut proc = instance_mutex.lock().await;

        if let Some(cancel_tx) = proc.cancel_tx.take() {
            let _ = cancel_tx.send(());
        }

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
                "instance": instance_idx,
                "status": "stopped",
            }),
        );
        Ok(())
    }

    async fn is_running(&self, id: &str) -> bool {
        let keys = self.instance_keys(id).await;
        let instances = self.instances.read().await;
        for key in keys {
            if let Some(instance_mutex) = instances.get(&key) {
                let proc = instance_mutex.lock().await;
                if proc.status == ProcessStatus::Running {
                    return true;
                }
            }
        }
        false
    }

    async fn ensure_runtime_instances(&self, id: &str, instance_count: u32) {
        let mut instances = self.instances.write().await;
        for idx in 0..instance_count {
            let key = (id.to_string(), idx);
            instances.entry(key).or_insert_with(|| {
                Mutex::new(RunningProcess {
                    child: None,
                    status: ProcessStatus::Created,
                    pid: None,
                    restart_count: 0,
                    started_at: None,
                    exit_code: None,
                    cancel_tx: None,
                })
            });
        }
    }

    async fn trim_runtime_instances(&self, id: &str, instance_count: u32) {
        let keys_to_remove = {
            let instances = self.instances.read().await;
            instances
                .keys()
                .filter(|(proc_id, idx)| proc_id == id && *idx >= instance_count)
                .cloned()
                .collect::<Vec<_>>()
        };

        for (_, idx) in &keys_to_remove {
            let _ = self.stop_instance(id, *idx).await;
        }

        let mut instances = self.instances.write().await;
        for (_, idx) in &keys_to_remove {
            let stale_dir = self.log_dir.join(id).join(format!("instance-{}", idx));
            if stale_dir.exists() {
                let _ = std::fs::remove_dir_all(&stale_dir);
            }
        }
        for key in keys_to_remove {
            instances.remove(&key);
        }
    }

    async fn instance_keys(&self, id: &str) -> Vec<(String, u32)> {
        let instances = self.instances.read().await;
        let mut keys: Vec<(String, u32)> = instances
            .keys()
            .filter(|(proc_id, _)| proc_id == id)
            .cloned()
            .collect();
        keys.sort_by_key(|(_, idx)| *idx);
        keys
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
            let mut instances = self.instances.write().await;
            let keys_to_remove: Vec<_> = instances
                .keys()
                .filter(|(proc_id, _)| proc_id == id)
                .cloned()
                .collect();
            for key in keys_to_remove {
                instances.remove(&key);
            }
        }

        // Remove from database
        sqlx::query("DELETE FROM processes WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        // Clean up log files
        let log_dir = self.log_dir.join(id);
        if log_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&log_dir) {
                warn!("Failed to remove log dir for {}: {}", id, e);
            }
        }

        info!("Deleted process: {}", id);
        Ok(())
    }

    /// Get logs for a process.
    pub async fn get_logs(&self, req: GetLogsRequest) -> Result<LogsResponse, AppError> {
        // Verify process exists
        let definition = self
            .load_definition(&req.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", req.id)))?;

        if req.instance >= definition.instance_count {
            return Err(AppError::BadRequest(format!(
                "Instance {} out of range for process {}",
                req.instance, req.id
            )));
        }

        let proc_log_dir = self
            .log_dir
            .join(&req.id)
            .join(format!("instance-{}", req.instance));

        let mut all_lines: Vec<LogLine> = Vec::new();

        let streams = req.stream.as_slices();

        for stream in streams {
            let log_file = proc_log_dir.join(format!("{}.log", stream));
            if log_file.exists() {
                if let Ok(content) = tokio::fs::read_to_string(&log_file).await {
                    for line_str in content.lines() {
                        all_lines.push(LogLine {
                            stream: stream.to_string(),
                            line: line_str.to_string(),
                            timestamp: None,
                        });
                    }
                }
            }

            // Also read rotated files (oldest first)
            for i in (1..=10).rev() {
                let rotated = proc_log_dir.join(format!("{}.log.{}", stream, i));
                if rotated.exists() {
                    if let Ok(content) = tokio::fs::read_to_string(&rotated).await {
                        let rotated_lines: Vec<LogLine> = content
                            .lines()
                            .map(|l| LogLine {
                                stream: stream.to_string(),
                                line: l.to_string(),
                                timestamp: None,
                            })
                            .collect();
                        // Prepend rotated lines (older)
                        all_lines.splice(0..0, rotated_lines);
                    }
                }
            }
        }

        let total = all_lines.len();
        let start = if total > req.offset + req.lines {
            total - req.offset - req.lines
        } else {
            0
        };
        let end = if total > req.offset {
            total - req.offset
        } else {
            0
        };

        let lines: Vec<LogLine> = all_lines
            .into_iter()
            .skip(start)
            .take(end - start)
            .collect();
        let has_more = start > 0;

        Ok(LogsResponse {
            process_id: req.id,
            instance: req.instance,
            lines,
            has_more,
        })
    }

    /// List all processes with their current status.
    pub async fn list_processes(&self) -> Result<Vec<ProcessInfo>, AppError> {
        let definitions = self.load_all_definitions().await?;
        let instances = self.instances.read().await;

        let mut result = Vec::new();
        for def in definitions {
            let mut instance_infos = Vec::new();
            for idx in 0..def.instance_count {
                let key = (def.id.clone(), idx);
                if let Some(proc_mutex) = instances.get(&key) {
                    let proc = proc_mutex.lock().await;
                    instance_infos.push(InstanceInfo {
                        index: idx,
                        status: proc.status.clone(),
                        pid: proc.pid,
                        restart_count: proc.restart_count,
                        started_at: proc.started_at.map(|t| t.to_rfc3339()),
                        exit_code: proc.exit_code,
                    });
                } else {
                    instance_infos.push(InstanceInfo {
                        index: idx,
                        status: ProcessStatus::Created,
                        pid: None,
                        restart_count: 0,
                        started_at: None,
                        exit_code: None,
                    });
                }
            }
            result.push(ProcessInfo {
                definition: def,
                instances: instance_infos,
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

        let instances = self.instances.read().await;
        let mut instance_infos = Vec::new();
        for idx in 0..def.instance_count {
            let key = (def.id.clone(), idx);
            if let Some(proc_mutex) = instances.get(&key) {
                let proc = proc_mutex.lock().await;
                instance_infos.push(InstanceInfo {
                    index: idx,
                    status: proc.status.clone(),
                    pid: proc.pid,
                    restart_count: proc.restart_count,
                    started_at: proc.started_at.map(|t| t.to_rfc3339()),
                    exit_code: proc.exit_code,
                });
            } else {
                instance_infos.push(InstanceInfo {
                    index: idx,
                    status: ProcessStatus::Created,
                    pid: None,
                    restart_count: 0,
                    started_at: None,
                    exit_code: None,
                });
            }
        }

        Ok(ProcessInfo {
            definition: def,
            instances: instance_infos,
        })
    }

    pub async fn list_groups(&self) -> Result<Vec<String>, AppError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT group_name FROM processes WHERE group_name IS NOT NULL AND trim(group_name) != '' ORDER BY group_name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(name,)| name).collect())
    }

    pub async fn start_group(self: &Arc<Self>, group_name: &str) -> Result<Vec<String>, AppError> {
        let group_name = trimmed_non_empty(group_name.to_string())
            .ok_or_else(|| AppError::BadRequest("group_name must not be empty".to_string()))?;
        let definitions = self.load_definitions_in_group(&group_name).await?;
        if definitions.is_empty() {
            return Err(AppError::NotFound(format!(
                "Group {} does not contain any processes",
                group_name
            )));
        }

        let mut errors = Vec::new();
        for def in definitions {
            if let Err(err) = self.start_process(&def.id).await {
                errors.push(format!("{} ({}): {}", def.name, def.id, err));
            }
        }
        Ok(errors)
    }

    pub async fn stop_group(&self, group_name: &str) -> Result<Vec<String>, AppError> {
        let group_name = trimmed_non_empty(group_name.to_string())
            .ok_or_else(|| AppError::BadRequest("group_name must not be empty".to_string()))?;
        let definitions = self.load_definitions_in_group(&group_name).await?;
        if definitions.is_empty() {
            return Err(AppError::NotFound(format!(
                "Group {} does not contain any processes",
                group_name
            )));
        }

        let mut errors = Vec::new();
        for def in definitions {
            if let Err(err) = self.stop_process(&def.id).await {
                errors.push(format!("{} ({}): {}", def.name, def.id, err));
            }
        }
        Ok(errors)
    }

    // ── Database Operations ─────────────────────────────────────

    async fn load_definitions_in_group(
        &self,
        group_name: &str,
    ) -> Result<Vec<ProcessDefinition>, AppError> {
        let rows: Vec<(
            String, String, String, String, String,
            String, String, i32, Option<String>, String, Option<String>, i64, String, String,
        )> = sqlx::query_as(
            "SELECT id, name, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, created_at, updated_at FROM processes WHERE group_name = ?1 ORDER BY created_at",
        )
        .bind(group_name)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
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
                log_config: serde_json::from_str(&r.9).unwrap_or_default(),
                run_as: r.10,
                instance_count: u32::try_from(r.11).unwrap_or(default_instance_count()),
                created_at: r.12,
                updated_at: r.13,
            })
            .collect())
    }

    async fn save_definition(&self, def: &ProcessDefinition) -> Result<(), AppError> {
        let args_json = serde_json::to_string(&def.args).unwrap();
        let env_json = serde_json::to_string(&def.env).unwrap();
        let policy_json = serde_json::to_string(&def.restart_policy).unwrap();
        let log_config_json = serde_json::to_string(&def.log_config).unwrap();

        sqlx::query(
            "INSERT OR REPLACE INTO processes (id, name, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
        .bind(&log_config_json)
        .bind(&def.run_as)
        .bind(def.instance_count as i64)
        .bind(&def.created_at)
        .bind(&def.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn load_definition(&self, id: &str) -> Result<Option<ProcessDefinition>, AppError> {
        let row: Option<(
            String, String, String, String, String,
            String, String, i32, Option<String>, String, Option<String>, i64, String, String,
        )> = sqlx::query_as(
            "SELECT id, name, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, created_at, updated_at FROM processes WHERE id = ?1",
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
            log_config: serde_json::from_str(&r.9).unwrap_or_default(),
            run_as: r.10,
            instance_count: u32::try_from(r.11).unwrap_or(default_instance_count()),
            created_at: r.12,
            updated_at: r.13,
        }))
    }

    async fn load_all_definitions(&self) -> Result<Vec<ProcessDefinition>, AppError> {
        let rows: Vec<(
            String, String, String, String, String,
            String, String, i32, Option<String>, String, Option<String>, i64, String, String,
        )> = sqlx::query_as(
            "SELECT id, name, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, created_at, updated_at FROM processes ORDER BY created_at",
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
                log_config: serde_json::from_str(&r.9).unwrap_or_default(),
                run_as: r.10,
                instance_count: u32::try_from(r.11).unwrap_or(default_instance_count()),
                created_at: r.12,
                updated_at: r.13,
            })
            .collect();

        Ok(defs)
    }
}

// ── Log File Utilities ──────────────────────────────────────────

/// Stream from an async reader to both a log file (with rotation) and the event bus.
async fn stream_to_file_and_bus<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    bus: &SharedEventBus,
    process_id: &str,
    instance_idx: u32,
    stream_name: &str,
    log_path: &Path,
    max_file_size: u64,
    max_files: u32,
) {
    let mut buf_reader = BufReader::new(reader);
    let mut line_buf = String::new();

    // Open log file for appending
    let file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .await;

    let mut file = match file {
        Ok(f) => f,
        Err(e) => {
            error!("Failed to open log file {:?}: {}", log_path, e);
            // Fallback: just stream to bus without file
            let mut lines = BufReader::new(buf_reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                bus.publish(
                    "process.log",
                    serde_json::json!({
                        "process_id": process_id,
                        "instance": instance_idx,
                        "stream": stream_name,
                        "line": line,
                    }),
                );
            }
            return;
        }
    };

    let mut current_size = std::fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);

    loop {
        line_buf.clear();
        match buf_reader.read_line(&mut line_buf).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                let line = line_buf.trim_end_matches('\n').trim_end_matches('\r');

                // Write to file
                let log_line = format!("{}\n", line);
                if let Err(e) = file.write_all(log_line.as_bytes()).await {
                    error!("Failed to write to log: {}", e);
                }
                current_size += log_line.len() as u64;

                // Check rotation
                if current_size >= max_file_size {
                    // Flush and close
                    let _ = file.flush().await;
                    drop(file);

                    // Rotate files
                    rotate_log_files(log_path, max_files);
                    current_size = 0;

                    // Reopen
                    file = match tokio::fs::OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(log_path)
                        .await
                    {
                        Ok(f) => f,
                        Err(e) => {
                            error!("Failed to reopen log file after rotation: {}", e);
                            return;
                        }
                    };
                }

                // Publish to event bus
                bus.publish(
                    "process.log",
                    serde_json::json!({
                        "process_id": process_id,
                        "instance": instance_idx,
                        "stream": stream_name,
                        "line": line,
                    }),
                );
            }
            Err(e) => {
                debug!(
                    "Log stream read error for {}/{}/{}: {}",
                    process_id, instance_idx, stream_name, e
                );
                break;
            }
        }
    }
}

/// Rotate log files: file.log -> file.log.1, file.log.1 -> file.log.2, etc.
fn rotate_log_files(log_path: &Path, max_files: u32) {
    // Remove the oldest if it exceeds max
    let oldest = format!("{}.{}", log_path.display(), max_files);
    let _ = std::fs::remove_file(&oldest);

    // Shift files
    for i in (1..max_files).rev() {
        let from = format!("{}.{}", log_path.display(), i);
        let to = format!("{}.{}", log_path.display(), i + 1);
        if Path::new(&from).exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }

    // Move current to .1
    let first_rotated = format!("{}.1", log_path.display());
    let _ = std::fs::rename(log_path, &first_rotated);
}

/// Resolve a username to (uid, gid) on Unix.
#[cfg(unix)]
fn resolve_username(username: &str) -> Option<(u32, u32)> {
    use std::ffi::CString;
    let c_name = CString::new(username).ok()?;
    unsafe {
        let pw = libc::getpwnam(c_name.as_ptr());
        if pw.is_null() {
            None
        } else {
            Some(((*pw).pw_uid, (*pw).pw_gid))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    use crate::services::event_bus::EventBus;

    async fn test_pm() -> (Arc<ProcessManager>, SqlitePool) {
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        let event_bus = Arc::new(EventBus::default());
        let tmp_dir = std::env::temp_dir().join(format!("xdeck-test-{}", uuid::Uuid::new_v4()));
        let pm = ProcessManager::new(pool.clone(), event_bus, &tmp_dir);
        (pm, pool)
    }

    fn sleep_process_request(name: &str) -> CreateProcessRequest {
        CreateProcessRequest {
            name: name.to_string(),
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
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 1,
        }
    }

    fn instance(info: &ProcessInfo, index: u32) -> &InstanceInfo {
        info.instances
            .iter()
            .find(|inst| inst.index == index)
            .expect("instance should exist")
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
                log_config: ProcessLogConfig::default(),
                run_as: None,
                instance_count: 1,
            })
            .await
            .unwrap();
        assert_eq!(info.definition.name, "test-echo");
        assert_eq!(info.instances.len(), 1);
        assert_eq!(info.instances[0].status, ProcessStatus::Created);
    }

    #[tokio::test]
    async fn test_multi_instance_create() {
        let (pm, _pool) = test_pm().await;
        let info = pm
            .create_process(CreateProcessRequest {
                name: "multi-create".to_string(),
                command: "echo".to_string(),
                args: vec!["hello".to_string()],
                cwd: "/tmp".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy::default(),
                auto_start: false,
                group_name: None,
                log_config: ProcessLogConfig::default(),
                run_as: None,
                instance_count: 3,
            })
            .await
            .unwrap();

        assert_eq!(info.instances.len(), 3);
        assert!(info
            .instances
            .iter()
            .all(|instance| instance.status == ProcessStatus::Created));

        for idx in 0..3 {
            let dir = pm
                .log_dir
                .join(&info.definition.id)
                .join(format!("instance-{}", idx));
            assert!(dir.exists());
        }
    }

    #[tokio::test]
    async fn test_multi_instance_start_stop() {
        let (pm, _pool) = test_pm().await;
        let mut req = sleep_process_request("multi-start-stop");
        req.instance_count = 3;
        let info = pm.create_process(req).await.unwrap();
        let id = info.definition.id;

        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;

        let running = pm.get_process(&id).await.unwrap();
        assert_eq!(running.instances.len(), 3);
        assert!(running
            .instances
            .iter()
            .all(|instance| instance.status == ProcessStatus::Running));
        let pids: HashSet<u32> = running
            .instances
            .iter()
            .filter_map(|instance| instance.pid)
            .collect();
        assert_eq!(pids.len(), 3);

        pm.stop_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;

        let stopped = pm.get_process(&id).await.unwrap();
        assert!(stopped
            .instances
            .iter()
            .all(|instance| instance.status == ProcessStatus::Stopped && instance.pid.is_none()));
    }

    #[tokio::test]
    async fn test_multi_instance_independent_supervision() {
        let (pm, _pool) = test_pm().await;
        let mut req = sleep_process_request("independent-supervision");
        req.instance_count = 2;
        let info = pm.create_process(req).await.unwrap();
        let id = info.definition.id;

        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;

        pm.stop_instance(&id, 1).await.unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;

        let process = pm.get_process(&id).await.unwrap();
        assert_eq!(instance(&process, 0).status, ProcessStatus::Running);
        assert_eq!(instance(&process, 1).status, ProcessStatus::Stopped);
    }

    #[tokio::test]
    async fn test_instance_logs_isolation() {
        let (pm, _pool) = test_pm().await;
        let info = pm
            .create_process(CreateProcessRequest {
                name: "instance-logs".to_string(),
                command: "sh".to_string(),
                args: vec!["-c".to_string(), "echo hello-from-instance".to_string()],
                cwd: "/tmp".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy {
                    strategy: RestartStrategy::Never,
                    ..Default::default()
                },
                auto_start: false,
                group_name: None,
                log_config: ProcessLogConfig::default(),
                run_as: None,
                instance_count: 2,
            })
            .await
            .unwrap();
        let id = info.definition.id;

        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;

        let logs_0 = pm
            .get_logs(GetLogsRequest {
                id: id.clone(),
                stream: LogStream::Stdout,
                lines: 100,
                offset: 0,
                instance: 0,
            })
            .await
            .unwrap();
        let logs_1 = pm
            .get_logs(GetLogsRequest {
                id,
                stream: LogStream::Stdout,
                lines: 100,
                offset: 0,
                instance: 1,
            })
            .await
            .unwrap();

        assert_eq!(logs_0.instance, 0);
        assert_eq!(logs_1.instance, 1);
        assert!(!logs_0.lines.is_empty());
        assert!(!logs_1.lines.is_empty());
    }

    #[tokio::test]
    async fn test_update_name_only_when_running_does_not_restart() {
        let (pm, _pool) = test_pm().await;
        let info = pm
            .create_process(sleep_process_request("name-only"))
            .await
            .unwrap();
        let id = info.definition.id;

        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        let before = pm.get_process(&id).await.unwrap();
        let old_pid = instance(&before, 0)
            .pid
            .expect("running process should have pid");

        let updated = pm
            .update_process(UpdateProcessRequest {
                id: id.clone(),
                name: Some("name-only-updated".to_string()),
                command: None,
                args: None,
                cwd: None,
                env: None,
                restart_policy: None,
                auto_start: None,
                group_name: None,
                log_config: None,
                run_as: None,
                instance_count: None,
            })
            .await
            .unwrap();

        assert_eq!(updated.definition.name, "name-only-updated");
        assert_eq!(instance(&updated, 0).status, ProcessStatus::Running);
        assert_eq!(instance(&updated, 0).pid, Some(old_pid));
    }

    #[tokio::test]
    async fn test_update_launch_params_when_running_triggers_restart() {
        let (pm, _pool) = test_pm().await;
        let info = pm
            .create_process(sleep_process_request("launch-change"))
            .await
            .unwrap();
        let id = info.definition.id;

        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        let before = pm.get_process(&id).await.unwrap();
        let old_pid = instance(&before, 0)
            .pid
            .expect("running process should have pid");

        let updated = pm
            .update_process(UpdateProcessRequest {
                id: id.clone(),
                name: None,
                command: Some("sh".to_string()),
                args: Some(vec!["-c".to_string(), "sleep 60".to_string()]),
                cwd: None,
                env: None,
                restart_policy: None,
                auto_start: None,
                group_name: None,
                log_config: None,
                run_as: None,
                instance_count: None,
            })
            .await
            .unwrap();

        assert_eq!(instance(&updated, 0).status, ProcessStatus::Running);
        assert!(instance(&updated, 0).pid.is_some());
        assert_ne!(instance(&updated, 0).pid, Some(old_pid));
        assert_eq!(updated.definition.command, "sh");
    }

    #[tokio::test]
    async fn test_update_daemon_config_when_running_does_not_restart() {
        let (pm, _pool) = test_pm().await;
        let info = pm
            .create_process(sleep_process_request("daemon-change"))
            .await
            .unwrap();
        let id = info.definition.id;

        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        let before = pm.get_process(&id).await.unwrap();
        let old_pid = instance(&before, 0)
            .pid
            .expect("running process should have pid");

        let updated = pm
            .update_process(UpdateProcessRequest {
                id: id.clone(),
                name: None,
                command: None,
                args: None,
                cwd: None,
                env: None,
                restart_policy: Some(RestartPolicy {
                    strategy: RestartStrategy::Always,
                    max_retries: Some(2),
                    delay_ms: 500,
                    backoff_multiplier: 2.0,
                }),
                auto_start: Some(true),
                group_name: Some(Some("svc".to_string())),
                log_config: None,
                run_as: None,
                instance_count: None,
            })
            .await
            .unwrap();

        assert_eq!(instance(&updated, 0).status, ProcessStatus::Running);
        assert_eq!(instance(&updated, 0).pid, Some(old_pid));
        assert_eq!(
            updated.definition.restart_policy.strategy,
            RestartStrategy::Always
        );
        assert_eq!(updated.definition.group_name.as_deref(), Some("svc"));
    }

    #[tokio::test]
    async fn test_update_process_can_clear_group_name() {
        let (pm, _pool) = test_pm().await;
        let mut req = sleep_process_request("group-clear");
        req.group_name = Some("svc".to_string());

        let created = pm.create_process(req).await.unwrap();
        let id = created.definition.id.clone();
        assert_eq!(created.definition.group_name.as_deref(), Some("svc"));

        let updated = pm
            .update_process(UpdateProcessRequest {
                id: id.clone(),
                name: None,
                command: None,
                args: None,
                cwd: None,
                env: None,
                restart_policy: None,
                auto_start: None,
                group_name: Some(None),
                log_config: None,
                run_as: None,
                instance_count: None,
            })
            .await
            .unwrap();

        assert_eq!(updated.definition.group_name, None);
        let fetched = pm.get_process(&id).await.unwrap();
        assert_eq!(fetched.definition.group_name, None);
    }

    #[tokio::test]
    async fn test_update_stopped_process_only_saves_definition() {
        let (pm, _pool) = test_pm().await;
        let info = pm
            .create_process(sleep_process_request("stopped-update"))
            .await
            .unwrap();
        let id = info.definition.id;

        let updated = pm
            .update_process(UpdateProcessRequest {
                id: id.clone(),
                name: None,
                command: Some("echo".to_string()),
                args: Some(vec!["hello".to_string()]),
                cwd: None,
                env: None,
                restart_policy: None,
                auto_start: None,
                group_name: None,
                log_config: None,
                run_as: None,
                instance_count: None,
            })
            .await
            .unwrap();

        assert_eq!(instance(&updated, 0).status, ProcessStatus::Created);
        assert_eq!(updated.definition.command, "echo");
        assert_eq!(updated.definition.args, vec!["hello".to_string()]);
    }

    #[tokio::test]
    async fn test_update_process_publishes_config_updated_event() {
        let (pm, _pool) = test_pm().await;
        let mut events = pm.event_bus.subscribe();
        let info = pm
            .create_process(sleep_process_request("event-update"))
            .await
            .unwrap();
        let id = info.definition.id;

        pm.update_process(UpdateProcessRequest {
            id: id.clone(),
            name: Some("event-update-2".to_string()),
            command: None,
            args: None,
            cwd: None,
            env: None,
            restart_policy: None,
            auto_start: None,
            group_name: None,
            log_config: None,
            run_as: None,
            instance_count: None,
        })
        .await
        .unwrap();

        let event = events.recv().await.unwrap();
        assert_eq!(event.topic, "process.config_updated");
        assert_eq!(event.payload["process_id"], serde_json::json!(id));
        assert_eq!(event.payload["restarted"], false);
        assert_eq!(event.payload["changed_fields"], serde_json::json!(["name"]));
    }

    #[test]
    fn test_restart_policy_defaults() {
        let policy = RestartPolicy::default();
        assert_eq!(policy.strategy, RestartStrategy::OnFailure);
        assert_eq!(policy.max_retries, Some(10));
        assert_eq!(policy.delay_ms, 1000);
        assert_eq!(policy.backoff_multiplier, 2.0);
    }

    #[tokio::test]
    async fn test_update_instance_count_when_running_triggers_restart() {
        let (pm, _pool) = test_pm().await;
        let info = pm
            .create_process(sleep_process_request("scale-running"))
            .await
            .unwrap();
        let id = info.definition.id;

        pm.start_process(&id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        let before = pm.get_process(&id).await.unwrap();
        let old_pid = instance(&before, 0).pid;

        let updated = pm
            .update_process(UpdateProcessRequest {
                id: id.clone(),
                name: None,
                command: None,
                args: None,
                cwd: None,
                env: None,
                restart_policy: None,
                auto_start: None,
                group_name: None,
                log_config: None,
                run_as: None,
                instance_count: Some(2),
            })
            .await
            .unwrap();

        assert_eq!(updated.instances.len(), 2);
        assert_eq!(instance(&updated, 0).status, ProcessStatus::Running);
        assert_eq!(instance(&updated, 1).status, ProcessStatus::Running);
        assert_ne!(instance(&updated, 0).pid, old_pid);
    }

    #[tokio::test]
    async fn test_list_groups() {
        let (pm, _pool) = test_pm().await;
        let mut req1 = sleep_process_request("group-a-1");
        req1.group_name = Some("svc-a".to_string());
        let mut req2 = sleep_process_request("group-a-2");
        req2.group_name = Some("svc-a".to_string());
        let req3 = sleep_process_request("ungrouped");

        pm.create_process(req1).await.unwrap();
        pm.create_process(req2).await.unwrap();
        pm.create_process(req3).await.unwrap();

        let groups = pm.list_groups().await.unwrap();
        assert_eq!(groups, vec!["svc-a".to_string()]);
    }

    #[tokio::test]
    async fn test_start_stop_group() {
        let (pm, _pool) = test_pm().await;
        let mut req1 = sleep_process_request("group-start-stop-1");
        req1.group_name = Some("svc-b".to_string());
        let mut req2 = sleep_process_request("group-start-stop-2");
        req2.group_name = Some("svc-b".to_string());

        let p1 = pm.create_process(req1).await.unwrap();
        let p2 = pm.create_process(req2).await.unwrap();

        let start_errors = pm.start_group("svc-b").await.unwrap();
        assert!(start_errors.is_empty());
        tokio::time::sleep(Duration::from_millis(250)).await;

        assert_eq!(
            instance(&pm.get_process(&p1.definition.id).await.unwrap(), 0).status,
            ProcessStatus::Running
        );
        assert_eq!(
            instance(&pm.get_process(&p2.definition.id).await.unwrap(), 0).status,
            ProcessStatus::Running
        );

        let stop_errors = pm.stop_group("svc-b").await.unwrap();
        assert!(stop_errors.is_empty());
        tokio::time::sleep(Duration::from_millis(250)).await;

        assert_eq!(
            instance(&pm.get_process(&p1.definition.id).await.unwrap(), 0).status,
            ProcessStatus::Stopped
        );
        assert_eq!(
            instance(&pm.get_process(&p2.definition.id).await.unwrap(), 0).status,
            ProcessStatus::Stopped
        );
    }

    #[tokio::test]
    async fn test_group_partial_failure() {
        let (pm, _pool) = test_pm().await;
        let mut good_req = sleep_process_request("group-good");
        good_req.group_name = Some("svc-c".to_string());
        let mut bad_req = sleep_process_request("group-bad");
        bad_req.group_name = Some("svc-c".to_string());

        let good = pm.create_process(good_req).await.unwrap();
        let bad = pm.create_process(bad_req).await.unwrap();

        sqlx::query("UPDATE processes SET command = ?1 WHERE id = ?2")
            .bind("/path/does/not/exist/xdeck")
            .bind(&bad.definition.id)
            .execute(&pm.pool)
            .await
            .unwrap();

        let errors = pm.start_group("svc-c").await.unwrap();
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains(&bad.definition.id));

        let good_state = pm.get_process(&good.definition.id).await.unwrap();
        assert_eq!(instance(&good_state, 0).status, ProcessStatus::Running);
    }
}
