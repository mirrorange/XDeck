use std::collections::HashSet;
use std::path::Path;

use uuid::Uuid;

use crate::error::AppError;

use super::UploadFileDescriptor;

#[derive(Debug, Clone)]
pub(super) struct NormalizedUploadFile {
    pub id: String,
    pub file_name: String,
    pub relative_path: String,
    pub size: u64,
    pub last_modified: Option<i64>,
}

pub(super) fn normalize_files(
    files: &[UploadFileDescriptor],
) -> Result<Vec<NormalizedUploadFile>, AppError> {
    let mut normalized = Vec::with_capacity(files.len());
    let mut seen_paths = HashSet::new();

    for file in files {
        let relative_path = normalize_relative_upload_path(file)?;
        if !seen_paths.insert(relative_path.clone()) {
            return Err(AppError::BadRequest(format!(
                "Duplicate upload path in session: {}",
                relative_path
            )));
        }

        let file_name = Path::new(&relative_path)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::BadRequest("Invalid upload file name".into()))?
            .to_string();

        normalized.push(NormalizedUploadFile {
            id: Uuid::new_v4().to_string(),
            file_name,
            relative_path,
            size: file.size,
            last_modified: file.last_modified,
        });
    }

    Ok(normalized)
}

fn normalize_relative_upload_path(file: &UploadFileDescriptor) -> Result<String, AppError> {
    let candidate = file
        .relative_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .unwrap_or(file.name.as_str());
    let path = Path::new(candidate);

    if path.is_absolute() {
        return Err(AppError::BadRequest(format!(
            "Upload path must be relative: {}",
            candidate
        )));
    }

    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => {
                let part = part.to_str().ok_or_else(|| {
                    AppError::BadRequest(format!("Upload path is not valid UTF-8: {}", candidate))
                })?;
                if part.is_empty() {
                    return Err(AppError::BadRequest(format!(
                        "Upload path contains an empty component: {}",
                        candidate
                    )));
                }
                parts.push(part.to_string());
            }
            _ => {
                return Err(AppError::BadRequest(format!(
                    "Invalid upload path: {}",
                    candidate
                )))
            }
        }
    }

    if parts.is_empty() {
        return Err(AppError::BadRequest("Upload path cannot be empty".into()));
    }

    Ok(parts.join("/"))
}

pub(super) fn build_upload_title(files: &[NormalizedUploadFile]) -> String {
    if files.len() == 1 {
        return format!("Uploading {}", files[0].file_name);
    }

    let root = files[0]
        .relative_path
        .split('/')
        .next()
        .unwrap_or("files")
        .to_string();
    let is_folder = files
        .iter()
        .all(|file| file.relative_path.starts_with(&(root.clone() + "/")));

    if is_folder {
        format!("Uploading folder: {}", root)
    } else {
        format!("Uploading {} files", files.len())
    }
}

pub(super) fn progress_percent(uploaded: u64, total: u64) -> u8 {
    if total == 0 {
        return 100;
    }

    (((uploaded as f64 / total as f64) * 100.0).round() as u8).min(100)
}

pub(super) fn to_i64(value: u64) -> Result<i64, AppError> {
    i64::try_from(value)
        .map_err(|_| AppError::Internal("Value exceeds sqlite integer range".into()))
}

pub(super) fn from_i64(value: i64) -> Result<u64, AppError> {
    u64::try_from(value)
        .map_err(|_| AppError::Internal("Database contained a negative value".into()))
}
