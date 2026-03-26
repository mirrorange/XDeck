use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use tokio::sync::oneshot;
use tracing::{debug, info, warn};

use crate::error::AppError;
use crate::services::event_bus::SharedEventBus;

use super::session::PtySession;
use super::types::PtySessionInfo;

const IDLE_REAPER_INTERVAL: Duration = Duration::from_secs(30);

pub struct PtyManager {
    pub(super) sessions: DashMap<String, Arc<PtySession>>,
    pub(super) event_bus: SharedEventBus,
    pub(super) idle_timeout: Duration,
}

impl PtyManager {
    pub fn new(event_bus: SharedEventBus, idle_timeout: Duration) -> Arc<Self> {
        Arc::new(Self {
            sessions: DashMap::new(),
            event_bus,
            idle_timeout,
        })
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

    pub(super) fn spawn_exit_cleanup_task(
        self: &Arc<Self>,
        session_id: String,
        exit_rx: oneshot::Receiver<()>,
    ) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            if exit_rx.await.is_err() {
                return;
            }

            match manager.close_session(&session_id).await {
                Ok(()) => debug!("Closed exited PTY session {}", session_id),
                Err(AppError::NotFound(_)) => {
                    debug!(
                        "PTY session {} already closed before exit cleanup",
                        session_id
                    )
                }
                Err(err) => warn!("Failed to close exited PTY session {}: {}", session_id, err),
            }
        });
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
                        let is_terminal =
                            matches!(session.session_type, super::types::PtySessionType::Terminal);
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
