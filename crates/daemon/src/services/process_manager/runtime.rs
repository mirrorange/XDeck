use std::time::Duration;

use chrono::{DateTime, Utc};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};
use tokio::process::Child;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::ProcessStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProcessRuntimeIdentity {
    pub pid: u32,
    pub start_time: u64,
}

impl ProcessRuntimeIdentity {
    pub fn started_at(&self) -> Option<DateTime<Utc>> {
        DateTime::<Utc>::from_timestamp(self.start_time as i64, 0)
    }
}

pub(super) struct RunningProcess {
    pub child: Option<Child>,
    pub pty_session_id: Option<String>,
    pub runtime_identity: Option<ProcessRuntimeIdentity>,
    pub attached: bool,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub started_at: Option<DateTime<Utc>>,
    pub exit_code: Option<i32>,
    pub cancel_tx: Option<oneshot::Sender<()>>,
    pub ephemeral: bool,
}

pub(super) struct ScheduleTaskHandle {
    pub cancel_tx: oneshot::Sender<()>,
    pub join_handle: JoinHandle<()>,
}

pub(super) enum ScheduleTriggerSource {
    Manual,
    Scheduled(DateTime<Utc>),
}

pub(super) fn lookup_process_identity(pid: u32) -> Option<ProcessRuntimeIdentity> {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing(),
    );
    let process = system.process(pid)?;
    Some(ProcessRuntimeIdentity {
        pid: pid.as_u32(),
        start_time: process.start_time(),
    })
}

pub(super) fn process_identity_is_alive(identity: &ProcessRuntimeIdentity) -> bool {
    matches!(
        lookup_process_identity(identity.pid),
        Some(current) if current == *identity
    )
}

pub(super) fn kill_process_identity(identity: &ProcessRuntimeIdentity) -> bool {
    let pid = Pid::from_u32(identity.pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing(),
    );

    let Some(process) = system.process(pid) else {
        return true;
    };
    if process.start_time() != identity.start_time {
        return true;
    }

    process
        .kill_with(Signal::Term)
        .or_else(|| Some(process.kill()))
        .unwrap_or(false)
}

pub(super) async fn wait_for_process_identity_exit(
    identity: &ProcessRuntimeIdentity,
    timeout: Duration,
) -> bool {
    let started = tokio::time::Instant::now();
    while started.elapsed() < timeout {
        if !process_identity_is_alive(identity) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    !process_identity_is_alive(identity)
}
