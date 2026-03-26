use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use chrono::Utc;
use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use tokio::sync::{broadcast, oneshot};
use tokio::task::JoinHandle;
use tracing::{info, warn};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::event_bus::SharedEventBus;

use super::manager::PtyManager;
use super::session::{PtySession, ScrollbackBuffer};
use super::types::{
    CreatePtyRequest, PtySessionExitedEvent, PtySessionType, PTY_SESSION_EXITED_TOPIC,
};

const DEFAULT_OUTPUT_CHANNEL_CAPACITY: usize = 512;
const DEFAULT_SCROLLBACK_CAPACITY: usize = 64 * 1024;

impl PtyManager {
    pub async fn create_session(
        self: &Arc<Self>,
        req: CreatePtyRequest,
    ) -> Result<super::types::PtySessionInfo, AppError> {
        if req.cols == 0 || req.rows == 0 {
            return Err(AppError::BadRequest(
                "cols and rows must be greater than 0".to_string(),
            ));
        }
        if req.command.trim().is_empty() {
            return Err(AppError::BadRequest(
                "command must not be empty".to_string(),
            ));
        }

        let session_id = Uuid::new_v4().to_string();
        let default_name = match &req.session_type {
            PtySessionType::Terminal => format!("terminal-{}", &session_id[..8]),
            PtySessionType::ProcessDaemon { process_id } => {
                format!("process-{}-{}", process_id, &session_id[..8])
            }
        };
        let session_name = req.name.unwrap_or(default_name);
        let size = PtySize {
            rows: req.rows,
            cols: req.cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let output_tx = broadcast::channel(DEFAULT_OUTPUT_CHANNEL_CAPACITY).0;
        let scrollback = Arc::new(Mutex::new(ScrollbackBuffer::new(
            DEFAULT_SCROLLBACK_CAPACITY,
        )));

        let command = req.command.clone();
        let args = req.args.clone();
        let cwd = req.cwd.clone();
        let env = req.env.clone();

        let (master, child, reader, writer, pid) =
            tokio::task::spawn_blocking(move || {
                let pty_system = native_pty_system();
                let pair = pty_system
                    .openpty(size)
                    .map_err(|e| AppError::Internal(format!("Failed to create PTY: {}", e)))?;

                let mut cmd = CommandBuilder::new(&command);
                for arg in args {
                    cmd.arg(arg);
                }
                if let Some(cwd) = cwd {
                    cmd.cwd(cwd);
                }
                for (key, value) in env {
                    cmd.env(key, value);
                }

                let child = pair.slave.spawn_command(cmd).map_err(|e| {
                    AppError::Internal(format!("Failed to spawn PTY command: {}", e))
                })?;
                let pid = child.process_id();
                let reader = pair.master.try_clone_reader().map_err(|e| {
                    AppError::Internal(format!("Failed to clone PTY reader: {}", e))
                })?;
                let writer = pair
                    .master
                    .take_writer()
                    .map_err(|e| AppError::Internal(format!("Failed to get PTY writer: {}", e)))?;

                Ok::<_, AppError>((pair.master, child, reader, writer, pid))
            })
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create PTY task: {}", e)))??;

        let killer = child.clone_killer();
        let session = Arc::new(PtySession {
            id: session_id.clone(),
            name: session_name,
            session_type: req.session_type,
            command: req.command,
            writer: Mutex::new(writer),
            output_tx: output_tx.clone(),
            scrollback: scrollback.clone(),
            master: Mutex::new(master),
            killer: Mutex::new(Some(killer)),
            wait_task: Mutex::new(None),
            client_count: std::sync::atomic::AtomicU32::new(0),
            last_client_disconnect: Mutex::new(None),
            resize_state: Mutex::new(()),
            client_sizes: Mutex::new(HashMap::new()),
            size: Mutex::new(size),
            pid,
            created_at: Utc::now(),
        });

        pty_output_loop(reader, output_tx, scrollback);
        let (exit_tx, exit_rx) = oneshot::channel();
        let wait_task = pty_child_wait_loop(
            child,
            self.event_bus.clone(),
            session.exit_event_payload(),
            exit_tx,
        );
        if let Ok(mut wait_task_guard) = session.wait_task.lock() {
            *wait_task_guard = Some(wait_task);
        }

        self.spawn_exit_cleanup_task(session_id.clone(), exit_rx);

        self.sessions.insert(session_id.clone(), session.clone());
        let info = session.info();

        self.event_bus.publish(
            "pty.session_created",
            serde_json::to_value(&info).unwrap_or_else(|_| {
                serde_json::json!({
                    "session_id": info.session_id,
                })
            }),
        );
        info!("Created PTY session {}", info.session_id);

        Ok(info)
    }
}

fn pty_output_loop(
    mut reader: Box<dyn Read + Send>,
    output_tx: broadcast::Sender<Bytes>,
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
) {
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = &buf[..n];
                    if let Ok(mut sb) = scrollback.lock() {
                        sb.push(data);
                    }
                    let _ = output_tx.send(Bytes::copy_from_slice(data));
                }
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {
                    continue;
                }
                Err(err) => {
                    warn!("PTY output read failed: {}", err);
                    break;
                }
            }
        }
    });
}

fn pty_child_wait_loop(
    mut child: Box<dyn Child + Send + Sync>,
    event_bus: SharedEventBus,
    mut payload: PtySessionExitedEvent,
    exit_tx: oneshot::Sender<()>,
) -> JoinHandle<()> {
    tokio::task::spawn_blocking(move || match child.wait() {
        Ok(status) => {
            payload.exit_code = status.exit_code().min(i32::MAX as u32) as i32;
            payload.success = status.success();
            event_bus.publish(
                PTY_SESSION_EXITED_TOPIC,
                serde_json::to_value(&payload).unwrap_or_else(|_| {
                    serde_json::json!({
                        "session_id": payload.session_id,
                        "exit_code": payload.exit_code,
                        "success": payload.success,
                    })
                }),
            );
            info!(
                "PTY session {} exited with code {}",
                payload.session_id, payload.exit_code
            );
            let _ = exit_tx.send(());
        }
        Err(err) => {
            warn!(
                "Failed waiting for PTY session {} child exit: {}",
                payload.session_id, err
            );
        }
    })
}
