use std::collections::{HashMap, HashSet};

use bollard::container::ListContainersOptions;
use bollard::image::{ListImagesOptions, PruneImagesOptions, RemoveImageOptions};

use crate::error::AppError;

use super::manager::DockerManager;
use super::types::ImageInfo;

impl DockerManager {
    pub async fn list_images(&self) -> Result<Vec<ImageInfo>, AppError> {
        let client = self.get_client().await?;

        let containers = client
            .list_containers(Some(ListContainersOptions::<String> {
                all: true,
                ..Default::default()
            }))
            .await
            .unwrap_or_default();

        let used_images: HashSet<String> = containers
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
                in_use: Self::image_in_use(&img.id, img.containers, &used_images),
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
            .prune_images(Some(Self::prune_all_unused_image_options()))
            .await
            .map_err(|e| AppError::Internal(format!("Failed to prune images: {}", e)))?;

        Ok(serde_json::json!({
            "images_deleted": result.images_deleted.unwrap_or_default().len(),
            "space_reclaimed": result.space_reclaimed,
        }))
    }

    pub(super) fn prune_all_unused_image_options() -> PruneImagesOptions<String> {
        let mut filters = HashMap::new();
        filters.insert("dangling".to_string(), vec!["false".to_string()]);
        PruneImagesOptions { filters }
    }

    pub(super) fn image_in_use(
        image_id: &str,
        container_count: i64,
        used_images: &HashSet<String>,
    ) -> bool {
        container_count > 0 || used_images.contains(image_id)
    }
}
