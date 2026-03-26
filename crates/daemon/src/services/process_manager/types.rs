use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProcessMode {
    #[default]
    Daemon,
    Schedule,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleOverlapPolicy {
    Ignore,
    Restart,
    StartNew,
}

impl Default for ScheduleOverlapPolicy {
    fn default() -> Self {
        Self::Ignore
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleWeekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

impl ScheduleWeekday {
    pub(super) fn from_chrono(weekday: chrono::Weekday) -> Self {
        match weekday {
            chrono::Weekday::Mon => Self::Monday,
            chrono::Weekday::Tue => Self::Tuesday,
            chrono::Weekday::Wed => Self::Wednesday,
            chrono::Weekday::Thu => Self::Thursday,
            chrono::Weekday::Fri => Self::Friday,
            chrono::Weekday::Sat => Self::Saturday,
            chrono::Weekday::Sun => Self::Sunday,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScheduleConfig {
    Once {
        run_at: String,
    },
    Daily {
        hour: u8,
        minute: u8,
    },
    Weekly {
        weekdays: Vec<ScheduleWeekday>,
        hour: u8,
        minute: u8,
    },
    Interval {
        every_seconds: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ScheduleState {
    pub next_run_at: Option<String>,
    pub last_triggered_at: Option<String>,
    pub last_skipped_at: Option<String>,
    #[serde(default)]
    pub trigger_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcessLogConfig {
    #[serde(default = "default_log_max_size")]
    pub max_file_size: u64,
    #[serde(default = "default_log_max_files")]
    pub max_files: u32,
}

fn default_log_max_size() -> u64 {
    10 * 1024 * 1024
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub mode: ProcessMode,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub restart_policy: RestartPolicy,
    pub auto_start: bool,
    pub group_name: Option<String>,
    #[serde(default)]
    pub log_config: ProcessLogConfig,
    pub run_as: Option<String>,
    #[serde(default = "default_instance_count")]
    pub instance_count: u32,
    #[serde(default)]
    pub pty_mode: bool,
    #[serde(default)]
    pub schedule: Option<ScheduleConfig>,
    #[serde(default)]
    pub schedule_overlap_policy: ScheduleOverlapPolicy,
    #[serde(default)]
    pub schedule_state: ScheduleState,
    pub created_at: String,
    pub updated_at: String,
}

pub(super) fn default_instance_count() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceInfo {
    pub index: u32,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pty_session_id: Option<String>,
    pub restart_count: u32,
    pub started_at: Option<String>,
    pub exit_code: Option<i32>,
}

pub(super) struct ProcessStatusChange<'a> {
    pub status: &'a str,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub pty_session_id: Option<&'a str>,
    pub message: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    #[serde(flatten)]
    pub definition: ProcessDefinition,
    pub instances: Vec<InstanceInfo>,
}

#[derive(Debug, Clone)]
pub struct CreateProcessRequest {
    pub name: String,
    pub mode: ProcessMode,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub restart_policy: RestartPolicy,
    pub auto_start: bool,
    pub group_name: Option<String>,
    pub log_config: ProcessLogConfig,
    pub run_as: Option<String>,
    pub instance_count: u32,
    pub pty_mode: bool,
    pub schedule: Option<ScheduleConfig>,
    pub schedule_overlap_policy: ScheduleOverlapPolicy,
}

#[derive(Debug, Clone)]
pub struct UpdateProcessRequest {
    pub id: String,
    pub name: Option<String>,
    pub mode: Option<ProcessMode>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub restart_policy: Option<RestartPolicy>,
    pub auto_start: Option<bool>,
    pub group_name: Option<Option<String>>,
    pub log_config: Option<ProcessLogConfig>,
    pub run_as: Option<Option<String>>,
    pub instance_count: Option<u32>,
    pub pty_mode: Option<bool>,
    pub schedule: Option<ScheduleConfig>,
    pub schedule_overlap_policy: Option<ScheduleOverlapPolicy>,
}

#[derive(Debug, Clone, Copy)]
pub enum LogStream {
    Stdout,
    Stderr,
    All,
}

impl LogStream {
    pub(super) fn as_slices(self) -> &'static [&'static str] {
        match self {
            Self::Stdout => &["stdout"],
            Self::Stderr => &["stderr"],
            Self::All => &["stdout", "stderr"],
        }
    }
}

#[derive(Debug, Clone)]
pub struct GetLogsRequest {
    pub id: String,
    pub stream: LogStream,
    pub lines: usize,
    pub offset: usize,
    pub instance: u32,
}

#[derive(Debug, Serialize)]
pub struct LogsResponse {
    pub process_id: String,
    pub instance: u32,
    pub lines: Vec<LogLine>,
    pub has_more: bool,
    pub total_lines: usize,
}

#[derive(Debug, Serialize)]
pub struct LogLine {
    pub stream: String,
    pub line: String,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PtyReplayRequest {
    pub id: String,
    pub instance: u32,
    pub offset: u64,
    pub length: u64,
}

#[derive(Debug, Serialize)]
pub struct PtyReplayResponse {
    pub process_id: String,
    pub instance: u32,
    pub data: String,
    pub total_size: u64,
    pub offset: u64,
    pub length: u64,
}
