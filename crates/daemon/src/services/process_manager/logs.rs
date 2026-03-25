use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use bytes::Bytes;
use chrono::Utc;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::process::Child;
use tokio::sync::broadcast;
use tracing::{error, warn};

use crate::error::AppError;
use crate::services::event_bus::SharedEventBus;

use super::log_utils::{rotate_log_files, stream_to_file_and_bus};
use super::{
    GetLogsRequest, LogLine, LogsResponse, ProcessLogConfig, ProcessManager, PtyReplayRequest,
    PtyReplayResponse,
};

impl ProcessManager {
    pub(super) fn spawn_log_tasks(
        event_bus: &SharedEventBus,
        child: &mut Child,
        process_id: &str,
        instance_idx: u32,
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
                    stdout,
                    &bus,
                    &pid_str,
                    instance_idx,
                    "stdout",
                    &log_path,
                    max_size,
                    max_files,
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
                    stderr,
                    &bus,
                    &pid_str,
                    instance_idx,
                    "stderr",
                    &log_path,
                    max_size,
                    max_files,
                )
                .await;
            });
        }
    }

    pub(super) fn spawn_pty_log_task(
        event_bus: SharedEventBus,
        mut output_rx: broadcast::Receiver<Bytes>,
        process_id: String,
        instance_idx: u32,
        log_dir: PathBuf,
        log_config: ProcessLogConfig,
    ) {
        tokio::spawn(async move {
            let log_path = log_dir.join("stdout.log");
            let raw_log_path = log_dir.join("pty_raw.log");
            let max_size = log_config.max_file_size;
            let max_files = log_config.max_files;

            let mut file = match tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .await
            {
                Ok(f) => f,
                Err(err) => {
                    error!("Failed to open PTY log file {:?}: {}", log_path, err);
                    return;
                }
            };

            let mut raw_file = match tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&raw_log_path)
                .await
            {
                Ok(f) => f,
                Err(err) => {
                    error!(
                        "Failed to open PTY raw log file {:?}: {}",
                        raw_log_path, err
                    );
                    return;
                }
            };

            let mut current_size = std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
            let mut raw_current_size = std::fs::metadata(&raw_log_path)
                .map(|m| m.len())
                .unwrap_or(0);
            let mut line_buf = String::new();

            loop {
                let chunk = match output_rx.recv().await {
                    Ok(bytes) => bytes,
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(
                            "PTY log subscriber lagged for process {} instance {} (skipped {})",
                            process_id, instance_idx, skipped
                        );
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                };

                if let Err(err) = raw_file.write_all(&chunk).await {
                    error!("Failed to write PTY raw log: {}", err);
                    return;
                }
                raw_current_size += chunk.len() as u64;

                if raw_current_size >= max_size {
                    let _ = raw_file.flush().await;
                    drop(raw_file);
                    rotate_log_files(&raw_log_path, max_files);
                    raw_file = match tokio::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&raw_log_path)
                        .await
                    {
                        Ok(f) => f,
                        Err(err) => {
                            error!("Failed to reopen PTY raw log file after rotation: {}", err);
                            return;
                        }
                    };
                    raw_current_size = 0;
                }

                line_buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(idx) = line_buf.find('\n') {
                    let mut line = line_buf[..idx].to_string();
                    if line.ends_with('\r') {
                        let _ = line.pop();
                    }

                    let log_line = format!("{}\n", line);
                    if let Err(err) = file.write_all(log_line.as_bytes()).await {
                        error!("Failed to write PTY log: {}", err);
                        return;
                    }
                    current_size += log_line.len() as u64;

                    event_bus.publish(
                        "process.log",
                        serde_json::json!({
                            "process_id": process_id,
                            "instance": instance_idx,
                            "stream": "stdout",
                            "line": line,
                            "timestamp": Utc::now().to_rfc3339(),
                        }),
                    );

                    if current_size >= max_size {
                        let _ = file.flush().await;
                        drop(file);
                        rotate_log_files(&log_path, max_files);
                        file = match tokio::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_path)
                            .await
                        {
                            Ok(f) => f,
                            Err(err) => {
                                error!("Failed to reopen PTY log file after rotation: {}", err);
                                return;
                            }
                        };
                        current_size = 0;
                    }

                    line_buf.drain(..=idx);
                }
            }

            if !line_buf.is_empty() {
                let final_line = std::mem::take(&mut line_buf);
                let _ = file.write_all(final_line.as_bytes()).await;
            }
        });
    }

    pub(super) fn publish_status_changed(
        &self,
        process_id: &str,
        instance_idx: u32,
        status: &str,
        pid: Option<u32>,
        exit_code: Option<i32>,
        pty_session_id: Option<&str>,
        message: Option<&str>,
    ) {
        self.event_bus.publish(
            "process.status_changed",
            serde_json::json!({
                "process_id": process_id,
                "instance": instance_idx,
                "status": status,
                "pid": pid,
                "exit_code": exit_code,
                "pty_session_id": pty_session_id,
                "message": message,
            }),
        );
    }

    pub async fn get_logs(&self, req: GetLogsRequest) -> Result<LogsResponse, AppError> {
        let definition = self
            .load_definition(&req.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", req.id)))?;

        let proc_log_dir = self
            .log_dir
            .join(&req.id)
            .join(format!("instance-{}", req.instance));

        if !self.instance_exists(&req.id, req.instance).await && !proc_log_dir.exists() {
            return Err(AppError::BadRequest(format!(
                "Instance {} out of range for process {}",
                req.instance, req.id
            )));
        }

        let mut all_lines: Vec<LogLine> = Vec::new();

        for stream in req.stream.as_slices() {
            for i in (1..=definition.log_config.max_files).rev() {
                let rotated = proc_log_dir.join(format!("{}.log.{}", stream, i));
                if rotated.exists() {
                    if let Ok(content) = tokio::fs::read_to_string(&rotated).await {
                        for line_str in content.lines() {
                            all_lines.push(LogLine {
                                stream: stream.to_string(),
                                line: line_str.to_string(),
                                timestamp: None,
                            });
                        }
                    }
                }
            }

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

        Ok(LogsResponse {
            process_id: req.id,
            instance: req.instance,
            lines: all_lines
                .into_iter()
                .skip(start)
                .take(end - start)
                .collect(),
            has_more: start > 0,
            total_lines: total,
        })
    }

    pub async fn get_pty_replay(
        &self,
        req: PtyReplayRequest,
    ) -> Result<PtyReplayResponse, AppError> {
        let _definition = self
            .load_definition(&req.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", req.id)))?;

        let raw_log_path = self
            .log_dir
            .join(&req.id)
            .join(format!("instance-{}", req.instance))
            .join("pty_raw.log");

        if !self.instance_exists(&req.id, req.instance).await
            && !raw_log_path
                .parent()
                .map(|dir| dir.exists())
                .unwrap_or(false)
        {
            return Err(AppError::BadRequest(format!(
                "Instance {} out of range for process {}",
                req.instance, req.id
            )));
        }

        if !raw_log_path.exists() {
            return Ok(PtyReplayResponse {
                process_id: req.id,
                instance: req.instance,
                data: String::new(),
                total_size: 0,
                offset: 0,
                length: 0,
            });
        }

        let total_size = tokio::fs::metadata(&raw_log_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        if req.offset >= total_size {
            return Ok(PtyReplayResponse {
                process_id: req.id,
                instance: req.instance,
                data: String::new(),
                total_size,
                offset: req.offset,
                length: 0,
            });
        }

        const MAX_READ: u64 = 512 * 1024;
        let actual_length = req.length.min(MAX_READ).min(total_size - req.offset);

        let mut file = tokio::fs::File::open(&raw_log_path)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to open PTY raw log: {}", e)))?;

        file.seek(std::io::SeekFrom::Start(req.offset))
            .await
            .map_err(|e| AppError::Internal(format!("Failed to seek PTY raw log: {}", e)))?;

        let mut buf = vec![0u8; actual_length as usize];
        let bytes_read = file
            .read(&mut buf)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to read PTY raw log: {}", e)))?;
        buf.truncate(bytes_read);

        Ok(PtyReplayResponse {
            process_id: req.id,
            instance: req.instance,
            data: BASE64.encode(&buf),
            total_size,
            offset: req.offset,
            length: bytes_read as u64,
        })
    }
}
