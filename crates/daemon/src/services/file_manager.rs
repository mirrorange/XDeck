use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tracing::{debug, info};

use crate::error::AppError;
use crate::services::task_manager::TaskHandle;

// ── Data Structures ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileType {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub file_type: FileType,
    pub size: u64,
    pub modified: Option<DateTime<Utc>>,
    pub created: Option<DateTime<Utc>>,
    pub readonly: bool,
    #[cfg(unix)]
    pub mode: Option<u32>,
    #[cfg(unix)]
    pub uid: Option<u32>,
    #[cfg(unix)]
    pub gid: Option<u32>,
    #[cfg(unix)]
    pub owner: Option<String>,
    #[cfg(unix)]
    pub group: Option<String>,
    pub symlink_target: Option<String>,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub total: usize,
}

// ── Path Safety ─────────────────────────────────────────────────

/// Resolve and validate a path, preventing path traversal attacks.
/// Returns the canonicalized absolute path.
pub fn resolve_safe_path(path: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(path);

    // Must be absolute
    if !path.is_absolute() {
        return Err(AppError::BadRequest("Path must be absolute".into()));
    }

    // Attempt to canonicalize; if path doesn't exist yet, canonicalize parent
    let resolved = if path.exists() {
        path.canonicalize()
            .map_err(|e| AppError::BadRequest(format!("Cannot resolve path: {}", e)))?
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::BadRequest("Invalid path".into()))?;
        let file_name = path
            .file_name()
            .ok_or_else(|| AppError::BadRequest("Invalid path".into()))?;
        let resolved_parent = parent
            .canonicalize()
            .map_err(|e| AppError::BadRequest(format!("Cannot resolve parent path: {}", e)))?;
        resolved_parent.join(file_name)
    };

    Ok(resolved)
}

// ── Metadata Helpers ────────────────────────────────────────────

#[cfg(unix)]
fn get_unix_metadata(metadata: &std::fs::Metadata) -> (Option<u32>, Option<u32>, Option<u32>) {
    use std::os::unix::fs::MetadataExt;
    (
        Some(metadata.mode()),
        Some(metadata.uid()),
        Some(metadata.gid()),
    )
}

#[cfg(unix)]
fn get_owner_name(uid: u32) -> Option<String> {
    // Use libc to look up user name
    unsafe {
        let pw = libc::getpwuid(uid);
        if pw.is_null() {
            return None;
        }
        let name = std::ffi::CStr::from_ptr((*pw).pw_name);
        name.to_str().ok().map(String::from)
    }
}

#[cfg(unix)]
fn get_group_name(gid: u32) -> Option<String> {
    unsafe {
        let gr = libc::getgrgid(gid);
        if gr.is_null() {
            return None;
        }
        let name = std::ffi::CStr::from_ptr((*gr).gr_name);
        name.to_str().ok().map(String::from)
    }
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn system_time_to_datetime(st: std::io::Result<std::time::SystemTime>) -> Option<DateTime<Utc>> {
    st.ok().map(DateTime::<Utc>::from)
}

async fn build_file_entry(path: &Path) -> Result<FileEntry, AppError> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let metadata = fs::symlink_metadata(path).await.map_err(|e| {
        AppError::BadRequest(format!(
            "Cannot read metadata for {}: {}",
            path.display(),
            e
        ))
    })?;

    let file_type = if metadata.is_symlink() {
        FileType::Symlink
    } else if metadata.is_dir() {
        FileType::Directory
    } else if metadata.is_file() {
        FileType::File
    } else {
        FileType::Other
    };

    let symlink_target = if metadata.is_symlink() {
        fs::read_link(path)
            .await
            .ok()
            .map(|t| t.to_string_lossy().to_string())
    } else {
        None
    };

    let modified = system_time_to_datetime(metadata.modified());
    let created = system_time_to_datetime(metadata.created());
    let readonly = metadata.permissions().readonly();

    #[cfg(unix)]
    let (mode, uid, gid) = get_unix_metadata(&metadata);
    #[cfg(unix)]
    let owner = uid.and_then(get_owner_name);
    #[cfg(unix)]
    let group = gid.and_then(get_group_name);

    Ok(FileEntry {
        name: name.clone(),
        path: path.to_string_lossy().to_string(),
        file_type,
        size: metadata.len(),
        modified,
        created,
        readonly,
        #[cfg(unix)]
        mode,
        #[cfg(unix)]
        uid,
        #[cfg(unix)]
        gid,
        #[cfg(unix)]
        owner,
        #[cfg(unix)]
        group,
        symlink_target,
        hidden: is_hidden(&name),
    })
}

