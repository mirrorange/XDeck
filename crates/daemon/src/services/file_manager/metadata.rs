use std::path::Path;

use chrono::{DateTime, Utc};
use tokio::fs;

use crate::error::AppError;

use super::{FileEntry, FileType};

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

pub(super) async fn build_file_entry(path: &Path) -> Result<FileEntry, AppError> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();

    let metadata = fs::symlink_metadata(path).await.map_err(|err| {
        AppError::BadRequest(format!(
            "Cannot read metadata for {}: {}",
            path.display(),
            err
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
            .map(|target| target.to_string_lossy().to_string())
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
