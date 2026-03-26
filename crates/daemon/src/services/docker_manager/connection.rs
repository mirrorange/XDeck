use bollard::Docker;
use crate::error::AppError;

use super::manager::DockerManager;
use super::types::{ContainerRuntime, DockerStatus};

impl DockerManager {
    pub async fn auto_detect(&self) -> Result<(), AppError> {
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

    async fn try_connect_docker(&self) -> Result<(), AppError> {
        let paths = Self::docker_socket_paths();
        for path in &paths {
            if let Ok(client) = Docker::connect_with_socket(path, 5, bollard::API_DEFAULT_VERSION) {
                if client.ping().await.is_ok() {
                    tracing::info!("Connected to Docker via {}", path);
                    *self.client.write().await = Some(client);
                    *self.runtime.write().await = Some(ContainerRuntime::Docker);
                    *self.socket_path.write().await = Some(path.to_string());
                    return Ok(());
                }
            }
        }

        if let Ok(client) = Docker::connect_with_local_defaults() {
            if client.ping().await.is_ok() {
                tracing::info!("Connected to Docker via default connection");
                *self.client.write().await = Some(client);
                *self.runtime.write().await = Some(ContainerRuntime::Docker);
                *self.socket_path.write().await = Some("default".to_string());
                return Ok(());
            }
        }

        Err(AppError::Internal("Docker not available".into()))
    }

    async fn try_connect_podman(&self) -> Result<(), AppError> {
        let paths = Self::podman_socket_paths();
        for path in &paths {
            if let Ok(client) = Docker::connect_with_socket(path, 5, bollard::API_DEFAULT_VERSION) {
                if client.ping().await.is_ok() {
                    tracing::info!("Connected to Podman via {}", path);
                    *self.client.write().await = Some(client);
                    *self.runtime.write().await = Some(ContainerRuntime::Podman);
                    *self.socket_path.write().await = Some(path.to_string());
                    return Ok(());
                }
            }
        }

        Err(AppError::Internal("Podman not available".into()))
    }

    fn docker_socket_paths() -> Vec<String> {
        let mut paths = vec![];

        if cfg!(target_os = "linux") {
            paths.push("/var/run/docker.sock".to_string());
        } else if cfg!(target_os = "macos") {
            paths.push("/var/run/docker.sock".to_string());
            if let Some(home) = dirs::home_dir() {
                paths.push(format!("{}/.docker/run/docker.sock", home.display()));
            }
            if let Some(home) = dirs::home_dir() {
                paths.push(format!("{}/.colima/default/docker.sock", home.display()));
            }
        } else if cfg!(target_os = "windows") {
            paths.push("//./pipe/docker_engine".to_string());
        }

        paths
    }

    fn podman_socket_paths() -> Vec<String> {
        let mut paths = vec![];

        if cfg!(target_os = "linux") {
            paths.push("/run/podman/podman.sock".to_string());
            if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
                paths.push(format!("{}/podman/podman.sock", runtime_dir));
            }
            if let Ok(uid) = Self::current_uid() {
                paths.push(format!("/run/user/{}/podman/podman.sock", uid));
            }
        } else if cfg!(target_os = "macos") {
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
            paths.push("/var/run/podman/podman.sock".to_string());
            if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
                paths.push(format!("{}/podman/podman.sock", runtime_dir));
            }
        } else if cfg!(target_os = "windows") {
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

    pub(super) async fn get_client(&self) -> Result<Docker, AppError> {
        self.client.read().await.clone().ok_or_else(|| {
            AppError::Internal("No container runtime connected. Install Docker or Podman.".into())
        })
    }

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

    pub async fn reconnect(&self) -> Result<DockerStatus, AppError> {
        *self.client.write().await = None;
        *self.runtime.write().await = None;
        *self.socket_path.write().await = None;
        let _ = self.auto_detect().await;
        Ok(self.status().await)
    }
}