// ── Core Operations ─────────────────────────────────────────────

/// List directory contents.
pub async fn list_directory(path: &str) -> Result<DirListing, AppError> {
    let resolved = resolve_safe_path(path)?;
    debug!("Listing directory: {}", resolved.display());

    let metadata = fs::metadata(&resolved)
        .await
        .map_err(|e| AppError::NotFound(format!("Path not found: {}", e)))?;

    if !metadata.is_dir() {
        return Err(AppError::BadRequest(format!(
            "Not a directory: {}",
            resolved.display()
        )));
    }

    let mut entries = Vec::new();
    let mut read_dir = fs::read_dir(&resolved)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot read directory: {}", e)))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| AppError::BadRequest(format!("Error reading directory entry: {}", e)))?
    {
        match build_file_entry(&entry.path()).await {
            Ok(file_entry) => entries.push(file_entry),
            Err(e) => {
                debug!("Skipping entry: {}", e);
            }
        }
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        let a_is_dir = matches!(a.file_type, FileType::Directory);
        let b_is_dir = matches!(b.file_type, FileType::Directory);
        b_is_dir
            .cmp(&a_is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let total = entries.len();
    Ok(DirListing {
        path: resolved.to_string_lossy().to_string(),
        entries,
        total,
    })
}

/// Get detailed information about a single file/directory.
pub async fn stat_path(path: &str) -> Result<FileEntry, AppError> {
    let resolved = resolve_safe_path(path)?;
    debug!("Stat: {}", resolved.display());

    if !resolved.exists() {
        return Err(AppError::NotFound(format!(
            "Path not found: {}",
            resolved.display()
        )));
    }

    build_file_entry(&resolved).await
}

/// Read file content as UTF-8 text. Limited to a max size for safety.
pub async fn read_file_content(path: &str, max_bytes: usize) -> Result<String, AppError> {
    let resolved = resolve_safe_path(path)?;
    debug!("Read file: {}", resolved.display());

    if !resolved.is_file() {
        return Err(AppError::BadRequest(format!(
            "Not a file: {}",
            resolved.display()
        )));
    }

    let metadata = fs::metadata(&resolved)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot read metadata: {}", e)))?;

    if metadata.len() as usize > max_bytes {
        return Err(AppError::BadRequest(format!(
            "File too large for preview ({} bytes, max {})",
            metadata.len(),
            max_bytes
        )));
    }

    let content = fs::read_to_string(&resolved)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot read file (may be binary): {}", e)))?;

    Ok(content)
}

/// Get the user's home directory.
pub fn get_home_dir() -> Result<String, AppError> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| AppError::Internal("Cannot determine home directory".into()))
}

/// Create a directory (with parents if needed).
pub async fn create_directory(path: &str, parents: bool) -> Result<FileEntry, AppError> {
    let resolved = resolve_safe_path(path)?;
    debug!("Creating directory: {}", resolved.display());

    if resolved.exists() {
        return Err(AppError::AlreadyExists(format!(
            "Path already exists: {}",
            resolved.display()
        )));
    }

    if parents {
        fs::create_dir_all(&resolved).await
    } else {
        fs::create_dir(&resolved).await
    }
    .map_err(|e| AppError::BadRequest(format!("Cannot create directory: {}", e)))?;

    build_file_entry(&resolved).await
}

