use std::time::Duration;

use chrono::{DateTime, Datelike, Local, LocalResult, TimeZone, Utc};
use tokio::sync::oneshot;
use tracing::error;

use crate::error::AppError;

use super::runtime::{ScheduleTaskHandle, ScheduleTriggerSource};
use super::{
    ProcessDefinition, ProcessManager, ProcessMode, ProcessStatus, ScheduleConfig,
    ScheduleOverlapPolicy, ScheduleState, ScheduleWeekday,
};

fn parse_utc_datetime(value: &str) -> Result<DateTime<Utc>, AppError> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|err| {
            AppError::BadRequest(format!("Invalid RFC3339 datetime '{}': {}", value, err))
        })
}

fn local_datetime_for(date: chrono::NaiveDate, hour: u8, minute: u8) -> DateTime<Utc> {
    let naive = date
        .and_hms_opt(hour as u32, minute as u32, 0)
        .expect("validated schedule time should always produce a local time");
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt.with_timezone(&Utc),
        LocalResult::Ambiguous(first, _) => first.with_timezone(&Utc),
        LocalResult::None => {
            let fallback = naive + chrono::Duration::hours(1);
            Local
                .from_local_datetime(&fallback)
                .earliest()
                .expect("one-hour fallback should resolve to a local datetime")
                .with_timezone(&Utc)
        }
    }
}

