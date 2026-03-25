use chrono::{DateTime, Utc};
use tokio::process::Child;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::ProcessStatus;

pub(super) struct RunningProcess {
    pub child: Option<Child>,
    pub pty_session_id: Option<String>,
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
