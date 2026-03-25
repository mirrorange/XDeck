mod manager;
#[cfg(test)]
mod tests;
mod types;

pub use manager::{create_task, new_shared, SharedTaskManager, TaskHandle, TaskManager};
pub use types::{DismissTaskResult, Task, TaskStatus, TaskType};
