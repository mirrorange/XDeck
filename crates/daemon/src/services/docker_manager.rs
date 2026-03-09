use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use bollard::container::{
    InspectContainerOptions, ListContainersOptions, LogsOptions, RemoveContainerOptions,
    RestartContainerOptions, StartContainerOptions, StopContainerOptions,
};
use bollard::image::{ListImagesOptions, RemoveImageOptions};
use bollard::network::ListNetworksOptions;
use bollard::system::EventsOptions;
use bollard::Docker;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::error::AppError;
use crate::services::event_bus::SharedEventBus;

// ── Data Structures ─────────────────────────────────────────────

/// Detected container runtime engine.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ContainerRuntime {
    Docker,
    Podman,
}

/// Docker/Podman connection status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerStatus {
    pub available: bool,
    pub runtime: Option<ContainerRuntime>,
    pub version: Option<String>,
    pub api_version: Option<String>,
    pub socket_path: Option<String>,
    pub error: Option<String>,
}

/// Simplified container info for list view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub created: i64,
    pub ports: Vec<PortMapping>,
    pub labels: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compose_project: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub host_ip: Option<String>,
    pub host_port: Option<u16>,
    pub container_port: u16,
    pub protocol: String,
}

/// Detailed container inspection result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerDetail {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub created: String,
    pub ports: Vec<PortMapping>,
    pub env: Vec<String>,
    pub mounts: Vec<MountInfo>,
    pub networks: HashMap<String, NetworkInfo>,
    pub labels: HashMap<String, String>,
    pub restart_policy: Option<String>,
    pub cmd: Option<Vec<String>>,
    pub entrypoint: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compose_project: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountInfo {
    pub source: String,
    pub destination: String,
    pub mode: String,
    pub rw: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInfo {
    pub network_id: String,
    pub ip_address: String,
    pub gateway: String,
}

/// Image info for list view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size: i64,
    pub created: i64,
    pub in_use: bool,
}

/// Network info for list view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerNetworkInfo {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub internal: bool,
    pub containers: usize,
}

/// Compose project info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposeProjectInfo {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub cwd: String,
    pub status: String,
    pub services: Vec<ComposeServiceInfo>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposeServiceInfo {
    pub name: String,
    pub container_id: Option<String>,
    pub state: String,
    pub image: String,
}

// ── DockerManager ───────────────────────────────────────────────

pub struct DockerManager {
    client: RwLock<Option<Docker>>,
    event_bus: SharedEventBus,
    runtime: RwLock<Option<ContainerRuntime>>,
    socket_path: RwLock<Option<String>>,
}

impl DockerManager {
    pub fn new(event_bus: SharedEventBus) -> Arc<Self> {
        let mgr = Arc::new(Self {
            client: RwLock::new(None),
            event_bus,
            runtime: RwLock::new(None),
            socket_path: RwLock::new(None),
        });

        // Try to auto-connect on creation.
        let mgr_clone = mgr.clone();
        tokio::spawn(async move {
            if let Err(e) = mgr_clone.auto_detect().await {
                warn!("Docker auto-detection failed: {}", e);
            }
        });

        mgr
    }

    /// Auto-detect Docker/Podman and connect.
    pub async fn auto_detect(&self) -> Result<(), AppError> {
        // Try Docker first, then Podman.
        if self.try_connect_docker().await.is_ok() {
            return Ok(());
        }
        if self.try_connect_podman().await.is_ok() {
            return Ok(());
        }
        Err(AppError::Internal(
            "No container runtime found (Docker or Podman)".into(),
        ))
    }

