use std::collections::HashSet;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Deserialize};
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

use crate::error::AppError;
use crate::rpc::router::RequestContext;
use crate::rpc::types::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};

use super::AppState;

const AUTH_AUTHENTICATE_METHOD: &str = "auth.authenticate";
const EVENT_SUBSCRIBE_METHOD: &str = "event.subscribe";
const EVENT_UNSUBSCRIBE_METHOD: &str = "event.unsubscribe";

#[derive(Debug, Default)]
struct WsSession {
    authenticated_user_id: Option<String>,
    subscribed_topics: HashSet<String>,
}

impl WsSession {
    fn request_context(&self, pool: sqlx::SqlitePool) -> RequestContext {
        RequestContext {
            user_id: self.authenticated_user_id.clone(),
            ip_address: None,
            pool,
        }
    }

    fn is_authenticated(&self) -> bool {
        self.authenticated_user_id.is_some()
    }

    fn ensure_authenticated(&self) -> Result<(), AppError> {
        if self.is_authenticated() {
            Ok(())
        } else {
            Err(AppError::Unauthorized)
        }
    }

    fn authenticate_as(&mut self, user_id: String) -> Result<(), AppError> {
        if let Some(existing_user_id) = &self.authenticated_user_id {
            if existing_user_id != &user_id {
                return Err(AppError::Unauthorized);
            }
        }

        self.authenticated_user_id = Some(user_id);
        Ok(())
    }

    fn subscribe_topics(&mut self, topics: Vec<String>) -> Result<(), AppError> {
        if topics.is_empty() {
            return Err(AppError::BadRequest(
                "topics must contain at least one topic".into(),
            ));
        }

        for topic in topics {
            let normalized = normalize_topic(&topic)
                .ok_or_else(|| AppError::BadRequest(format!("Invalid topic: {}", topic)))?;
            self.subscribed_topics.insert(normalized);
        }

        Ok(())
    }

    fn unsubscribe_topics(&mut self, topics: Vec<String>) -> Result<(), AppError> {
        if topics.is_empty() {
            self.subscribed_topics.clear();
            return Ok(());
        }

        for topic in topics {
            let normalized = normalize_topic(&topic)
                .ok_or_else(|| AppError::BadRequest(format!("Invalid topic: {}", topic)))?;
            self.subscribed_topics.remove(&normalized);
        }

        Ok(())
    }

    fn is_event_subscribed(&self, event_topic: &str) -> bool {
        self.subscribed_topics
            .iter()
            .any(|topic| topic_matches_pattern(topic, event_topic))
    }