/// Rename or move a file/directory.
pub async fn rename_path(from: &str, to: &str) -> Result<FileEntry, AppError> {
    let from_resolved = resolve_safe_path(from)?;
    let to_resolved = resolve_safe_path(to)?;
    debug!(
        "Rename: {} -> {}",
        from_resolved.display(),
        to_resolved.display()
    );

    if !from_resolved.exists() {
        return Err(AppError::NotFound(format!(
            "Source not found: {}",
            from_resolved.display()
        )));
    }

    if to_resolved.exists() {
        return Err(AppError::AlreadyExists(format!(
            "Destination already exists: {}",
            to_resolved.display()
        )));
    }

    fs::rename(&from_resolved, &to_resolved)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot rename: {}", e)))?;

    build_file_entry(&to_resolved).await
}

/// Copy a file or directory recursively.
pub async fn copy_path(from: &str, to: &str) -> Result<FileEntry, AppError> {
    let from_resolved = resolve_safe_path(from)?;
    let to_resolved = resolve_safe_path(to)?;
    debug!(
        "Copy: {} -> {}",
        from_resolved.display(),
        to_resolved.display()
    );

    if !from_resolved.exists() {
        return Err(AppError::NotFound(format!(
            "Source not found: {}",
            from_resolved.display()
        )));
    }

    if to_resolved.exists() {
        return Err(AppError::AlreadyExists(format!(
            "Destination already exists: {}",
            to_resolved.display()
        )));
    }

    let metadata = fs::metadata(&from_resolved)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot read source: {}", e)))?;

    if metadata.is_dir() {
        copy_dir_recursive(&from_resolved, &to_resolved).await?;
    } else {
        fs::copy(&from_resolved, &to_resolved)
            .await
            .map_err(|e| AppError::BadRequest(format!("Cannot copy file: {}", e)))?;
    }

    build_file_entry(&to_resolved).await
}

/// Recursive directory copy.
async fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), AppError> {
    fs::create_dir_all(to)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot create directory: {}", e)))?;

    let mut read_dir = fs::read_dir(from)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot read directory: {}", e)))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| AppError::BadRequest(format!("Error reading entry: {}", e)))?
    {
        let entry_path = entry.path();
        let dest_path = to.join(entry.file_name());
        let metadata = fs::metadata(&entry_path)
            .await
            .map_err(|e| AppError::BadRequest(format!("Cannot read metadata: {}", e)))?;

        if metadata.is_dir() {
            Box::pin(copy_dir_recursive(&entry_path, &dest_path)).await?;
        } else {
            fs::copy(&entry_path, &dest_path)
                .await
                .map_err(|e| AppError::BadRequest(format!("Cannot copy file: {}", e)))?;
        }
    }

    Ok(())
}

/// Delete a file or directory.
pub async fn delete_path(path: &str, recursive: bool) -> Result<(), AppError> {
    let resolved = resolve_safe_path(path)?;
    debug!("Delete: {} (recursive: {})", resolved.display(), recursive);

    if !resolved.exists() {
        return Err(AppError::NotFound(format!(
            "Path not found: {}",
            resolved.display()
        )));
    }

    let metadata = fs::symlink_metadata(&resolved)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot read metadata: {}", e)))?;

    if metadata.is_dir() {
        if recursive {
            fs::remove_dir_all(&resolved).await
        } else {
            fs::remove_dir(&resolved).await
        }
        .map_err(|e| AppError::BadRequest(format!("Cannot delete directory: {}", e)))?;
    } else {
        fs::remove_file(&resolved)
            .await
            .map_err(|e| AppError::BadRequest(format!("Cannot delete file: {}", e)))?;
    }

    Ok(())
}

/// Change file permissions (Unix only).
#[cfg(unix)]
pub async fn chmod_path(path: &str, mode: u32) -> Result<FileEntry, AppError> {
    use std::os::unix::fs::PermissionsExt;

    let resolved = resolve_safe_path(path)?;
    debug!("Chmod: {} -> {:o}", resolved.display(), mode);

    if !resolved.exists() {
        return Err(AppError::NotFound(format!(
            "Path not found: {}",
            resolved.display()
        )));
    }

    let permissions = std::fs::Permissions::from_mode(mode);
    fs::set_permissions(&resolved, permissions)
        .await
        .map_err(|e| AppError::BadRequest(format!("Cannot set permissions: {}", e)))?;

    build_file_entry(&resolved).await
}

