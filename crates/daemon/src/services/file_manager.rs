use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::fs;
use tracing::debug;

use crate::error::AppError;

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
        return Err(AppError::BadRequest(
            "Path must be absolute".into(),
        ));
    }

    // Attempt to canonicalize; if path doesn't exist yet, canonicalize parent
    let resolved = if path.exists() {
        path.canonicalize().map_err(|e| {
            AppError::BadRequest(format!("Cannot resolve path: {}", e))
        })?
    } else {
        let parent = path.parent().ok_or_else(|| {
            AppError::BadRequest("Invalid path".into())
        })?;
        let file_name = path.file_name().ok_or_else(|| {
            AppError::BadRequest("Invalid path".into())
        })?;
        let resolved_parent = parent.canonicalize().map_err(|e| {
            AppError::BadRequest(format!("Cannot resolve parent path: {}", e))
        })?;
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
        AppError::BadRequest(format!("Cannot read metadata for {}: {}", path.display(), e))
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

    let metadata = fs::metadata(&resolved).await.map_err(|e| {
        AppError::NotFound(format!("Path not found: {}", e))
    })?;

    if !metadata.is_dir() {
        return Err(AppError::BadRequest(format!(
            "Not a directory: {}",
            resolved.display()
        )));
    }

    let mut entries = Vec::new();
    let mut read_dir = fs::read_dir(&resolved).await.map_err(|e| {
        AppError::BadRequest(format!("Cannot read directory: {}", e))
    })?;

    while let Some(entry) = read_dir.next_entry().await.map_err(|e| {
        AppError::BadRequest(format!("Error reading directory entry: {}", e))
    })? {
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
        b_is_dir.cmp(&a_is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
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
    debug!("Rename: {} -> {}", from_resolved.display(), to_resolved.display());

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

    fs::rename(&from_resolved, &to_resolved).await.map_err(|e| {
        AppError::BadRequest(format!("Cannot rename: {}", e))
    })?;

    build_file_entry(&to_resolved).await
}

/// Copy a file or directory recursively.
pub async fn copy_path(from: &str, to: &str) -> Result<FileEntry, AppError> {
    let from_resolved = resolve_safe_path(from)?;
    let to_resolved = resolve_safe_path(to)?;
    debug!("Copy: {} -> {}", from_resolved.display(), to_resolved.display());

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

    let metadata = fs::metadata(&from_resolved).await.map_err(|e| {
        AppError::BadRequest(format!("Cannot read source: {}", e))
    })?;

    if metadata.is_dir() {
        copy_dir_recursive(&from_resolved, &to_resolved).await?;
    } else {
        fs::copy(&from_resolved, &to_resolved).await.map_err(|e| {
            AppError::BadRequest(format!("Cannot copy file: {}", e))
        })?;
    }

    build_file_entry(&to_resolved).await
}

/// Recursive directory copy.
async fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), AppError> {
    fs::create_dir_all(to).await.map_err(|e| {
        AppError::BadRequest(format!("Cannot create directory: {}", e))
    })?;

    let mut read_dir = fs::read_dir(from).await.map_err(|e| {
        AppError::BadRequest(format!("Cannot read directory: {}", e))
    })?;

    while let Some(entry) = read_dir.next_entry().await.map_err(|e| {
        AppError::BadRequest(format!("Error reading entry: {}", e))
    })? {
        let entry_path = entry.path();
        let dest_path = to.join(entry.file_name());
        let metadata = fs::metadata(&entry_path).await.map_err(|e| {
            AppError::BadRequest(format!("Cannot read metadata: {}", e))
        })?;

        if metadata.is_dir() {
            Box::pin(copy_dir_recursive(&entry_path, &dest_path)).await?;
        } else {
            fs::copy(&entry_path, &dest_path).await.map_err(|e| {
                AppError::BadRequest(format!("Cannot copy file: {}", e))
            })?;
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

    let metadata = fs::symlink_metadata(&resolved).await.map_err(|e| {
        AppError::BadRequest(format!("Cannot read metadata: {}", e))
    })?;

    if metadata.is_dir() {
        if recursive {
            fs::remove_dir_all(&resolved).await
        } else {
            fs::remove_dir(&resolved).await
        }
        .map_err(|e| AppError::BadRequest(format!("Cannot delete directory: {}", e)))?;
    } else {
        fs::remove_file(&resolved).await.map_err(|e| {
            AppError::BadRequest(format!("Cannot delete file: {}", e))
        })?;
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
    fs::set_permissions(&resolved, permissions).await.map_err(|e| {
        AppError::BadRequest(format!("Cannot set permissions: {}", e))
    })?;

    build_file_entry(&resolved).await
}

/// Change file owner (Unix only). Requires appropriate privileges.
#[cfg(unix)]
pub async fn chown_path(path: &str, uid: Option<u32>, gid: Option<u32>) -> Result<FileEntry, AppError> {
    use std::os::unix::ffi::OsStrExt;

    let resolved = resolve_safe_path(path)?;
    debug!("Chown: {} -> uid={:?} gid={:?}", resolved.display(), uid, gid);

    if !resolved.exists() {
        return Err(AppError::NotFound(format!(
            "Path not found: {}",
            resolved.display()
        )));
    }

    let c_path = std::ffi::CString::new(resolved.as_os_str().as_bytes()).map_err(|_| {
        AppError::BadRequest("Invalid path".into())
    })?;

    let result = unsafe {
        libc::chown(
            c_path.as_ptr(),
            uid.unwrap_or(u32::MAX), // -1 means don't change
            gid.unwrap_or(u32::MAX),
        )
    };

    if result != 0 {
        let err = std::io::Error::last_os_error();
        return Err(AppError::BadRequest(format!("Cannot change owner: {}", err)));
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
        return Err(AppError::BadRequest("Search path must be a directory".into()));
    }

    let pattern_lower = pattern.to_lowercase();
    let mut results = Vec::new();
    search_recursive(&resolved, &pattern_lower, recursive, max_results, &mut results).await?;

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
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

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
