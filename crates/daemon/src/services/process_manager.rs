use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use nutype::nutype;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::error::{AppError, ValidationIssue};
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

/// Per-process log configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(default)]
    pub log_config: ProcessLogConfig,
    /// Run as a specific user (username or UID). Unix only.
    pub run_as: Option<String>,
}

fn default_true() -> bool {
    true
}

#[nutype(
    sanitize(trim),
    validate(not_empty, len_char_max = 128),
    derive(Debug, Clone, PartialEq, Eq, AsRef, Deref)
)]
struct ProcessName(String);

#[nutype(
    sanitize(trim),
    validate(not_empty),
    derive(Debug, Clone, PartialEq, Eq, AsRef, Deref)
)]
struct ProcessCommand(String);

#[nutype(
    sanitize(trim),
    validate(not_empty),
    derive(Debug, Clone, PartialEq, Eq, AsRef, Deref)
)]
struct ProcessCwd(String);

#[nutype(
    sanitize(trim),
    validate(not_empty),
    derive(Debug, Clone, PartialEq, Eq, AsRef, Deref)
)]
struct ProcessId(String);

#[nutype(
    validate(greater_or_equal = 1),
    derive(Debug, Clone, Copy, PartialEq, Eq)
)]
struct RestartDelayMs(u64);

#[nutype(
    validate(finite, greater_or_equal = 1.0),
    derive(Debug, Clone, Copy, PartialEq)
)]
struct RestartBackoffMultiplier(f64);

#[nutype(
    validate(greater_or_equal = 1024),
    derive(Debug, Clone, Copy, PartialEq, Eq)
)]
struct LogMaxFileSize(u64);

#[nutype(
    validate(greater_or_equal = 1),
    derive(Debug, Clone, Copy, PartialEq, Eq)
)]
struct LogMaxFiles(u32);

#[nutype(
    validate(greater_or_equal = 1, less_or_equal = 5000),
    derive(Debug, Clone, Copy, PartialEq, Eq)
)]
struct LogTailLines(usize);

#[derive(Debug, Clone, Copy)]
enum LogStream {
    Stdout,
    Stderr,
    All,
}

impl LogStream {
    fn parse(value: &str) -> Result<Self, &'static str> {
        match value.trim() {
            "stdout" => Ok(Self::Stdout),
            "stderr" => Ok(Self::Stderr),
            "all" => Ok(Self::All),
            _ => Err("must be one of stdout|stderr|all"),
        }
    }

    fn as_slices(self) -> &'static [&'static str] {
        match self {
            Self::Stdout => &["stdout"],
            Self::Stderr => &["stderr"],
            Self::All => &["stdout", "stderr"],
        }
    }
}

#[derive(Debug)]
struct ParsedCreateProcessRequest {
    name: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    env: HashMap<String, String>,
    restart_policy: RestartPolicy,
    auto_start: bool,
    group_name: Option<String>,
    log_config: ProcessLogConfig,
    run_as: Option<String>,
}

impl ParsedCreateProcessRequest {
    fn parse(raw: CreateProcessRequest) -> Result<Self, AppError> {
        let CreateProcessRequest {
            name,
            command,
            args,
            cwd,
            env,
            restart_policy,
            auto_start,
            group_name,
            log_config,
            run_as,
        } = raw;

        let mut issues = Vec::new();

        let name = match ProcessName::try_new(name) {
            Ok(name) => Some(name.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new("name", "must not be empty"));
                None
            }
        };

