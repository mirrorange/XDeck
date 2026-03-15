use axum::{
    body::{Body, Bytes},
    extract::{Multipart, Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use tracing::{info, warn};

use crate::error::AppError;
use crate::services::file_manager;
use crate::services::upload_manager::CreateUploadSessionRequest;

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

#[derive(Debug, Deserialize)]
pub struct AuthQuery {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct UploadChunkParams {
    pub token: String,
    pub offset: u64,
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

fn app_error_response(err: AppError) -> Response {
    match err {
        AppError::BadRequest(message) => (StatusCode::BAD_REQUEST, message).into_response(),
        AppError::BadRequestWithDetails { message, details } => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": message,
                "details": details,
            })),
        )
            .into_response(),
        AppError::NotFound(message) => (StatusCode::NOT_FOUND, message).into_response(),
        AppError::Unauthorized | AppError::TokenExpired | AppError::InvalidCredentials => {
            StatusCode::UNAUTHORIZED.into_response()
        }
        other => {
            warn!("Upload API error: {}", other);
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
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

/// POST /api/files/upload/sessions?token=...
/// Create a resumable upload session and a corresponding task-list entry.
pub async fn create_upload_session_handler(
    Query(params): Query<AuthQuery>,
    State(state): State<AppState>,
    Json(request): Json<CreateUploadSessionRequest>,
) -> Response {
    if let Err(code) = authorize(&state, &params.token) {
        return code.into_response();
    }

    match state.upload_manager.create_session(request).await {
        Ok(session) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "session": session })),
        )
            .into_response(),
        Err(err) => app_error_response(err),
    }
}

/// GET /api/files/upload/sessions/:session_id?token=...
/// Fetch the persisted upload session state for resume/retry logic.
pub async fn get_upload_session_handler(
    Query(params): Query<AuthQuery>,
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
) -> Response {
    if let Err(code) = authorize(&state, &params.token) {
        return code.into_response();
    }

    match state.upload_manager.get_session(&session_id).await {
        Ok(session) => (StatusCode::OK, Json(serde_json::json!({ "session": session }))).into_response(),
        Err(err) => app_error_response(err),
    }
}

/// PUT /api/files/upload/sessions/:session_id/files/:file_id/chunk?token=...&offset=...
/// Append a single upload chunk to the file's temp file.
pub async fn upload_chunk_handler(
    Query(params): Query<UploadChunkParams>,
    State(state): State<AppState>,
    AxumPath((session_id, file_id)): AxumPath<(String, String)>,
    body: Bytes,
) -> Response {
    if let Err(code) = authorize(&state, &params.token) {
        return code.into_response();
    }

    match state
        .upload_manager
        .append_chunk(&session_id, &file_id, params.offset, body)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(serde_json::json!(result))).into_response(),
        Err(err) => app_error_response(err),
    }
}

/// POST /api/files/upload/sessions/:session_id/complete?token=...
/// Finalize a resumable upload by moving all staged files into place.
pub async fn complete_upload_session_handler(
    Query(params): Query<AuthQuery>,
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
) -> Response {
    if let Err(code) = authorize(&state, &params.token) {
        return code.into_response();
    }

    match state.upload_manager.complete_session(&session_id).await {
        Ok(session) => (StatusCode::OK, Json(serde_json::json!({ "session": session }))).into_response(),
        Err(err) => app_error_response(err),
    }
}

/// DELETE /api/files/upload/sessions/:session_id?token=...
/// Cancel a resumable upload and remove its staged temp files.
pub async fn cancel_upload_session_handler(
    Query(params): Query<AuthQuery>,
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<String>,
) -> Response {
    if let Err(code) = authorize(&state, &params.token) {
        return code.into_response();
    }

    match state.upload_manager.cancel_session(&session_id).await {
        Ok(cancelled) => (
            StatusCode::OK,
            Json(serde_json::json!({ "cancelled": cancelled })),
        )
            .into_response(),
        Err(err) => app_error_response(err),
    }
}
