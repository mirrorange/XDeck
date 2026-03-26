use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use portable_pty::{ChildKiller, MasterPty, PtySize};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::error::AppError;

use super::types::{PtySessionExitedEvent, PtySessionInfo, PtySessionType, PtySessionTypeLabel};

pub struct PtySession {
    pub id: String,
    pub name: String,
    pub session_type: PtySessionType,
    pub(super) command: String,
    pub(super) writer: Mutex<Box<dyn Write + Send>>,
    pub(super) output_tx: broadcast::Sender<Bytes>,
    pub(super) scrollback: Arc<Mutex<ScrollbackBuffer>>,
    pub(super) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(super) killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>,
    pub(super) wait_task: Mutex<Option<JoinHandle<()>>>,
    pub(super) client_count: AtomicU32,
    pub(super) last_client_disconnect: Mutex<Option<Instant>>,
    pub(super) resize_state: Mutex<()>,
    pub(super) client_sizes: Mutex<HashMap<String, PtySize>>,
    pub(super) size: Mutex<PtySize>,
    pub(super) pid: Option<u32>,
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
        if let Some(mut killer) = self
            .killer
            .lock()
            .map_err(|_| AppError::Internal("PTY killer mutex poisoned".to_string()))?
            .take()
        {
            let _ = killer.kill();
        }

        let wait_task = self
            .wait_task
            .lock()
            .map_err(|_| AppError::Internal("PTY wait task mutex poisoned".to_string()))?
            .take();

        if let Some(wait_task) = wait_task {
            wait_task
                .await
                .map_err(|e| AppError::Internal(format!("Failed to join PTY close task: {}", e)))?;
        }

        Ok(())
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

    pub(super) fn exit_event_payload(&self) -> PtySessionExitedEvent {
        let (session_type, process_id) = match &self.session_type {
            PtySessionType::Terminal => (PtySessionTypeLabel::Terminal, None),
            PtySessionType::ProcessDaemon { process_id } => {
                (PtySessionTypeLabel::ProcessDaemon, Some(process_id.clone()))
            }
        };

        PtySessionExitedEvent {
            session_id: self.id.clone(),
            session_type,
            process_id,
            pid: self.pid,
            exit_code: 0,
            success: false,
        }
    }
}

pub(super) struct ScrollbackBuffer {
    buf: VecDeque<u8>,
    capacity: usize,
}

impl ScrollbackBuffer {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    pub(super) fn push(&mut self, data: &[u8]) {
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

    pub(super) fn get_all(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
    }
}
