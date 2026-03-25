use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UploadSessionStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl UploadSessionStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub(super) fn from_db(value: &str) -> Result<Self, AppError> {
        match value {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(AppError::Internal(format!(
                "Unknown upload session status: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UploadFileStatus {
    Pending,
    Running,
    Uploaded,
    Completed,
    Failed,
    Cancelled,
}

impl UploadFileStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Uploaded => "uploaded",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub(super) fn from_db(value: &str) -> Result<Self, AppError> {
        match value {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "uploaded" => Ok(Self::Uploaded),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(AppError::Internal(format!(
                "Unknown upload file status: {}",
                other
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadFileDescriptor {
    pub name: String,
    pub size: u64,
    pub relative_path: Option<String>,
    pub last_modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUploadSessionRequest {
    pub dest_path: String,
    pub files: Vec<UploadFileDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadSessionFile {
    pub id: String,
    pub file_name: String,
    pub relative_path: String,
    pub size: u64,
    pub uploaded_bytes: u64,
    pub status: UploadFileStatus,
    pub last_modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadSession {
    pub id: String,
    pub task_id: String,
    pub dest_path: String,
    pub title: String,
    pub status: UploadSessionStatus,
    pub total_files: u32,
    pub completed_files: u32,
    pub total_bytes: u64,
    pub uploaded_bytes: u64,
    pub error_message: Option<String>,
    pub files: Vec<UploadSessionFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppendChunkResult {
    pub session_id: String,
    pub file_id: String,
    pub uploaded_bytes: u64,
    pub file_size: u64,
    pub session_uploaded_bytes: u64,
    pub session_total_bytes: u64,
    pub completed_files: u32,
    pub total_files: u32,
    pub progress: u8,
}
