use serde::Deserialize;

use crate::error::AppError;
use crate::rpc::params::{parse_required_params, require_ws_session};
use crate::rpc::router::RpcRouter;

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

pub fn register(router: &mut RpcRouter) {
    router.register("event.subscribe", |params, ctx| async move {
        let session = require_ws_session(&ctx)?;
        let params = parse_required_params::<EventSubscribeParams>(params)?;

        if params.topics.is_empty() {
            return Err(AppError::BadRequest(
                "topics must contain at least one topic".into(),
            ));
        }

        session.subscribe_topics(normalize_topics(params.topics)?)?;

        Ok(serde_json::json!({
            "subscribed_topics": session.get_subscribed_topics(),
        }))
    });

    router.register("event.unsubscribe", |params, ctx| async move {
        let session = require_ws_session(&ctx)?;
        let params = parse_required_params::<EventUnsubscribeParams>(params)?;

        session.unsubscribe_topics(normalize_topics(params.topics)?)?;

        Ok(serde_json::json!({
            "subscribed_topics": session.get_subscribed_topics(),
        }))
    });
}

fn normalize_topics(topics: Vec<String>) -> Result<Vec<String>, AppError> {
    let mut normalized = Vec::with_capacity(topics.len());

    for topic in topics {
        let topic = normalize_topic(&topic)
            .ok_or_else(|| AppError::BadRequest(format!("Invalid topic: {}", topic)))?;
        normalized.push(topic);
    }

    Ok(normalized)
}

pub(crate) fn normalize_topic(topic: &str) -> Option<String> {
    let trimmed = topic.trim();
    if trimmed.is_empty() {
        return None;
    }

    let topic = trimmed.strip_prefix("event.").unwrap_or(trimmed);
    Some(topic.to_string())
}

pub(crate) fn topic_matches_pattern(pattern: &str, event_topic: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    use serde_json::Value;

    use super::*;
    use crate::error::error_codes;
    use crate::rpc::router::{RequestContext, SessionAccess};
    use crate::rpc::types::JsonRpcRequest;

    #[derive(Default)]
    struct MockSession {
        topics: Mutex<HashSet<String>>,
    }

    impl SessionAccess for MockSession {
        fn set_authenticated_user(&self, _user_id: String) {}

        fn get_authenticated_user(&self) -> Option<String> {
            Some("user-1".to_string())
        }

        fn subscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError> {
            let mut current = self.topics.lock().unwrap();
            for topic in topics {
                current.insert(topic);
            }
            Ok(())
        }

        fn unsubscribe_topics(&self, topics: Vec<String>) -> Result<(), AppError> {
            let mut current = self.topics.lock().unwrap();
            if topics.is_empty() {
                current.clear();
                return Ok(());
            }

            for topic in topics {
                current.remove(&topic);
            }
            Ok(())
        }

        fn get_subscribed_topics(&self) -> Vec<String> {
            let mut topics: Vec<String> = self.topics.lock().unwrap().iter().cloned().collect();
            topics.sort();
            topics
        }

        fn is_subscribed_to(&self, topic: &str) -> bool {
            self.topics
                .lock()
                .unwrap()
                .iter()
                .any(|pattern| topic_matches_pattern(pattern, topic))
        }
    }

    async fn test_pool() -> sqlx::SqlitePool {
        crate::db::connect_in_memory().await.unwrap()
    }

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

    #[tokio::test]
    async fn test_event_subscribe_via_router_updates_topics() {
        let mut router = RpcRouter::new();
        register(&mut router);

        let session = Arc::new(MockSession::default());
        let ctx = RequestContext::with_session(
            Some("user-1".to_string()),
            test_pool().await,
            session.clone(),
        );

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "event.subscribe".to_string(),
            params: Some(serde_json::json!({"topics": [" event.process.* "]})),
        };

        let resp = router.dispatch(req, ctx).await.unwrap();
        assert!(resp.error.is_none());

        let topics = resp
            .result
            .unwrap()
            .get("subscribed_topics")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect::<Vec<_>>();

        assert_eq!(topics, vec!["process.*".to_string()]);
    }

    #[tokio::test]
    async fn test_event_subscribe_requires_websocket_session() {
        let mut router = RpcRouter::new();
        register(&mut router);

        let ctx = RequestContext::new(Some("user-1".to_string()), test_pool().await);

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(Value::String("1".to_string())),
            method: "event.subscribe".to_string(),
            params: Some(serde_json::json!({"topics": ["process.*"]})),
        };

        let resp = router.dispatch(req, ctx).await.unwrap();
        let err = resp.error.expect("expected error");

        assert_eq!(err.code, error_codes::INVALID_PARAMS);
        assert!(err.message.contains("Only available over WebSocket"));
    }
}