    fn subscribed_topics(&self) -> Vec<String> {
        sorted_topics(&self.subscribed_topics)
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthAuthenticateParams {
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventSubscribeParams {
    topics: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventUnsubscribeParams {
    topics: Vec<String>,
}

/// WebSocket upgrade handler.
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Handle a single WebSocket connection.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let mut session = WsSession::default();
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
                    &mut session,
                ).await;

                if !should_continue {
                    break;
                }
            }
            event = event_rx.recv() => {
                match event {
                    Ok(event) => {
                        if !session.is_event_subscribed(&event.topic) {
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
    session: &mut WsSession,
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

            if let Some(response) = dispatch_client_request(request, state, session).await {
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

async fn dispatch_client_request(
    request: JsonRpcRequest,
    state: &AppState,
    session: &mut WsSession,
) -> Option<JsonRpcResponse> {
    match request.method.as_str() {
        AUTH_AUTHENTICATE_METHOD => handle_auth_authenticate(request, state, session),
        EVENT_SUBSCRIBE_METHOD => handle_event_subscribe(request, session),
        EVENT_UNSUBSCRIBE_METHOD => handle_event_unsubscribe(request, session),
        _ => dispatch_application_request(request, state, session).await,
    }
}

fn handle_auth_authenticate(
    request: JsonRpcRequest,
    state: &AppState,
    session: &mut WsSession,
) -> Option<JsonRpcResponse> {
    let is_notification = request.is_notification();
    let id = request.id;
    let result =
        parse_required_params::<AuthAuthenticateParams>(request.params).and_then(|params| {
            let claims = state.auth_service.verify_token(&params.token)?;
            session.authenticate_as(claims.sub.clone())?;

            Ok(serde_json::json!({
                "authenticated": true,
                "user_id": claims.sub,
            }))
        });

    rpc_response_from_result(id, is_notification, result)
}

fn handle_event_subscribe(
    request: JsonRpcRequest,
    session: &mut WsSession,
) -> Option<JsonRpcResponse> {
    let is_notification = request.is_notification();
    let id = request.id;
    let result = session.ensure_authenticated().and_then(|_| {
        parse_required_params::<EventSubscribeParams>(request.params)
            .and_then(|params| session.subscribe_topics(params.topics))
            .map(|_| {
                serde_json::json!({
                    "subscribed_topics": session.subscribed_topics(),
                })
            })
    });

    rpc_response_from_result(id, is_notification, result)
}

fn handle_event_unsubscribe(
    request: JsonRpcRequest,
    session: &mut WsSession,
) -> Option<JsonRpcResponse> {
    let is_notification = request.is_notification();
    let id = request.id;
    let result = session.ensure_authenticated().and_then(|_| {
        parse_required_params::<EventUnsubscribeParams>(request.params)
            .and_then(|params| session.unsubscribe_topics(params.topics))
            .map(|_| {
                serde_json::json!({
                    "subscribed_topics": session.subscribed_topics(),
                })
            })
    });

    rpc_response_from_result(id, is_notification, result)
}

async fn dispatch_application_request(
    request: JsonRpcRequest,
    state: &AppState,
    session: &WsSession,
) -> Option<JsonRpcResponse> {
    if method_requires_auth(&request.method) && !session.is_authenticated() {
        let is_notification = request.is_notification();
        let id = request.id;
        return rpc_response_from_result(id, is_notification, Err(AppError::Unauthorized));
    }

    let ctx = session.request_context(state.pool.clone());
    state.rpc_router.dispatch(request, ctx).await
}

fn method_requires_auth(method: &str) -> bool {
    method.starts_with("process.")
}

fn parse_required_params<T: DeserializeOwned>(
    params: Option<serde_json::Value>,
) -> Result<T, AppError> {
    let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
    serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))
}

fn normalize_topic(topic: &str) -> Option<String> {
    let trimmed = topic.trim();
    if trimmed.is_empty() {
        return None;
    }

    let topic = trimmed.strip_prefix("event.").unwrap_or(trimmed);
    Some(topic.to_string())
}

fn topic_matches_pattern(pattern: &str, event_topic: &str) -> bool {
    if pattern == "*" {
        return true;
    }

    if let Some(prefix) = pattern.strip_suffix(".*") {
        return event_topic == prefix
            || event_topic
                .strip_prefix(prefix)
                .is_some_and(|suffix| suffix.starts_with('.'));
    }

    pattern == event_topic
}

fn sorted_topics(topics: &HashSet<String>) -> Vec<String> {
    let mut sorted: Vec<String> = topics.iter().cloned().collect();
    sorted.sort();
    sorted
}

fn rpc_response_from_result(
    id: Option<serde_json::Value>,
    is_notification: bool,
    result: Result<serde_json::Value, AppError>,
) -> Option<JsonRpcResponse> {
    if is_notification {
        None
    } else {
        Some(map_rpc_result(id, result))
    }
}

fn map_rpc_result(
    id: Option<serde_json::Value>,
    result: Result<serde_json::Value, AppError>,
) -> JsonRpcResponse {
    match result {
        Ok(value) => JsonRpcResponse::success(id, value),
        Err(err) => {
            if let Some(data) = err.error_data() {
                JsonRpcResponse::error_with_data(id, err.error_code(), err.to_string(), data)
            } else {
                JsonRpcResponse::error(id, err.error_code(), err.to_string())
            }
        }
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
    fn test_topic_matches_pattern() {
        assert!(topic_matches_pattern("system.metrics", "system.metrics"));
        assert!(!topic_matches_pattern("system.metrics", "process.log"));

        assert!(topic_matches_pattern("process.*", "process.log"));
        assert!(topic_matches_pattern("process.*", "process.status_changed"));
        assert!(!topic_matches_pattern("process.*", "system.metrics"));

        assert!(topic_matches_pattern("*", "anything"));
    }

    #[test]
    fn test_normalize_topic() {
        assert_eq!(
            normalize_topic("system.metrics"),
            Some("system.metrics".to_string())
        );
        assert_eq!(
            normalize_topic("event.system.metrics"),
            Some("system.metrics".to_string())
        );
        assert_eq!(
            normalize_topic("  process.log  "),
            Some("process.log".to_string())
        );
        assert_eq!(normalize_topic(""), None);
    }

    #[test]
    fn test_event_subscribe_rejects_unknown_fields() {
        let result: Result<EventSubscribeParams, _> = serde_json::from_value(serde_json::json!({
            "topics": ["process.*"],
            "token": "should-not-be-accepted"
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_event_unsubscribe_requires_topics_field() {
        let result: Result<EventUnsubscribeParams, _> =
            serde_json::from_value(serde_json::json!({}));
        assert!(result.is_err());
    }

    #[test]
    fn test_auth_authenticate_rejects_extra_fields() {
        let result: Result<AuthAuthenticateParams, _> = serde_json::from_value(serde_json::json!({
            "token": "abc",
            "username": "admin"
        }));
        assert!(result.is_err());
    }
}
