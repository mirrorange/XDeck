use std::collections::{HashMap, HashSet};
use std::process::Child as StdChild;
use std::sync::Arc;
use std::time::Duration;

use sqlx::SqlitePool;
use tokio::sync::broadcast;

use super::runtime::{lookup_process_identity, ProcessRuntimeIdentity};
use super::*;
use crate::services::event_bus::{Event, EventBus};
use crate::services::pty_manager::PtyManager;

async fn test_pm() -> (Arc<ProcessManager>, SqlitePool) {
    let pool = crate::db::connect_in_memory().await.unwrap();
    crate::db::run_migrations(&pool).await.unwrap();
    let event_bus = Arc::new(EventBus::default());
    let pty_manager = PtyManager::new(event_bus.clone(), Duration::from_secs(30 * 60));
    let tmp_dir = std::env::temp_dir().join(format!("xdeck-test-{}", uuid::Uuid::new_v4()));
    let pm = ProcessManager::new(pool.clone(), event_bus, pty_manager, &tmp_dir);
    (pm, pool)
}

fn sleep_process_request(name: &str) -> CreateProcessRequest {
    CreateProcessRequest {
        name: name.to_string(),
        mode: ProcessMode::Daemon,
        command: "sleep".to_string(),
        args: vec!["60".to_string()],
        cwd: "/tmp".to_string(),
        env: HashMap::new(),
        restart_policy: RestartPolicy {
            strategy: RestartStrategy::Never,
            ..Default::default()
        },
        enabled: false,
        group_name: None,
        log_config: ProcessLogConfig::default(),
        run_as: None,
        instance_count: 1,
        pty_mode: false,
        schedule: None,
        schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
    }
}

fn scheduled_sleep_process_request(
    name: &str,
    overlap_policy: ScheduleOverlapPolicy,
) -> CreateProcessRequest {
    CreateProcessRequest {
        name: name.to_string(),
        mode: ProcessMode::Schedule,
        command: "sleep".to_string(),
        args: vec!["60".to_string()],
        cwd: "/tmp".to_string(),
        env: HashMap::new(),
        restart_policy: RestartPolicy {
            strategy: RestartStrategy::Never,
            ..Default::default()
        },
        enabled: false,
        group_name: None,
        log_config: ProcessLogConfig::default(),
        run_as: None,
        instance_count: 1,
        pty_mode: false,
        schedule: Some(ScheduleConfig::Interval { every_seconds: 60 }),
        schedule_overlap_policy: overlap_policy,
    }
}

fn instance(info: &ProcessInfo, index: u32) -> &InstanceInfo {
    info.instances
        .iter()
        .find(|inst| inst.index == index)
        .expect("instance should exist")
}

async fn recv_process_status_event(
    events: &mut broadcast::Receiver<Event>,
    process_id: &str,
    status: &str,
) -> Event {
    loop {
        let event = events.recv().await.unwrap();
        if event.topic != "process.status_changed" {
            continue;
        }

        if event.payload["process_id"] != serde_json::json!(process_id) {
            continue;
        }

        if event.payload["status"] != serde_json::json!(status) {
            continue;
        }

        return event;
    }
}

