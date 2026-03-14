use axum::{
    body::Body,
    extract::{Multipart, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use tracing::{info, warn};

use crate::services::file_manager;

use super::AppState;

#[derive(Debug, Deserialize)]
pub struct FileTransferParams {
    pub token: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct FileUploadParams {
    pub token: String,
    pub path: String,
}

/// Authenticate a token against the auth service.
fn authorize(state: &AppState, token: &str) -> Result<(), StatusCode> {
    if token.trim().is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    state
        .auth_service
        .verify_token(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(())
}

/// GET /api/files/download?token=...&path=...
/// Stream a file as a download.
pub async fn download_handler(
    Query(params): Query<FileTransferParams>,
    State(state): State<AppState>,
) -> Response {
    if let Err(code) = authorize(&state, &params.token) {
        return code.into_response();
    }

    let safe_path = match file_manager::resolve_safe_path(&params.path) {
        Ok(p) => p,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    if !safe_path.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let file = match tokio::fs::File::open(&safe_path).await {
        Ok(f) => f,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let metadata = match file.metadata().await {
        Ok(m) => m,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let file_name = safe_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download");

    let content_type = mime_guess::from_path(&safe_path)
        .first_or_octet_stream()
        .to_string();

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    info!("File download: {}", safe_path.display());

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, metadata.len())
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", file_name),
        )
        .body(body)
        .unwrap()
        .into_response()
}

/// Validate a relative path component to prevent path traversal.
/// Returns the sanitized relative path, or None if it's invalid.
fn sanitize_relative_path(path: &str) -> Option<std::path::PathBuf> {
    let path = std::path::Path::new(path);

    // Reject absolute paths
    if path.is_absolute() {
        return None;
    }

    // Reject any component that is ".."
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => return None,
            std::path::Component::RootDir => return None,
            std::path::Component::Prefix(_) => return None,
            _ => {}
        }
    }

    Some(path.to_path_buf())
}

/// POST /api/files/upload?token=...&path=...
/// Upload files via multipart form data into the specified directory.
///
/// For folder uploads, each file field should include a "relative_path" text field
/// before it, specifying the path relative to the upload root (e.g., "subdir/file.txt").
/// Files without a relative_path are placed directly in the destination directory.
pub async fn upload_handler(
    Query(params): Query<FileUploadParams>,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Response {
    if let Err(code) = authorize(&state, &params.token) {
        return code.into_response();
    }

    let dest_dir = match file_manager::resolve_safe_path(&params.path) {
        Ok(p) => p,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    if !dest_dir.is_dir() {
        return (StatusCode::BAD_REQUEST, "Destination must be a directory").into_response();
    }

    let mut uploaded: Vec<String> = Vec::new();
    // Track the current relative path for folder uploads
    let mut current_relative_path: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().map(|s| s.to_string());

        // Handle relative_path text fields (sent before each file in folder uploads)
        if field_name.as_deref() == Some("relative_path") {
            let text = match field.text().await {
                Ok(t) => t,
                Err(e) => {
                    warn!("Failed to read relative_path field: {}", e);
                    return (StatusCode::BAD_REQUEST, "Failed to read relative_path").into_response();
                }
            };
            current_relative_path = Some(text);
            continue;
        }

        let file_name = match field.file_name() {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Determine the destination path
        let dest_path = if let Some(ref rel_path) = current_relative_path {
            // Folder upload mode: use relative path
            match sanitize_relative_path(rel_path) {
                Some(sanitized) => {
                    let full_path = dest_dir.join(&sanitized);
                    // Create parent directories if needed
                    if let Some(parent) = full_path.parent() {
                        if !parent.exists() {
                            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                                warn!("Failed to create directory {}: {}", parent.display(), e);
                                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                            }
                        }
                    }
                    full_path
                }
                None => {
                    warn!("Rejected upload with suspicious relative path: {}", rel_path);
                    return (StatusCode::BAD_REQUEST, "Invalid relative path").into_response();
                }
            }
        } else {
            // Simple upload mode: validate filename directly
            if file_name.contains('/') || file_name.contains('\\') || file_name == ".." || file_name == "." {
                warn!("Rejected upload with suspicious filename: {}", file_name);
                return (StatusCode::BAD_REQUEST, "Invalid filename").into_response();
            }
            dest_dir.join(&file_name)
        };

        // Reset relative path for the next file
        current_relative_path = None;

        let data = match field.bytes().await {
            Ok(d) => d,
            Err(e) => {
                warn!("Failed to read upload field: {}", e);
                return (StatusCode::BAD_REQUEST, "Failed to read file data").into_response();
            }
        };

        let mut file = match tokio::fs::File::create(&dest_path).await {
            Ok(f) => f,
            Err(e) => {
                warn!("Failed to create file {}: {}", dest_path.display(), e);
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };

        if let Err(e) = file.write_all(&data).await {
            warn!("Failed to write file {}: {}", dest_path.display(), e);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }

        // Report the path relative to dest_dir for the response
        let reported_path = dest_path
            .strip_prefix(&dest_dir)
            .unwrap_or(&dest_path)
            .to_string_lossy()
            .to_string();

        info!("File uploaded: {}", dest_path.display());
        uploaded.push(reported_path);
    }

    let body = serde_json::json!({
        "uploaded": uploaded,
        "count": uploaded.len(),
    });

    (StatusCode::OK, axum::Json(body)).into_response()
}
