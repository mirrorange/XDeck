use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::event_bus::SharedEventBus;

const DEFAULT_OUTPUT_CHANNEL_CAPACITY: usize = 512;
const DEFAULT_SCROLLBACK_CAPACITY: usize = 64 * 1024;
const IDLE_REAPER_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtySessionType {
    Terminal,
    ProcessDaemon { process_id: String },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtyChildExitState {
    pub exit_code: i32,
    pub success: bool,
}

pub struct PtySession {
    pub id: String,
    pub name: String,
    pub session_type: PtySessionType,
    command: String,
    writer: Mutex<Box<dyn Write + Send>>,
    output_tx: broadcast::Sender<Bytes>,
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    client_count: AtomicU32,
    last_client_disconnect: Mutex<Option<Instant>>,
    resize_state: Mutex<()>,
    client_sizes: Mutex<HashMap<String, PtySize>>,
    size: Mutex<PtySize>,
    pid: Option<u32>,
    pub created_at: DateTime<Utc>,
}

impl PtySession {
    fn apply_size(&self, size: PtySize) -> Result<(), AppError> {
        {
            let current = self
                .size
                .lock()
                .map_err(|_| AppError::Internal("PTY size mutex poisoned".to_string()))?;
            if current.cols == size.cols && current.rows == size.rows {
                return Ok(());
            }
        }

        {
            let master = self
                .master
                .lock()
                .map_err(|_| AppError::Internal("PTY master mutex poisoned".to_string()))?;
            master
                .resize(size)
                .map_err(|e| AppError::Internal(format!("Failed to resize PTY: {}", e)))?;
        }

        let mut current_size = self
            .size
            .lock()
            .map_err(|_| AppError::Internal("PTY size mutex poisoned".to_string()))?;
        *current_size = size;

        Ok(())
    }

    fn min_size_from_clients(client_sizes: &HashMap<String, PtySize>) -> Option<PtySize> {
        let cols = client_sizes.values().map(|size| size.cols).min()?;
        let rows = client_sizes.values().map(|size| size.rows).min()?;
        Some(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), AppError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AppError::Internal("PTY writer mutex poisoned".to_string()))?;
        writer
            .write_all(data)
            .map_err(|e| AppError::Internal(format!("Failed to write PTY input: {}", e)))?;
        writer
            .flush()
            .map_err(|e| AppError::Internal(format!("Failed to flush PTY input: {}", e)))?;
        Ok(())
    }

    pub fn subscribe_output(&self) -> broadcast::Receiver<Bytes> {
        self.output_tx.subscribe()
    }

    pub fn get_scrollback(&self) -> Vec<u8> {
        self.scrollback
            .lock()
            .map(|buf| buf.get_all())
            .unwrap_or_default()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        if cols == 0 || rows == 0 {
            return Err(AppError::BadRequest(
                "PTY size cols/rows must be greater than 0".to_string(),
            ));
        }
        let _resize_guard = self
            .resize_state
            .lock()
            .map_err(|_| AppError::Internal("PTY resize mutex poisoned".to_string()))?;

        let size = PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        };

        self.apply_size(size)?;

        if let Ok(mut client_sizes) = self.client_sizes.lock() {
            for client_size in client_sizes.values_mut() {
                *client_size = size;
            }
        }

        Ok(())
    }

    pub fn resize_for_client(&self, client_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        if cols == 0 || rows == 0 {
            return Err(AppError::BadRequest(
                "PTY size cols/rows must be greater than 0".to_string(),
            ));
        }
        let _resize_guard = self
            .resize_state
            .lock()
            .map_err(|_| AppError::Internal("PTY resize mutex poisoned".to_string()))?;

        let target_size = {
            let mut client_sizes = self
                .client_sizes
                .lock()
                .map_err(|_| AppError::Internal("PTY client size mutex poisoned".to_string()))?;

            client_sizes.insert(
                client_id.to_string(),
                PtySize {
                    cols,
                    rows,
                    pixel_width: 0,
                    pixel_height: 0,
                },
            );
            Self::min_size_from_clients(&client_sizes).ok_or_else(|| {
                AppError::Internal("Failed to compute PTY size from connected clients".to_string())
            })?
        };

        self.apply_size(target_size)?;
        Ok(())
    }

    pub fn client_connected(&self, client_id: &str) -> Result<(), AppError> {
        let _resize_guard = self
            .resize_state
            .lock()
            .map_err(|_| AppError::Internal("PTY resize mutex poisoned".to_string()))?;
        let size = *self
            .size
            .lock()
            .map_err(|_| AppError::Internal("PTY size mutex poisoned".to_string()))?;
        let mut client_sizes = self
            .client_sizes
            .lock()
            .map_err(|_| AppError::Internal("PTY client size mutex poisoned".to_string()))?;
        client_sizes.insert(client_id.to_string(), size);

        self.client_count.fetch_add(1, Ordering::SeqCst);
        let mut last_disconnect = self
            .last_client_disconnect
            .lock()
            .map_err(|_| AppError::Internal("PTY disconnect mutex poisoned".to_string()))?;
        *last_disconnect = None;
        Ok(())
    }

    pub fn client_disconnected(&self, client_id: &str) -> Result<(), AppError> {
        let prev = self.client_count.fetch_sub(1, Ordering::SeqCst);
        if prev <= 1 {
            self.client_count.store(0, Ordering::SeqCst);
            let mut last_disconnect = self
                .last_client_disconnect
                .lock()
                .map_err(|_| AppError::Internal("PTY disconnect mutex poisoned".to_string()))?;
            *last_disconnect = Some(Instant::now());
        }
        let _resize_guard = self
            .resize_state
            .lock()
            .map_err(|_| AppError::Internal("PTY resize mutex poisoned".to_string()))?;

        let target_size = {
            let mut client_sizes = self
                .client_sizes
                .lock()
                .map_err(|_| AppError::Internal("PTY client size mutex poisoned".to_string()))?;
            client_sizes.remove(client_id);
            Self::min_size_from_clients(&client_sizes)
        };

        if let Some(size) = target_size {
            self.apply_size(size)?;
        }

        Ok(())
    }

    pub fn client_count(&self) -> u32 {
        self.client_count.load(Ordering::SeqCst)
    }

    pub fn is_idle_timeout(&self, timeout: Duration) -> bool {
        if self.client_count() > 0 {
            return false;
        }

        self.last_client_disconnect
            .lock()
            .ok()
            .and_then(|v| *v)
            .is_some_and(|when| when.elapsed() >= timeout)
    }

    pub async fn close(&self) -> Result<(), AppError> {
        let child = self
            .child
            .lock()
            .map_err(|_| AppError::Internal("PTY child mutex poisoned".to_string()))?
            .take();

        if let Some(mut child) = child {
            tokio::task::spawn_blocking(move || {
                let _ = child.kill();
                let _ = child.wait();
            })
            .await
            .map_err(|e| AppError::Internal(format!("Failed to join PTY close task: {}", e)))?;
        }

        Ok(())
    }

    pub fn try_wait_child(&self) -> Result<Option<PtyChildExitState>, AppError> {
        let mut child_guard = self
            .child
            .lock()
            .map_err(|_| AppError::Internal("PTY child mutex poisoned".to_string()))?;
        let Some(child) = child_guard.as_mut() else {
            return Ok(None);
        };

        let status = child
            .try_wait()
            .map_err(|e| AppError::Internal(format!("Failed to poll PTY child status: {}", e)))?;
        let Some(status) = status else {
            return Ok(None);
        };

        let exit_code = status.exit_code().min(i32::MAX as u32) as i32;
        let success = status.success();
        *child_guard = None;

        Ok(Some(PtyChildExitState { exit_code, success }))
    }

    pub fn info(&self) -> PtySessionInfo {
        let (session_type, process_id) = match &self.session_type {
            PtySessionType::Terminal => (PtySessionTypeLabel::Terminal, None),
            PtySessionType::ProcessDaemon { process_id } => {
                (PtySessionTypeLabel::ProcessDaemon, Some(process_id.clone()))
            }
        };
        let size = self.size.lock().map(|v| *v).unwrap_or(PtySize {
            cols: 80,
            rows: 24,
            pixel_width: 0,
            pixel_height: 0,
        });

        PtySessionInfo {
            session_id: self.id.clone(),
            name: self.name.clone(),
            session_type,
            process_id,
            command: self.command.clone(),
            cols: size.cols,
            rows: size.rows,
            client_count: self.client_count(),
            pid: self.pid,
            created_at: self.created_at.to_rfc3339(),
        }
    }
}

