use serde::Deserialize;

use crate::rpc::params::parse_required_params;
use crate::rpc::router::RpcRouter;
use crate::services::file_manager;
use crate::services::file_manager::ArchiveFormat;

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

// ── Handler Registration ────────────────────────────────────────

pub fn register(router: &mut RpcRouter) {
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

    // fs.compress — Compress files into an archive
    router.register("fs.compress", move |params, _ctx| async move {
        let params = parse_required_params::<CompressParams>(params)?;
        let entry = file_manager::compress(&params.paths, &params.output, params.format).await?;
        Ok(serde_json::to_value(&entry).unwrap())
    });

    // fs.extract — Extract an archive
    router.register("fs.extract", move |params, _ctx| async move {
        let params = parse_required_params::<ExtractParams>(params)?;
        let entries = file_manager::extract(&params.archive, &params.dest).await?;
        Ok(serde_json::json!({
            "entries": entries,
            "total": entries.len(),
        }))
    });
}
