use std::path::PathBuf;
use std::sync::Arc;

use bytes::Bytes;
use sqlx::{Row, SqlitePool};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use tracing::info;
use uuid::Uuid;

use super::helpers::{build_upload_title, from_i64, normalize_files, progress_percent, to_i64};
use super::models::{
    AppendChunkResult, CreateUploadSessionRequest, UploadFileStatus, UploadSession,
    UploadSessionFile, UploadSessionStatus,
};
use crate::error::AppError;
use crate::services::file_manager;
use crate::services::task_manager::{self, SharedTaskManager, TaskStatus, TaskType};

pub struct UploadManager {
    pool: SqlitePool,
    task_manager: SharedTaskManager,
    temp_root: PathBuf,
}

pub type SharedUploadManager = Arc<UploadManager>;

impl UploadManager {
    pub fn new(
        pool: SqlitePool,
        task_manager: SharedTaskManager,
        temp_root: PathBuf,
    ) -> Result<Self, AppError> {
        std::fs::create_dir_all(&temp_root).map_err(|err| {
            AppError::Internal(format!("Failed to create upload temp dir: {}", err))
        })?;

        Ok(Self {
            pool,
            task_manager,
            temp_root,
        })
    }

    pub async fn create_session(
        &self,
        request: CreateUploadSessionRequest,
    ) -> Result<UploadSession, AppError> {
        if request.files.is_empty() {
            return Err(AppError::BadRequest("At least one file is required".into()));
        }

        let dest_dir = file_manager::resolve_safe_path(&request.dest_path)?;
        if !dest_dir.is_dir() {
            return Err(AppError::BadRequest(
                "Destination must be a directory".into(),
            ));
        }

        let normalized_files = normalize_files(&request.files)?;
        let total_files = u32::try_from(normalized_files.len())
            .map_err(|_| AppError::Internal("Too many files in upload session".into()))?;
        let total_bytes = normalized_files.iter().map(|file| file.size).sum::<u64>();
        let title = build_upload_title(&normalized_files);
        let task_handle =
            task_manager::create_task(&self.task_manager, TaskType::Upload, title.clone()).await;
        let task_id = task_handle.id().to_string();
        let session_id = Uuid::new_v4().to_string();
        let session_dir = self.temp_root.join(&session_id);
        fs::create_dir_all(&session_dir).await.map_err(|err| {
            AppError::Internal(format!("Failed to create upload session dir: {}", err))
        })?;

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO upload_sessions (
                id, task_id, dest_path, title, status, total_files, completed_files,
                total_bytes, uploaded_bytes, error_message
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 0, NULL)",
        )
        .bind(&session_id)
        .bind(&task_id)
        .bind(dest_dir.to_string_lossy().to_string())
        .bind(&title)
        .bind(UploadSessionStatus::Pending.as_str())
        .bind(i64::from(total_files))
        .bind(to_i64(total_bytes)?)
        .execute(&mut *tx)
        .await?;

        for file in &normalized_files {
            let temp_path = session_dir.join(format!("{}.part", file.id));
            sqlx::query(
                "INSERT INTO upload_session_files (
                    id, session_id, file_name, relative_path, size, uploaded_bytes,
                    temp_path, status, last_modified
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
            )
            .bind(&file.id)
            .bind(&session_id)
            .bind(&file.file_name)
            .bind(&file.relative_path)
            .bind(to_i64(file.size)?)
            .bind(temp_path.to_string_lossy().to_string())
            .bind(if file.size == 0 {
                UploadFileStatus::Uploaded.as_str()
            } else {
                UploadFileStatus::Pending.as_str()
            })
            .bind(file.last_modified)
            .execute(&mut *tx)
            .await?;
        }

