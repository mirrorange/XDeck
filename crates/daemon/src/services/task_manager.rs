use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::services::event_bus::SharedEventBus;

// ── Types ───────────────────────────────────────────────────────

/// Current status of a task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// Type of long-running task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    Compress,
    Extract,
    Upload,
    Download,
    FolderDownload,
    Copy,
}

/// A tracked long-running task.
#[derive(Debug, Clone, Serialize)]
pub struct Task {
    pub id: String,
    pub task_type: TaskType,
    pub title: String,
    pub status: TaskStatus,
    /// Progress percentage (0-100). None if indeterminate.
    pub progress: Option<u8>,
    /// Human-readable status message.
    pub message: Option<String>,
    /// Unix timestamp in milliseconds.
    pub created_at: u64,
    /// Unix timestamp in milliseconds.
    pub updated_at: u64,
}

/// Handle returned to callers for updating task progress.
#[derive(Clone)]
pub struct TaskHandle {
    task_id: String,
    manager: SharedTaskManager,
}

impl TaskHandle {
    /// Update progress (0-100) with an optional message.
    pub async fn update_progress(&self, progress: u8, message: Option<String>) {
        self.manager
            .update_task(&self.task_id, TaskStatus::Running, Some(progress.min(100)), message)
            .await;
    }

    /// Mark the task as completed.
    pub async fn complete(&self, message: Option<String>) {
        self.manager
            .update_task(&self.task_id, TaskStatus::Completed, Some(100), message)
            .await;
    }

    /// Mark the task as failed.
    pub async fn fail(&self, message: Option<String>) {
        self.manager
            .update_task(&self.task_id, TaskStatus::Failed, None, message)
            .await;
    }

    /// Check if this task has been cancelled.
    pub async fn is_cancelled(&self) -> bool {
        self.manager.is_cancelled(&self.task_id).await
    }

    pub fn id(&self) -> &str {
        &self.task_id
    }
}

// ── Task Manager ────────────────────────────────────────────────

/// Manages long-running tasks and publishes progress events.
pub struct TaskManager {
    tasks: Mutex<HashMap<String, Task>>,
    event_bus: SharedEventBus,
    /// Maximum number of completed/failed tasks to retain.
    max_history: usize,
}

/// Shared TaskManager reference.
pub type SharedTaskManager = Arc<TaskManager>;

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl TaskManager {
    /// Create a new TaskManager.
    pub fn new(event_bus: SharedEventBus) -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            event_bus,
            max_history: 50,
        }
    }

    /// List all tasks (active and recent completed).
    pub async fn list_tasks(&self) -> Vec<Task> {
        let tasks = self.tasks.lock().await;
        let mut result: Vec<Task> = tasks.values().cloned().collect();
        result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        result
    }

    /// Cancel a task.
    pub async fn cancel_task(&self, task_id: &str) -> bool {
        let mut tasks = self.tasks.lock().await;
        if let Some(task) = tasks.get_mut(task_id) {
            if task.status == TaskStatus::Pending || task.status == TaskStatus::Running {
                task.status = TaskStatus::Cancelled;
                task.updated_at = now_millis();

                let task_clone = task.clone();
                drop(tasks);

                self.event_bus.publish(
                    "task.cancelled",
                    serde_json::to_value(&task_clone).unwrap(),
                );

                info!("Task cancelled: {}", task_id);
                return true;
            }
        }
        false
    }

    /// Check if a task has been cancelled.
    pub async fn is_cancelled(&self, task_id: &str) -> bool {
        let tasks = self.tasks.lock().await;
        tasks
            .get(task_id)
            .map_or(false, |t| t.status == TaskStatus::Cancelled)
    }

    /// Update a task's status, progress, and message.
    pub async fn update_task(
        &self,
        task_id: &str,
        status: TaskStatus,
        progress: Option<u8>,
        message: Option<String>,
    ) {
        let mut tasks = self.tasks.lock().await;
        if let Some(task) = tasks.get_mut(task_id) {
            // Don't update cancelled tasks
            if task.status == TaskStatus::Cancelled {
                return;
            }

            task.status = status;
            task.progress = progress;
            task.message = message;
            task.updated_at = now_millis();

            let task_clone = task.clone();
            drop(tasks);

            let event_topic = match status {
                TaskStatus::Completed => "task.completed",
                TaskStatus::Failed => "task.failed",
                _ => "task.progress",
            };

            self.event_bus.publish(
                event_topic,
                serde_json::to_value(&task_clone).unwrap(),
            );

            debug!("Task {}: {:?} progress={:?}", task_id, status, progress);

            // Clean up old completed tasks
            if status == TaskStatus::Completed || status == TaskStatus::Failed {
                self.cleanup_old_tasks().await;
            }
        } else {
            warn!("Task not found for update: {}", task_id);
        }
    }

    /// Remove old completed/failed tasks to avoid unbounded growth.
    async fn cleanup_old_tasks(&self) {
        let mut tasks = self.tasks.lock().await;
        let finished: Vec<(String, u64)> = tasks
            .iter()
            .filter(|(_, t)| {
                t.status == TaskStatus::Completed
                    || t.status == TaskStatus::Failed
                    || t.status == TaskStatus::Cancelled
            })
            .map(|(id, t)| (id.clone(), t.updated_at))
            .collect();

        if finished.len() > self.max_history {
            let mut sorted = finished;
            sorted.sort_by(|a, b| b.1.cmp(&a.1));

            // Remove oldest beyond max_history
            for (id, _) in sorted.into_iter().skip(self.max_history) {
                tasks.remove(&id);
            }
        }
    }
}

