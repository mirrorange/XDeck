use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Resolve and validate a path, preventing path traversal attacks.
/// Returns the canonicalized absolute path.
pub fn resolve_safe_path(path: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(path);

    if !path.is_absolute() {
        return Err(AppError::BadRequest("Path must be absolute".into()));
    }

    let resolved = if path.exists() {
        path.canonicalize()
            .map_err(|err| AppError::BadRequest(format!("Cannot resolve path: {}", err)))?
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| AppError::BadRequest("Invalid path".into()))?;
        let file_name = path
            .file_name()
            .ok_or_else(|| AppError::BadRequest("Invalid path".into()))?;
        let resolved_parent = parent
            .canonicalize()
            .map_err(|err| AppError::BadRequest(format!("Cannot resolve parent path: {}", err)))?;
        resolved_parent.join(file_name)
    };

    Ok(resolved)
}
