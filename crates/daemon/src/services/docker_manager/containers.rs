use std::collections::HashMap;

use bollard::container::{
    InspectContainerOptions, ListContainersOptions, LogsOptions, RemoveContainerOptions,
    RestartContainerOptions, StartContainerOptions, StopContainerOptions,
};
use crate::error::AppError;

use super::manager::DockerManager;
use super::types::{ContainerDetail, ContainerInfo, MountInfo, NetworkInfo, PortMapping};

impl DockerManager {
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
        let labels = config.and_then(|c| c.labels.clone()).unwrap_or_default();

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
                                host_port: b.host_port.as_ref().and_then(|p| p.parse().ok()),
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
            image: config.and_then(|c| c.image.clone()).unwrap_or_default(),
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
            env: config.and_then(|c| c.env.clone()).unwrap_or_default(),
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
            .stop_container(id, Some(StopContainerOptions { t: 10 }))
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
            .restart_container(id, Some(RestartContainerOptions { t: 10 }))
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
        use futures_util::StreamExt;

        let client = self.get_client().await?;
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
}
