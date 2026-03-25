use std::path::Path;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{debug, error};

use crate::services::event_bus::SharedEventBus;

/// Stream from an async reader to both a log file (with rotation) and the event bus.
pub(super) async fn stream_to_file_and_bus<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    bus: &SharedEventBus,
    process_id: &str,
    instance_idx: u32,
    stream_name: &str,
    log_path: &Path,
    max_file_size: u64,
    max_files: u32,
) {
    let mut buf_reader = BufReader::new(reader);
    let mut line_buf = String::new();

    let file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .await;

    let mut file = match file {
        Ok(file) => file,
        Err(err) => {
            error!("Failed to open log file {:?}: {}", log_path, err);
            let mut lines = BufReader::new(buf_reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                bus.publish(
                    "process.log",
                    serde_json::json!({
                        "process_id": process_id,
                        "instance": instance_idx,
                        "stream": stream_name,
                        "line": line,
                    }),
                );
            }
            return;
        }
    };

    let mut current_size = std::fs::metadata(log_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    loop {
        line_buf.clear();
        match buf_reader.read_line(&mut line_buf).await {
            Ok(0) => break,
            Ok(_) => {
                let line = line_buf.trim_end_matches('\n').trim_end_matches('\r');

                let log_line = format!("{}\n", line);
                if let Err(err) = file.write_all(log_line.as_bytes()).await {
                    error!("Failed to write to log: {}", err);
                }
                current_size += log_line.len() as u64;

                if current_size >= max_file_size {
                    let _ = file.flush().await;
                    drop(file);

                    rotate_log_files(log_path, max_files);
                    current_size = 0;

                    file = match tokio::fs::OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(log_path)
                        .await
                    {
                        Ok(file) => file,
                        Err(err) => {
                            error!("Failed to reopen log file after rotation: {}", err);
                            return;
                        }
                    };
                }

                bus.publish(
                    "process.log",
                    serde_json::json!({
                        "process_id": process_id,
                        "instance": instance_idx,
                        "stream": stream_name,
                        "line": line,
                    }),
                );
            }
            Err(err) => {
                debug!(
                    "Log stream read error for {}/{}/{}: {}",
                    process_id, instance_idx, stream_name, err
                );
                break;
            }
        }
    }
}

/// Rotate log files: file.log -> file.log.1, file.log.1 -> file.log.2, etc.
pub(super) fn rotate_log_files(log_path: &Path, max_files: u32) {
    let oldest = format!("{}.{}", log_path.display(), max_files);
    let _ = std::fs::remove_file(&oldest);

    for index in (1..max_files).rev() {
        let from = format!("{}.{}", log_path.display(), index);
        let to = format!("{}.{}", log_path.display(), index + 1);
        if Path::new(&from).exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }

    let first_rotated = format!("{}.1", log_path.display());
    let _ = std::fs::rename(log_path, &first_rotated);
}

/// Resolve a username to (uid, gid) on Unix.
#[cfg(unix)]
pub(super) fn resolve_username(username: &str) -> Option<(u32, u32)> {
    use std::ffi::CString;

    let c_name = CString::new(username).ok()?;
    unsafe {
        let pw = libc::getpwnam(c_name.as_ptr());
        if pw.is_null() {
            None
        } else {
            Some(((*pw).pw_uid, (*pw).pw_gid))
        }
    }
}
