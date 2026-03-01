use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::debug;

/// An event published through the EventBus.
#[derive(Debug, Clone)]
pub struct Event {
    /// Topic name (e.g. "process.status_changed", "system.metrics")
    pub topic: String,
    /// Event payload as JSON
    pub payload: Value,
}

/// EventBus provides a publish-subscribe mechanism for internal events.
///
/// Managers publish events → EventBus distributes → WebSocket handler pushes to clients.
pub struct EventBus {
    sender: broadcast::Sender<Event>,
}

impl EventBus {
    /// Create a new EventBus with the given channel capacity.
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    /// Publish an event to all subscribers.
    pub fn publish(&self, topic: impl Into<String>, payload: Value) {
        let topic = topic.into();
        debug!("EventBus publish: {}", topic);
        // It's OK if there are no subscribers
        let _ = self.sender.send(Event { topic, payload });
    }

    /// Subscribe to all events. Returns a receiver.
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(1024)
    }
}

/// Shared EventBus reference.
pub type SharedEventBus = Arc<EventBus>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_pub_sub() {
        let bus = EventBus::new(16);
        let mut rx = bus.subscribe();

        bus.publish("test.topic", serde_json::json!({"value": 42}));

        let event = rx.recv().await.unwrap();
        assert_eq!(event.topic, "test.topic");
        assert_eq!(event.payload["value"], 42);
    }

    #[tokio::test]
    async fn test_multiple_subscribers() {
        let bus = EventBus::new(16);
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();

        bus.publish("test.topic", serde_json::json!({"value": 1}));

        let e1 = rx1.recv().await.unwrap();
        let e2 = rx2.recv().await.unwrap();
        assert_eq!(e1.topic, e2.topic);
    }
}
