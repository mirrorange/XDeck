use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};
use uuid::Uuid;

use super::AppState;

#[derive(Debug, Deserialize)]
pub struct PtyWsParams {
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PtyControlMessage {
    Resize { cols: u16, rows: u16 },
}

pub async fn pty_ws_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    Query(params): Query<PtyWsParams>,
    State(state): State<AppState>,
) -> Response {
    if let Err(code) = authorize_pty_ws_token(&state, params.token.as_deref()) {
        return code.into_response();
    }

    if state.pty_manager.get_session_handle(&session_id).is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }

    ws.on_upgrade(move |socket| handle_pty_socket(socket, session_id, state))
        .into_response()
}

fn authorize_pty_ws_token(state: &AppState, token: Option<&str>) -> Result<(), StatusCode> {
    let Some(token) = token.filter(|token| !token.trim().is_empty()) else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    state
        .auth_service
        .verify_token(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(())
}

async fn handle_pty_socket(socket: WebSocket, session_id: String, state: AppState) {
    let Some(session) = state.pty_manager.get_session_handle(&session_id) else {
        return;
    };
    let client_id = Uuid::new_v4().to_string();

    let (mut sender, mut receiver) = socket.split();
    let mut output_rx = session.subscribe_output();

    if let Err(err) = session.client_connected(&client_id) {
        warn!(
            "Failed to register PTY websocket client for {}: {}",
            session_id, err
        );
        return;
    }
    publish_client_count_event(&state, &session_id, session.client_count());
    info!("PTY websocket connected: {}", session_id);

    let scrollback = session.get_scrollback();
    if !scrollback.is_empty()
        && sender
            .send(Message::Binary(scrollback.into()))
            .await
            .is_err()
    {
        if let Err(err) = session.client_disconnected(&client_id) {
            warn!(
                "Failed to unregister PTY websocket client for {}: {}",
                session_id, err
            );
        }
        publish_client_count_event(&state, &session_id, session.client_count());
        return;
    }

    loop {
        tokio::select! {
            message = receiver.next() => {
                let Some(message) = message else {
                    break;
                };

                let Ok(message) = message else {
                    break;
                };

                match message {
                    Message::Binary(data) => {
                        if let Err(err) = session.write(&data) {
                            warn!("PTY input write failed for {}: {}", session_id, err);
                            break;
                        }
                    }
                    Message::Text(text) => {
                        match serde_json::from_str::<PtyControlMessage>(&text) {
                            Ok(PtyControlMessage::Resize { cols, rows }) => {
                                if let Err(err) = session.resize_for_client(&client_id, cols, rows) {
                                    warn!("PTY resize failed for {}: {}", session_id, err);
                                }
                            }
                            Err(err) => {
                                debug!("Ignored invalid PTY control message: {}", err);
                            }
                        }
                    }
                    Message::Ping(payload) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Message::Pong(_) => {}
                    Message::Close(_) => break,
                }
            }
            output = output_rx.recv() => {
                match output {
                    Ok(data) => {
                        if sender.send(Message::Binary(data)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!("PTY output lagged for {} (skipped {})", session_id, skipped);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    if let Err(err) = session.client_disconnected(&client_id) {
        warn!(
            "Failed to unregister PTY websocket client for {}: {}",
            session_id, err
        );
    }
    publish_client_count_event(&state, &session_id, session.client_count());
    info!("PTY websocket disconnected: {}", session_id);
}

fn publish_client_count_event(state: &AppState, session_id: &str, client_count: u32) {
    state.event_bus.publish(
        "pty.session_client_count",
        serde_json::json!({
            "session_id": session_id,
            "client_count": client_count,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::AppState;
    use crate::config::AppConfig;

    #[tokio::test]
    async fn test_pty_ws_auth_required() {
        let config = AppConfig {
            data_dir: std::env::temp_dir().join(format!("xdeck-pty-ws-{}", uuid::Uuid::new_v4())),
            ..AppConfig::default()
        };
        let pool = crate::db::connect_in_memory().await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        let state = AppState::new(config, pool);

        let result = authorize_pty_ws_token(&state, None);
        assert_eq!(result, Err(StatusCode::UNAUTHORIZED));
    }
}