        if total_bytes == 0 {
            sqlx::query(
                "UPDATE upload_sessions
                 SET completed_files = total_files, updated_at = datetime('now')
                 WHERE id = ?1",
            )
            .bind(&session_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        let session = self.get_session(&session_id).await?;
        self.sync_task(&session).await;
        Ok(session)
    }

    pub async fn get_session(&self, session_id: &str) -> Result<UploadSession, AppError> {
        let session_row = sqlx::query(
            "SELECT
                id, task_id, dest_path, title, status, total_files, completed_files,
                total_bytes, uploaded_bytes, error_message
             FROM upload_sessions
             WHERE id = ?1",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        let session_row = session_row.ok_or_else(|| {
            AppError::NotFound(format!("Upload session not found: {}", session_id))
        })?;

        let file_rows = sqlx::query(
            "SELECT
                id, file_name, relative_path, size, uploaded_bytes, status, last_modified
             FROM upload_session_files
             WHERE session_id = ?1
             ORDER BY relative_path ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;

        let mut files = Vec::with_capacity(file_rows.len());
        for row in file_rows {
            files.push(UploadSessionFile {
                id: row.try_get::<String, _>("id")?,
                file_name: row.try_get::<String, _>("file_name")?,
                relative_path: row.try_get::<String, _>("relative_path")?,
                size: from_i64(row.try_get::<i64, _>("size")?)?,
                uploaded_bytes: from_i64(row.try_get::<i64, _>("uploaded_bytes")?)?,
                status: UploadFileStatus::from_db(&row.try_get::<String, _>("status")?)?,
                last_modified: row.try_get::<Option<i64>, _>("last_modified")?,
            });
        }

        Ok(UploadSession {
            id: session_row.try_get::<String, _>("id")?,
            task_id: session_row.try_get::<String, _>("task_id")?,
            dest_path: session_row.try_get::<String, _>("dest_path")?,
            title: session_row.try_get::<String, _>("title")?,
            status: UploadSessionStatus::from_db(&session_row.try_get::<String, _>("status")?)?,
            total_files: u32::try_from(session_row.try_get::<i64, _>("total_files")?)
                .map_err(|_| AppError::Internal("Invalid total_files value".into()))?,
            completed_files: u32::try_from(session_row.try_get::<i64, _>("completed_files")?)
                .map_err(|_| AppError::Internal("Invalid completed_files value".into()))?,
            total_bytes: from_i64(session_row.try_get::<i64, _>("total_bytes")?)?,
            uploaded_bytes: from_i64(session_row.try_get::<i64, _>("uploaded_bytes")?)?,
            error_message: session_row.try_get::<Option<String>, _>("error_message")?,
            files,
        })
    }

    pub async fn append_chunk(
        &self,
        session_id: &str,
        file_id: &str,
        offset: u64,
        chunk: Bytes,
    ) -> Result<AppendChunkResult, AppError> {
        if chunk.is_empty() {
            return Err(AppError::BadRequest("Upload chunk cannot be empty".into()));
        }

        let row = sqlx::query(
            "SELECT
                s.id AS session_id,
                s.task_id AS task_id,
                s.status AS session_status,
                s.total_files AS total_files,
                s.total_bytes AS total_bytes,
                f.id AS file_id,
                f.size AS file_size,
                f.uploaded_bytes AS uploaded_bytes,
                f.temp_path AS temp_path,
                f.status AS file_status
             FROM upload_sessions s
             JOIN upload_session_files f ON f.session_id = s.id
             WHERE s.id = ?1 AND f.id = ?2",
        )
        .bind(session_id)
        .bind(file_id)
        .fetch_optional(&self.pool)
        .await?;

        let row = row.ok_or_else(|| {
            AppError::NotFound(format!(
                "Upload file not found for session {}: {}",
                session_id, file_id
            ))
        })?;

        let session_status =
            UploadSessionStatus::from_db(&row.try_get::<String, _>("session_status")?)?;
        if matches!(
            session_status,
            UploadSessionStatus::Completed | UploadSessionStatus::Cancelled
        ) {
            return Err(AppError::BadRequest(format!(
                "Upload session is already {}",
                session_status.as_str()
            )));
        }

        let file_status = UploadFileStatus::from_db(&row.try_get::<String, _>("file_status")?)?;
        if matches!(
            file_status,
            UploadFileStatus::Completed | UploadFileStatus::Cancelled
        ) {
            return Err(AppError::BadRequest(
                "Upload file can no longer accept chunks".into(),
            ));
        }

        let stored_offset = from_i64(row.try_get::<i64, _>("uploaded_bytes")?)?;
        if offset != stored_offset {
            return Err(AppError::BadRequest(format!(
                "Offset mismatch for file {}: expected {}, got {}",
                file_id, stored_offset, offset
            )));
        }

        let file_size = from_i64(row.try_get::<i64, _>("file_size")?)?;
        let next_offset = offset
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| AppError::BadRequest("Chunk exceeds file size".into()))?;
        if next_offset > file_size {
            return Err(AppError::BadRequest(format!(
                "Chunk exceeds declared file size for {}",
                file_id
            )));
        }

        let temp_path = PathBuf::from(row.try_get::<String, _>("temp_path")?);
        if let Some(parent) = temp_path.parent() {
            fs::create_dir_all(parent).await.map_err(|err| {
                AppError::Internal(format!("Failed to create upload temp dir: {}", err))
            })?;
        }

        let existing_len = match fs::metadata(&temp_path).await {
            Ok(metadata) => metadata.len(),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => 0,
            Err(err) => {
                return Err(AppError::Internal(format!(
                    "Failed to read temp file metadata: {}",
                    err
                )))
            }
        };
        if existing_len != stored_offset {
            return Err(AppError::Internal(format!(
                "Temp file size mismatch for {}: expected {}, found {}",
                file_id, stored_offset, existing_len
            )));
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&temp_path)
            .await
            .map_err(|err| {
                AppError::Internal(format!("Failed to open upload temp file: {}", err))
            })?;
        file.write_all(&chunk)
            .await
            .map_err(|err| AppError::Internal(format!("Failed to write upload chunk: {}", err)))?;
        file.flush()
            .await
            .map_err(|err| AppError::Internal(format!("Failed to flush upload chunk: {}", err)))?;

        let next_status = if next_offset == file_size {
            UploadFileStatus::Uploaded
        } else {
            UploadFileStatus::Running
        };

        sqlx::query(
            "UPDATE upload_session_files
             SET uploaded_bytes = ?1, status = ?2, updated_at = datetime('now')
             WHERE id = ?3",
        )
        .bind(to_i64(next_offset)?)
        .bind(next_status.as_str())
        .bind(file_id)
        .execute(&self.pool)
        .await?;

        let session = self.refresh_session_progress(session_id).await?;
        self.sync_task(&session).await;

        Ok(AppendChunkResult {
            session_id: session.id,
            file_id: file_id.to_string(),
            uploaded_bytes: next_offset,
            file_size,
            session_uploaded_bytes: session.uploaded_bytes,
            session_total_bytes: session.total_bytes,
            completed_files: session.completed_files,
            total_files: session.total_files,
            progress: progress_percent(session.uploaded_bytes, session.total_bytes),
        })
    }