fn compute_initial_next_run(
    schedule: &ScheduleConfig,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, AppError> {
    match schedule {
        ScheduleConfig::Once { run_at } => Ok(Some(parse_utc_datetime(run_at)?)),
        ScheduleConfig::Daily { hour, minute } => Ok(Some(next_daily_run(*hour, *minute, now))),
        ScheduleConfig::Weekly {
            weekdays,
            hour,
            minute,
        } => Ok(Some(next_weekly_run(weekdays, *hour, *minute, now)?)),
        ScheduleConfig::Interval { every_seconds } => Ok(Some(
            now + chrono::Duration::seconds((*every_seconds).try_into().unwrap_or(i64::MAX)),
        )),
    }
}

fn compute_next_run_after_trigger(
    schedule: &ScheduleConfig,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, AppError> {
    match schedule {
        ScheduleConfig::Once { .. } => Ok(None),
        ScheduleConfig::Daily { hour, minute } => Ok(Some(next_daily_run(*hour, *minute, now))),
        ScheduleConfig::Weekly {
            weekdays,
            hour,
            minute,
        } => Ok(Some(next_weekly_run(weekdays, *hour, *minute, now)?)),
        ScheduleConfig::Interval { every_seconds } => Ok(Some(
            now + chrono::Duration::seconds((*every_seconds).try_into().unwrap_or(i64::MAX)),
        )),
    }
}

fn next_daily_run(hour: u8, minute: u8, now: DateTime<Utc>) -> DateTime<Utc> {
    let local_now = now.with_timezone(&Local);
    let today = local_now.date_naive();
    let today_run = local_datetime_for(today, hour, minute);
    if today_run > now {
        today_run
    } else {
        local_datetime_for(
            today.succ_opt().expect("next day should exist"),
            hour,
            minute,
        )
    }
}

fn next_weekly_run(
    weekdays: &[ScheduleWeekday],
    hour: u8,
    minute: u8,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>, AppError> {
    if weekdays.is_empty() {
        return Err(AppError::BadRequest(
            "Weekly schedule must include at least one weekday".to_string(),
        ));
    }

    let local_now = now.with_timezone(&Local);
    let today = local_now.date_naive();

    for offset in 0..14 {
        let date = today + chrono::Duration::days(offset);
        let weekday = ScheduleWeekday::from_chrono(date.weekday());
        if !weekdays.contains(&weekday) {
            continue;
        }

        let candidate = local_datetime_for(date, hour, minute);
        if candidate > now {
            return Ok(candidate);
        }
    }

    Err(AppError::Internal(
        "Failed to compute next weekly schedule run".to_string(),
    ))
}

impl ProcessManager {
    pub(super) fn validate_process_definition(
        &self,
        def: &ProcessDefinition,
    ) -> Result<(), AppError> {
        match def.mode {
            ProcessMode::Daemon => Ok(()),
            ProcessMode::Schedule => {
                let schedule = def.schedule.as_ref().ok_or_else(|| {
                    AppError::BadRequest(
                        "Scheduled process must include a schedule configuration".to_string(),
                    )
                })?;
                Self::validate_schedule_config(schedule)
            }
        }
    }

    fn validate_schedule_config(schedule: &ScheduleConfig) -> Result<(), AppError> {
        match schedule {
            ScheduleConfig::Once { run_at } => {
                let _ = parse_utc_datetime(run_at)?;
            }
            ScheduleConfig::Daily { hour, minute } => {
                Self::validate_schedule_time(*hour, *minute)?;
            }
            ScheduleConfig::Weekly {
                weekdays,
                hour,
                minute,
            } => {
                Self::validate_schedule_time(*hour, *minute)?;
                if weekdays.is_empty() {
                    return Err(AppError::BadRequest(
                        "Weekly schedule must include at least one weekday".to_string(),
                    ));
                }
            }
            ScheduleConfig::Interval { every_seconds } => {
                if *every_seconds == 0 {
                    return Err(AppError::BadRequest(
                        "Interval schedule must be at least 1 second".to_string(),
                    ));
                }
            }
        }

        Ok(())
    }

    fn validate_schedule_time(hour: u8, minute: u8) -> Result<(), AppError> {
        if hour > 23 {
            return Err(AppError::BadRequest(format!(
                "Schedule hour must be in range [0, 23], got {}",
                hour
            )));
        }
        if minute > 59 {
            return Err(AppError::BadRequest(format!(
                "Schedule minute must be in range [0, 59], got {}",
                minute
            )));
        }
        Ok(())
    }

    pub(super) fn initialize_schedule_state(
        &self,
        mut definition: ProcessDefinition,
    ) -> Result<ProcessDefinition, AppError> {
        if definition.mode != ProcessMode::Schedule {
            definition.schedule = None;
            definition.schedule_state = ScheduleState::default();
            return Ok(definition);
        }

        let schedule = definition.schedule.as_ref().ok_or_else(|| {
            AppError::BadRequest("Scheduled process must include a schedule".to_string())
        })?;

        if definition.schedule_state.next_run_at.is_none() {
            definition.schedule_state.next_run_at =
                compute_initial_next_run(schedule, Utc::now())?.map(|dt| dt.to_rfc3339());
        }

        Ok(definition)
    }

    pub(super) async fn ensure_schedule_task(
        self: &std::sync::Arc<Self>,
        id: &str,
    ) -> Result<(), AppError> {
        self.cancel_schedule_task(id).await;

        let Some(definition) = self.load_definition(id).await? else {
            return Ok(());
        };

        if definition.mode != ProcessMode::Schedule || !definition.auto_start {
            return Ok(());
        }

        let (cancel_tx, cancel_rx) = oneshot::channel();
        let process_id = id.to_string();
        let manager = self.clone();
        let join_handle = tokio::spawn(async move {
            manager.schedule_loop(process_id, cancel_rx).await;
        });

        let mut tasks = self.schedule_tasks.write().await;
        tasks.insert(
            id.to_string(),
            ScheduleTaskHandle {
                cancel_tx,
                join_handle,
            },
        );
        Ok(())
    }

    pub(super) async fn cancel_schedule_task(&self, id: &str) {
        let handle = {
            let mut tasks = self.schedule_tasks.write().await;
            tasks.remove(id)
        };

        if let Some(handle) = handle {
            let _ = handle.cancel_tx.send(());
            handle.join_handle.abort();
        }
    }

    async fn schedule_loop(
        self: std::sync::Arc<Self>,
        id: String,
        mut cancel_rx: oneshot::Receiver<()>,
    ) {
        loop {
            let Some(definition) = self.load_definition(&id).await.ok().flatten() else {
                return;
            };

            if definition.mode != ProcessMode::Schedule {
                return;
            }

            let Some(next_run_at) = definition.schedule_state.next_run_at.as_deref() else {
                return;
            };

            let next_run = match parse_utc_datetime(next_run_at) {
                Ok(next_run) => next_run,
                Err(err) => {
                    error!(
                        "Failed to parse next schedule run for process {}: {}",
                        id, err
                    );
                    return;
                }
            };

            let now = Utc::now();
            if next_run > now {
                let wait = match (next_run - now).to_std() {
                    Ok(wait) => wait,
                    Err(_) => Duration::from_secs(0),
                };
                let sleep = tokio::time::sleep(wait);
                tokio::pin!(sleep);
                tokio::select! {
                    _ = &mut cancel_rx => return,
                    _ = &mut sleep => {}
                }
            }

            tokio::select! {
                _ = &mut cancel_rx => return,
                result = self.run_schedule_trigger(&id, ScheduleTriggerSource::Scheduled(next_run)) => {
                    if let Err(err) = result {
                        error!("Scheduled trigger failed for process {}: {}", id, err);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        }
    }

    pub(super) async fn run_schedule_trigger(
        self: &std::sync::Arc<Self>,
        id: &str,
        source: ScheduleTriggerSource,
    ) -> Result<(), AppError> {
        let definition = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        if definition.mode != ProcessMode::Schedule {
            return Err(AppError::BadRequest(format!(
                "Process {} is not configured in schedule mode",
                id
            )));
        }

        let schedule = definition.schedule.as_ref().ok_or_else(|| {
            AppError::BadRequest(format!(
                "Scheduled process {} is missing schedule configuration",
                id
            ))
        })?;

        let mut running_instances = self.running_instance_indices(id).await;
        running_instances.sort_unstable();

        let mut updated_definition = definition.clone();
        let trigger_time = Utc::now();
        let mut action = "started";

        let selected_instance = match source {
            ScheduleTriggerSource::Scheduled(due_at) => {
                updated_definition.schedule_state.last_triggered_at =
                    Some(trigger_time.to_rfc3339());
                updated_definition.schedule_state.trigger_count += 1;
                updated_definition.schedule_state.next_run_at =
                    compute_next_run_after_trigger(schedule, trigger_time)?
                        .map(|dt| dt.to_rfc3339());

                if !running_instances.is_empty() {
                    match definition.schedule_overlap_policy {
                        ScheduleOverlapPolicy::Ignore => {
                            action = "ignored";
                            updated_definition.schedule_state.last_skipped_at =
                                Some(trigger_time.to_rfc3339());
                            self.save_definition(&updated_definition).await?;
                            self.event_bus.publish(
                                "process.schedule_triggered",
                                serde_json::json!({
                                    "process_id": id,
                                    "action": action,
                                    "due_at": due_at.to_rfc3339(),
                                    "triggered_at": trigger_time.to_rfc3339(),
                                    "overlap_policy": definition.schedule_overlap_policy,
                                    "running_instances": running_instances,
                                    "next_run_at": updated_definition.schedule_state.next_run_at,
                                }),
                            );
                            return Ok(());
                        }
                        ScheduleOverlapPolicy::Restart => {
                            self.stop_process(id).await?;
                            tokio::time::sleep(Duration::from_millis(100)).await;
                            action = "restarted";
                        }
                        ScheduleOverlapPolicy::StartNew => {
                            action = "started_new";
                        }
                    }
                }

                self.save_definition(&updated_definition).await?;
                let selected_instance = self
                    .select_schedule_instance_index(
                        &definition,
                        matches!(
                            definition.schedule_overlap_policy,
                            ScheduleOverlapPolicy::StartNew
                        ),
                    )
                    .await?;
                self.event_bus.publish(
                    "process.schedule_triggered",
                    serde_json::json!({
                        "process_id": id,
                        "action": action,
                        "due_at": due_at.to_rfc3339(),
                        "triggered_at": trigger_time.to_rfc3339(),
                        "overlap_policy": definition.schedule_overlap_policy,
                        "instance": selected_instance,
                        "next_run_at": updated_definition.schedule_state.next_run_at,
                    }),
                );
                selected_instance
            }
            ScheduleTriggerSource::Manual => {
                if !running_instances.is_empty() {
                    match definition.schedule_overlap_policy {
                        ScheduleOverlapPolicy::Ignore => return Ok(()),
                        ScheduleOverlapPolicy::Restart => {
                            self.stop_process(id).await?;
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                        ScheduleOverlapPolicy::StartNew => {}
                    }
                }

                self.select_schedule_instance_index(
                    &definition,
                    matches!(
                        definition.schedule_overlap_policy,
                        ScheduleOverlapPolicy::StartNew
                    ),
                )
                .await?
            }
        };

        self.ensure_runtime_instance_slot(
            id,
            selected_instance,
            selected_instance >= definition.instance_count,
        )
        .await;
        self.start_instance_with_mode(&definition, selected_instance)
            .await?;
        Ok(())
    }

    pub(super) async fn trigger_scheduled_process(
        self: &std::sync::Arc<Self>,
        id: &str,
    ) -> Result<(), AppError> {
        self.run_schedule_trigger(id, ScheduleTriggerSource::Manual)
            .await
    }

    async fn running_instance_indices(&self, id: &str) -> Vec<u32> {
        let keys = self.instance_keys(id).await;
        let instances = self.instances.read().await;
        let mut running = Vec::new();
        for key in keys {
            if let Some(instance_mutex) = instances.get(&key) {
                let proc = instance_mutex.lock().await;
                if proc.status == ProcessStatus::Running || proc.status == ProcessStatus::Starting {
                    running.push(key.1);
                }
            }
        }
        running
    }

    async fn select_schedule_instance_index(
        &self,
        def: &ProcessDefinition,
        allow_new_instance: bool,
    ) -> Result<u32, AppError> {
        for idx in 0..def.instance_count {
            self.ensure_runtime_instance_slot(&def.id, idx, false).await;
            let instances = self.instances.read().await;
            if let Some(instance_mutex) = instances.get(&(def.id.clone(), idx)) {
                let proc = instance_mutex.lock().await;
                if proc.status != ProcessStatus::Running && proc.status != ProcessStatus::Starting {
                    return Ok(idx);
                }
            }
        }

        if allow_new_instance {
            return Ok(self.next_ephemeral_instance_index(&def.id).await);
        }

        Err(AppError::Internal(format!(
            "No available instance slot for scheduled process {}",
            def.id
        )))
    }

    async fn next_ephemeral_instance_index(&self, id: &str) -> u32 {
        let mut max_idx = {
            let instances = self.instances.read().await;
            instances
                .keys()
                .filter(|(proc_id, _)| proc_id == id)
                .map(|(_, idx)| *idx)
                .max()
                .unwrap_or(0)
        };

        let log_dir = self.log_dir.join(id);
        if let Ok(entries) = std::fs::read_dir(log_dir) {
            for entry in entries.flatten() {
                let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else {
                    continue;
                };
                let Some(idx_str) = name.strip_prefix("instance-") else {
                    continue;
                };
                if let Ok(idx) = idx_str.parse::<u32>() {
                    max_idx = max_idx.max(idx);
                }
            }
        }

        max_idx.saturating_add(1)
    }
}