        let command = match ProcessCommand::try_new(command) {
            Ok(command) => Some(command.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new("command", "must not be empty"));
                None
            }
        };

        // Command must be resolvable either as absolute path or via PATH.
        if let Some(command) = command.as_deref() {
            let command_path = Path::new(command);
            if command_path.is_absolute() {
                if !command_path.exists() {
                    issues.push(ValidationIssue::new(
                        "command",
                        format!("command not found: {}", command),
                    ));
                }
            } else if which::which(command).is_err() {
                issues.push(ValidationIssue::new(
                    "command",
                    format!("command not found in PATH: {}", command),
                ));
            }
        }

        // Empty cwd is normalized to current directory for backward compatibility.
        let cwd_raw = if cwd.trim().is_empty() {
            ".".to_string()
        } else {
            cwd
        };
        let cwd = match ProcessCwd::try_new(cwd_raw) {
            Ok(cwd) => Some(cwd.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new("cwd", "must not be empty"));
                None
            }
        };
        if let Some(cwd) = cwd.as_deref() {
            let cwd_path = Path::new(cwd);
            if !cwd_path.exists() {
                issues.push(ValidationIssue::new(
                    "cwd",
                    format!("working directory does not exist: {}", cwd),
                ));
            } else if !cwd_path.is_dir() {
                issues.push(ValidationIssue::new(
                    "cwd",
                    format!("working directory is not a directory: {}", cwd),
                ));
            }
        }

        let delay_ms = match RestartDelayMs::try_new(restart_policy.delay_ms) {
            Ok(delay_ms) => Some(delay_ms.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new(
                    "restart_policy.delay_ms",
                    "must be greater than 0",
                ));
                None
            }
        };
        let backoff_multiplier =
            match RestartBackoffMultiplier::try_new(restart_policy.backoff_multiplier) {
                Ok(multiplier) => Some(multiplier.into_inner()),
                Err(_) => {
                    issues.push(ValidationIssue::new(
                        "restart_policy.backoff_multiplier",
                        "must be finite and >= 1.0",
                    ));
                    None
                }
            };
        let restart_policy =
            if let (Some(delay_ms), Some(backoff_multiplier)) = (delay_ms, backoff_multiplier) {
                Some(RestartPolicy {
                    strategy: restart_policy.strategy,
                    max_retries: restart_policy.max_retries,
                    delay_ms,
                    backoff_multiplier,
                })
            } else {
                None
            };

        let max_file_size = match LogMaxFileSize::try_new(log_config.max_file_size) {
            Ok(size) => Some(size.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new(
                    "log_config.max_file_size",
                    "must be at least 1024 bytes",
                ));
                None
            }
        };
        let max_files = match LogMaxFiles::try_new(log_config.max_files) {
            Ok(max_files) => Some(max_files.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new(
                    "log_config.max_files",
                    "must be greater than 0",
                ));
                None
            }
        };
        let log_config = if let (Some(max_file_size), Some(max_files)) = (max_file_size, max_files)
        {
            Some(ProcessLogConfig {
                max_file_size,
                max_files,
            })
        } else {
            None
        };

        if !issues.is_empty() {
            return Err(AppError::bad_request_with_details(
                "Invalid process.create params",
                issues,
            ));
        }

        let group_name = group_name.and_then(trimmed_non_empty);
        let run_as = run_as.and_then(trimmed_non_empty);

        Ok(Self {
            name: name.expect("name is present when issues is empty"),
            command: command.expect("command is present when issues is empty"),
            args,
            cwd: cwd.expect("cwd is present when issues is empty"),
            env,
            restart_policy: restart_policy.expect("restart_policy is present when issues is empty"),
            auto_start,
            group_name,
            log_config: log_config.expect("log_config is present when issues is empty"),
            run_as,
        })
    }
}

/// Request payload for fetching process logs.
#[derive(Debug, Deserialize)]
pub struct GetLogsRequest {
    pub id: String,
    /// Which stream to fetch: "stdout", "stderr", or "all" (default)
    #[serde(default = "default_stream")]
    pub stream: String,
    /// Number of lines to return from the tail (default: 200)
    #[serde(default = "default_tail_lines")]
    pub lines: usize,
    /// Offset from the end for pagination (default: 0)
    #[serde(default)]
    pub offset: usize,
}

fn default_stream() -> String {
    "all".to_string()
}

fn default_tail_lines() -> usize {
    200
}

#[derive(Debug)]
struct ParsedGetLogsRequest {
    id: String,
    stream: LogStream,
    lines: usize,
    offset: usize,
}

impl ParsedGetLogsRequest {
    fn parse(raw: GetLogsRequest) -> Result<Self, AppError> {
        let GetLogsRequest {
            id,
            stream,
            lines,
            offset,
        } = raw;
        let mut issues = Vec::new();

        let id = match ProcessId::try_new(id) {
            Ok(id) => Some(id.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new("id", "must not be empty"));
                None
            }
        };
        let stream = match LogStream::parse(&stream) {
            Ok(stream) => Some(stream),
            Err(msg) => {
                issues.push(ValidationIssue::new("stream", msg));
                None
            }
        };
        let lines = match LogTailLines::try_new(lines) {
            Ok(lines) => Some(lines.into_inner()),
            Err(_) => {
                issues.push(ValidationIssue::new("lines", "must be in range [1, 5000]"));
                None
            }
        };

