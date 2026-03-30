use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use sqlx::SqlitePool;
use tokio::sync::{Mutex, RwLock};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::event_bus::SharedEventBus;
use crate::services::pty_manager::PtyManager;

use super::runtime::{
    kill_process_identity, process_identity_is_alive, wait_for_process_identity_exit,
    RunningProcess, ScheduleTaskHandle,
};
use super::{
    CreateProcessRequest, InstanceInfo, ProcessDefinition, ProcessInfo, ProcessMode, ProcessStatus,
    ScheduleState, UpdateProcessRequest,
};

fn trimmed_non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub struct ProcessManager {
    pub(super) instances: RwLock<HashMap<(String, u32), Mutex<RunningProcess>>>,
    pub(super) pool: SqlitePool,
    pub(super) event_bus: SharedEventBus,
    pub(super) pty_manager: Arc<PtyManager>,
    pub(super) log_dir: PathBuf,
    pub(super) schedule_tasks: RwLock<HashMap<String, ScheduleTaskHandle>>,
}

impl ProcessManager {
    pub fn new(
        pool: SqlitePool,
        event_bus: SharedEventBus,
        pty_manager: Arc<PtyManager>,
        data_dir: &Path,
    ) -> Arc<Self> {
        let log_dir = data_dir.join("logs").join("processes");
        if let Err(e) = std::fs::create_dir_all(&log_dir) {
            error!("Failed to create process log directory: {}", e);
        }
        Arc::new(Self {
            instances: RwLock::new(HashMap::new()),
            pool,
            event_bus,
            pty_manager,
            log_dir,
            schedule_tasks: RwLock::new(HashMap::new()),
        })
    }

    pub async fn restore_processes(self: &Arc<Self>) -> anyhow::Result<()> {
        let definitions = self.load_all_definitions().await?;
        info!("Restoring {} process definitions", definitions.len());

        for def in &definitions {
            self.ensure_runtime_instances(&def.id, def.instance_count)
                .await;
        }

        let mut daemon_defs = Vec::new();
        let mut scheduled_defs = Vec::new();

        for def in definitions {
            match def.mode {
                ProcessMode::Daemon if def.enabled => daemon_defs.push(def),
                ProcessMode::Schedule if def.enabled => scheduled_defs.push(def),
                _ => {}
            }
        }

        info!("Auto-starting {} daemon processes", daemon_defs.len());
        for def in daemon_defs {
            if let Err(e) = self.restore_daemon_process(&def).await {
                error!("Failed to restore daemon process {}: {}", def.id, e);
            }
        }

        info!("Arming {} scheduled processes", scheduled_defs.len());
        for def in scheduled_defs {
            if let Err(e) = self.ensure_schedule_task(&def.id).await {
                error!("Failed to arm schedule for process {}: {}", def.id, e);
            }
        }

        Ok(())
    }

    async fn restore_daemon_process(
        self: &Arc<Self>,
        def: &ProcessDefinition,
    ) -> Result<(), AppError> {
        let persisted = self.load_runtime_identities(&def.id).await?;
        self.clear_runtime_identities_after_instance(&def.id, def.instance_count)
            .await?;

        let mut start_errors = Vec::new();
        for instance_idx in 0..def.instance_count {
            if let Some(identity) = persisted.get(&instance_idx).cloned() {
                if process_identity_is_alive(&identity) {
                    warn!(
                        "Found orphaned runtime for {} instance {} (PID {}); terminating before restart",
                        def.name, instance_idx, identity.pid
                    );
                    if !kill_process_identity(&identity) {
                        start_errors.push(format!(
                            "instance {}: failed to terminate orphaned runtime PID {}",
                            instance_idx, identity.pid
                        ));
                        continue;
                    }
                    if !wait_for_process_identity_exit(&identity, std::time::Duration::from_secs(3))
                        .await
                    {
                        start_errors.push(format!(
                            "instance {}: timed out waiting for orphaned runtime PID {} to exit",
                            instance_idx, identity.pid
                        ));
                        continue;
                    }
                } else {
                    warn!(
                        "Discarding stale runtime identity for {} instance {} (PID {})",
                        def.name, instance_idx, identity.pid
                    );
                }

                self.clear_runtime_identity(&def.id, instance_idx).await?;
            }

            if let Err(err) = self.start_instance(def, instance_idx).await {
                start_errors.push(format!("instance {}: {}", instance_idx, err));
            }
        }

        if start_errors.is_empty() {
            Ok(())
        } else {
            Err(AppError::Internal(format!(
                "Failed to restore all instances for {}: {}",
                def.id,
                start_errors.join("; ")
            )))
        }
    }

    pub async fn shutdown(self: &Arc<Self>) -> Result<(), AppError> {
        let schedule_ids = {
            let tasks = self.schedule_tasks.read().await;
            tasks.keys().cloned().collect::<Vec<_>>()
        };
        for id in schedule_ids {
            self.cancel_schedule_task(&id).await;
        }

        let definitions = self.load_all_definitions().await?;
        for def in definitions {
            let _ = self.stop_process(&def.id).await;
        }

        Ok(())
    }