async fn spawn_external_sleep() -> (StdChild, ProcessRuntimeIdentity) {
    let child = std::process::Command::new("sleep")
        .arg("60")
        .spawn()
        .expect("failed to spawn external sleep");
    let pid = child.id();

    for _ in 0..10 {
        if let Some(identity) = lookup_process_identity(pid) {
            return (child, identity);
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    panic!(
        "failed to resolve runtime identity for external sleep {}",
        pid
    );
}

#[tokio::test]
async fn test_create_process() {
    let (pm, _pool) = test_pm().await;
    let info = pm
        .create_process(CreateProcessRequest {
            name: "test-echo".to_string(),
            mode: ProcessMode::Daemon,
            command: "echo".to_string(),
            args: vec!["hello".to_string()],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy::default(),
            enabled: false,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 1,
            pty_mode: false,
            schedule: None,
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
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
            mode: ProcessMode::Daemon,
            command: "echo".to_string(),
            args: vec!["hello".to_string()],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy::default(),
            enabled: false,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 3,
            pty_mode: false,
            schedule: None,
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
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
            mode: ProcessMode::Daemon,
            command: "sh".to_string(),
            args: vec!["-c".to_string(), "echo hello-from-instance".to_string()],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy {
                strategy: RestartStrategy::Never,
                ..Default::default()
            },
            enabled: false,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 2,
            pty_mode: false,
            schedule: None,
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
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
async fn test_get_logs_orders_rotated_files_oldest_first() {
    let (pm, _pool) = test_pm().await;
    let mut req = sleep_process_request("rotated-log-order");
    req.log_config = ProcessLogConfig {
        max_file_size: 1024,
        max_files: 3,
    };

    let info = pm.create_process(req).await.unwrap();
    let id = info.definition.id;
    let proc_log_dir = pm.log_dir.join(&id).join("instance-0");

    std::fs::create_dir_all(&proc_log_dir).unwrap();
    std::fs::write(proc_log_dir.join("stdout.log.2"), "oldest-1\noldest-2\n").unwrap();
    std::fs::write(proc_log_dir.join("stdout.log.1"), "newer-1\n").unwrap();
    std::fs::write(proc_log_dir.join("stdout.log"), "current-1\ncurrent-2\n").unwrap();

    let logs = pm
        .get_logs(GetLogsRequest {
            id,
            stream: LogStream::Stdout,
            lines: 10,
            offset: 0,
            instance: 0,
        })
        .await
        .unwrap();

    let lines: Vec<&str> = logs.lines.iter().map(|line| line.line.as_str()).collect();
    assert_eq!(
        lines,
        vec!["oldest-1", "oldest-2", "newer-1", "current-1", "current-2"]
    );
    assert_eq!(logs.total_lines, 5);
    assert!(!logs.has_more);
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
            mode: None,
            command: None,
            args: None,
            cwd: None,
            env: None,
            restart_policy: None,
            enabled: None,
            group_name: None,
            log_config: None,
            run_as: None,
            instance_count: None,
            pty_mode: None,
            schedule: None,
            schedule_overlap_policy: None,
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
            mode: None,
            command: Some("sh".to_string()),
            args: Some(vec!["-c".to_string(), "sleep 60".to_string()]),
            cwd: None,
            env: None,
            restart_policy: None,
            enabled: None,
            group_name: None,
            log_config: None,
            run_as: None,
            instance_count: None,
            pty_mode: None,
            schedule: None,
            schedule_overlap_policy: None,
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
            mode: None,
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
            enabled: Some(true),
            group_name: Some(Some("svc".to_string())),
            log_config: None,
            run_as: None,
            instance_count: None,
            pty_mode: None,
            schedule: None,
            schedule_overlap_policy: None,
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
            mode: None,
            command: None,
            args: None,
            cwd: None,
            env: None,
            restart_policy: None,
            enabled: None,
            group_name: Some(None),
            log_config: None,
            run_as: None,
            instance_count: None,
            pty_mode: None,
            schedule: None,
            schedule_overlap_policy: None,
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
            mode: None,
            command: Some("echo".to_string()),
            args: Some(vec!["hello".to_string()]),
            cwd: None,
            env: None,
            restart_policy: None,
            enabled: None,
            group_name: None,
            log_config: None,
            run_as: None,
            instance_count: None,
            pty_mode: None,
            schedule: None,
            schedule_overlap_policy: None,
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
        mode: None,
        command: None,
        args: None,
        cwd: None,
        env: None,
        restart_policy: None,
        enabled: None,
        group_name: None,
        log_config: None,
        run_as: None,
        instance_count: None,
        pty_mode: None,
        schedule: None,
        schedule_overlap_policy: None,
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
            mode: None,
            command: None,
            args: None,
            cwd: None,
            env: None,
            restart_policy: None,
            enabled: None,
            group_name: None,
            log_config: None,
            run_as: None,
            instance_count: Some(2),
            pty_mode: None,
            schedule: None,
            schedule_overlap_policy: None,
        })
        .await
        .unwrap();

    assert_eq!(updated.instances.len(), 2);
    assert_eq!(instance(&updated, 0).status, ProcessStatus::Running);
    assert_eq!(instance(&updated, 1).status, ProcessStatus::Running);
    assert_ne!(instance(&updated, 0).pid, old_pid);
}

#[tokio::test]
async fn test_schedule_once_auto_triggers_and_updates_state() {
    let (pm, _pool) = test_pm().await;
    let info = pm
        .create_process(CreateProcessRequest {
            name: "schedule-once-auto".to_string(),
            mode: ProcessMode::Schedule,
            command: "sh".to_string(),
            args: vec!["-c".to_string(), "echo scheduled-once".to_string()],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy {
                strategy: RestartStrategy::Never,
                ..Default::default()
            },
            enabled: true,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 1,
            pty_mode: false,
            schedule: Some(ScheduleConfig::Once {
                run_at: (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339(),
            }),
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
        })
        .await
        .unwrap();
    let id = info.definition.id;

    tokio::time::sleep(Duration::from_millis(300)).await;

    let process = pm.get_process(&id).await.unwrap();
    assert!(process
        .definition
        .schedule_state
        .last_triggered_at
        .is_some());
    assert_eq!(process.definition.schedule_state.next_run_at, None);
    let logs = pm
        .get_logs(GetLogsRequest {
            id,
            stream: LogStream::Stdout,
            lines: 50,
            offset: 0,
            instance: 0,
        })
        .await
        .unwrap();
    assert!(logs
        .lines
        .iter()
        .any(|line| line.line.contains("scheduled-once")));
}

#[tokio::test]
async fn test_schedule_overlap_ignore_skips_when_instance_running() {
    let (pm, _pool) = test_pm().await;
    let created = pm
        .create_process(scheduled_sleep_process_request(
            "schedule-ignore",
            ScheduleOverlapPolicy::Ignore,
        ))
        .await
        .unwrap();
    let id = created.definition.id.clone();

    pm.start_process(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    pm.run_schedule_trigger(
        &id,
        super::runtime::ScheduleTriggerSource::Scheduled(chrono::Utc::now()),
    )
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;

    let process = pm.get_process(&id).await.unwrap();
    let running: Vec<_> = process
        .instances
        .iter()
        .filter(|instance| instance.status == ProcessStatus::Running)
        .collect();
    assert_eq!(running.len(), 1);
    assert_eq!(process.definition.schedule_state.trigger_count, 1);
    assert!(process.definition.schedule_state.last_skipped_at.is_some());

    let _ = pm.stop_process(&id).await;
}

#[tokio::test]
async fn test_schedule_overlap_restart_replaces_running_instance() {
    let (pm, _pool) = test_pm().await;
    let created = pm
        .create_process(scheduled_sleep_process_request(
            "schedule-restart",
            ScheduleOverlapPolicy::Restart,
        ))
        .await
        .unwrap();
    let id = created.definition.id.clone();

    pm.start_process(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    let before = pm.get_process(&id).await.unwrap();
    let old_pid = instance(&before, 0)
        .pid
        .expect("manual trigger should start instance");

    pm.run_schedule_trigger(
        &id,
        super::runtime::ScheduleTriggerSource::Scheduled(chrono::Utc::now()),
    )
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let after = pm.get_process(&id).await.unwrap();
    let new_pid = instance(&after, 0)
        .pid
        .expect("scheduled restart should start a replacement instance");
    assert_ne!(new_pid, old_pid);
    assert_eq!(after.definition.schedule_state.trigger_count, 1);

    let _ = pm.stop_process(&id).await;
}

#[tokio::test]
async fn test_schedule_overlap_start_new_adds_ephemeral_instance() {
    let (pm, _pool) = test_pm().await;
    let created = pm
        .create_process(scheduled_sleep_process_request(
            "schedule-start-new",
            ScheduleOverlapPolicy::StartNew,
        ))
        .await
        .unwrap();
    let id = created.definition.id.clone();

    pm.start_process(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    pm.run_schedule_trigger(
        &id,
        super::runtime::ScheduleTriggerSource::Scheduled(chrono::Utc::now()),
    )
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    let process = pm.get_process(&id).await.unwrap();
    let running_instances: Vec<_> = process
        .instances
        .iter()
        .filter(|instance| instance.status == ProcessStatus::Running)
        .map(|instance| instance.index)
        .collect();
    assert_eq!(running_instances, vec![0, 1]);
    assert_eq!(process.definition.schedule_state.trigger_count, 1);

    let _ = pm.stop_process(&id).await;
}

#[tokio::test]
async fn test_restore_processes_arms_scheduled_processes() {
    let pool = crate::db::connect_in_memory().await.unwrap();
    crate::db::run_migrations(&pool).await.unwrap();
    let data_dir =
        std::env::temp_dir().join(format!("xdeck-schedule-restore-{}", uuid::Uuid::new_v4()));

    let event_bus_1 = Arc::new(EventBus::default());
    let pty_manager_1 = PtyManager::new(event_bus_1.clone(), Duration::from_secs(30 * 60));
    let pm_1 = ProcessManager::new(pool.clone(), event_bus_1, pty_manager_1, &data_dir);

    let created = pm_1
        .create_process(CreateProcessRequest {
            name: "restore-schedule".to_string(),
            mode: ProcessMode::Schedule,
            command: "sh".to_string(),
            args: vec!["-c".to_string(), "echo restore-schedule".to_string()],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy {
                strategy: RestartStrategy::Never,
                ..Default::default()
            },
            enabled: false,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 1,
            pty_mode: false,
            schedule: Some(ScheduleConfig::Once {
                run_at: (chrono::Utc::now() + chrono::Duration::minutes(10)).to_rfc3339(),
            }),
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
        })
        .await
        .unwrap();
    let id = created.definition.id.clone();

    let mut definition = pm_1.load_definition(&id).await.unwrap().unwrap();
    definition.enabled = true;
    definition.schedule_state.next_run_at =
        Some((chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339());
    pm_1.save_definition(&definition).await.unwrap();

    let event_bus_2 = Arc::new(EventBus::default());
    let pty_manager_2 = PtyManager::new(event_bus_2.clone(), Duration::from_secs(30 * 60));
    let pm_2 = ProcessManager::new(pool.clone(), event_bus_2, pty_manager_2, &data_dir);
    pm_2.restore_processes().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let restored = pm_2.get_process(&id).await.unwrap();
    assert!(restored
        .definition
        .schedule_state
        .last_triggered_at
        .is_some());
    assert_eq!(restored.definition.schedule_state.next_run_at, None);

    let logs = pm_2
        .get_logs(GetLogsRequest {
            id: id.clone(),
            stream: LogStream::Stdout,
            lines: 50,
            offset: 0,
            instance: 0,
        })
        .await
        .unwrap();
    assert!(logs
        .lines
        .iter()
        .any(|line| line.line.contains("restore-schedule")));
}

#[tokio::test]
async fn test_restore_processes_kills_orphaned_runtime_and_starts_new_child() {
    let pool = crate::db::connect_in_memory().await.unwrap();
    crate::db::run_migrations(&pool).await.unwrap();
    let data_dir =
        std::env::temp_dir().join(format!("xdeck-runtime-restore-{}", uuid::Uuid::new_v4()));

    let event_bus_1 = Arc::new(EventBus::default());
    let pty_manager_1 = PtyManager::new(event_bus_1.clone(), Duration::from_secs(30 * 60));
    let pm_1 = ProcessManager::new(pool.clone(), event_bus_1, pty_manager_1, &data_dir);

    let mut req = sleep_process_request("restore-runtime-orphan");
    req.enabled = true;
    let created = pm_1.create_process(req).await.unwrap();
    let process_id = created.definition.id.clone();

    let (mut external_child, identity) = spawn_external_sleep().await;
    pm_1.save_runtime_identity(&process_id, 0, &identity)
        .await
        .unwrap();

    let event_bus_2 = Arc::new(EventBus::default());
    let pty_manager_2 = PtyManager::new(event_bus_2.clone(), Duration::from_secs(30 * 60));
    let pm_2 = ProcessManager::new(pool.clone(), event_bus_2, pty_manager_2, &data_dir);
    pm_2.restore_processes().await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    let restored = pm_2.get_process(&process_id).await.unwrap();
    assert_eq!(instance(&restored, 0).status, ProcessStatus::Running);
    let new_pid = instance(&restored, 0)
        .pid
        .expect("restored process should have pid");
    assert_ne!(new_pid, identity.pid);

    let persisted = pm_2.load_runtime_identities(&process_id).await.unwrap();
    assert_eq!(persisted.get(&0).map(|item| item.pid), Some(new_pid));

    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(external_child.try_wait().unwrap().is_some());

    pm_2.stop_process(&process_id).await.unwrap();
}

#[tokio::test]
async fn test_restore_processes_rejects_stale_runtime_identity() {
    let pool = crate::db::connect_in_memory().await.unwrap();
    crate::db::run_migrations(&pool).await.unwrap();
    let data_dir =
        std::env::temp_dir().join(format!("xdeck-runtime-stale-{}", uuid::Uuid::new_v4()));

    let event_bus_1 = Arc::new(EventBus::default());
    let pty_manager_1 = PtyManager::new(event_bus_1.clone(), Duration::from_secs(30 * 60));
    let pm_1 = ProcessManager::new(pool.clone(), event_bus_1, pty_manager_1, &data_dir);

    let mut req = sleep_process_request("restore-runtime-stale");
    req.enabled = true;
    let created = pm_1.create_process(req).await.unwrap();
    let process_id = created.definition.id.clone();

    let (mut external_child, identity) = spawn_external_sleep().await;
    pm_1.save_runtime_identity(
        &process_id,
        0,
        &ProcessRuntimeIdentity {
            pid: identity.pid,
            start_time: identity.start_time.saturating_add(1),
        },
    )
    .await
    .unwrap();

    let event_bus_2 = Arc::new(EventBus::default());
    let pty_manager_2 = PtyManager::new(event_bus_2.clone(), Duration::from_secs(30 * 60));
    let pm_2 = ProcessManager::new(pool.clone(), event_bus_2, pty_manager_2, &data_dir);
    pm_2.restore_processes().await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    let restored = pm_2.get_process(&process_id).await.unwrap();
    assert_eq!(instance(&restored, 0).status, ProcessStatus::Running);
    let new_pid = instance(&restored, 0)
        .pid
        .expect("restored process should have pid");
    assert_ne!(new_pid, identity.pid);

    let persisted = pm_2.load_runtime_identities(&process_id).await.unwrap();
    assert_eq!(persisted.get(&0).map(|item| item.pid), Some(new_pid));

    pm_2.stop_process(&process_id).await.unwrap();
    let _ = external_child.kill();
    let _ = external_child.wait();
}

#[tokio::test]
async fn test_shutdown_stops_processes_and_clears_runtime_identity() {
    let (pm, _pool) = test_pm().await;
    let created = pm
        .create_process(sleep_process_request("shutdown-cleanup"))
        .await
        .unwrap();
    let process_id = created.definition.id.clone();

    pm.start_process(&process_id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    let running = pm.get_process(&process_id).await.unwrap();
    let pid = instance(&running, 0)
        .pid
        .expect("running process should have pid");
    assert!(pm
        .load_runtime_identities(&process_id)
        .await
        .unwrap()
        .contains_key(&0));

    pm.shutdown().await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;

    let stopped = pm.get_process(&process_id).await.unwrap();
    assert_eq!(instance(&stopped, 0).status, ProcessStatus::Stopped);
    assert!(instance(&stopped, 0).pid.is_none());
    assert!(pm
        .load_runtime_identities(&process_id)
        .await
        .unwrap()
        .is_empty());
    assert!(lookup_process_identity(pid).is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn test_create_pty_mode_process() {
    let (pm, _pool) = test_pm().await;
    let mut req = sleep_process_request("pty-create");
    req.pty_mode = true;

    let created = pm.create_process(req).await.unwrap();
    assert!(created.definition.pty_mode);

    pm.start_process(&created.definition.id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    let running = pm.get_process(&created.definition.id).await.unwrap();
    assert_eq!(instance(&running, 0).status, ProcessStatus::Running);
    assert!(instance(&running, 0).pty_session_id.is_some());

    pm.stop_process(&created.definition.id).await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn test_stop_pty_mode_cleans_session() {
    let (pm, _pool) = test_pm().await;
    let mut req = sleep_process_request("pty-stop-clean");
    req.pty_mode = true;
    let created = pm.create_process(req).await.unwrap();
    let process_id = created.definition.id.clone();

    pm.start_process(&process_id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;

    let running = pm.get_process(&process_id).await.unwrap();
    let session_id = instance(&running, 0)
        .pty_session_id
        .clone()
        .expect("pty session should be set when pty mode is enabled");
    assert!(pm.pty_manager.get_session_handle(&session_id).is_some());

    pm.stop_process(&process_id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(pm.pty_manager.get_session_handle(&session_id).is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn test_stop_pty_mode_publishes_null_session_id() {
    let (pm, _pool) = test_pm().await;
    let mut events = pm.event_bus.subscribe();
    let mut req = sleep_process_request("pty-stop-event");
    req.pty_mode = true;
    let created = pm.create_process(req).await.unwrap();
    let process_id = created.definition.id.clone();

    pm.start_process(&process_id).await.unwrap();
    let running_event = recv_process_status_event(&mut events, &process_id, "running").await;
    assert!(running_event.payload["pty_session_id"].as_str().is_some());

    pm.stop_process(&process_id).await.unwrap();
    let stopped_event = recv_process_status_event(&mut events, &process_id, "stopped").await;
    assert!(stopped_event.payload["pty_session_id"].is_null());
    assert!(stopped_event.payload["pid"].is_null());
}

#[cfg(unix)]
#[tokio::test]
async fn test_pty_mode_process_exits_updates_status() {
    let (pm, _pool) = test_pm().await;
    let info = pm
        .create_process(CreateProcessRequest {
            name: "pty-exit-status".to_string(),
            mode: ProcessMode::Daemon,
            command: "sh".to_string(),
            args: vec!["-c".to_string(), "exit 0".to_string()],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy {
                strategy: RestartStrategy::Never,
                ..Default::default()
            },
            enabled: false,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 1,
            pty_mode: true,
            schedule: None,
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
        })
        .await
        .unwrap();
    let id = info.definition.id;

    pm.start_process(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(700)).await;

    let exited = pm.get_process(&id).await.unwrap();
    let state = instance(&exited, 0);
    assert_eq!(state.status, ProcessStatus::Stopped);
    assert!(state.pid.is_none());
    assert!(state.pty_session_id.is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn test_pty_mode_restart_publishes_new_session_id() {
    let (pm, _pool) = test_pm().await;
    let mut events = pm.event_bus.subscribe();
    let marker_path =
        std::env::temp_dir().join(format!("xdeck-pty-restart-{}", uuid::Uuid::new_v4()));

    let info = pm
        .create_process(CreateProcessRequest {
            name: "pty-restart-event".to_string(),
            mode: ProcessMode::Daemon,
            command: "sh".to_string(),
            args: vec![
                "-c".to_string(),
                "if [ -f \"$0\" ]; then sleep 2; else touch \"$0\"; exit 1; fi".to_string(),
                marker_path.to_string_lossy().into_owned(),
            ],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy {
                strategy: RestartStrategy::OnFailure,
                max_retries: Some(1),
                delay_ms: 10,
                backoff_multiplier: 1.0,
            },
            enabled: false,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 1,
            pty_mode: true,
            schedule: None,
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
        })
        .await
        .unwrap();
    let process_id = info.definition.id.clone();

    pm.start_process(&process_id).await.unwrap();

    let first_running = recv_process_status_event(&mut events, &process_id, "running").await;
    let first_session_id = first_running.payload["pty_session_id"]
        .as_str()
        .expect("first running event should include PTY session id")
        .to_string();

    let errored_event = recv_process_status_event(&mut events, &process_id, "errored").await;
    assert_eq!(errored_event.payload["exit_code"], serde_json::json!(1));
    assert!(errored_event.payload["pty_session_id"].is_null());

    let restarted_running = recv_process_status_event(&mut events, &process_id, "running").await;
    let restarted_session_id = restarted_running.payload["pty_session_id"]
        .as_str()
        .expect("restarted running event should include PTY session id")
        .to_string();
    assert_ne!(first_session_id, restarted_session_id);

    let _ = pm.stop_process(&process_id).await;
    let _ = std::fs::remove_file(&marker_path);
}

#[cfg(unix)]
#[tokio::test]
async fn test_pty_output_flows_to_logs() {
    let (pm, _pool) = test_pm().await;
    let info = pm
        .create_process(CreateProcessRequest {
            name: "pty-log-flow".to_string(),
            mode: ProcessMode::Daemon,
            command: "sh".to_string(),
            args: vec![
                "-c".to_string(),
                "echo pty-output-line && sleep 2".to_string(),
            ],
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            restart_policy: RestartPolicy {
                strategy: RestartStrategy::Never,
                ..Default::default()
            },
            enabled: false,
            group_name: None,
            log_config: ProcessLogConfig::default(),
            run_as: None,
            instance_count: 1,
            pty_mode: true,
            schedule: None,
            schedule_overlap_policy: ScheduleOverlapPolicy::Ignore,
        })
        .await
        .unwrap();
    let id = info.definition.id;

    pm.start_process(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;

    let logs = pm
        .get_logs(GetLogsRequest {
            id: id.clone(),
            stream: LogStream::Stdout,
            lines: 200,
            offset: 0,
            instance: 0,
        })
        .await
        .unwrap();

    assert!(logs
        .lines
        .iter()
        .any(|line| line.line.contains("pty-output-line")));

    let _ = pm.stop_process(&id).await;
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

    let start_errors = pm.start_group("svc-b", true).await.unwrap();
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

    let errors = pm.start_group("svc-c", true).await.unwrap();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].contains(&bad.definition.id));

    let good_state = pm.get_process(&good.definition.id).await.unwrap();
    assert_eq!(instance(&good_state, 0).status, ProcessStatus::Running);
}