/// Change file owner (Unix only). Requires appropriate privileges.
#[cfg(unix)]
pub async fn chown_path(
    path: &str,
    uid: Option<u32>,
    gid: Option<u32>,
) -> Result<FileEntry, AppError> {
    use std::os::unix::ffi::OsStrExt;

    let resolved = resolve_safe_path(path)?;
    debug!(
        "Chown: {} -> uid={:?} gid={:?}",
        resolved.display(),
        uid,
        gid
    );

    if !resolved.exists() {
        return Err(AppError::NotFound(format!(
            "Path not found: {}",
            resolved.display()
        )));
    }

    let c_path = std::ffi::CString::new(resolved.as_os_str().as_bytes())
        .map_err(|_| AppError::BadRequest("Invalid path".into()))?;

    let result = unsafe {
        libc::chown(
            c_path.as_ptr(),
            uid.unwrap_or(u32::MAX), // -1 means don't change
            gid.unwrap_or(u32::MAX),
        )
    };

    if result != 0 {
        let err = std::io::Error::last_os_error();
        return Err(AppError::BadRequest(format!(
            "Cannot change owner: {}",
            err
        )));
    }

    build_file_entry(&resolved).await
}

/// Search for files matching a pattern.
pub async fn search_files(
    dir: &str,
    pattern: &str,
    recursive: bool,
    max_results: usize,
) -> Result<Vec<FileEntry>, AppError> {
    let resolved = resolve_safe_path(dir)?;
    debug!(
        "Search: dir={} pattern={} recursive={}",
        resolved.display(),
        pattern,
        recursive
    );

    if !resolved.is_dir() {
        return Err(AppError::BadRequest(
            "Search path must be a directory".into(),
        ));
    }

    let pattern_lower = pattern.to_lowercase();
    let mut results = Vec::new();
    search_recursive(
        &resolved,
        &pattern_lower,
        recursive,
        max_results,
        &mut results,
    )
    .await?;

    Ok(results)
}

async fn search_recursive(
    dir: &Path,
    pattern: &str,
    recursive: bool,
    max_results: usize,
    results: &mut Vec<FileEntry>,
) -> Result<(), AppError> {
    if results.len() >= max_results {
        return Ok(());
    }

    let mut read_dir = match fs::read_dir(dir).await {
        Ok(rd) => rd,
        Err(_) => return Ok(()), // Skip unreadable directories
    };

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        if results.len() >= max_results {
            break;
        }

        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.to_lowercase().contains(pattern) {
            if let Ok(file_entry) = build_file_entry(&entry_path).await {
                results.push(file_entry);
            }
        }

        if recursive {
            if let Ok(metadata) = fs::metadata(&entry_path).await {
                if metadata.is_dir() {
                    Box::pin(search_recursive(
                        &entry_path,
                        pattern,
                        recursive,
                        max_results,
                        results,
                    ))
                    .await?;
                }
            }
        }
    }

    Ok(())
}

// ── Compression ─────────────────────────────────────────────────

/// Supported archive formats.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveFormat {
    Zip,
    TarGz,
}

impl ArchiveFormat {
    /// Get the file extension for this format.
    pub fn extension(&self) -> &str {
        match self {
            ArchiveFormat::Zip => ".zip",
            ArchiveFormat::TarGz => ".tar.gz",
        }
    }

    /// Detect format from file extension.
    pub fn from_path(path: &Path) -> Option<Self> {
        let name = path.file_name()?.to_string_lossy().to_lowercase();
        if name.ends_with(".zip") {
            Some(ArchiveFormat::Zip)
        } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
            Some(ArchiveFormat::TarGz)
        } else {
            None
        }
    }
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::BadRequest(format!("Cannot open archive: {}", e)))?;
    let dec = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(dec);

    tar.unpack(dest)
        .map_err(|e| AppError::Internal(format!("Extract error: {}", e)))?;

    Ok(())
}