    pub async fn create_process(
        self: &Arc<Self>,
        req: CreateProcessRequest,
    ) -> Result<ProcessInfo, AppError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let proc_log_dir = self.log_dir.join(&id);
        std::fs::create_dir_all(&proc_log_dir)
            .map_err(|e| AppError::Internal(format!("Failed to create log dir: {}", e)))?;
        for idx in 0..req.instance_count {
            let instance_dir = proc_log_dir.join(format!("instance-{}", idx));
            std::fs::create_dir_all(&instance_dir).map_err(|e| {
                AppError::Internal(format!("Failed to create instance log dir: {}", e))
            })?;
        }

        let definition = ProcessDefinition {
            id: id.clone(),
            name: req.name,
            mode: req.mode,
            command: req.command,
            args: req.args,
            cwd: req.cwd,
            env: req.env,
            restart_policy: req.restart_policy,
            enabled: req.enabled,
            group_name: req.group_name,
            log_config: req.log_config,
            run_as: req.run_as,
            instance_count: req.instance_count,
            pty_mode: req.pty_mode,
            schedule: req.schedule,
            schedule_overlap_policy: req.schedule_overlap_policy,
            schedule_state: ScheduleState::default(),
            created_at: now.clone(),
            updated_at: now,
        };

        self.validate_process_definition(&definition)?;
        let definition = self.initialize_schedule_state(definition)?;

        self.save_definition(&definition).await?;
        self.ensure_runtime_instances(&id, definition.instance_count)
            .await;

        if definition.mode == ProcessMode::Schedule && definition.enabled {
            self.ensure_schedule_task(&id).await?;
        }

        info!("Created process: {} ({})", definition.name, id);

