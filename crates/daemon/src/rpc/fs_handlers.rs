use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::file_manager;
use crate::services::file_manager::ArchiveFormat;
use crate::services::task_manager::{self, SharedTaskManager, TaskType};

// ── Param Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListParams {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StatParams {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateDirParams {
    path: String,
    #[serde(default)]
    parents: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RenameParams {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CopyParams {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MoveParams {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteParams {
    path: String,
    #[serde(default)]
    recursive: bool,
}

#[cfg(unix)]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ChmodParams {
    path: String,
    mode: u32,
}

#[cfg(unix)]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ChownParams {
    path: String,
    uid: Option<u32>,
    gid: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchParams {
    path: String,
    pattern: String,
    #[serde(default)]
    recursive: bool,
    #[serde(default = "default_max_results")]
    max_results: usize,
}

fn default_max_results() -> usize {
    500
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompressParams {
    paths: Vec<String>,
    output: String,
    #[serde(default = "default_archive_format")]
    format: ArchiveFormat,
}

fn default_archive_format() -> ArchiveFormat {
    ArchiveFormat::Zip
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExtractParams {
    archive: String,
    dest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PrepareDownloadParams {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadFileParams {
    path: String,
    #[serde(default = "default_max_bytes")]
    max_bytes: usize,
}

fn default_max_bytes() -> usize {
    2 * 1024 * 1024 // 2MB
}

// ── Handler Registration ────────────────────────────────────────

pub fn register(router: &mut RpcRouter, task_mgr: SharedTaskManager) {
    // fs.list — List directory contents
    router.register("fs.list", move |params, _ctx| async move {
        let params = parse_required_params::<ListParams>(params)?;
        let listing = file_manager::list_directory(&params.path).await?;
        Ok(serde_json::to_value(&listing).unwrap())
    });

    // fs.stat — Get file/directory info
    router.register("fs.stat", move |params, _ctx| async move {
        let params = parse_required_params::<StatParams>(params)?;
        let entry = file_manager::stat_path(&params.path).await?;
        Ok(serde_json::to_value(&entry).unwrap())
    });

    // fs.read_file — Read file content (text)
    router.register("fs.read_file", move |params, _ctx| async move {
        let params = parse_required_params::<ReadFileParams>(params)?;
        let content = file_manager::read_file_content(&params.path, params.max_bytes).await?;
        Ok(serde_json::json!({
            "content": content,
            "size": content.len(),
        }))
    });

    // fs.home — Get home directory
    router.register("fs.home", move |_params, _ctx| async move {
        let home = file_manager::get_home_dir()?;
        Ok(serde_json::json!({ "path": home }))
    });

    // fs.create_dir — Create directory
    router.register("fs.create_dir", move |params, _ctx| async move {
        let params = parse_required_params::<CreateDirParams>(params)?;
        let entry = file_manager::create_directory(&params.path, params.parents).await?;
        Ok(serde_json::to_value(&entry).unwrap())
    });

    // fs.rename — Rename file/directory
    router.register("fs.rename", move |params, _ctx| async move {
        let params = parse_required_params::<RenameParams>(params)?;
        let entry = file_manager::rename_path(&params.from, &params.to).await?;
        Ok(serde_json::to_value(&entry).unwrap())
    });

    // fs.copy — Copy file/directory
    router.register("fs.copy", move |params, _ctx| async move {
        let params = parse_required_params::<CopyParams>(params)?;
        let entry = file_manager::copy_path(&params.from, &params.to).await?;
        Ok(serde_json::to_value(&entry).unwrap())
    });

    // fs.move — Move file/directory (same as rename with cross-device support)
    router.register("fs.move", move |params, _ctx| async move {
        let params = parse_required_params::<MoveParams>(params)?;
        // Try rename first (fast, same device), fall back to copy+delete
        match file_manager::rename_path(&params.from, &params.to).await {
            Ok(entry) => Ok(serde_json::to_value(&entry).unwrap()),
            Err(_) => {
                let entry = file_manager::copy_path(&params.from, &params.to).await?;
                file_manager::delete_path(&params.from, true).await?;
                Ok(serde_json::to_value(&entry).unwrap())
            }
        }
    });

    // fs.delete — Delete file/directory
    router.register("fs.delete", move |params, _ctx| async move {
        let params = parse_required_params::<DeleteParams>(params)?;
        file_manager::delete_path(&params.path, params.recursive).await?;
        Ok(serde_json::json!({ "success": true }))
    });

    // fs.chmod — Change permissions (Unix only)
    #[cfg(unix)]
    router.register("fs.chmod", move |params, _ctx| async move {
        let params = parse_required_params::<ChmodParams>(params)?;
        let entry = file_manager::chmod_path(&params.path, params.mode).await?;
        Ok(serde_json::to_value(&entry).unwrap())
    });

    // fs.chown — Change owner (Unix only)
    #[cfg(unix)]
    router.register("fs.chown", move |params, _ctx| async move {
        let params = parse_required_params::<ChownParams>(params)?;
        let entry = file_manager::chown_path(&params.path, params.uid, params.gid).await?;
        Ok(serde_json::to_value(&entry).unwrap())
    });

    // fs.search — Search files by pattern
    router.register("fs.search", move |params, _ctx| async move {
        let params = parse_required_params::<SearchParams>(params)?;
        let results = file_manager::search_files(
            &params.path,
            &params.pattern,
            params.recursive,
            params.max_results,
        )
        .await?;
        Ok(serde_json::json!({
            "results": results,
            "total": results.len(),
        }))
    });

    // fs.compress — Compress files into an archive (async with progress tracking)
    let mgr = task_mgr.clone();
    router.register("fs.compress", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<CompressParams>(params)?;

            // Derive a short title from the output filename
            let output_name = std::path::Path::new(&params.output)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "archive".into());
            let title = format!("Compressing {}", output_name);

            let task_handle = task_manager::create_task(&mgr, TaskType::Compress, title).await;
            let task_id = task_handle.id().to_string();

            // Spawn the compression in the background — return task_id immediately
            tokio::spawn(async move {
                let _ = file_manager::compress_with_progress(
                    &params.paths,
                    &params.output,
                    params.format,
                    task_handle,
                )
                .await;
                // TaskHandle.complete() / .fail() is called inside compress_with_progress
            });

            Ok(serde_json::json!({ "task_id": task_id }))
        }
    });

    // fs.extract — Extract an archive (async with progress tracking)
    let mgr = task_mgr.clone();
    router.register("fs.extract", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<ExtractParams>(params)?;

            let archive_name = std::path::Path::new(&params.archive)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "archive".into());
            let title = format!("Extracting {}", archive_name);

            let task_handle = task_manager::create_task(&mgr, TaskType::Extract, title).await;
            let task_id = task_handle.id().to_string();

            // Spawn the extraction in the background — return task_id immediately
            tokio::spawn(async move {
                let _ = file_manager::extract_with_progress(
                    &params.archive,
                    &params.dest,
                    task_handle,
                )
                .await;
                // TaskHandle.complete() / .fail() is called inside extract_with_progress
            });

            Ok(serde_json::json!({ "task_id": task_id }))
        }
    });

    // fs.prepare_download — Prepare a folder for download (compress to temp zip with progress)
    let mgr = task_mgr.clone();
    router.register("fs.prepare_download", move |params, _ctx| {
        let mgr = mgr.clone();
        async move {
            let params = parse_required_params::<PrepareDownloadParams>(params)?;

            let folder_name = std::path::Path::new(&params.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "folder".into());
            let title = format!("Preparing download: {}", folder_name);

            let task_handle =
                task_manager::create_task(&mgr, TaskType::FolderDownload, title).await;
            let task_id = task_handle.id().to_string();

            let download_path =
                file_manager::prepare_folder_download(&params.path, task_handle).await?;

            Ok(serde_json::json!({
                "download_path": download_path,
                "task_id": task_id,
            }))
        }
    });
}
