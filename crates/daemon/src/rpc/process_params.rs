use std::collections::HashMap;
use std::path::Path;

use nutype::nutype;
use serde::{Deserialize, Deserializer};

use crate::error::{AppError, ValidationIssue};
use crate::rpc::params::parse_required_params;
use crate::services::process_manager::{
    CreateProcessRequest, GetLogsRequest, LogStream, ProcessLogConfig, ProcessMode,
    PtyReplayRequest, RestartPolicy, ScheduleConfig, ScheduleOverlapPolicy, UpdateProcessRequest,
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateProcessParams {
    name: String,
    #[serde(default)]
    mode: ProcessMode,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: String,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default)]
    restart_policy: RestartPolicy,
    #[serde(default = "default_true")]
    enabled: bool,
    group_name: Option<String>,
    #[serde(default)]
    log_config: ProcessLogConfig,
    run_as: Option<String>,
    #[serde(default = "default_instance_count")]
    instance_count: u32,
    #[serde(default)]
    pty_mode: bool,
    schedule: Option<ScheduleConfig>,
    #[serde(default)]
    schedule_overlap_policy: ScheduleOverlapPolicy,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateProcessParams {
    id: String,
    name: Option<String>,
    mode: Option<ProcessMode>,
    command: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    restart_policy: Option<RestartPolicy>,
    enabled: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_patch_nullable_string")]
    group_name: Option<Option<String>>,
    log_config: Option<ProcessLogConfig>,
    #[serde(default, deserialize_with = "deserialize_patch_nullable_string")]
    run_as: Option<Option<String>>,
    instance_count: Option<u32>,
    pty_mode: Option<bool>,
    schedule: Option<ScheduleConfig>,
    schedule_overlap_policy: Option<ScheduleOverlapPolicy>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GetLogsParams {
    id: String,
    #[serde(default = "default_stream")]
    stream: String,
    #[serde(default = "default_tail_lines")]
    lines: usize,
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    instance: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PtyReplayParams {
    id: String,
    #[serde(default)]
    instance: Option<u32>,
    #[serde(default)]
    offset: u64,
    #[serde(default = "default_replay_length")]
    length: u64,
}

#[nutype(
    sanitize(trim),
    validate(not_empty, len_char_max = 128),
    derive(Debug, Clone, PartialEq, Eq)
)]
struct ProcessName(String);

#[nutype(
    sanitize(trim),
    validate(not_empty),
    derive(Debug, Clone, PartialEq, Eq)
)]
struct ProcessCommand(String);

#[nutype(
    sanitize(trim),
    validate(not_empty),
    derive(Debug, Clone, PartialEq, Eq)
)]
struct ProcessCwd(String);

#[nutype(
    sanitize(trim),
    validate(not_empty),
    derive(Debug, Clone, PartialEq, Eq)
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
    validate(greater_or_equal = 1, less_or_equal = 100),
    derive(Debug, Clone, Copy, PartialEq, Eq)
)]
struct InstanceCount(u32);

#[nutype(
    validate(greater_or_equal = 1, less_or_equal = 5000),
    derive(Debug, Clone, Copy, PartialEq, Eq)
)]
struct LogTailLines(usize);

pub fn parse_create_request(
    params: Option<serde_json::Value>,
) -> Result<CreateProcessRequest, AppError> {
    let raw = parse_required_params::<CreateProcessParams>(params)?;
    parse_create_payload(raw)
}

pub fn parse_update_request(
    params: Option<serde_json::Value>,
) -> Result<UpdateProcessRequest, AppError> {
    let raw = parse_required_params::<UpdateProcessParams>(params)?;
    parse_update_payload(raw)
}

pub fn parse_get_logs_request(
    params: Option<serde_json::Value>,
) -> Result<GetLogsRequest, AppError> {
    let raw = parse_required_params::<GetLogsParams>(params)?;
    parse_get_logs_payload(raw)
}