// ── Folder Download ─────────────────────────────────────────────

/// Prepare a folder for download by compressing it to a temporary zip file.
/// Returns the path to the temporary zip file.
pub async fn prepare_folder_download(
    folder_path: &str,
    task_handle: TaskHandle,
) -> Result<String, AppError> {
    let folder = resolve_safe_path(folder_path)?;

    if !folder.is_dir() {
        let msg = format!("Not a directory: {}", folder.display());
        task_handle.fail(Some(msg.clone())).await;
        return Err(AppError::BadRequest(msg));
    }

    let folder_name = folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".into());

    // Create temp file in system temp directory
    let temp_dir = std::env::temp_dir().join("xdeck-downloads");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| AppError::Internal(format!("Cannot create temp dir: {}", e)))?;

    let temp_file = temp_dir.join(format!("{}.zip", folder_name));
    // Remove if already exists (from a previous attempt)
    if temp_file.exists() {
        let _ = tokio::fs::remove_file(&temp_file).await;
    }

    let output_path = temp_file.to_string_lossy().to_string();

    // Use compress_with_progress to create the zip
    let paths = vec![folder_path.to_string()];
    compress_with_progress(&paths, &output_path, ArchiveFormat::Zip, task_handle).await?;

    Ok(output_path)
}

// ── Progress-aware variants ─────────────────────────────────────

/// Count files recursively in a list of paths (for progress estimation).
fn count_files_recursive(paths: &[PathBuf]) -> usize {
    let mut count = 0;
    for path in paths {
        if path.is_file() {
            count += 1;
        } else if path.is_dir() {
            count += count_dir_files(path);
        }
    }
    count
}

fn count_dir_files(dir: &Path) -> usize {
    let mut count = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                count += 1;
            } else if path.is_dir() {
                count += count_dir_files(&path);
            }
        }
    }
    count
}

/// A thread-safe progress sender for use inside spawn_blocking.
type ProgressSender = std::sync::mpsc::Sender<(usize, usize)>;