        if !issues.is_empty() {
            return Err(AppError::bad_request_with_details(
                "Invalid process.logs params",
                issues,
            ));
        }

        Ok(Self {
            id: id.expect("id is present when issues is empty"),
            stream: stream.expect("stream is present when issues is empty"),
            lines: lines.expect("lines is present when issues is empty"),
            offset,
        })
    }
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
    /// Runtime state of all processes
    processes: RwLock<HashMap<String, Mutex<RunningProcess>>>,
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
            processes: RwLock::new(HashMap::new()),
            pool,
            event_bus,
            log_dir,
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
        let req = ParsedCreateProcessRequest::parse(req)?;

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        // Ensure process log directory
        let proc_log_dir = self.log_dir.join(&id);
        std::fs::create_dir_all(&proc_log_dir)
            .map_err(|e| AppError::Internal(format!("Failed to create log dir: {}", e)))?;

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
                    stdout, &bus, &pid_str, "stdout", &log_path, max_size, max_files,
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
                    stderr, &bus, &pid_str, "stderr", &log_path, max_size, max_files,
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
        let mut cmd = Self::build_command(&def);

        // Ensure log directory
        let proc_log_dir = self.log_dir.join(id);
        let _ = std::fs::create_dir_all(&proc_log_dir);

        // Spawn
        match cmd.spawn() {
            Ok(mut child) => {
                let pid = child.id();
                proc.pid = pid;
                proc.status = ProcessStatus::Running;
                proc.started_at = Some(Utc::now());
                proc.exit_code = None;

                // Set up log streaming (file + event bus)
                Self::spawn_log_tasks(
                    &self.event_bus,
                    &mut child,
                    id,
                    &proc_log_dir,
                    &def.log_config,
                );

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
            let mut cmd = Self::build_command(&def);

            let proc_log_dir = self.log_dir.join(&id);
            let _ = std::fs::create_dir_all(&proc_log_dir);

            match cmd.spawn() {
                Ok(mut child) => {
                    let pid = child.id();

                    // Set up log streaming (file + event bus)
                    Self::spawn_log_tasks(
                        &self.event_bus,
                        &mut child,
                        &id,
                        &proc_log_dir,
                        &def.log_config,
                    );

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
        let req = ParsedGetLogsRequest::parse(req)?;

        // Verify process exists
        self.load_definition(&req.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", req.id)))?;

        let proc_log_dir = self.log_dir.join(&req.id);

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
            lines,
            has_more,
        })
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
        let log_config_json = serde_json::to_string(&def.log_config).unwrap();

        sqlx::query(
            "INSERT OR REPLACE INTO processes (id, name, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
        .bind(&def.created_at)
        .bind(&def.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn load_definition(&self, id: &str) -> Result<Option<ProcessDefinition>, AppError> {
        let row: Option<(
            String, String, String, String, String,
            String, String, i32, Option<String>, String, Option<String>, String, String,
        )> = sqlx::query_as(
            "SELECT id, name, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, created_at, updated_at FROM processes WHERE id = ?1",
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
            created_at: r.11,
            updated_at: r.12,
        }))
    }

    async fn load_all_definitions(&self) -> Result<Vec<ProcessDefinition>, AppError> {
        let rows: Vec<(
            String, String, String, String, String,
            String, String, i32, Option<String>, String, Option<String>, String, String,
        )> = sqlx::query_as(
            "SELECT id, name, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, created_at, updated_at FROM processes ORDER BY created_at",
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
                created_at: r.11,
                updated_at: r.12,
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
                        "stream": stream_name,
                        "line": line,
                    }),
                );
            }
            Err(e) => {
                debug!(
                    "Log stream read error for {}/{}: {}",
                    process_id, stream_name, e
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
        let tmp_dir = std::env::temp_dir().join(format!("xdeck-test-{}", uuid::Uuid::new_v4()));
        let pm = ProcessManager::new(pool.clone(), event_bus, &tmp_dir);
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
                log_config: ProcessLogConfig::default(),
                run_as: None,
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
                log_config: ProcessLogConfig::default(),
                run_as: None,
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
            log_config: ProcessLogConfig::default(),
            run_as: None,
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
            log_config: ProcessLogConfig::default(),
            run_as: None,
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
                log_config: ProcessLogConfig::default(),
                run_as: None,
            })
            .await
            .unwrap();

        pm.delete_process(&info.definition.id).await.unwrap();

        let list = pm.list_processes().await.unwrap();
        assert_eq!(list.len(), 0);
    }

    #[tokio::test]
    async fn test_create_process_rejects_empty_name() {
        let (pm, _pool) = test_pm().await;

        let err = pm
            .create_process(CreateProcessRequest {
                name: "   ".to_string(),
                command: "echo".to_string(),
                args: vec!["hello".to_string()],
                cwd: "/tmp".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy::default(),
                auto_start: false,
                group_name: None,
                log_config: ProcessLogConfig::default(),
                run_as: None,
            })
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::BadRequestWithDetails { .. }));
    }

    #[tokio::test]
    async fn test_create_process_rejects_zero_log_max_files() {
        let (pm, _pool) = test_pm().await;

        let err = pm
            .create_process(CreateProcessRequest {
                name: "test-log".to_string(),
                command: "echo".to_string(),
                args: vec!["hello".to_string()],
                cwd: "/tmp".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy::default(),
                auto_start: false,
                group_name: None,
                log_config: ProcessLogConfig {
                    max_file_size: 1024,
                    max_files: 0,
                },
                run_as: None,
            })
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::BadRequestWithDetails { .. }));
    }

    #[tokio::test]
    async fn test_get_logs_rejects_invalid_stream() {
        let (pm, _pool) = test_pm().await;

        let err = pm
            .get_logs(GetLogsRequest {
                id: "proc-id".to_string(),
                stream: "invalid".to_string(),
                lines: 200,
                offset: 0,
            })
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::BadRequestWithDetails { .. }));
    }

    #[tokio::test]
    async fn test_get_logs_rejects_zero_lines() {
        let (pm, _pool) = test_pm().await;

        let err = pm
            .get_logs(GetLogsRequest {
                id: "proc-id".to_string(),
                stream: "all".to_string(),
                lines: 0,
                offset: 0,
            })
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::BadRequestWithDetails { .. }));
    }

    #[tokio::test]
    async fn test_create_process_accumulates_multiple_errors() {
        let (pm, _pool) = test_pm().await;

        let err = pm
            .create_process(CreateProcessRequest {
                name: "   ".to_string(),
                command: "   ".to_string(),
                args: vec![],
                cwd: "/path/that/does/not/exist".to_string(),
                env: HashMap::new(),
                restart_policy: RestartPolicy {
                    strategy: RestartStrategy::OnFailure,
                    max_retries: Some(3),
                    delay_ms: 0,
                    backoff_multiplier: 0.5,
                },
                auto_start: false,
                group_name: None,
                log_config: ProcessLogConfig {
                    max_file_size: 100,
                    max_files: 0,
                },
                run_as: None,
            })
            .await
            .unwrap_err();

        match err {
            AppError::BadRequestWithDetails { details, .. } => {
                assert!(details.len() >= 6);
                assert!(details.iter().any(|d| d.field == "name"));
                assert!(details.iter().any(|d| d.field == "command"));
                assert!(details.iter().any(|d| d.field == "restart_policy.delay_ms"));
                assert!(details.iter().any(|d| d.field == "log_config.max_files"));
            }
            other => panic!("Expected BadRequestWithDetails, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_get_logs_accumulates_multiple_errors() {
        let (pm, _pool) = test_pm().await;

        let err = pm
            .get_logs(GetLogsRequest {
                id: "   ".to_string(),
                stream: "invalid".to_string(),
                lines: 0,
                offset: 0,
            })
            .await
            .unwrap_err();

        match err {
            AppError::BadRequestWithDetails { details, .. } => {
                assert_eq!(details.len(), 3);
                assert!(details.iter().any(|d| d.field == "id"));
                assert!(details.iter().any(|d| d.field == "stream"));
                assert!(details.iter().any(|d| d.field == "lines"));
            }
            other => panic!("Expected BadRequestWithDetails, got {:?}", other),
        }
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
