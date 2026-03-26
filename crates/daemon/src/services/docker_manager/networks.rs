use bollard::network::ListNetworksOptions;

use crate::error::AppError;

use super::manager::DockerManager;
use super::types::DockerNetworkInfo;

impl DockerManager {
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
}
