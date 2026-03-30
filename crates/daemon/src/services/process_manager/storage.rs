use std::collections::HashMap;

use sqlx::{sqlite::SqliteRow, Row};

use crate::error::AppError;

use super::{
    default_instance_count, runtime::ProcessRuntimeIdentity, ProcessDefinition, ProcessLogConfig,
    ProcessManager, ProcessMode, RestartPolicy, ScheduleConfig, ScheduleOverlapPolicy,
    ScheduleState,
};

fn process_definition_from_row(row: &SqliteRow) -> ProcessDefinition {
    ProcessDefinition {
        id: row.get("id"),
        name: row.get("name"),
        mode: serde_json::from_str::<ProcessMode>(&row.get::<String, _>("mode"))
            .unwrap_or_default(),
        command: row.get("command"),
        args: serde_json::from_str(&row.get::<String, _>("args")).unwrap_or_default(),
        cwd: row.get("cwd"),
        env: serde_json::from_str(&row.get::<String, _>("env")).unwrap_or_default(),
        restart_policy: serde_json::from_str::<RestartPolicy>(
            &row.get::<String, _>("restart_policy"),
        )
        .unwrap_or_default(),
        auto_start: row.get::<i32, _>("auto_start") != 0,
        group_name: row.get("group_name"),
        log_config: serde_json::from_str::<ProcessLogConfig>(&row.get::<String, _>("log_config"))
            .unwrap_or_default(),
        run_as: row.get("run_as"),
        instance_count: u32::try_from(row.get::<i64, _>("instance_count"))
            .unwrap_or(default_instance_count()),
        pty_mode: row.get::<i32, _>("pty_mode") != 0,
        schedule: row
            .get::<Option<String>, _>("schedule")
            .and_then(|value| serde_json::from_str::<ScheduleConfig>(&value).ok()),
        schedule_overlap_policy: serde_json::from_str::<ScheduleOverlapPolicy>(
            &row.get::<String, _>("schedule_overlap_policy"),
        )
        .unwrap_or_default(),
        schedule_state: serde_json::from_str::<ScheduleState>(
            &row.get::<String, _>("schedule_state"),
        )
        .unwrap_or_default(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

impl ProcessManager {
    pub(super) async fn load_definitions_in_group(
        &self,
        group_name: &str,
    ) -> Result<Vec<ProcessDefinition>, AppError> {
        let rows = sqlx::query(
            "SELECT id, name, mode, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, pty_mode, schedule, schedule_overlap_policy, schedule_state, created_at, updated_at FROM processes WHERE group_name = ?1 ORDER BY created_at",
        )
        .bind(group_name)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| process_definition_from_row(&row))
            .collect())
    }

    pub(super) async fn save_definition(&self, def: &ProcessDefinition) -> Result<(), AppError> {
        let mode_json = serde_json::to_string(&def.mode).unwrap();
        let args_json = serde_json::to_string(&def.args).unwrap();
        let env_json = serde_json::to_string(&def.env).unwrap();
        let policy_json = serde_json::to_string(&def.restart_policy).unwrap();
        let log_config_json = serde_json::to_string(&def.log_config).unwrap();
        let schedule_json = def
            .schedule
            .as_ref()
            .map(|schedule| serde_json::to_string(schedule).unwrap());
        let overlap_policy_json = serde_json::to_string(&def.schedule_overlap_policy).unwrap();
        let schedule_state_json = serde_json::to_string(&def.schedule_state).unwrap();

        sqlx::query(
            "INSERT OR REPLACE INTO processes (id, name, mode, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, pty_mode, schedule, schedule_overlap_policy, schedule_state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        )
        .bind(&def.id)
        .bind(&def.name)
        .bind(&mode_json)
        .bind(&def.command)
        .bind(&args_json)
        .bind(&def.cwd)
        .bind(&env_json)
        .bind(&policy_json)
        .bind(def.auto_start as i32)
        .bind(&def.group_name)
        .bind(&log_config_json)
        .bind(&def.run_as)
        .bind(def.instance_count as i64)
        .bind(def.pty_mode as i32)
        .bind(&schedule_json)
        .bind(&overlap_policy_json)
        .bind(&schedule_state_json)
        .bind(&def.created_at)
        .bind(&def.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub(super) async fn load_definition(
        &self,
        id: &str,
    ) -> Result<Option<ProcessDefinition>, AppError> {
        let row = sqlx::query(
            "SELECT id, name, mode, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, pty_mode, schedule, schedule_overlap_policy, schedule_state, created_at, updated_at FROM processes WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| process_definition_from_row(&row)))
    }

    pub(super) async fn load_all_definitions(&self) -> Result<Vec<ProcessDefinition>, AppError> {
        let rows = sqlx::query(
            "SELECT id, name, mode, command, args, cwd, env, restart_policy, auto_start, group_name, log_config, run_as, instance_count, pty_mode, schedule, schedule_overlap_policy, schedule_state, created_at, updated_at FROM processes ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| process_definition_from_row(&row))
            .collect())
    }

    pub(super) async fn save_runtime_identity(
        &self,
        id: &str,
        instance_idx: u32,
        identity: &ProcessRuntimeIdentity,
    ) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO process_runtime_instances (process_id, instance_idx, pid, start_time) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(process_id, instance_idx) DO UPDATE SET pid = excluded.pid, start_time = excluded.start_time",
        )
        .bind(id)
        .bind(instance_idx as i64)
        .bind(identity.pid as i64)
        .bind(identity.start_time as i64)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub(super) async fn clear_runtime_identity(
        &self,
        id: &str,
        instance_idx: u32,
    ) -> Result<(), AppError> {
        sqlx::query(
            "DELETE FROM process_runtime_instances WHERE process_id = ?1 AND instance_idx = ?2",
        )
        .bind(id)
        .bind(instance_idx as i64)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub(super) async fn clear_runtime_identities_for_process(
        &self,
        id: &str,
    ) -> Result<(), AppError> {
        sqlx::query("DELETE FROM process_runtime_instances WHERE process_id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub(super) async fn clear_runtime_identities_after_instance(
        &self,
        id: &str,
        instance_count: u32,
    ) -> Result<(), AppError> {
        sqlx::query(
            "DELETE FROM process_runtime_instances WHERE process_id = ?1 AND instance_idx >= ?2",
        )
        .bind(id)
        .bind(instance_count as i64)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub(super) async fn load_runtime_identities(
        &self,
        id: &str,
    ) -> Result<HashMap<u32, ProcessRuntimeIdentity>, AppError> {
        let rows = sqlx::query(
            "SELECT instance_idx, pid, start_time FROM process_runtime_instances WHERE process_id = ?1",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;

        let mut identities = HashMap::with_capacity(rows.len());
        for row in rows {
            let instance_idx = u32::try_from(row.get::<i64, _>("instance_idx")).map_err(|err| {
                AppError::Internal(format!("Invalid instance_idx in runtime table: {}", err))
            })?;
            let pid = u32::try_from(row.get::<i64, _>("pid")).map_err(|err| {
                AppError::Internal(format!("Invalid pid in runtime table: {}", err))
            })?;
            let start_time = u64::try_from(row.get::<i64, _>("start_time")).map_err(|err| {
                AppError::Internal(format!("Invalid start_time in runtime table: {}", err))
            })?;
            identities.insert(instance_idx, ProcessRuntimeIdentity { pid, start_time });
        }

        Ok(identities)
    }
}
