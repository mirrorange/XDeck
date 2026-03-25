use serde::{Deserialize, Serialize};

/// Current status of a task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// Type of long-running task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    Compress,
    Extract,
    Upload,
    Download,
    FolderDownload,
    Copy,
}

/// A tracked long-running task.
#[derive(Debug, Clone, Serialize)]
pub struct Task {
    pub id: String,
    pub task_type: TaskType,
    pub title: String,
    pub status: TaskStatus,
    /// Progress percentage (0-100). None if indeterminate.
    pub progress: Option<u8>,
    /// Human-readable status message.
    pub message: Option<String>,
    /// Unix timestamp in milliseconds.
    pub created_at: u64,
    /// Unix timestamp in milliseconds.
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DismissTaskResult {
    Dismissed,
    Active,
    NotFound,
}
