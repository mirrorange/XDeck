use super::manager::DockerManager;

#[test]
fn prune_images_targets_all_unused_images() {
    let options = DockerManager::prune_all_unused_image_options();

    assert_eq!(
        options.filters.get("dangling"),
        Some(&vec!["false".to_string()])
    );
}

#[test]
fn image_is_in_use_when_runtime_reports_container_references() {
    let used_images = std::collections::HashSet::new();

    assert!(DockerManager::image_in_use("sha256:demo", 1, &used_images));
}

#[test]
fn image_is_in_use_when_container_image_ids_match() {
    let used_images = std::collections::HashSet::from(["sha256:demo".to_string()]);

    assert!(DockerManager::image_in_use("sha256:demo", 0, &used_images));
}
