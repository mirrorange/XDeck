#![cfg(test)]

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::*;
use crate::services::event_bus::EventBus;

#[tokio::test]
async fn test_create_and_update_task() {
    let event_bus = Arc::new(EventBus::new(16));
    let mut rx = event_bus.subscribe();
    let manager = new_shared(event_bus);

    let handle = create_task(&manager, TaskType::Compress, "Test compress".into()).await;

    let event = rx.recv().await.unwrap();
    assert_eq!(event.topic, "task.created");

    handle
        .update_progress(50, Some("Halfway done".into()))
        .await;
    let event = rx.recv().await.unwrap();
    assert_eq!(event.topic, "task.progress");
    assert_eq!(event.payload["progress"], 50);

    handle.complete(Some("Done!".into())).await;
    let event = rx.recv().await.unwrap();
    assert_eq!(event.topic, "task.completed");
    assert_eq!(event.payload["progress"], 100);

    let tasks = manager.list_tasks().await;
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].status, TaskStatus::Completed);
}

#[tokio::test]
async fn test_cancel_task() {
    let event_bus = Arc::new(EventBus::new(16));
    let manager = new_shared(event_bus);

    let handle = create_task(&manager, TaskType::Extract, "Test extract".into()).await;

    assert!(!handle.is_cancelled().await);

    let cancelled = manager.cancel_task(handle.id()).await;
    assert!(cancelled);
    assert!(handle.is_cancelled().await);

    handle.update_progress(50, None).await;
    let tasks = manager.list_tasks().await;
    assert_eq!(tasks[0].status, TaskStatus::Cancelled);
}

#[tokio::test]
async fn test_dismiss_finished_task() {
    let event_bus = Arc::new(EventBus::new(16));
    let mut rx = event_bus.subscribe();
    let manager = new_shared(event_bus);

    let handle = create_task(&manager, TaskType::Compress, "Dismiss me".into()).await;
    let _ = rx.recv().await.unwrap();

    handle.complete(None).await;
    let _ = rx.recv().await.unwrap();

    let result = manager.dismiss_task(handle.id()).await;
    assert_eq!(result, DismissTaskResult::Dismissed);

    let event = rx.recv().await.unwrap();
    assert_eq!(event.topic, "task.dismissed");
    assert_eq!(event.payload["id"], handle.id());
    assert!(manager.list_tasks().await.is_empty());
}

#[tokio::test]
async fn test_cannot_dismiss_active_task() {
    let event_bus = Arc::new(EventBus::new(16));
    let manager = new_shared(event_bus);

    let handle = create_task(&manager, TaskType::Extract, "Still running".into()).await;

    let result = manager.dismiss_task(handle.id()).await;
    assert_eq!(result, DismissTaskResult::Active);
    assert_eq!(manager.list_tasks().await.len(), 1);
}

#[tokio::test]
async fn test_clear_finished_tasks_keeps_active_tasks() {
    let event_bus = Arc::new(EventBus::new(32));
    let mut rx = event_bus.subscribe();
    let manager = new_shared(event_bus);

    let active = create_task(&manager, TaskType::Upload, "Active".into()).await;
    let _ = rx.recv().await.unwrap();

    let completed = create_task(&manager, TaskType::Compress, "Completed".into()).await;
    let _ = rx.recv().await.unwrap();
    completed.complete(None).await;
    let _ = rx.recv().await.unwrap();

    let cancelled = create_task(&manager, TaskType::Extract, "Cancelled".into()).await;
    let _ = rx.recv().await.unwrap();
    assert!(manager.cancel_task(cancelled.id()).await);
    let _ = rx.recv().await.unwrap();

    let cleared = manager.clear_finished_tasks().await;
    assert_eq!(cleared, 2);

    let event = rx.recv().await.unwrap();
    assert_eq!(event.topic, "task.cleared");
    let ids = event.payload["ids"].as_array().unwrap();
    assert_eq!(ids.len(), 2);

    let tasks = manager.list_tasks().await;
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, active.id());
}

#[tokio::test]
async fn test_cleanup_old_tasks() {
    let event_bus = Arc::new(EventBus::new(256));
    let manager = Arc::new(TaskManager {
        tasks: Mutex::new(HashMap::new()),
        event_bus,
        max_history: 3,
    });

    for i in 0..5 {
        let handle = create_task(&manager, TaskType::Compress, format!("Task {}", i)).await;
        handle.complete(None).await;
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }

    let tasks = manager.list_tasks().await;
    assert!(
        tasks.len() <= 3,
        "Should retain at most 3 finished tasks, got {}",
        tasks.len()
    );
}
