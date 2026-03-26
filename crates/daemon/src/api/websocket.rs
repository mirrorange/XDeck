use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

use crate::error::AppError;
use crate::rpc::event_handlers::topic_matches_pattern;
use crate::rpc::router::{RequestContext, SessionAccess};
use crate::rpc::types::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};

use super::AppState;

#[derive(Default)]
struct WsSessionInner {
    authenticated_user_id: Option<String>,
    subscribed_topics: HashSet<String>,
}

#[derive(Clone, Default)]
pub(crate) struct WsSession {
    inner: Arc<Mutex<WsSessionInner>>,
}

impl WsSession {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(WsSessionInner::default())),
        }
    }
}

impl SessionAccess for WsSession {
    fn set_authenticated_user(&self, user_id: String) {
        self.inner.lock().unwrap().authenticated_user_id = Some(user_id);
    }

    fn get_authenticated_user(&self) -> Option<String> {
        self.inner.lock().unwrap().authenticated_user_id.clone()
    }

    fn subscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError> {
        if topics.is_empty() {
            return Err(AppError::BadRequest(
                "topics must contain at least one topic".into(),
            ));
        }

        let mut inner = self.inner.lock().unwrap();
        for topic in topics {
            inner.subscribed_topics.insert(topic);
        }

        Ok(())
    }

    fn unsubscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError> {
        let mut inner = self.inner.lock().unwrap();

        if topics.is_empty() {
            inner.subscribed_topics.clear();
            return Ok(());
        }

        for topic in topics {
            inner.subscribed_topics.remove(&topic);
        }

        Ok(())
    }

    fn get_subscribed_topics(&self) -> Vec<String> {
        let inner = self.inner.lock().unwrap();
        let mut topics: Vec<String> = inner.subscribed_topics.iter().cloned().collect();
        topics.sort();
        topics
    }

    fn is_subscribed_to(&self, topic: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        inner
            .subscribed_topics
            .iter()
            .any(|pattern| topic_matches_pattern(pattern, topic))
    }
}

/// WebSocket upgrade handler.
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Handle a single WebSocket connection.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let session = Arc::new(WsSession::new());
    let mut event_rx = state.event_bus.subscribe();

    info!("WebSocket client connected");

    loop {
        tokio::select! {
            message = ws_receiver.next() => {
                let Some(message) = message else {
                    break;
                };

                let should_continue = handle_client_message(
                    message,
                    &mut ws_sender,
                    &state,
                    &session,
                ).await;

                if !should_continue {
                    break;
                }
            }
            event = event_rx.recv() => {
                match event {
                    Ok(event) => {
                        if !session.is_subscribed_to(&event.topic) {
                            continue;
                        }

                        let notification = JsonRpcNotification::new(
                            format!("event.{}", event.topic),
                            event.payload,
                        );

                        match serde_json::to_string(&notification) {
                            Ok(json) => {
                                if ws_sender.send(Message::Text(json.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(err) => {
                                error!("Failed to serialize event notification: {}", err);
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!("Event stream lagged, skipped {} messages", skipped);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        warn!("Event stream closed");
                        break;
                    }
                }
            }
        }
    }

    info!("WebSocket connection closed");
}

async fn handle_client_message(
    msg: Result<Message, axum::Error>,
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    state: &AppState,
    session: &Arc<WsSession>,
) -> bool {
    let msg = match msg {
        Ok(msg) => msg,
        Err(e) => {
            warn!("WebSocket receive error: {}", e);
            return false;
        }
    };

    match msg {
        Message::Text(text) => {
            let request: JsonRpcRequest = match serde_json::from_str(&text) {
                Ok(req) => req,
                Err(e) => {
                    error!("Invalid JSON-RPC request: {}", e);
                    let err_resp = JsonRpcResponse::error(
                        None,
                        crate::error::error_codes::PARSE_ERROR,
                        format!("Parse error: {}", e),
                    );
                    return send_response(ws_sender, &err_resp).await.is_ok();
                }
            };

            let session_access: Arc<dyn SessionAccess> = session.clone();
            let ctx = RequestContext::with_session(
                session.get_authenticated_user(),
                state.pool.clone(),
                session_access,
            );

            if let Some(response) = state.rpc_router.dispatch(request, ctx).await {
                debug!("RPC response queued");
                if send_response(ws_sender, &response).await.is_err() {
                    return false;
                }
            }

            true
        }
        Message::Ping(payload) => {
            debug!("Received ping");
            ws_sender.send(Message::Pong(payload)).await.is_ok()
        }
        Message::Close(_) => {
            info!("WebSocket client disconnected");
            false
        }
        Message::Pong(_) => {
            debug!("Received pong");
            true
        }
        _ => true,
    }
}

async fn send_response(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    response: &JsonRpcResponse,
) -> Result<(), ()> {
    let json = match serde_json::to_string(response) {
        Ok(json) => json,
        Err(err) => {
            error!("Failed to serialize RPC response: {}", err);
            return Ok(());
        }
    };

    ws_sender
        .send(Message::Text(json.into()))
        .await
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ws_session_subscribe_and_match() {
        let session = WsSession::new();

        session
            .subscribe_topics(vec!["process.*".to_string(), "system.metrics".to_string()])
            .unwrap();

        assert!(session.is_subscribed_to("process.log"));
        assert!(session.is_subscribed_to("process.status_changed"));
        assert!(session.is_subscribed_to("system.metrics"));
        assert!(!session.is_subscribed_to("system.info"));

        assert_eq!(
            session.get_subscribed_topics(),
            vec!["process.*".to_string(), "system.metrics".to_string()]
        );
    }

    #[test]
    fn test_ws_session_unsubscribe_all_with_empty_topics() {
        let session = WsSession::new();
        session
            .subscribe_topics(vec!["process.*".to_string(), "system.*".to_string()])
            .unwrap();

        session.unsubscribe_topics(vec![]).unwrap();

        assert!(session.get_subscribed_topics().is_empty());
        assert!(!session.is_subscribed_to("process.log"));
    }
}