    /// Try connecting to Docker daemon.
    async fn try_connect_docker(&self) -> Result<(), AppError> {
        // Try default Docker socket paths.
        let paths = Self::docker_socket_paths();
        for path in &paths {
            if let Ok(client) = Docker::connect_with_socket(path, 5, bollard::API_DEFAULT_VERSION) {
                if client.ping().await.is_ok() {
                    info!("Connected to Docker via {}", path);
                    *self.client.write().await = Some(client);
                    *self.runtime.write().await = Some(ContainerRuntime::Docker);
                    *self.socket_path.write().await = Some(path.to_string());
                    return Ok(());
                }
            }
        }

        // Try default connection (env vars, etc.).
        if let Ok(client) = Docker::connect_with_local_defaults() {
            if client.ping().await.is_ok() {
                info!("Connected to Docker via default connection");
                *self.client.write().await = Some(client);
                *self.runtime.write().await = Some(ContainerRuntime::Docker);
                *self.socket_path.write().await = Some("default".to_string());
                return Ok(());
            }
        }

        Err(AppError::Internal("Docker not available".into()))
    }

    /// Try connecting to Podman.
    async fn try_connect_podman(&self) -> Result<(), AppError> {
        let paths = Self::podman_socket_paths();
        for path in &paths {
            if let Ok(client) = Docker::connect_with_socket(path, 5, bollard::API_DEFAULT_VERSION) {
                if client.ping().await.is_ok() {
                    info!("Connected to Podman via {}", path);
                    *self.client.write().await = Some(client);
                    *self.runtime.write().await = Some(ContainerRuntime::Podman);
                    *self.socket_path.write().await = Some(path.to_string());
                    return Ok(());
                }
            }
        }

        Err(AppError::Internal("Podman not available".into()))
    }

    /// Get Docker socket paths for the current platform.
    fn docker_socket_paths() -> Vec<String> {
        let mut paths = vec![];

        if cfg!(target_os = "linux") {
            paths.push("/var/run/docker.sock".to_string());
        } else if cfg!(target_os = "macos") {
            paths.push("/var/run/docker.sock".to_string());
            // Docker Desktop for macOS
            if let Some(home) = dirs::home_dir() {
                paths.push(format!(
                    "{}/.docker/run/docker.sock",
                    home.display()
                ));
            }
            // Colima
            if let Some(home) = dirs::home_dir() {
                paths.push(format!(
                    "{}/.colima/default/docker.sock",
                    home.display()
                ));
            }
        } else if cfg!(target_os = "windows") {
            // Windows named pipe handled by bollard default
            paths.push("//./pipe/docker_engine".to_string());
        }

        paths
    }

