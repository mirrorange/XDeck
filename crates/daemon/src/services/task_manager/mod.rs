mod manager;
#[cfg(test)]
mod tests;
mod types;

#[cfg(test)]
pub use manager::TaskManager;
pub use manager::{create_task, new_shared, SharedTaskManager, TaskHandle};
pub use types::{DismissTaskResult, Task, TaskStatus, TaskType};