/// Compress files with progress tracking via a TaskHandle.
pub async fn compress_with_progress(
    paths: &[String],
    output_path: &str,
    format: ArchiveFormat,
    task_handle: TaskHandle,
) -> Result<FileEntry, AppError> {
    if paths.is_empty() {
        task_handle.fail(Some("No paths to compress".into())).await;
        return Err(AppError::BadRequest("No paths to compress".into()));
    }

    let output = resolve_safe_path(output_path)?;
    if output.exists() {
        let msg = format!("Output already exists: {}", output.display());
        task_handle.fail(Some(msg.clone())).await;
        return Err(AppError::AlreadyExists(msg));
    }

    let resolved_paths: Vec<PathBuf> = paths
        .iter()
        .map(|p| resolve_safe_path(p))
        .collect::<Result<Vec<_>, _>>()?;

    for p in &resolved_paths {
        if !p.exists() {
            let msg = format!("Path not found: {}", p.display());
            task_handle.fail(Some(msg.clone())).await;
            return Err(AppError::NotFound(msg));
        }
    }

    task_handle
        .update_progress(0, Some("Counting files...".into()))
        .await;

    let paths_for_count = resolved_paths.clone();
    let output_clone = output.clone();

    // Set up progress channel
    let (progress_tx, progress_rx) = std::sync::mpsc::channel::<(usize, usize)>();

    // Spawn the blocking compression task
    let compress_handle = tokio::task::spawn_blocking(move || {
        let total = count_files_recursive(&paths_for_count);
        let _ = progress_tx.send((0, total));

        match format {
            ArchiveFormat::Zip => {
                compress_zip_with_progress(&paths_for_count, &output_clone, &progress_tx, total)
            }
            ArchiveFormat::TarGz => {
                compress_tar_gz_with_progress(&paths_for_count, &output_clone, &progress_tx, total)
            }
        }
    });

    // Poll progress from the channel while waiting
    let poll_handle = task_handle.clone();
    let progress_poller = tokio::spawn(async move {
        loop {
            match progress_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok((done, total)) => {
                    if total > 0 {
                        let pct = ((done as f64 / total as f64) * 100.0).min(99.0) as u8;
                        poll_handle
                            .update_progress(pct, Some(format!("{}/{} files", done, total)))
                            .await;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    let result = compress_handle
        .await
        .map_err(|e| AppError::Internal(format!("Compression task panicked: {}", e)))?;

    // Stop the progress poller
    progress_poller.abort();

    match result {
        Ok(()) => {
            task_handle
                .complete(Some("Compression complete".into()))
                .await;
            info!("Compressed {} file(s) to {}", paths.len(), output.display());
            build_file_entry(&output).await
        }
        Err(e) => {
            task_handle
                .fail(Some(format!("Compression failed: {}", e)))
                .await;
            Err(e)
        }
    }
}

fn compress_zip_with_progress(
    paths: &[PathBuf],
    output: &Path,
    progress_tx: &ProgressSender,
    total: usize,
) -> Result<(), AppError> {
    let file = std::fs::File::create(output)
        .map_err(|e| AppError::BadRequest(format!("Cannot create archive: {}", e)))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut done = 0usize;

    for path in paths {
        if path.is_file() {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            zip.start_file(&name, options)
                .map_err(|e| AppError::Internal(format!("Zip error: {}", e)))?;
            let data = std::fs::read(path).map_err(|e| {
                AppError::BadRequest(format!("Cannot read {}: {}", path.display(), e))
            })?;
            std::io::Write::write_all(&mut zip, &data)
                .map_err(|e| AppError::Internal(format!("Zip write error: {}", e)))?;
            done += 1;
            let _ = progress_tx.send((done, total));
        } else if path.is_dir() {
            done = add_dir_to_zip_with_progress(
                &mut zip,
                path,
                path.file_name().unwrap().to_string_lossy().as_ref(),
                options,
                progress_tx,
                done,
                total,
            )?;
        }
    }

    zip.finish()
        .map_err(|e| AppError::Internal(format!("Zip finish error: {}", e)))?;
    Ok(())
}

fn add_dir_to_zip_with_progress(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
    progress_tx: &ProgressSender,
    mut done: usize,
    total: usize,
) -> Result<usize, AppError> {
    for entry in std::fs::read_dir(dir)
        .map_err(|e| AppError::BadRequest(format!("Cannot read dir: {}", e)))?
    {
        let entry = entry.map_err(|e| AppError::BadRequest(format!("Dir entry error: {}", e)))?;
        let path = entry.path();
        let name = format!("{}/{}", prefix, entry.file_name().to_string_lossy());

        if path.is_file() {
            zip.start_file(&name, options)
                .map_err(|e| AppError::Internal(format!("Zip error: {}", e)))?;
            let data = std::fs::read(&path)
                .map_err(|e| AppError::BadRequest(format!("Cannot read: {}", e)))?;
            std::io::Write::write_all(zip, &data)
                .map_err(|e| AppError::Internal(format!("Zip write error: {}", e)))?;
            done += 1;
            let _ = progress_tx.send((done, total));
        } else if path.is_dir() {
            done =
                add_dir_to_zip_with_progress(zip, &path, &name, options, progress_tx, done, total)?;
        }
    }
    Ok(done)
}

fn compress_tar_gz_with_progress(
    paths: &[PathBuf],
    output: &Path,
    progress_tx: &ProgressSender,
    total: usize,
) -> Result<(), AppError> {
    let file = std::fs::File::create(output)
        .map_err(|e| AppError::BadRequest(format!("Cannot create archive: {}", e)))?;
    let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut tar = tar::Builder::new(enc);

    let mut done = 0usize;
    for path in paths {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if path.is_file() {
            tar.append_path_with_name(path, &name)
                .map_err(|e| AppError::Internal(format!("Tar error: {}", e)))?;
            done += 1;
            let _ = progress_tx.send((done, total));
        } else if path.is_dir() {
            // For tar, we add the whole dir but still count files for progress
            tar.append_dir_all(&name, path)
                .map_err(|e| AppError::Internal(format!("Tar error: {}", e)))?;
            done += count_dir_files(path);
            let _ = progress_tx.send((done, total));
        }
    }

    tar.into_inner()
        .map_err(|e| AppError::Internal(format!("Tar finish error: {}", e)))?
        .finish()
        .map_err(|e| AppError::Internal(format!("Gzip finish error: {}", e)))?;
    Ok(())
}

/// Extract an archive with progress tracking via a TaskHandle.
pub async fn extract_with_progress(
    archive_path: &str,
    dest_path: &str,
    task_handle: TaskHandle,
) -> Result<Vec<FileEntry>, AppError> {
    let archive = resolve_safe_path(archive_path)?;
    let dest = resolve_safe_path(dest_path)?;

    if !archive.is_file() {
        let msg = format!("Archive not found: {}", archive.display());
        task_handle.fail(Some(msg.clone())).await;
        return Err(AppError::NotFound(msg));
    }

    if !dest.is_dir() {
        task_handle
            .fail(Some("Destination must be a directory".into()))
            .await;
        return Err(AppError::BadRequest(
            "Destination must be a directory".into(),
        ));
    }

    let format = ArchiveFormat::from_path(&archive).ok_or_else(|| {
        AppError::BadRequest("Unsupported archive format. Supported: .zip, .tar.gz, .tgz".into())
    })?;

    task_handle
        .update_progress(0, Some("Starting extraction...".into()))
        .await;

    let archive_clone = archive.clone();
    let dest_clone = dest.clone();

    let (progress_tx, progress_rx) = std::sync::mpsc::channel::<(usize, usize)>();

    let extract_handle = tokio::task::spawn_blocking(move || match format {
        ArchiveFormat::Zip => extract_zip_with_progress(&archive_clone, &dest_clone, &progress_tx),
        ArchiveFormat::TarGz => {
            // tar.gz doesn't easily support per-file progress, report indeterminate
            let _ = progress_tx.send((0, 0));
            extract_tar_gz(&archive_clone, &dest_clone)?;
            let _ = progress_tx.send((1, 1));
            Ok(())
        }
    });

    let poll_handle = task_handle.clone();
    let progress_poller = tokio::spawn(async move {
        loop {
            match progress_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok((done, total)) => {
                    if total > 0 {
                        let pct = ((done as f64 / total as f64) * 100.0).min(99.0) as u8;
                        poll_handle
                            .update_progress(pct, Some(format!("{}/{} entries", done, total)))
                            .await;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    let result = extract_handle
        .await
        .map_err(|e| AppError::Internal(format!("Extract task panicked: {}", e)))?;

    progress_poller.abort();

    match result {
        Ok(()) => {
            task_handle
                .complete(Some("Extraction complete".into()))
                .await;
            info!("Extracted {} to {}", archive.display(), dest.display());
            let entries = list_directory(dest_path).await?;
            Ok(entries.entries)
        }
        Err(e) => {
            task_handle
                .fail(Some(format!("Extraction failed: {}", e)))
                .await;
            Err(e)
        }
    }
}

fn extract_zip_with_progress(
    archive: &Path,
    dest: &Path,
    progress_tx: &ProgressSender,
) -> Result<(), AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::BadRequest(format!("Cannot open archive: {}", e)))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::BadRequest(format!("Invalid zip: {}", e)))?;

    let total = zip.len();
    let _ = progress_tx.send((0, total));

    for i in 0..total {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::Internal(format!("Zip read error: {}", e)))?;

        let name = entry.name().to_string();
        if name.contains("..") {
            continue;
        }

        let out_path = dest.join(&name);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| AppError::Internal(format!("Cannot create dir: {}", e)))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::Internal(format!("Cannot create dir: {}", e)))?;
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| AppError::Internal(format!("Cannot create file: {}", e)))?;
            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| AppError::Internal(format!("Extract error: {}", e)))?;
        }

        let _ = progress_tx.send((i + 1, total));
    }

    Ok(())
}
