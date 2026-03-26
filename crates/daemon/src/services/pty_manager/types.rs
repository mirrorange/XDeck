use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const PTY_SESSION_EXITED_TOPIC: &str = "pty.session_exited";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtySessionType {
    Terminal,
    ProcessDaemon { process_id: String },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PtySessionTypeLabel {
    Terminal,
    ProcessDaemon,
}

#[derive(Debug, Clone)]
pub struct CreatePtyRequest {
    pub name: Option<String>,
    pub session_type: PtySessionType,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtySessionInfo {
    pub session_id: String,
    pub name: String,
    pub session_type: PtySessionTypeLabel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    pub command: String,
    pub cols: u16,
    pub rows: u16,
    pub client_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PtySessionExitedEvent {
    pub session_id: String,
    pub session_type: PtySessionTypeLabel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub exit_code: i32,
    pub success: bool,
}
