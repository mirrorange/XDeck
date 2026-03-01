use axum::{
    extract::{
        State,
        WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::rpc::router::RequestContext;
use crate::rpc::types::{JsonRpcNotification, JsonRpcRequest};

use super::AppState;

/// WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Handle a single WebSocket connection.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    info!("WebSocket client connected");

    // Create a channel for sending messages back to the client
    let (tx, mut rx) = mpsc::channel::<String>(256);

    // Subscribe to EventBus for push events
    let mut event_rx = state.event_bus.subscribe();

    // Task: Forward outgoing messages (responses + events) to WebSocket
    let event_tx = tx.clone();
    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                // Forward event bus notifications
                Ok(event) = event_rx.recv() => {
                    let notification = JsonRpcNotification::new(
                        format!("event.{}", event.topic),
                        event.payload,
                    );
                    if let Ok(json) = serde_json::to_string(&notification) {
                        if event_tx.send(json).await.is_err() {
                            break;
                        }
                    }
                }
                // Forward queued response messages
                Some(msg) = rx.recv() => {
                    if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                else => break,
            }
        }
    });

    // Task: Process incoming messages from the client
    let rpc_router = state.rpc_router.clone();
    let pool = state.pool.clone();
    let response_tx = tx.clone();

    while let Some(msg) = ws_receiver.next().await {
        let msg = match msg {
            Ok(msg) => msg,
            Err(e) => {
                warn!("WebSocket receive error: {}", e);
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                // Parse as JSON-RPC request
                let request: JsonRpcRequest = match serde_json::from_str(&text) {
                    Ok(req) => req,
                    Err(e) => {
                        error!("Invalid JSON-RPC request: {}", e);
                        let err_resp = crate::rpc::types::JsonRpcResponse::error(
                            None,
                            crate::error::error_codes::PARSE_ERROR,
                            format!("Parse error: {}", e),
                        );
                        if let Ok(json) = serde_json::to_string(&err_resp) {
                            let _ = response_tx.send(json).await;
                        }
                        continue;
                    }
                };

                // Check auth - for now, we allow "auth.login", "auth.setup",
                // and "system.setup_status" without authentication
                let ctx = RequestContext {
                    user_id: None, // TODO: implement session tracking
                    ip_address: None,
                    pool: pool.clone(),
                };

                if let Some(response) = rpc_router.dispatch(request, ctx).await {
                    let json = serde_json::to_string(&response).unwrap();
                    debug!("RPC response queued");
                    let _ = response_tx.send(json).await;
                }
            }
            Message::Ping(_) => {
                debug!("Received ping");
            }
            Message::Close(_) => {
                info!("WebSocket client disconnected");
                break;
            }
            _ => {}
        }
    }

    // Clean up
    send_task.abort();
    info!("WebSocket connection closed");
}