/// Ring buffer for PTY output scrollback.
struct ScrollbackBuffer {
    buf: VecDeque<u8>,
    capacity: usize,
}

impl ScrollbackBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, data: &[u8]) {
        if data.len() >= self.capacity {
            self.buf.clear();
            self.buf.extend(
                data[data.len().saturating_sub(self.capacity)..]
                    .iter()
                    .copied(),
            );
            return;
        }

        while self.buf.len() + data.len() > self.capacity {
            let _ = self.buf.pop_front();
        }
        self.buf.extend(data.iter().copied());
    }

    fn get_all(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
    }
}

/// Manages lifecycle of active PTY sessions.
pub struct PtyManager {
    sessions: DashMap<String, Arc<PtySession>>,
    event_bus: SharedEventBus,
    idle_timeout: Duration,
}

impl PtyManager {
    pub fn new(event_bus: SharedEventBus, idle_timeout: Duration) -> Arc<Self> {
        Arc::new(Self {
            sessions: DashMap::new(),
            event_bus,
            idle_timeout,
        })
    }

    pub async fn create_session(&self, req: CreatePtyRequest) -> Result<PtySessionInfo, AppError> {
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

        let session = Arc::new(PtySession {
            id: session_id.clone(),
            name: session_name,
            session_type: req.session_type,
            command: req.command,
            writer: Mutex::new(writer),
            output_tx: output_tx.clone(),
            scrollback: scrollback.clone(),
            master: Mutex::new(master),
            child: Mutex::new(Some(child)),
            client_count: AtomicU32::new(0),
            last_client_disconnect: Mutex::new(None),
            resize_state: Mutex::new(()),
            client_sizes: Mutex::new(HashMap::new()),
            size: Mutex::new(size),
            pid,
            created_at: Utc::now(),
        });

        pty_output_loop(reader, output_tx, scrollback);

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

    pub fn list_sessions(&self) -> Vec<PtySessionInfo> {
        self.sessions
            .iter()
            .map(|item| item.value().info())
            .collect()
    }

    pub fn get_session(&self, session_id: &str) -> Option<PtySessionInfo> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.value().info())
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let Some(session) = self.sessions.get(session_id) else {
            return Err(AppError::NotFound(format!(
                "PTY session not found: {}",
                session_id
            )));
        };
        session.resize(cols, rows)
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), AppError> {
        let Some((_, session)) = self.sessions.remove(session_id) else {
            return Err(AppError::NotFound(format!(
                "PTY session not found: {}",
                session_id
            )));
        };

        session.close().await?;
        self.event_bus.publish(
            "pty.session_closed",
            serde_json::json!({
                "session_id": session_id,
            }),
        );
        info!("Closed PTY session {}", session_id);
        Ok(())
    }

    pub fn get_session_handle(&self, session_id: &str) -> Option<Arc<PtySession>> {
        self.sessions
            .get(session_id)
            .map(|entry| Arc::clone(entry.value()))
    }

    pub fn poll_session_exit(
        &self,
        session_id: &str,
    ) -> Result<Option<PtyChildExitState>, AppError> {
        let Some(session) = self.get_session_handle(session_id) else {
            return Err(AppError::NotFound(format!(
                "PTY session not found: {}",
                session_id
            )));
        };
        session.try_wait_child()
    }

    pub fn start_idle_reaper(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(IDLE_REAPER_INTERVAL).await;

                let expired: Vec<String> = manager
                    .sessions
                    .iter()
                    .filter_map(|entry| {
                        let session = entry.value();
                        let is_terminal = matches!(session.session_type, PtySessionType::Terminal);
                        if is_terminal && session.is_idle_timeout(manager.idle_timeout) {
                            Some(entry.key().clone())
                        } else {
                            None
                        }
                    })
                    .collect();

                for session_id in expired {
                    if let Err(err) = manager.close_session(&session_id).await {
                        warn!("Failed to close idle PTY session {}: {}", session_id, err);
                    } else {
                        debug!("Reaped idle PTY session {}", session_id);
                    }
                }
            }
        });
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::event_bus::EventBus;

    fn manager_for_test() -> Arc<PtyManager> {
        PtyManager::new(Arc::new(EventBus::default()), Duration::from_secs(30 * 60))
    }

    fn shell_command() -> String {
        if cfg!(windows) {
            "cmd.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        }
    }

    #[cfg(unix)]
    fn cat_command() -> String {
        "/bin/cat".to_string()
    }

    #[test]
    fn test_scrollback_buffer_capacity() {
        let mut buf = ScrollbackBuffer::new(8);
        buf.push(b"1234");
        buf.push(b"5678");
        buf.push(b"90");
        assert_eq!(buf.get_all(), b"34567890");
    }

    #[tokio::test]
    async fn test_create_and_close_session() {
        let manager = manager_for_test();
        let created = manager
            .create_session(CreatePtyRequest {
                name: Some("test-session".to_string()),
                session_type: PtySessionType::Terminal,
                command: shell_command(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();

        assert_eq!(created.name, "test-session");
        assert!(manager.get_session(&created.session_id).is_some());

        manager.close_session(&created.session_id).await.unwrap();
        assert!(manager.get_session(&created.session_id).is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_session_write_and_read() {
        let manager = manager_for_test();
        let created = manager
            .create_session(CreatePtyRequest {
                name: Some("cat-session".to_string()),
                session_type: PtySessionType::ProcessDaemon {
                    process_id: "proc-1".to_string(),
                },
                command: cat_command(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();

        let session = manager.get_session_handle(&created.session_id).unwrap();
        let mut rx = session.subscribe_output();

        session.write(b"hello-pty\n").unwrap();

        let received = tokio::time::timeout(Duration::from_secs(3), async move {
            loop {
                let data = rx.recv().await.unwrap_or_else(|_| Bytes::new());
                if String::from_utf8_lossy(&data).contains("hello-pty") {
                    break true;
                }
            }
        })
        .await
        .unwrap();

        assert!(received);
        manager.close_session(&created.session_id).await.unwrap();
    }

    #[tokio::test]
    async fn test_client_count_tracking() {
        let manager = manager_for_test();
        let created = manager
            .create_session(CreatePtyRequest {
                name: Some("client-count-session".to_string()),
                session_type: PtySessionType::Terminal,
                command: shell_command(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();

        let session = manager.get_session_handle(&created.session_id).unwrap();
        assert_eq!(session.client_count(), 0);

        session.client_connected("client-1").unwrap();
        session.client_connected("client-2").unwrap();
        assert_eq!(session.client_count(), 2);

        session.client_disconnected("client-1").unwrap();
        assert_eq!(session.client_count(), 1);
        session.client_disconnected("client-2").unwrap();
        assert_eq!(session.client_count(), 0);

        manager.close_session(&created.session_id).await.unwrap();
    }

    #[tokio::test]
    async fn test_multi_client_resize_uses_minimum_size() {
        let manager = manager_for_test();
        let created = manager
            .create_session(CreatePtyRequest {
                name: Some("multi-client-resize".to_string()),
                session_type: PtySessionType::Terminal,
                command: shell_command(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 120,
                rows: 40,
            })
            .await
            .unwrap();

        let session = manager.get_session_handle(&created.session_id).unwrap();
        session.client_connected("client-1").unwrap();
        session.resize_for_client("client-1", 120, 40).unwrap();

        session.client_connected("client-2").unwrap();
        session.resize_for_client("client-2", 80, 24).unwrap();

        let info = session.info();
        assert_eq!(info.cols, 80);
        assert_eq!(info.rows, 24);

        session.client_disconnected("client-2").unwrap();

        let info = session.info();
        assert_eq!(info.cols, 120);
        assert_eq!(info.rows, 40);

        manager.close_session(&created.session_id).await.unwrap();
    }

    #[tokio::test]
    async fn test_idle_timeout_detection() {
        let manager = manager_for_test();
        let created = manager
            .create_session(CreatePtyRequest {
                name: Some("idle-session".to_string()),
                session_type: PtySessionType::Terminal,
                command: shell_command(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();

        let session = manager.get_session_handle(&created.session_id).unwrap();
        session.client_connected("client-1").unwrap();
        session.client_disconnected("client-1").unwrap();

        assert!(!session.is_idle_timeout(Duration::from_secs(1)));
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert!(session.is_idle_timeout(Duration::from_millis(10)));

        manager.close_session(&created.session_id).await.unwrap();
    }

    #[tokio::test]
    async fn test_session_created_event_contains_session_info() {
        let manager = manager_for_test();
        let mut events = manager.event_bus.subscribe();

        let created = manager
            .create_session(CreatePtyRequest {
                name: Some("event-payload-session".to_string()),
                session_type: PtySessionType::Terminal,
                command: shell_command(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();

        let event = tokio::time::timeout(Duration::from_secs(3), events.recv())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(event.topic, "pty.session_created");
        assert_eq!(event.payload["session_id"], created.session_id);
        assert_eq!(event.payload["name"], created.name);
        assert_eq!(event.payload["command"], created.command);
        assert_eq!(event.payload["cols"], created.cols);
        assert_eq!(event.payload["rows"], created.rows);
        assert_eq!(event.payload["session_type"], "terminal");

        manager.close_session(&created.session_id).await.unwrap();
    }
}
