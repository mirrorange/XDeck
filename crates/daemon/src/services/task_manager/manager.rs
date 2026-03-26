use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::services::event_bus::SharedEventBus;

use super::{DismissTaskResult, Task, TaskStatus, TaskType};

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
            .update_task(
                &self.task_id,
                TaskStatus::Running,
                Some(progress.min(100)),
                message,
            )
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
    #[cfg(test)]
    pub async fn is_cancelled(&self) -> bool {
        self.manager.is_cancelled(&self.task_id).await
    }

    pub fn id(&self) -> &str {
        &self.task_id
    }
}

/// Manages long-running tasks and publishes progress events.
pub struct TaskManager {
    pub(super) tasks: Mutex<HashMap<String, Task>>,
    pub(super) event_bus: SharedEventBus,
    /// Maximum number of completed/failed tasks to retain.
    pub(super) max_history: usize,
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

                self.event_bus
                    .publish("task.cancelled", serde_json::to_value(&task_clone).unwrap());

                info!("Task cancelled: {}", task_id);
                return true;
            }
        }
        false
    }

    /// Remove a finished task from the tracked history.
    pub async fn dismiss_task(&self, task_id: &str) -> DismissTaskResult {
        let mut tasks = self.tasks.lock().await;
        let Some(task) = tasks.get(task_id) else {
            return DismissTaskResult::NotFound;
        };

        if task.status == TaskStatus::Pending || task.status == TaskStatus::Running {
            return DismissTaskResult::Active;
        }

        tasks.remove(task_id);
        drop(tasks);

        self.event_bus
            .publish("task.dismissed", serde_json::json!({ "id": task_id }));

        info!("Task dismissed: {}", task_id);
        DismissTaskResult::Dismissed
    }

    /// Remove all finished tasks from tracked history.
    pub async fn clear_finished_tasks(&self) -> usize {
        let mut tasks = self.tasks.lock().await;
        let dismissed_ids: Vec<String> = tasks
            .iter()
            .filter(|(_, task)| {
                task.status == TaskStatus::Completed
                    || task.status == TaskStatus::Failed
                    || task.status == TaskStatus::Cancelled
            })
            .map(|(id, _)| id.clone())
            .collect();

        if dismissed_ids.is_empty() {
            return 0;
        }

        tasks.retain(|_, task| {
            task.status == TaskStatus::Pending || task.status == TaskStatus::Running
        });
        drop(tasks);

        self.event_bus
            .publish("task.cleared", serde_json::json!({ "ids": dismissed_ids }));

        info!("Cleared {} finished tasks", dismissed_ids.len());
        dismissed_ids.len()
    }

    /// Check if a task has been cancelled.
    #[cfg(test)]
    pub async fn is_cancelled(&self, task_id: &str) -> bool {
        let tasks = self.tasks.lock().await;
        tasks
            .get(task_id)
            .is_some_and(|task| task.status == TaskStatus::Cancelled)
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

            self.event_bus
                .publish(event_topic, serde_json::to_value(&task_clone).unwrap());

            debug!("Task {}: {:?} progress={:?}", task_id, status, progress);

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
            .filter(|(_, task)| {
                task.status == TaskStatus::Completed
                    || task.status == TaskStatus::Failed
                    || task.status == TaskStatus::Cancelled
            })
            .map(|(id, task)| (id.clone(), task.updated_at))
            .collect();

        if finished.len() > self.max_history {
            let mut sorted = finished;
            sorted.sort_by(|a, b| b.1.cmp(&a.1));

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

    manager
        .event_bus
        .publish("task.created", serde_json::to_value(&task).unwrap());

    info!("Task created: {} ({})", title, id);

    TaskHandle {
        task_id: id,
        manager: manager.clone(),
    }
}