pub fn parse_pty_replay_request(
    params: Option<serde_json::Value>,
) -> Result<PtyReplayRequest, AppError> {
    let raw = parse_required_params::<PtyReplayParams>(params)?;

    let mut issues = Vec::new();
    let id = match ProcessId::try_new(raw.id) {
        Ok(id) => Some(id.into_inner()),
        Err(_) => {
            issues.push(ValidationIssue::new("id", "must not be empty"));
            None
        }
    };

    if !issues.is_empty() {
        return Err(AppError::bad_request_with_details(
            "Invalid process.pty_replay params",
            issues,
        ));
    }

    Ok(PtyReplayRequest {
        id: id.expect("id is present when issues is empty"),
        instance: raw.instance.unwrap_or(0),
        offset: raw.offset,
        length: raw.length,
    })
}

fn parse_create_payload(raw: CreateProcessParams) -> Result<CreateProcessRequest, AppError> {
    let CreateProcessParams {
        name,
        mode,
        command,
        args,
        cwd,
        env,
        restart_policy,
        enabled,
        group_name,
        log_config,
        run_as,
        instance_count,
        pty_mode,
        schedule,
        schedule_overlap_policy,
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
    validate_command(command.as_deref(), &mut issues);

    let cwd = normalize_and_validate_cwd(Some(cwd), &mut issues).and_then(|v| v);

    let restart_policy = validate_restart_policy(Some(restart_policy), &mut issues).and_then(|v| v);
    let log_config = validate_log_config(Some(log_config), &mut issues).and_then(|v| v);
    let instance_count = validate_instance_count(Some(instance_count), &mut issues).and_then(|v| v);
    validate_schedule_fields(mode.clone(), schedule.as_ref(), &mut issues);

    if !issues.is_empty() {
        return Err(AppError::bad_request_with_details(
            "Invalid process.create params",
            issues,
        ));
    }

    Ok(CreateProcessRequest {
        name: name.expect("name is present when issues is empty"),
        mode,
        command: command.expect("command is present when issues is empty"),
        args,
        cwd: cwd.expect("cwd is present when issues is empty"),
        env,
        restart_policy: restart_policy.expect("restart_policy is present when issues is empty"),
        enabled: enabled,
        group_name: group_name.and_then(trimmed_non_empty),
        log_config: log_config.expect("log_config is present when issues is empty"),
        run_as: run_as.and_then(trimmed_non_empty),
        instance_count: instance_count.expect("instance_count is present when issues is empty"),
        pty_mode,
        schedule,
        schedule_overlap_policy,
    })
}

fn parse_update_payload(raw: UpdateProcessParams) -> Result<UpdateProcessRequest, AppError> {
    let UpdateProcessParams {
        id,
        name,
        mode,
        command,
        args,
        cwd,
        env,
        restart_policy,
        enabled,
        group_name,
        log_config,
        run_as,
        instance_count,
        pty_mode,
        schedule,
        schedule_overlap_policy,
    } = raw;

    let mut issues = Vec::new();

    let id = match ProcessId::try_new(id) {
        Ok(id) => Some(id.into_inner()),
        Err(_) => {
            issues.push(ValidationIssue::new("id", "must not be empty"));
            None
        }
    };

    let name = match name {
        Some(name) => match ProcessName::try_new(name) {
            Ok(name) => Some(Some(name.into_inner())),
            Err(_) => {
                issues.push(ValidationIssue::new("name", "must not be empty"));
                None
            }
        },
        None => Some(None),
    };

    let command = match command {
        Some(command) => match ProcessCommand::try_new(command) {
            Ok(command) => Some(Some(command.into_inner())),
            Err(_) => {
                issues.push(ValidationIssue::new("command", "must not be empty"));
                None
            }
        },
        None => Some(None),
    };
    validate_command(command.as_ref().and_then(|v| v.as_deref()), &mut issues);

    let cwd = normalize_and_validate_cwd(cwd, &mut issues);
    let restart_policy = validate_restart_policy(restart_policy, &mut issues);
    let log_config = validate_log_config(log_config, &mut issues);
    let instance_count = validate_instance_count(instance_count, &mut issues);

    if !issues.is_empty() {
        return Err(AppError::bad_request_with_details(
            "Invalid process.update params",
            issues,
        ));
    }

    Ok(UpdateProcessRequest {
        id: id.expect("id is present when issues is empty"),
        name: name.expect("name is present when issues is empty"),
        mode,
        command: command.expect("command is present when issues is empty"),
        args,
        cwd: cwd.expect("cwd is present when issues is empty"),
        env,
        restart_policy: restart_policy.expect("restart_policy is present when issues is empty"),
        enabled: enabled,
        group_name: group_name.map(|v| v.and_then(trimmed_non_empty)),
        log_config: log_config.expect("log_config is present when issues is empty"),
        run_as: run_as.map(|v| v.and_then(trimmed_non_empty)),
        instance_count: instance_count.expect("instance_count is present when issues is empty"),
        pty_mode,
        schedule,
        schedule_overlap_policy,
    })
}

fn parse_get_logs_payload(raw: GetLogsParams) -> Result<GetLogsRequest, AppError> {
    let GetLogsParams {
        id,
        stream,
        lines,
        offset,
        instance,
    } = raw;

    let mut issues = Vec::new();

    let id = match ProcessId::try_new(id) {
        Ok(id) => Some(id.into_inner()),
        Err(_) => {
            issues.push(ValidationIssue::new("id", "must not be empty"));
            None
        }
    };
    let stream = match parse_log_stream(&stream) {
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

    Ok(GetLogsRequest {
        id: id.expect("id is present when issues is empty"),
        stream: stream.expect("stream is present when issues is empty"),
        lines: lines.expect("lines is present when issues is empty"),
        offset,
        instance: instance.unwrap_or(0),
    })
}

fn validate_command(command: Option<&str>, issues: &mut Vec<ValidationIssue>) {
    let Some(command) = command else {
        return;
    };

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

fn normalize_and_validate_cwd(
    cwd: Option<String>,
    issues: &mut Vec<ValidationIssue>,
) -> Option<Option<String>> {
    match cwd {
        Some(cwd) => {
            let normalized = if cwd.trim().is_empty() {
                ".".to_string()
            } else {
                cwd
            };

            let cwd = match ProcessCwd::try_new(normalized) {
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

            cwd.map(Some)
        }
        None => Some(None),
    }
}

fn validate_restart_policy(
    restart_policy: Option<RestartPolicy>,
    issues: &mut Vec<ValidationIssue>,
) -> Option<Option<RestartPolicy>> {
    match restart_policy {
        Some(restart_policy) => {
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

            if let (Some(delay_ms), Some(backoff_multiplier)) = (delay_ms, backoff_multiplier) {
                Some(Some(RestartPolicy {
                    strategy: restart_policy.strategy,
                    max_retries: restart_policy.max_retries,
                    delay_ms,
                    backoff_multiplier,
                }))
            } else {
                None
            }
        }
        None => Some(None),
    }
}

fn validate_schedule_fields(
    mode: ProcessMode,
    schedule: Option<&ScheduleConfig>,
    issues: &mut Vec<ValidationIssue>,
) {
    match mode {
        ProcessMode::Daemon => {}
        ProcessMode::Schedule => {
            let Some(schedule) = schedule else {
                issues.push(ValidationIssue::new(
                    "schedule",
                    "schedule mode requires a schedule configuration",
                ));
                return;
            };
            validate_schedule_config(schedule, issues);
        }
    }
}

fn validate_schedule_config(schedule: &ScheduleConfig, issues: &mut Vec<ValidationIssue>) {
    match schedule {
        ScheduleConfig::Once { run_at } => {
            if chrono::DateTime::parse_from_rfc3339(run_at).is_err() {
                issues.push(ValidationIssue::new(
                    "schedule.run_at",
                    "must be a valid RFC3339 datetime",
                ));
            }
        }
        ScheduleConfig::Daily { hour, minute } => {
            validate_schedule_time(*hour, *minute, issues);
        }
        ScheduleConfig::Weekly {
            weekdays,
            hour,
            minute,
        } => {
            validate_schedule_time(*hour, *minute, issues);
            if weekdays.is_empty() {
                issues.push(ValidationIssue::new(
                    "schedule.weekdays",
                    "must include at least one weekday",
                ));
            }
        }
        ScheduleConfig::Interval { every_seconds } => {
            if *every_seconds == 0 {
                issues.push(ValidationIssue::new(
                    "schedule.every_seconds",
                    "must be greater than 0",
                ));
            }
        }
    }
}

fn validate_schedule_time(hour: u8, minute: u8, issues: &mut Vec<ValidationIssue>) {
    if hour > 23 {
        issues.push(ValidationIssue::new(
            "schedule.hour",
            "must be in range [0, 23]",
        ));
    }
    if minute > 59 {
        issues.push(ValidationIssue::new(
            "schedule.minute",
            "must be in range [0, 59]",
        ));
    }
}

fn validate_log_config(
    log_config: Option<ProcessLogConfig>,
    issues: &mut Vec<ValidationIssue>,
) -> Option<Option<ProcessLogConfig>> {
    match log_config {
        Some(log_config) => {
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

            if let (Some(max_file_size), Some(max_files)) = (max_file_size, max_files) {
                Some(Some(ProcessLogConfig {
                    max_file_size,
                    max_files,
                }))
            } else {
                None
            }
        }
        None => Some(None),
    }
}

fn validate_instance_count(
    instance_count: Option<u32>,
    issues: &mut Vec<ValidationIssue>,
) -> Option<Option<u32>> {
    match instance_count {
        Some(instance_count) => match InstanceCount::try_new(instance_count) {
            Ok(count) => Some(Some(count.into_inner())),
            Err(_) => {
                issues.push(ValidationIssue::new(
                    "instance_count",
                    "must be in range [1, 100]",
                ));
                None
            }
        },
        None => Some(None),
    }
}

fn parse_log_stream(value: &str) -> Result<LogStream, &'static str> {
    match value.trim() {
        "stdout" => Ok(LogStream::Stdout),
        "stderr" => Ok(LogStream::Stderr),
        "all" => Ok(LogStream::All),
        _ => Err("must be one of stdout|stderr|all"),
    }
}

fn deserialize_patch_nullable_string<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Null => Ok(Some(None)),
        serde_json::Value::String(value) => Ok(Some(Some(value))),
        _ => Err(serde::de::Error::custom("must be a string or null")),
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

fn default_instance_count() -> u32 {
    1
}

fn default_stream() -> String {
    "all".to_string()
}

fn default_tail_lines() -> usize {
    200
}

fn default_replay_length() -> u64 {
    256 * 1024 // 256KB default
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_process_parse_accepts_partial_request() {
        let parsed = parse_update_request(Some(serde_json::json!({
            "id": "process-1",
            "name": "renamed",
        })))
        .unwrap();

        assert_eq!(parsed.id, "process-1");
        assert_eq!(parsed.name, Some("renamed".to_string()));
        assert!(parsed.command.is_none());
        assert!(parsed.restart_policy.is_none());
        assert!(parsed.pty_mode.is_none());
    }

    #[test]
    fn test_create_process_defaults_pty_mode_to_false() {
        let parsed = parse_create_request(Some(serde_json::json!({
            "name": "proc-1",
            "command": "echo",
            "args": ["hello"],
            "cwd": "/tmp",
            "env": {},
            "restart_policy": {
                "strategy": "never",
                "max_retries": null,
                "delay_ms": 1000,
                "backoff_multiplier": 2.0
            },
            "enabled": false,
            "group_name": null,
            "log_config": {
                "max_file_size": 1048576,
                "max_files": 3
            },
            "run_as": null,
            "instance_count": 1
        })))
        .unwrap();

        assert!(!parsed.pty_mode);
    }

    #[test]
    fn test_create_schedule_process_requires_schedule_payload() {
        let err = parse_create_request(Some(serde_json::json!({
            "name": "scheduled-proc",
            "mode": "schedule",
            "command": "echo",
            "cwd": "/tmp"
        })))
        .unwrap_err();

        match err {
            AppError::BadRequestWithDetails { details, .. } => {
                assert!(details.iter().any(|issue| issue.field == "schedule"));
            }
            other => panic!("Expected BadRequestWithDetails, got {:?}", other),
        }
    }

    #[test]
    fn test_create_schedule_process_accepts_interval_schedule() {
        let parsed = parse_create_request(Some(serde_json::json!({
            "name": "scheduled-proc",
            "mode": "schedule",
            "command": "echo",
            "cwd": "/tmp",
            "schedule": {
                "type": "interval",
                "every_seconds": 300
            },
            "schedule_overlap_policy": "start_new"
        })))
        .unwrap();

        assert_eq!(parsed.mode, ProcessMode::Schedule);
        assert_eq!(
            parsed.schedule,
            Some(ScheduleConfig::Interval { every_seconds: 300 })
        );
        assert_eq!(
            parsed.schedule_overlap_policy,
            ScheduleOverlapPolicy::StartNew
        );
    }

    #[test]
    fn test_create_schedule_process_rejects_invalid_daily_time() {
        let err = parse_create_request(Some(serde_json::json!({
            "name": "scheduled-proc",
            "mode": "schedule",
            "command": "echo",
            "cwd": "/tmp",
            "schedule": {
                "type": "daily",
                "hour": 24,
                "minute": 0
            }
        })))
        .unwrap_err();

        match err {
            AppError::BadRequestWithDetails { details, .. } => {
                assert!(details.iter().any(|issue| issue.field == "schedule.hour"));
            }
            other => panic!("Expected BadRequestWithDetails, got {:?}", other),
        }
    }

    #[test]
    fn test_update_process_parse_rejects_invalid_fields() {
        let err = parse_update_request(Some(serde_json::json!({
            "id": "   ",
            "name": "   ",
            "command": "/path/that/does/not/exist",
            "cwd": "/path/that/does/not/exist",
            "restart_policy": {
                "strategy": "on_failure",
                "max_retries": 3,
                "delay_ms": 0,
                "backoff_multiplier": 0.5
            },
            "log_config": {
                "max_file_size": 100,
                "max_files": 0
            },
            "instance_count": 0
        })))
        .unwrap_err();

        match err {
            AppError::BadRequestWithDetails { details, .. } => {
                assert!(details.iter().any(|d| d.field == "id"));
                assert!(details.iter().any(|d| d.field == "name"));
                assert!(details.iter().any(|d| d.field == "command"));
                assert!(details.iter().any(|d| d.field == "cwd"));
                assert!(details.iter().any(|d| d.field == "restart_policy.delay_ms"));
                assert!(details
                    .iter()
                    .any(|d| d.field == "restart_policy.backoff_multiplier"));
                assert!(details.iter().any(|d| d.field == "log_config.max_files"));
                assert!(details.iter().any(|d| d.field == "instance_count"));
            }
            other => panic!("Expected BadRequestWithDetails, got {:?}", other),
        }
    }

    #[test]
    fn test_update_process_deserialize_group_name_null_as_clear() {
        let parsed = parse_update_request(Some(serde_json::json!({
            "id": "process-1",
            "group_name": null
        })))
        .unwrap();
        assert_eq!(parsed.group_name, Some(None));
    }

    #[test]
    fn test_update_process_deserialize_run_as_null_as_clear() {
        let parsed = parse_update_request(Some(serde_json::json!({
            "id": "process-1",
            "run_as": null
        })))
        .unwrap();
        assert_eq!(parsed.run_as, Some(None));
    }

    #[test]
    fn test_create_process_accumulates_multiple_errors() {
        let err = parse_create_request(Some(serde_json::json!({
            "name": "   ",
            "command": "   ",
            "args": [],
            "cwd": "/path/that/does/not/exist",
            "env": {},
            "restart_policy": {
                "strategy": "on_failure",
                "max_retries": 3,
                "delay_ms": 0,
                "backoff_multiplier": 0.5
            },
            "enabled": false,
            "group_name": null,
            "log_config": {
                "max_file_size": 100,
                "max_files": 0
            },
            "run_as": null,
            "instance_count": 0
        })))
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

    #[test]
    fn test_get_logs_accumulates_multiple_errors() {
        let err = parse_get_logs_request(Some(serde_json::json!({
            "id": "   ",
            "stream": "invalid",
            "lines": 0,
            "offset": 0
        })))
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
    fn test_get_logs_defaults() {
        let parsed = parse_get_logs_request(Some(serde_json::json!({
            "id": "proc-1"
        })))
        .unwrap();

        assert_eq!(parsed.id, "proc-1");
        assert!(matches!(parsed.stream, LogStream::All));
        assert_eq!(parsed.lines, 200);
        assert_eq!(parsed.offset, 0);
        assert_eq!(parsed.instance, 0);
    }
}
