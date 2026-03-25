use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::process::Command;
use tokio::sync::{broadcast, oneshot, Mutex};
use tracing::{debug, error, info, warn};

use crate::error::AppError;
use crate::services::event_bus::Event;
use crate::services::pty_manager::{
    CreatePtyRequest, PtySessionExitedEvent, PtySessionType, PTY_SESSION_EXITED_TOPIC,
};

#[cfg(unix)]
use super::log_utils::resolve_username;
use super::runtime::RunningProcess;
use super::{ProcessDefinition, ProcessManager, ProcessMode, ProcessStatus, RestartStrategy};

impl ProcessManager {
    pub async fn start_process(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        let def = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        self.ensure_runtime_instances(id, def.instance_count).await;

        if def.mode == ProcessMode::Schedule {
            self.trigger_scheduled_process(id).await
        } else {
            self.start_process_internal(id).await
        }
    }

    fn build_command(def: &ProcessDefinition) -> Command {
        let mut cmd = Command::new(&def.command);
        cmd.args(&def.args);
        let cwd = if def.cwd.is_empty() || def.cwd == "." {
            ".".to_string()
        } else {
            def.cwd.clone()
        };
        cmd.current_dir(&cwd);
        for (k, v) in &def.env {
            cmd.env(k, v);
        }
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        #[cfg(unix)]
        {
            if let Some(ref run_as) = def.run_as {
                let is_root = unsafe { libc::geteuid() } == 0;
                if is_root {
                    if let Ok(uid) = run_as.parse::<u32>() {
                        info!("Running process {} as UID {}", def.name, uid);
                        cmd.uid(uid);
                    } else {
                        match resolve_username(run_as) {
                            Some((uid, gid)) => {
                                info!(
                                    "Running process {} as user {} (UID={}, GID={})",
                                    def.name, run_as, uid, gid
                                );
                                cmd.uid(uid);
                                cmd.gid(gid);
                            }
                            None => {
                                warn!(
                                    "User '{}' not found, ignoring run_as for process {}",
                                    run_as, def.name
                                );
                            }
                        }
                    }
                } else {
                    warn!(
                        "Not running as root, ignoring run_as='{}' for process {}",
                        run_as, def.name
                    );
                }
            }
        }

        cmd
    }