        self.get_process(&definition.id).await
    }

    pub async fn update_process(
        self: &Arc<Self>,
        req: UpdateProcessRequest,
    ) -> Result<ProcessInfo, AppError> {
        let existing = self
            .load_definition(&req.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", req.id.as_str())))?;

        let mut updated = existing.clone();
        let mut changed_fields = Vec::new();

        if let Some(name) = req.name {
            if updated.name != name {
                updated.name = name;
                changed_fields.push("name");
            }
        }
        if let Some(mode) = req.mode {
            if updated.mode != mode {
                updated.mode = mode;
                if updated.mode == ProcessMode::Daemon {
                    updated.schedule = None;
                }
                changed_fields.push("mode");
            }
        }
        if let Some(command) = req.command {
            if updated.command != command {
                updated.command = command;
                changed_fields.push("command");
            }
        }
        if let Some(args) = req.args {
            if updated.args != args {
                updated.args = args;
                changed_fields.push("args");
            }
        }
        if let Some(cwd) = req.cwd {
            if updated.cwd != cwd {
                updated.cwd = cwd;
                changed_fields.push("cwd");
            }
        }
        if let Some(env) = req.env {
            if updated.env != env {
                updated.env = env;
                changed_fields.push("env");
            }
        }
        if let Some(restart_policy) = req.restart_policy {
            if updated.restart_policy != restart_policy {
                updated.restart_policy = restart_policy;
                changed_fields.push("restart_policy");
            }
        }
        if let Some(enabled) = req.enabled {
            if updated.enabled != enabled {
                updated.enabled = enabled;
                changed_fields.push("enabled");
            }
        }
        if let Some(group_name) = req.group_name {
            if updated.group_name != group_name {
                updated.group_name = group_name;
                changed_fields.push("group_name");
            }
        }
        if let Some(log_config) = req.log_config {
            if updated.log_config != log_config {
                updated.log_config = log_config;
                changed_fields.push("log_config");
            }
        }
        if let Some(run_as) = req.run_as {
            if updated.run_as != run_as {
                updated.run_as = run_as;
                changed_fields.push("run_as");
            }
        }
        if let Some(instance_count) = req.instance_count {
            if updated.instance_count != instance_count {
                updated.instance_count = instance_count;
                changed_fields.push("instance_count");
            }
        }
        if let Some(pty_mode) = req.pty_mode {
            if updated.pty_mode != pty_mode {
                updated.pty_mode = pty_mode;
                changed_fields.push("pty_mode");
            }
        }
        if let Some(schedule) = req.schedule {
            if updated.schedule != Some(schedule.clone()) {
                updated.schedule = Some(schedule);
                changed_fields.push("schedule");
            }
        }
        if let Some(overlap_policy) = req.schedule_overlap_policy {
            if updated.schedule_overlap_policy != overlap_policy {
                updated.schedule_overlap_policy = overlap_policy;
                changed_fields.push("schedule_overlap_policy");
            }
        }

        self.validate_process_definition(&updated)?;
        let schedule_changed = changed_fields
            .iter()
            .any(|field| matches!(*field, "mode" | "schedule" | "schedule_overlap_policy"));
        if schedule_changed {
            updated.schedule_state = ScheduleState::default();
            updated = self.initialize_schedule_state(updated)?;
        }

        let launch_param_changed = changed_fields.iter().any(|field| {
            matches!(
                *field,
                "command"
                    | "args"
                    | "cwd"
                    | "env"
                    | "run_as"
                    | "instance_count"
                    | "pty_mode"
                    | "mode"
            )
        });
        let is_running = self.is_running(&req.id).await;

        updated.updated_at = Utc::now().to_rfc3339();
        self.save_definition(&updated).await?;

        if updated.mode == ProcessMode::Schedule && updated.enabled {
            self.ensure_schedule_task(&updated.id).await?;
        } else {
            self.cancel_schedule_task(&updated.id).await;
        }

        if existing.instance_count != updated.instance_count {
            self.ensure_runtime_instances(&updated.id, updated.instance_count)
                .await;
            self.trim_runtime_instances(&updated.id, updated.instance_count)
                .await;
        }

        let restarted = if is_running && launch_param_changed {
            self.restart_process(&req.id).await?;
            true
        } else {
            false
        };

        self.event_bus.publish(
            "process.config_updated",
            serde_json::json!({
                "process_id": req.id,
                "restarted": restarted,
                "changed_fields": changed_fields,
            }),
        );

        self.get_process(&updated.id).await
    }

    pub async fn list_processes(&self) -> Result<Vec<ProcessInfo>, AppError> {
        let definitions = self.load_all_definitions().await?;

        let mut result = Vec::new();
        for def in definitions {
            let instance_infos = self.collect_instance_info(&def).await;
            result.push(ProcessInfo {
                definition: def,
                instances: instance_infos,
            });
        }

        Ok(result)
    }

    pub async fn get_process(&self, id: &str) -> Result<ProcessInfo, AppError> {
        let def = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;

        let instance_infos = self.collect_instance_info(&def).await;

        Ok(ProcessInfo {
            definition: def,
            instances: instance_infos,
        })
    }

    async fn collect_instance_info(&self, def: &ProcessDefinition) -> Vec<InstanceInfo> {
        let mut indices: Vec<u32> = (0..def.instance_count).collect();
        let keys = self.instance_keys(&def.id).await;
        for (_, idx) in keys {
            if !indices.contains(&idx) {
                indices.push(idx);
            }
        }
        indices.sort_unstable();

        let instances = self.instances.read().await;
        let mut infos = Vec::with_capacity(indices.len());
        for idx in indices {
            let key = (def.id.clone(), idx);
            if let Some(proc_mutex) = instances.get(&key) {
                let proc = proc_mutex.lock().await;
                infos.push(InstanceInfo {
                    index: idx,
                    status: proc.status.clone(),
                    pid: proc.pid,
                    pty_session_id: proc.pty_session_id.clone(),
                    restart_count: proc.restart_count,
                    started_at: proc.started_at.map(|t| t.to_rfc3339()),
                    exit_code: proc.exit_code,
                });
            } else {
                infos.push(InstanceInfo {
                    index: idx,
                    status: ProcessStatus::Created,
                    pid: None,
                    pty_session_id: None,
                    restart_count: 0,
                    started_at: None,
                    exit_code: None,
                });
            }
        }

        infos
    }

    pub async fn list_groups(&self) -> Result<Vec<String>, AppError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT group_name FROM processes WHERE group_name IS NOT NULL AND trim(group_name) != '' ORDER BY group_name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(name,)| name).collect())
    }

    pub async fn start_group(
        self: &Arc<Self>,
        group_name: &str,
        trigger_schedules: bool,
    ) -> Result<Vec<String>, AppError> {
        let group_name = trimmed_non_empty(group_name.to_string())
            .ok_or_else(|| AppError::BadRequest("group_name must not be empty".to_string()))?;
        let definitions = self.load_definitions_in_group(&group_name).await?;
        if definitions.is_empty() {
            return Err(AppError::NotFound(format!(
                "Group {} does not contain any processes",
                group_name
            )));
        }

        let mut errors = Vec::new();
        for def in definitions {
            if def.mode == ProcessMode::Schedule && !trigger_schedules {
                // Skip scheduled processes when the user chose not to trigger them
                continue;
            }
            if let Err(err) = self.start_process(&def.id).await {
                errors.push(format!("{} ({}): {}", def.name, def.id, err));
            }
        }
        Ok(errors)
    }

    pub async fn stop_group(&self, group_name: &str) -> Result<Vec<String>, AppError> {
        let group_name = trimmed_non_empty(group_name.to_string())
            .ok_or_else(|| AppError::BadRequest("group_name must not be empty".to_string()))?;
        let definitions = self.load_definitions_in_group(&group_name).await?;
        if definitions.is_empty() {
            return Err(AppError::NotFound(format!(
                "Group {} does not contain any processes",
                group_name
            )));
        }

        let mut errors = Vec::new();
        for def in definitions {
            if let Err(err) = self.stop_process(&def.id).await {
                errors.push(format!("{} ({}): {}", def.name, def.id, err));
            }
        }
        Ok(errors)
    }
}