    /// Get Podman socket paths for the current platform.
    fn podman_socket_paths() -> Vec<String> {
        let mut paths = vec![];

        if cfg!(target_os = "linux") {
            // Root Podman
            paths.push("/run/podman/podman.sock".to_string());
            // Rootless Podman via XDG_RUNTIME_DIR
            if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
                paths.push(format!("{}/podman/podman.sock", runtime_dir));
            }
            // Common rootless fallback
            if let Ok(uid) = Self::current_uid() {
                paths.push(format!("/run/user/{}/podman/podman.sock", uid));
            }
        } else if cfg!(target_os = "macos") {
            // Podman Desktop on macOS
            if let Some(home) = dirs::home_dir() {
                paths.push(format!(
                    "{}/.local/share/containers/podman/machine/podman.sock",
                    home.display()
                ));
                paths.push(format!(
                    "{}/.local/share/containers/podman/machine/qemu/podman.sock",
                    home.display()
                ));
            }
            // Podman machine default socket
            paths.push("/var/run/podman/podman.sock".to_string());
            if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
                paths.push(format!("{}/podman/podman.sock", runtime_dir));
            }
        } else if cfg!(target_os = "windows") {
            // Podman on Windows uses named pipe
            paths.push("//./pipe/podman-machine-default".to_string());
        }

        paths
    }

    #[cfg(unix)]
    fn current_uid() -> Result<u32, std::io::Error> {
        Ok(unsafe { libc::getuid() })
    }

    #[cfg(not(unix))]
    fn current_uid() -> Result<u32, std::io::Error> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Not Unix",
        ))
    }

    /// Get a reference to the connected Docker client.
    async fn get_client(&self) -> Result<Docker, AppError> {
        self.client
            .read()
            .await
            .clone()
            .ok_or_else(|| {
                AppError::Internal("No container runtime connected. Install Docker or Podman.".into())
            })
    }

    // ── Status ──────────────────────────────────────────────────

    pub async fn status(&self) -> DockerStatus {
        let client_opt = self.client.read().await.clone();
        let runtime = self.runtime.read().await.clone();
        let socket = self.socket_path.read().await.clone();

        let Some(client) = client_opt else {
            return DockerStatus {
                available: false,
                runtime: None,
                version: None,
                api_version: None,
                socket_path: None,
                error: Some("No container runtime connected".into()),
            };
        };

        match client.version().await {
            Ok(ver) => DockerStatus {
                available: true,
                runtime,
                version: Some(ver.version.unwrap_or_default()),
                api_version: Some(ver.api_version.unwrap_or_default()),
                socket_path: socket,
                error: None,
            },
            Err(e) => DockerStatus {
                available: false,
                runtime,
                version: None,
                api_version: None,
                socket_path: socket,
                error: Some(e.to_string()),
            },
        }
    }

    /// Reconnect / re-detect runtime.
    pub async fn reconnect(&self) -> Result<DockerStatus, AppError> {
        *self.client.write().await = None;
        *self.runtime.write().await = None;
        *self.socket_path.write().await = None;
        let _ = self.auto_detect().await;
        Ok(self.status().await)
    }

    // ── Container Operations ────────────────────────────────────

    pub async fn list_containers(&self, all: bool) -> Result<Vec<ContainerInfo>, AppError> {
        let client = self.get_client().await?;

        let mut filters = HashMap::new();
        if !all {
            filters.insert("status", vec!["running"]);
        }

        let options = Some(ListContainersOptions {
            all,
            filters,
            ..Default::default()
        });

        let containers = client
            .list_containers(options)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to list containers: {}", e)))?;

        let result: Vec<ContainerInfo> = containers
            .into_iter()
            .map(|c| {
                let name = c
                    .names
                    .as_ref()
                    .and_then(|n| n.first())
                    .map(|n| n.trim_start_matches('/').to_string())
                    .unwrap_or_default();

                let ports = c
                    .ports
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| PortMapping {
                        host_ip: p.ip,
                        host_port: p.public_port,
                        container_port: p.private_port,
                        protocol: p.typ.map(|t| t.to_string()).unwrap_or("tcp".into()),
                    })
                    .collect();

                let labels = c.labels.unwrap_or_default();
                let compose_project = labels.get("com.docker.compose.project").cloned();

                ContainerInfo {
                    id: c.id.unwrap_or_default(),
                    name,
                    image: c.image.unwrap_or_default(),
                    state: c.state.unwrap_or_default(),
                    status: c.status.unwrap_or_default(),
                    created: c.created.unwrap_or(0),
                    ports,
                    labels,
                    compose_project,
                }
            })
            .collect();

        Ok(result)
    }

    pub async fn inspect_container(&self, id: &str) -> Result<ContainerDetail, AppError> {
        let client = self.get_client().await?;

        let info = client
            .inspect_container(id, None::<InspectContainerOptions>)
            .await
            .map_err(|e| match e {
                bollard::errors::Error::DockerResponseServerError {
                    status_code: 404, ..
                } => AppError::NotFound(format!("Container '{}'", id)),
                _ => AppError::Internal(format!("Failed to inspect container: {}", e)),
            })?;

        let state = info.state.as_ref();
        let config = info.config.as_ref();
        let network_settings = info.network_settings.as_ref();
        let host_config = info.host_config.as_ref();
        let labels = config
            .and_then(|c| c.labels.clone())
            .unwrap_or_default();

        let ports = network_settings
            .and_then(|ns| ns.ports.as_ref())
            .map(|ports| {
                let mut result = Vec::new();
                for (container_port_str, bindings) in ports {
                    let parts: Vec<&str> = container_port_str.split('/').collect();
                    let port: u16 = parts[0].parse().unwrap_or(0);
                    let proto = parts.get(1).unwrap_or(&"tcp").to_string();

                    if let Some(Some(bindings)) = bindings.as_ref().map(Some) {
                        for b in bindings {
                            result.push(PortMapping {
                                host_ip: b.host_ip.clone(),
                                host_port: b
                                    .host_port
                                    .as_ref()
                                    .and_then(|p| p.parse().ok()),
                                container_port: port,
                                protocol: proto.clone(),
                            });
                        }
                    } else {
                        result.push(PortMapping {
                            host_ip: None,
                            host_port: None,
                            container_port: port,
                            protocol: proto,
                        });
                    }
                }
                result
            })
            .unwrap_or_default();

        let mounts = info
            .mounts
            .unwrap_or_default()
            .into_iter()
            .map(|m| MountInfo {
                source: m.source.unwrap_or_default(),
                destination: m.destination.unwrap_or_default(),
                mode: m.mode.unwrap_or_default(),
                rw: m.rw.unwrap_or(false),
            })
            .collect();

        let networks = network_settings
            .and_then(|ns| ns.networks.as_ref())
            .map(|nets| {
                nets.iter()
                    .map(|(name, net)| {
                        (
                            name.clone(),
                            NetworkInfo {
                                network_id: net.network_id.clone().unwrap_or_default(),
                                ip_address: net.ip_address.clone().unwrap_or_default(),
                                gateway: net.gateway.clone().unwrap_or_default(),
                            },
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();

        let compose_project = labels.get("com.docker.compose.project").cloned();

        Ok(ContainerDetail {
            id: info.id.unwrap_or_default(),
            name: info
                .name
                .unwrap_or_default()
                .trim_start_matches('/')
                .to_string(),
            image: config
                .and_then(|c| c.image.clone())
                .unwrap_or_default(),
            state: state
                .and_then(|s| s.status.as_ref())
                .map(|s| s.to_string())
                .unwrap_or_default(),
            status: state
                .and_then(|s| s.status.as_ref())
                .map(|s| s.to_string())
                .unwrap_or_default(),
            created: info.created.unwrap_or_default(),
            ports,
            env: config
                .and_then(|c| c.env.clone())
                .unwrap_or_default(),
            mounts,
            networks,
            labels,
            restart_policy: host_config
                .and_then(|hc| hc.restart_policy.as_ref())
                .and_then(|rp| rp.name.as_ref())
                .map(|n| n.to_string()),
            cmd: config.and_then(|c| c.cmd.clone()),
            entrypoint: config.and_then(|c| c.entrypoint.clone()),
            compose_project,
        })
    }

    pub async fn start_container(&self, id: &str) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .start_container(id, None::<StartContainerOptions<String>>)
            .await
            .map_err(|e| match e {
                bollard::errors::Error::DockerResponseServerError {
                    status_code: 404, ..
                } => AppError::NotFound(format!("Container '{}'", id)),
                _ => AppError::Internal(format!("Failed to start container: {}", e)),
            })?;
        self.emit_container_event(id, "started").await;
        Ok(())
    }

    pub async fn stop_container(&self, id: &str) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .stop_container(
                id,
                Some(StopContainerOptions { t: 10 }),
            )
            .await
            .map_err(|e| match e {
                bollard::errors::Error::DockerResponseServerError {
                    status_code: 404, ..
                } => AppError::NotFound(format!("Container '{}'", id)),
                _ => AppError::Internal(format!("Failed to stop container: {}", e)),
            })?;
        self.emit_container_event(id, "stopped").await;
        Ok(())
    }

    pub async fn restart_container(&self, id: &str) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .restart_container(
                id,
                Some(RestartContainerOptions { t: 10 }),
            )
            .await
            .map_err(|e| match e {
                bollard::errors::Error::DockerResponseServerError {
                    status_code: 404, ..
                } => AppError::NotFound(format!("Container '{}'", id)),
                _ => AppError::Internal(format!("Failed to restart container: {}", e)),
            })?;
        self.emit_container_event(id, "restarted").await;
        Ok(())
    }

    pub async fn remove_container(&self, id: &str, force: bool) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .remove_container(
                id,
                Some(RemoveContainerOptions {
                    force,
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| match e {
                bollard::errors::Error::DockerResponseServerError {
                    status_code: 404, ..
                } => AppError::NotFound(format!("Container '{}'", id)),
                _ => AppError::Internal(format!("Failed to remove container: {}", e)),
            })?;
        self.emit_container_event(id, "removed").await;
        Ok(())
    }

    pub async fn pause_container(&self, id: &str) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .pause_container(id)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to pause container: {}", e)))?;
        self.emit_container_event(id, "paused").await;
        Ok(())
    }

    pub async fn unpause_container(&self, id: &str) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .unpause_container(id)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to unpause container: {}", e)))?;
        self.emit_container_event(id, "unpaused").await;
        Ok(())
    }

    pub async fn container_logs(
        &self,
        id: &str,
        tail: Option<&str>,
    ) -> Result<Vec<String>, AppError> {
        let client = self.get_client().await?;
        use futures_util::StreamExt;

        let options = LogsOptions::<String> {
            stdout: true,
            stderr: true,
            tail: tail.unwrap_or("200").to_string(),
            ..Default::default()
        };

        let mut stream = client.logs(id, Some(options));
        let mut lines = Vec::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(output) => {
                    lines.push(output.to_string());
                }
                Err(e) => {
                    return Err(AppError::Internal(format!(
                        "Failed to read container logs: {}",
                        e
                    )));
                }
            }
        }

        Ok(lines)
    }

    // ── Image Operations ────────────────────────────────────────

    pub async fn list_images(&self) -> Result<Vec<ImageInfo>, AppError> {
        let client = self.get_client().await?;

        // Get list of images currently in use by containers.
        let containers = client
            .list_containers(Some(ListContainersOptions::<String> {
                all: true,
                ..Default::default()
            }))
            .await
            .unwrap_or_default();

        let used_images: std::collections::HashSet<String> = containers
            .iter()
            .filter_map(|c| c.image_id.clone())
            .collect();

        let images = client
            .list_images(Some(ListImagesOptions::<String> {
                all: false,
                ..Default::default()
            }))
            .await
            .map_err(|e| AppError::Internal(format!("Failed to list images: {}", e)))?;

        let result: Vec<ImageInfo> = images
            .into_iter()
            .map(|img| ImageInfo {
                id: img.id.clone(),
                repo_tags: img.repo_tags,
                size: img.size,
                created: img.created,
                in_use: used_images.contains(&img.id),
            })
            .collect();

        Ok(result)
    }

    pub async fn remove_image(&self, id: &str, force: bool) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .remove_image(
                id,
                Some(RemoveImageOptions {
                    force,
                    ..Default::default()
                }),
                None,
            )
            .await
            .map_err(|e| AppError::Internal(format!("Failed to remove image: {}", e)))?;
        Ok(())
    }

    pub async fn prune_images(&self) -> Result<serde_json::Value, AppError> {
        let client = self.get_client().await?;
        let result = client
            .prune_images(None::<bollard::image::PruneImagesOptions<String>>)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to prune images: {}", e)))?;

        Ok(serde_json::json!({
            "images_deleted": result.images_deleted.unwrap_or_default().len(),
            "space_reclaimed": result.space_reclaimed,
        }))
    }

    // ── Network Operations ──────────────────────────────────────

    pub async fn list_networks(&self) -> Result<Vec<DockerNetworkInfo>, AppError> {
        let client = self.get_client().await?;

        let networks = client
            .list_networks(None::<ListNetworksOptions<String>>)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to list networks: {}", e)))?;

        let result: Vec<DockerNetworkInfo> = networks
            .into_iter()
            .map(|n| DockerNetworkInfo {
                id: n.id.unwrap_or_default(),
                name: n.name.unwrap_or_default(),
                driver: n.driver.unwrap_or_default(),
                scope: n.scope.unwrap_or_default(),
                internal: n.internal.unwrap_or(false),
                containers: n.containers.map(|c| c.len()).unwrap_or(0),
            })
            .collect();

        Ok(result)
    }

    pub async fn remove_network(&self, id: &str) -> Result<(), AppError> {
        let client = self.get_client().await?;
        client
            .remove_network(id)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to remove network: {}", e)))?;
        Ok(())
    }

    // ── Docker Compose Operations ───────────────────────────────

    /// Detect the compose command: `docker compose` or `docker-compose` or `podman compose`.
    async fn compose_command(&self) -> Result<Vec<String>, AppError> {
        let runtime = self.runtime.read().await;

        if let Some(ContainerRuntime::Podman) = runtime.as_ref() {
            // Check for podman-compose
            if which::which("podman-compose").is_ok() {
                return Ok(vec!["podman-compose".into()]);
            }
            // podman compose (podman v4+)
            if which::which("podman").is_ok() {
                return Ok(vec!["podman".into(), "compose".into()]);
            }
        }

        // Try `docker compose` (Docker Compose v2 plugin)
        if which::which("docker").is_ok() {
            // Verify plugin
            let output = tokio::process::Command::new("docker")
                .args(["compose", "version"])
                .output()
                .await;
            if let Ok(o) = output {
                if o.status.success() {
                    return Ok(vec!["docker".into(), "compose".into()]);
                }
            }
        }

        // legacy docker-compose
        if which::which("docker-compose").is_ok() {
            return Ok(vec!["docker-compose".into()]);
        }

        Err(AppError::Internal(
            "No compose command found (docker compose / docker-compose / podman-compose)".into(),
        ))
    }

    pub async fn compose_up(&self, project_dir: &str, file: Option<&str>) -> Result<String, AppError> {
        let cmd_parts = self.compose_command().await?;
        let mut cmd = tokio::process::Command::new(&cmd_parts[0]);
        for arg in &cmd_parts[1..] {
            cmd.arg(arg);
        }
        if let Some(f) = file {
            cmd.args(["-f", f]);
        }
        cmd.args(["up", "-d"]);
        cmd.current_dir(project_dir);

        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run compose up: {}", e)))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(AppError::Internal(format!(
                "compose up failed: {}",
                stderr
            )));
        }

        Ok(format!("{}{}", stdout, stderr))
    }

    pub async fn compose_down(&self, project_dir: &str, file: Option<&str>) -> Result<String, AppError> {
        let cmd_parts = self.compose_command().await?;
        let mut cmd = tokio::process::Command::new(&cmd_parts[0]);
        for arg in &cmd_parts[1..] {
            cmd.arg(arg);
        }
        if let Some(f) = file {
            cmd.args(["-f", f]);
        }
        cmd.arg("down");
        cmd.current_dir(project_dir);

        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run compose down: {}", e)))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(AppError::Internal(format!(
                "compose down failed: {}",
                stderr
            )));
        }

        Ok(format!("{}{}", stdout, stderr))
    }

    pub async fn compose_restart(&self, project_dir: &str, file: Option<&str>) -> Result<String, AppError> {
        let cmd_parts = self.compose_command().await?;
        let mut cmd = tokio::process::Command::new(&cmd_parts[0]);
        for arg in &cmd_parts[1..] {
            cmd.arg(arg);
        }
        if let Some(f) = file {
            cmd.args(["-f", f]);
        }
        cmd.arg("restart");
        cmd.current_dir(project_dir);

        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run compose restart: {}", e)))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(AppError::Internal(format!(
                "compose restart failed: {}",
                stderr
            )));
        }

        Ok(format!("{}{}", stdout, stderr))
    }

    pub async fn compose_pull(&self, project_dir: &str, file: Option<&str>) -> Result<String, AppError> {
        let cmd_parts = self.compose_command().await?;
        let mut cmd = tokio::process::Command::new(&cmd_parts[0]);
        for arg in &cmd_parts[1..] {
            cmd.arg(arg);
        }
        if let Some(f) = file {
            cmd.args(["-f", f]);
        }
        cmd.arg("pull");
        cmd.current_dir(project_dir);

        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run compose pull: {}", e)))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(AppError::Internal(format!(
                "compose pull failed: {}",
                stderr
            )));
        }

        Ok(format!("{}{}", stdout, stderr))
    }

    pub async fn compose_ps(
        &self,
        project_dir: &str,
        file: Option<&str>,
    ) -> Result<Vec<ComposeServiceInfo>, AppError> {
        let cmd_parts = self.compose_command().await?;
        let mut cmd = tokio::process::Command::new(&cmd_parts[0]);
        for arg in &cmd_parts[1..] {
            cmd.arg(arg);
        }
        if let Some(f) = file {
            cmd.args(["-f", f]);
        }
        cmd.args(["ps", "--format", "json", "-a"]);
        cmd.current_dir(project_dir);

        let output = cmd
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to run compose ps: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Internal(format!("compose ps failed: {}", stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        // `docker compose ps --format json` outputs one JSON object per line.
        let services: Vec<ComposeServiceInfo> = stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|line| {
                let v: serde_json::Value = serde_json::from_str(line).ok()?;
                Some(ComposeServiceInfo {
                    name: v["Service"]
                        .as_str()
                        .or_else(|| v["Name"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    container_id: v["ID"].as_str().map(|s| s.to_string()),
                    state: v["State"]
                        .as_str()
                        .or_else(|| v["Status"].as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    image: v["Image"].as_str().unwrap_or("").to_string(),
                })
            })
            .collect();

        Ok(services)
    }

    // ── Compose Project CRUD (DB-backed) ────────────────────────

    pub async fn list_compose_projects(
        &self,
        pool: &sqlx::SqlitePool,
    ) -> Result<Vec<ComposeProjectInfo>, AppError> {
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String)>(
            "SELECT id, name, file_path, cwd, status, created_at, updated_at FROM compose_projects ORDER BY name ASC",
        )
        .fetch_all(pool)
        .await
        .map_err(AppError::Database)?;

        let mut projects = Vec::new();
        for (id, name, file_path, cwd, status, created_at, updated_at) in rows {
            // Try to get service status from compose ps.
            let services = match self.compose_ps(&cwd, Some(&file_path)).await {
                Ok(s) => s,
                Err(_) => vec![],
            };

            projects.push(ComposeProjectInfo {
                id,
                name,
                file_path,
                cwd,
                status,
                services,
                created_at,
                updated_at,
            });
        }

        Ok(projects)
    }

    pub async fn add_compose_project(
        &self,
        pool: &sqlx::SqlitePool,
        name: &str,
        file_path: &str,
        cwd: &str,
    ) -> Result<ComposeProjectInfo, AppError> {
        // Validate file exists.
        let full_path = PathBuf::from(cwd).join(file_path);
        if !full_path.exists() {
            return Err(AppError::BadRequest(format!(
                "Compose file not found: {}",
                full_path.display()
            )));
        }

        let id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO compose_projects (id, name, file_path, cwd) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(file_path)
        .bind(cwd)
        .execute(pool)
        .await
        .map_err(AppError::Database)?;

        let services = self.compose_ps(cwd, Some(file_path)).await.unwrap_or_default();

        Ok(ComposeProjectInfo {
            id,
            name: name.to_string(),
            file_path: file_path.to_string(),
            cwd: cwd.to_string(),
            status: "created".to_string(),
            services,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        })
    }

    pub async fn remove_compose_project(
        &self,
        pool: &sqlx::SqlitePool,
        id: &str,
    ) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM compose_projects WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(AppError::Database)?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("Compose project '{}'", id)));
        }

        Ok(())
    }

    // ── Events ──────────────────────────────────────────────────

    async fn emit_container_event(&self, container_id: &str, action: &str) {
        let data = serde_json::json!({
            "container_id": container_id,
            "action": action,
        });

        self.event_bus.publish("docker.container.state", data);
    }
}