    pub(super) async fn start_process_internal(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        let def = self
            .load_definition(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        self.ensure_runtime_instances(id, def.instance_count).await;

        let mut errors = Vec::new();
        for instance_idx in 0..def.instance_count {
            if let Err(err) = self.start_instance(&def, instance_idx).await {
                errors.push(format!("instance {}: {}", instance_idx, err));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(AppError::Internal(format!(
                "Failed to start all instances for {}: {}",
                id,
                errors.join("; ")
            )))
        }
    }

    async fn start_instance(
        self: &Arc<Self>,
        def: &ProcessDefinition,
        instance_idx: u32,
    ) -> Result<(), AppError> {
        self.ensure_runtime_instance_slot(
            &def.id,
            instance_idx,
            instance_idx >= def.instance_count,
        )
        .await;
        self.start_instance_with_mode(def, instance_idx).await
    }

    pub(super) async fn start_instance_with_mode(
        self: &Arc<Self>,
        def: &ProcessDefinition,
        instance_idx: u32,
    ) -> Result<(), AppError> {
        let key = (def.id.clone(), instance_idx);
        let instances = self.instances.read().await;
        let instance_mutex = instances
            .get(&key)
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", def.id)))?;
        let mut proc = instance_mutex.lock().await;

        if proc.status == ProcessStatus::Running {
            return Ok(());
        }

        proc.ephemeral = instance_idx >= def.instance_count;
        proc.status = ProcessStatus::Starting;

        let proc_log_dir = self
            .log_dir
            .join(&def.id)
            .join(format!("instance-{}", instance_idx));
        let _ = std::fs::create_dir_all(&proc_log_dir);

        if def.pty_mode {
            let event_rx = self.event_bus.subscribe();
            let pty_name = format!("{}-{}", def.name, instance_idx);
            match self
                .pty_manager
                .create_session(CreatePtyRequest {
                    name: Some(pty_name),
                    session_type: PtySessionType::ProcessDaemon {
                        process_id: def.id.clone(),
                    },
                    command: def.command.clone(),
                    args: def.args.clone(),
                    cwd: Some(def.cwd.clone()),
                    env: def.env.clone(),
                    cols: 80,
                    rows: 24,
                })
                .await
            {
                Ok(session_info) => {
                    let session = self
                        .pty_manager
                        .get_session_handle(&session_info.session_id)
                        .ok_or_else(|| {
                            AppError::Internal(format!(
                                "Failed to get PTY session {} after creation",
                                session_info.session_id
                            ))
                        })?;

                    proc.child = None;
                    proc.pty_session_id = Some(session_info.session_id.clone());
                    proc.pid = session_info.pid;
                    proc.status = ProcessStatus::Running;
                    proc.started_at = Some(Utc::now());
                    proc.exit_code = None;
                    let (cancel_tx, cancel_rx) = oneshot::channel();
                    proc.cancel_tx = Some(cancel_tx);
                    let session_id = session_info.session_id.clone();

                    Self::spawn_pty_log_task(
                        self.event_bus.clone(),
                        session.subscribe_output(),
                        def.id.clone(),
                        instance_idx,
                        proc_log_dir,
                        def.log_config.clone(),
                    );

                    self.publish_status_changed(
                        &def.id,
                        instance_idx,
                        "running",
                        session_info.pid,
                        None,
                        Some(&session_info.session_id),
                        None,
                    );

                    info!(
                        "Started PTY process: {} instance={} (pty_session_id={})",
                        def.name,
                        instance_idx,
                        proc.pty_session_id.as_deref().unwrap_or_default()
                    );
                    drop(proc);
                    drop(instances);

                    let mgr = self.clone();
                    let proc_id = def.id.clone();
                    tokio::spawn(mgr.supervise_pty_process(
                        proc_id,
                        instance_idx,
                        session_id,
                        cancel_rx,
                        event_rx,
                    ));
                    return Ok(());
                }
                Err(e) => {
                    proc.status = ProcessStatus::Errored;
                    error!(
                        "Failed to start PTY process {} instance {}: {}",
                        def.name, instance_idx, e
                    );
                    return Err(AppError::Internal(format!(
                        "Failed to start PTY process: {}",
                        e
                    )));
                }
            }
        }

        let mut cmd = Self::build_command(def);
        match cmd.spawn() {
            Ok(mut child) => {
                let pid = child.id();
                proc.pty_session_id = None;
                proc.pid = pid;
                proc.status = ProcessStatus::Running;
                proc.started_at = Some(Utc::now());
                proc.exit_code = None;

                Self::spawn_log_tasks(
                    &self.event_bus,
                    &mut child,
                    &def.id,
                    instance_idx,
                    &proc_log_dir,
                    &def.log_config,
                );

                proc.child = Some(child);
                self.publish_status_changed(
                    &def.id,
                    instance_idx,
                    "running",
                    pid,
                    None,
                    None,
                    None,
                );

                info!(
                    "Started process: {} instance={} (PID: {:?})",
                    def.name, instance_idx, pid
                );

                let (cancel_tx, cancel_rx) = oneshot::channel();
                proc.cancel_tx = Some(cancel_tx);
                drop(proc);
                drop(instances);

                let mgr = self.clone();
                let proc_id = def.id.clone();
                tokio::spawn(mgr.supervise_process(proc_id, instance_idx, cancel_rx));
                Ok(())
            }
            Err(e) => {
                proc.status = ProcessStatus::Errored;
                error!(
                    "Failed to start process {} instance {}: {}",
                    def.name, instance_idx, e
                );
                Err(AppError::Internal(format!("Failed to start: {}", e)))
            }
        }
    }

    async fn wait_for_pty_exit_event(
        event_rx: &mut broadcast::Receiver<Event>,
        session_id: &str,
    ) -> Result<PtySessionExitedEvent, broadcast::error::RecvError> {
        loop {
            let event = event_rx.recv().await?;
            if event.topic != PTY_SESSION_EXITED_TOPIC {
                continue;
            }

            match serde_json::from_value::<PtySessionExitedEvent>(event.payload) {
                Ok(exit_event) if exit_event.session_id == session_id => return Ok(exit_event),
                Ok(_) => continue,
                Err(err) => {
                    warn!(
                        "Failed to decode PTY exit event for session {}: {}",
                        session_id, err
                    );
                }
            }
        }
    }

    async fn supervise_pty_process(
        self: Arc<Self>,
        id: String,
        instance_idx: u32,
        mut session_id: String,
        mut cancel_rx: oneshot::Receiver<()>,
        mut event_rx: broadcast::Receiver<Event>,
    ) {
        loop {
            let exit_event = tokio::select! {
                _ = &mut cancel_rx => {
                    debug!("PTY supervisor cancelled for process {} instance {}", id, instance_idx);
                    return;
                }
                result = Self::wait_for_pty_exit_event(&mut event_rx, &session_id) => match result {
                    Ok(event) => event,
                    Err(broadcast::error::RecvError::Closed) => {
                        warn!(
                            "PTY supervisor event stream closed for process {} instance {}",
                            id, instance_idx
                        );
                        return;
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(
                            "PTY supervisor lagged for process {} instance {} (skipped {})",
                            id, instance_idx, skipped
                        );
                        continue;
                    }
                }
            };

            let exit_code = Some(exit_event.exit_code);
            let success = exit_event.success;

            if exit_event.session_id != session_id {
                continue;
            }

            if self.pty_manager.close_session(&session_id).await.is_err() {
                debug!(
                    "PTY session {} already closed for process {} instance {}",
                    session_id, id, instance_idx
                );
            }

            info!(
                "PTY process {} instance {} exited with code: {:?}",
                id, instance_idx, exit_code
            );

            let def = match self.load_definition(&id).await {
                Ok(Some(d)) => d,
                _ => return,
            };

            let should_restart = {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let Some(proc_mutex) = instances.get(&key) else {
                    return;
                };
                let mut proc = proc_mutex.lock().await;

                if proc.pty_session_id.as_deref() != Some(session_id.as_str()) {
                    return;
                }

                proc.child = None;
                proc.pty_session_id = None;
                proc.pid = None;
                proc.exit_code = exit_code;

                proc.status = if success {
                    ProcessStatus::Stopped
                } else {
                    ProcessStatus::Errored
                };

                self.publish_status_changed(
                    &id,
                    instance_idx,
                    &format!("{:?}", proc.status).to_lowercase(),
                    None,
                    exit_code,
                    None,
                    None,
                );

                let policy = &def.restart_policy;
                match policy.strategy {
                    RestartStrategy::Always => policy
                        .max_retries
                        .map_or(true, |max| proc.restart_count < max),
                    RestartStrategy::OnFailure => {
                        if success {
                            false
                        } else {
                            policy
                                .max_retries
                                .map_or(true, |max| proc.restart_count < max)
                        }
                    }
                    RestartStrategy::Never => false,
                }
            };

            if !should_restart {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                if let Some(proc_mutex) = instances.get(&key) {
                    let mut proc = proc_mutex.lock().await;
                    if proc.status == ProcessStatus::Errored {
                        proc.status = ProcessStatus::Failed;
                        self.publish_status_changed(
                            &id,
                            instance_idx,
                            "failed",
                            None,
                            proc.exit_code,
                            None,
                            Some("Max restart retries exceeded"),
                        );
                    }
                }
                return;
            }

            let delay = {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let Some(proc_mutex) = instances.get(&key) else {
                    return;
                };
                let mut proc = proc_mutex.lock().await;
                proc.restart_count += 1;
                let base_delay = def.restart_policy.delay_ms;
                let multiplier = def.restart_policy.backoff_multiplier;
                let delay_ms = (base_delay as f64
                    * multiplier.powi(proc.restart_count.saturating_sub(1) as i32))
                    as u64;
                Duration::from_millis(delay_ms.min(30_000))
            };

            info!(
                "Restarting PTY process {} instance {} in {:?}",
                def.name, instance_idx, delay
            );
            tokio::time::sleep(delay).await;

            let proc_log_dir = self
                .log_dir
                .join(&id)
                .join(format!("instance-{}", instance_idx));
            let _ = std::fs::create_dir_all(&proc_log_dir);

            let pty_name = format!("{}-{}", def.name, instance_idx);
            match self
                .pty_manager
                .create_session(CreatePtyRequest {
                    name: Some(pty_name),
                    session_type: PtySessionType::ProcessDaemon {
                        process_id: id.clone(),
                    },
                    command: def.command.clone(),
                    args: def.args.clone(),
                    cwd: Some(def.cwd.clone()),
                    env: def.env.clone(),
                    cols: 80,
                    rows: 24,
                })
                .await
            {
                Ok(session_info) => {
                    let session = match self
                        .pty_manager
                        .get_session_handle(&session_info.session_id)
                    {
                        Some(session) => session,
                        None => {
                            error!(
                                "Failed to get PTY session {} after restart for process {} instance {}",
                                session_info.session_id, def.name, instance_idx
                            );
                            let instances = self.instances.read().await;
                            let key = (id.clone(), instance_idx);
                            if let Some(proc_mutex) = instances.get(&key) {
                                let mut proc = proc_mutex.lock().await;
                                proc.status = ProcessStatus::Failed;
                                proc.pty_session_id = None;
                                proc.pid = None;
                            }
                            return;
                        }
                    };

                    let (new_cancel_tx, new_cancel_rx) = oneshot::channel();
                    {
                        let instances = self.instances.read().await;
                        let key = (id.clone(), instance_idx);
                        let Some(proc_mutex) = instances.get(&key) else {
                            return;
                        };
                        let mut proc = proc_mutex.lock().await;
                        proc.child = None;
                        proc.pty_session_id = Some(session_info.session_id.clone());
                        proc.pid = session_info.pid;
                        proc.status = ProcessStatus::Running;
                        proc.started_at = Some(Utc::now());
                        proc.exit_code = None;
                        proc.cancel_tx = Some(new_cancel_tx);
                    }

                    Self::spawn_pty_log_task(
                        self.event_bus.clone(),
                        session.subscribe_output(),
                        id.clone(),
                        instance_idx,
                        proc_log_dir,
                        def.log_config.clone(),
                    );

                    self.publish_status_changed(
                        &id,
                        instance_idx,
                        "running",
                        session_info.pid,
                        None,
                        Some(&session_info.session_id),
                        None,
                    );

                    info!(
                        "Restarted PTY process: {} instance={} (pty_session_id={})",
                        def.name, instance_idx, session_info.session_id
                    );

                    session_id = session_info.session_id;
                    cancel_rx = new_cancel_rx;
                    continue;
                }
                Err(err) => {
                    error!(
                        "Failed to restart PTY process {} instance {}: {}",
                        def.name, instance_idx, err
                    );
                    let instances = self.instances.read().await;
                    let key = (id.clone(), instance_idx);
                    if let Some(proc_mutex) = instances.get(&key) {
                        let mut proc = proc_mutex.lock().await;
                        proc.status = ProcessStatus::Failed;
                        proc.pty_session_id = None;
                        proc.pid = None;
                    }
                }
            }
            return;
        }
    }

    async fn supervise_process(
        self: Arc<Self>,
        id: String,
        instance_idx: u32,
        mut cancel_rx: oneshot::Receiver<()>,
    ) {
        loop {
            let mut child = {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let Some(proc_mutex) = instances.get(&key) else {
                    return;
                };
                let mut proc = proc_mutex.lock().await;
                match proc.child.take() {
                    Some(c) => c,
                    None => return,
                }
            };

            let exit_status = tokio::select! {
                result = child.wait() => result.ok(),
                _ = &mut cancel_rx => {
                    debug!("Supervisor cancelled for process {} instance {}", id, instance_idx);
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return;
                }
            };

            let exit_code = exit_status.and_then(|s| s.code());
            let success = exit_status.map(|s| s.success()).unwrap_or(false);

            info!(
                "Process {} instance {} exited with code: {:?}",
                id, instance_idx, exit_code
            );

            let def = match self.load_definition(&id).await {
                Ok(Some(d)) => d,
                _ => return,
            };

            let should_restart = {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let Some(proc_mutex) = instances.get(&key) else {
                    return;
                };
                let mut proc = proc_mutex.lock().await;
                proc.child = None;
                proc.pid = None;
                proc.exit_code = exit_code;

                proc.status = if success {
                    ProcessStatus::Stopped
                } else {
                    ProcessStatus::Errored
                };

                self.publish_status_changed(
                    &id,
                    instance_idx,
                    &format!("{:?}", proc.status).to_lowercase(),
                    None,
                    exit_code,
                    None,
                    None,
                );

                let policy = &def.restart_policy;
                match policy.strategy {
                    RestartStrategy::Always => policy
                        .max_retries
                        .map_or(true, |max| proc.restart_count < max),
                    RestartStrategy::OnFailure => {
                        if success {
                            false
                        } else {
                            policy
                                .max_retries
                                .map_or(true, |max| proc.restart_count < max)
                        }
                    }
                    RestartStrategy::Never => false,
                }
            };

            if !should_restart {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                if let Some(proc_mutex) = instances.get(&key) {
                    let mut proc = proc_mutex.lock().await;
                    if proc.status == ProcessStatus::Errored {
                        proc.status = ProcessStatus::Failed;
                        self.publish_status_changed(
                            &id,
                            instance_idx,
                            "failed",
                            None,
                            proc.exit_code,
                            None,
                            Some("Max restart retries exceeded"),
                        );
                    }
                }
                return;
            }

            let delay = {
                let instances = self.instances.read().await;
                let key = (id.clone(), instance_idx);
                let proc_mutex = instances.get(&key).unwrap();
                let mut proc = proc_mutex.lock().await;
                proc.restart_count += 1;
                let base_delay = def.restart_policy.delay_ms;
                let multiplier = def.restart_policy.backoff_multiplier;
                let delay_ms = (base_delay as f64
                    * multiplier.powi(proc.restart_count.saturating_sub(1) as i32))
                    as u64;
                Duration::from_millis(delay_ms.min(30_000))
            };

            info!(
                "Restarting process {} instance {} in {:?}",
                def.name, instance_idx, delay
            );
            tokio::time::sleep(delay).await;

            let mut cmd = Self::build_command(&def);
            let proc_log_dir = self
                .log_dir
                .join(&id)
                .join(format!("instance-{}", instance_idx));
            let _ = std::fs::create_dir_all(&proc_log_dir);

            match cmd.spawn() {
                Ok(mut child) => {
                    let pid = child.id();

                    Self::spawn_log_tasks(
                        &self.event_bus,
                        &mut child,
                        &id,
                        instance_idx,
                        &proc_log_dir,
                        &def.log_config,
                    );

                    let (new_cancel_tx, new_cancel_rx) = oneshot::channel();
                    {
                        let instances = self.instances.read().await;
                        let key = (id.clone(), instance_idx);
                        if let Some(proc_mutex) = instances.get(&key) {
                            let mut proc = proc_mutex.lock().await;
                            proc.child = Some(child);
                            proc.pid = pid;
                            proc.status = ProcessStatus::Running;
                            proc.started_at = Some(Utc::now());
                            proc.exit_code = None;
                            proc.cancel_tx = Some(new_cancel_tx);
                        }
                    }

                    self.publish_status_changed(
                        &id,
                        instance_idx,
                        "running",
                        pid,
                        None,
                        None,
                        None,
                    );

                    info!(
                        "Restarted process: {} instance={} (PID: {:?})",
                        def.name, instance_idx, pid
                    );

                    cancel_rx = new_cancel_rx;
                }
                Err(e) => {
                    error!(
                        "Failed to restart process {} instance {}: {}",
                        def.name, instance_idx, e
                    );
                    let instances = self.instances.read().await;
                    let key = (id.clone(), instance_idx);
                    if let Some(proc_mutex) = instances.get(&key) {
                        let mut proc = proc_mutex.lock().await;
                        proc.status = ProcessStatus::Failed;
                    }
                    return;
                }
            }
        }
    }

    pub async fn stop_process(&self, id: &str) -> Result<(), AppError> {
        let keys = self.instance_keys(id).await;
        if keys.is_empty() {
            return Err(AppError::NotFound(format!("Process {} not found", id)));
        }

        for (_, instance_idx) in keys {
            self.stop_instance(id, instance_idx).await?;
        }

        info!("Stopped process: {}", id);
        Ok(())
    }

    pub(super) async fn stop_instance(&self, id: &str, instance_idx: u32) -> Result<(), AppError> {
        let instances = self.instances.read().await;
        let key = (id.to_string(), instance_idx);
        let instance_mutex = instances
            .get(&key)
            .ok_or_else(|| AppError::NotFound(format!("Process {} not found", id)))?;
        let mut proc = instance_mutex.lock().await;
        let pty_session_id = proc.pty_session_id.clone();

        if let Some(cancel_tx) = proc.cancel_tx.take() {
            let _ = cancel_tx.send(());
        }

        if let Some(child) = proc.child.as_mut() {
            let _ = child.kill().await;
        }

        proc.child = None;
        proc.pty_session_id = None;
        proc.pid = None;
        proc.status = ProcessStatus::Stopped;
        drop(proc);
        drop(instances);

        if let Some(session_id) = pty_session_id {
            let _ = self.pty_manager.close_session(&session_id).await;
        }

        self.publish_status_changed(id, instance_idx, "stopped", None, None, None, None);
        Ok(())
    }

    pub(super) async fn is_running(&self, id: &str) -> bool {
        let keys = self.instance_keys(id).await;
        let instances = self.instances.read().await;
        for key in keys {
            if let Some(instance_mutex) = instances.get(&key) {
                let proc = instance_mutex.lock().await;
                if proc.status == ProcessStatus::Running {
                    return true;
                }
            }
        }
        false
    }

    pub(super) async fn ensure_runtime_instances(&self, id: &str, instance_count: u32) {
        let mut instances = self.instances.write().await;
        for idx in 0..instance_count {
            let key = (id.to_string(), idx);
            instances.entry(key).or_insert_with(|| {
                Mutex::new(RunningProcess {
                    child: None,
                    pty_session_id: None,
                    status: ProcessStatus::Created,
                    pid: None,
                    restart_count: 0,
                    started_at: None,
                    exit_code: None,
                    cancel_tx: None,
                    ephemeral: false,
                })
            });
        }
    }

    pub(super) async fn ensure_runtime_instance_slot(
        &self,
        id: &str,
        instance_idx: u32,
        ephemeral: bool,
    ) {
        let mut instances = self.instances.write().await;
        let key = (id.to_string(), instance_idx);
        instances.entry(key).or_insert_with(|| {
            Mutex::new(RunningProcess {
                child: None,
                pty_session_id: None,
                status: ProcessStatus::Created,
                pid: None,
                restart_count: 0,
                started_at: None,
                exit_code: None,
                cancel_tx: None,
                ephemeral,
            })
        });
    }

    pub(super) async fn trim_runtime_instances(&self, id: &str, instance_count: u32) {
        let keys_to_remove = {
            let instances = self.instances.read().await;
            instances
                .keys()
                .filter(|(proc_id, idx)| proc_id == id && *idx >= instance_count)
                .cloned()
                .collect::<Vec<_>>()
        };

        for (_, idx) in &keys_to_remove {
            let _ = self.stop_instance(id, *idx).await;
        }

        let mut instances = self.instances.write().await;
        for (_, idx) in &keys_to_remove {
            let stale_dir = self.log_dir.join(id).join(format!("instance-{}", idx));
            if stale_dir.exists() {
                let _ = std::fs::remove_dir_all(&stale_dir);
            }
        }
        for key in keys_to_remove {
            instances.remove(&key);
        }
    }

    pub(super) async fn instance_keys(&self, id: &str) -> Vec<(String, u32)> {
        let instances = self.instances.read().await;
        let mut keys: Vec<(String, u32)> = instances
            .keys()
            .filter(|(proc_id, _)| proc_id == id)
            .cloned()
            .collect();
        keys.sort_by_key(|(_, idx)| *idx);
        keys
    }

    pub(super) async fn instance_exists(&self, id: &str, instance_idx: u32) -> bool {
        let instances = self.instances.read().await;
        instances.contains_key(&(id.to_string(), instance_idx))
    }

    pub async fn restart_process(self: &Arc<Self>, id: &str) -> Result<(), AppError> {
        self.stop_process(id).await?;
        tokio::time::sleep(Duration::from_millis(200)).await;
        self.start_process(id).await
    }

    pub async fn delete_process(&self, id: &str) -> Result<(), AppError> {
        self.cancel_schedule_task(id).await;
        let _ = self.stop_process(id).await;

        {
            let mut instances = self.instances.write().await;
            let keys_to_remove: Vec<_> = instances
                .keys()
                .filter(|(proc_id, _)| proc_id == id)
                .cloned()
                .collect();
            for key in keys_to_remove {
                instances.remove(&key);
            }
        }

        sqlx::query("DELETE FROM processes WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        let log_dir = self.log_dir.join(id);
        if log_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&log_dir) {
                warn!("Failed to remove log dir for {}: {}", id, e);
            }
        }

        info!("Deleted process: {}", id);
        Ok(())
    }
}