    pub async fn complete_session(&self, session_id: &str) -> Result<UploadSession, AppError> {
        let session = self.get_session(session_id).await?;
        if matches!(
            session.status,
            UploadSessionStatus::Completed | UploadSessionStatus::Cancelled
        ) {
            return Err(AppError::BadRequest(format!(
                "Upload session is already {}",
                session.status.as_str()
            )));
        }

        for file in &session.files {
            if file.uploaded_bytes != file.size {
                return Err(AppError::BadRequest(format!(
                    "Upload file {} is incomplete: {}/{} bytes",
                    file.relative_path, file.uploaded_bytes, file.size
                )));
            }
        }

        let session_dir = self.temp_root.join(session_id);
        let dest_dir = PathBuf::from(&session.dest_path);

        let file_rows = sqlx::query(
            "SELECT id, relative_path, temp_path, size
             FROM upload_session_files
             WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;

        for row in file_rows {
            let relative_path = row.try_get::<String, _>("relative_path")?;
            let temp_path = PathBuf::from(row.try_get::<String, _>("temp_path")?);
            let size = from_i64(row.try_get::<i64, _>("size")?)?;
            let dest_path = dest_dir.join(&relative_path);

            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).await.map_err(|err| {
                    AppError::Internal(format!(
                        "Failed to create destination directory {}: {}",
                        parent.display(),
                        err
                    ))
                })?;
            }

            match fs::metadata(&dest_path).await {
                Ok(metadata) if metadata.is_file() => {
                    fs::remove_file(&dest_path).await.map_err(|err| {
                        AppError::Internal(format!(
                            "Failed to replace destination file {}: {}",
                            dest_path.display(),
                            err
                        ))
                    })?;
                }
                Ok(_) => {
                    return Err(AppError::BadRequest(format!(
                        "Destination path is not a file: {}",
                        dest_path.display()
                    )));
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(AppError::Internal(format!(
                        "Failed to inspect destination file {}: {}",
                        dest_path.display(),
                        err
                    )))
                }
            }

            if size == 0 {
                fs::File::create(&dest_path).await.map_err(|err| {
                    AppError::Internal(format!(
                        "Failed to create empty uploaded file {}: {}",
                        dest_path.display(),
                        err
                    ))
                })?;
            } else {
                fs::rename(&temp_path, &dest_path).await.map_err(|err| {
                    AppError::Internal(format!(
                        "Failed to finalize upload {}: {}",
                        dest_path.display(),
                        err
                    ))
                })?;
            }
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE upload_session_files
             SET status = ?1, updated_at = datetime('now')
             WHERE session_id = ?2",
        )
        .bind(UploadFileStatus::Completed.as_str())
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE upload_sessions
             SET status = ?1,
                 completed_files = total_files,
                 uploaded_bytes = total_bytes,
                 error_message = NULL,
                 updated_at = datetime('now')
             WHERE id = ?2",
        )
        .bind(UploadSessionStatus::Completed.as_str())
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        let _ = fs::remove_dir_all(&session_dir).await;

        let session = self.get_session(session_id).await?;
        self.sync_task(&session).await;
        info!("Upload session completed: {}", session_id);
        Ok(session)
    }

    pub async fn cancel_session(&self, session_id: &str) -> Result<bool, AppError> {
        let session = match self.get_session(session_id).await {
            Ok(session) => session,
            Err(AppError::NotFound(_)) => return Ok(false),
            Err(err) => return Err(err),
        };

        if matches!(
            session.status,
            UploadSessionStatus::Completed | UploadSessionStatus::Cancelled
        ) {
            return Ok(false);
        }

        sqlx::query(
            "UPDATE upload_session_files
             SET status = ?1, updated_at = datetime('now')
             WHERE session_id = ?2 AND status != ?3",
        )
        .bind(UploadFileStatus::Cancelled.as_str())
        .bind(session_id)
        .bind(UploadFileStatus::Completed.as_str())
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "UPDATE upload_sessions
             SET status = ?1,
                 error_message = ?2,
                 updated_at = datetime('now')
             WHERE id = ?3",
        )
        .bind(UploadSessionStatus::Cancelled.as_str())
        .bind("Upload cancelled")
        .bind(session_id)
        .execute(&self.pool)
        .await?;

        let session_dir = self.temp_root.join(session_id);
        let _ = fs::remove_dir_all(&session_dir).await;

        let _ = self.task_manager.cancel_task(&session.task_id).await;
        Ok(true)
    }

    pub async fn cancel_session_by_task(&self, task_id: &str) -> Result<bool, AppError> {
        let session_id = sqlx::query_scalar::<_, String>(
            "SELECT id FROM upload_sessions WHERE task_id = ?1 LIMIT 1",
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await?;

        match session_id {
            Some(session_id) => self.cancel_session(&session_id).await,
            None => Ok(false),
        }
    }

    async fn refresh_session_progress(&self, session_id: &str) -> Result<UploadSession, AppError> {
        let aggregate = sqlx::query(
            "SELECT
                COALESCE(SUM(uploaded_bytes), 0) AS uploaded_bytes,
                COALESCE(SUM(CASE WHEN status IN ('uploaded', 'completed') THEN 1 ELSE 0 END), 0) AS completed_files
             FROM upload_session_files
             WHERE session_id = ?1",
        )
        .bind(session_id)
        .fetch_one(&self.pool)
        .await?;

        let uploaded_bytes = from_i64(aggregate.try_get::<i64, _>("uploaded_bytes")?)?;
        let completed_files = aggregate.try_get::<i64, _>("completed_files")?;

        sqlx::query(
            "UPDATE upload_sessions
             SET status = CASE
                    WHEN ?1 = total_bytes AND total_bytes > 0 THEN ?2
                    WHEN ?1 > 0 THEN ?3
                    ELSE status
                 END,
                 uploaded_bytes = ?1,
                 completed_files = ?4,
                 error_message = NULL,
                 updated_at = datetime('now')
             WHERE id = ?5",
        )
        .bind(to_i64(uploaded_bytes)?)
        .bind(UploadSessionStatus::Running.as_str())
        .bind(UploadSessionStatus::Running.as_str())
        .bind(completed_files)
        .bind(session_id)
        .execute(&self.pool)
        .await?;

        self.get_session(session_id).await
    }

    async fn sync_task(&self, session: &UploadSession) {
        let progress = Some(progress_percent(
            session.uploaded_bytes,
            session.total_bytes,
        ));
        let message = Some(format!(
            "{} / {} files, {} / {} bytes",
            session.completed_files,
            session.total_files,
            session.uploaded_bytes,
            session.total_bytes
        ));

        match session.status {
            UploadSessionStatus::Pending => {
                self.task_manager
                    .update_task(&session.task_id, TaskStatus::Pending, progress, message)
                    .await;
            }
            UploadSessionStatus::Running => {
                self.task_manager
                    .update_task(&session.task_id, TaskStatus::Running, progress, message)
                    .await;
            }
            UploadSessionStatus::Completed => {
                self.task_manager
                    .update_task(
                        &session.task_id,
                        TaskStatus::Completed,
                        Some(100),
                        Some(format!("{} file(s) uploaded", session.total_files)),
                    )
                    .await;
            }
            UploadSessionStatus::Failed => {
                self.task_manager
                    .update_task(
                        &session.task_id,
                        TaskStatus::Failed,
                        progress,
                        session.error_message.clone(),
                    )
                    .await;
            }
            UploadSessionStatus::Cancelled => {
                let _ = self.task_manager.cancel_task(&session.task_id).await;
            }
        }
    }
}

pub fn new_shared(
    pool: SqlitePool,
    task_manager: SharedTaskManager,
    temp_root: PathBuf,
) -> Result<SharedUploadManager, AppError> {
    Ok(Arc::new(UploadManager::new(pool, task_manager, temp_root)?))
}