/// Create a shared TaskManager.
pub fn new_shared(event_bus: SharedEventBus) -> SharedTaskManager {
    Arc::new(TaskManager::new(event_bus))
}

/// Create a TaskHandle for a new task, properly linked to the shared manager.
pub async fn create_task(
    manager: &SharedTaskManager,
    task_type: TaskType,
    title: String,
) -> TaskHandle {
    let id = Uuid::new_v4().to_string();
    let now = now_millis();

    let task = Task {
        id: id.clone(),
        task_type,
        title: title.clone(),
        status: TaskStatus::Pending,
        progress: Some(0),
        message: None,
        created_at: now,
        updated_at: now,
    };

    {
        let mut tasks = manager.tasks.lock().await;
        tasks.insert(id.clone(), task.clone());
    }

    manager.event_bus.publish(
        "task.created",
        serde_json::to_value(&task).unwrap(),
    );

    info!("Task created: {} ({})", title, id);

    TaskHandle {
        task_id: id,
        manager: manager.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::event_bus::EventBus;

    #[tokio::test]
    async fn test_create_and_update_task() {
        let event_bus = Arc::new(EventBus::new(16));
        let mut rx = event_bus.subscribe();
        let manager = new_shared(event_bus);

        let handle = create_task(&manager, TaskType::Compress, "Test compress".into()).await;

        // Should have received task.created event
        let event = rx.recv().await.unwrap();
        assert_eq!(event.topic, "task.created");

        // Update progress
        handle.update_progress(50, Some("Halfway done".into())).await;
        let event = rx.recv().await.unwrap();
        assert_eq!(event.topic, "task.progress");
        assert_eq!(event.payload["progress"], 50);

        // Complete
        handle.complete(Some("Done!".into())).await;
        let event = rx.recv().await.unwrap();
        assert_eq!(event.topic, "task.completed");
        assert_eq!(event.payload["progress"], 100);

        // List tasks
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

        // Updating a cancelled task should be a no-op
        handle.update_progress(50, None).await;
        let tasks = manager.list_tasks().await;
        assert_eq!(tasks[0].status, TaskStatus::Cancelled);
    }

    #[tokio::test]
    async fn test_cleanup_old_tasks() {
        let event_bus = Arc::new(EventBus::new(256));
        let manager = Arc::new(TaskManager {
            tasks: Mutex::new(HashMap::new()),
            event_bus,
            max_history: 3,
        });

        // Create and complete more tasks than max_history
        for i in 0..5 {
            let handle = create_task(&manager, TaskType::Compress, format!("Task {}", i)).await;
            handle.complete(None).await;
            // Small delay to ensure different timestamps
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        }

        let tasks = manager.list_tasks().await;
        assert!(tasks.len() <= 3, "Should retain at most 3 finished tasks, got {}", tasks.len());
    }
}
