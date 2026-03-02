use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Serialize)]
pub struct ValidationIssue {
    pub field: String,
    pub message: String,
}

impl ValidationIssue {
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            message: message.into(),
        }
    }
}

/// Application-level error types.
#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Authentication required")]
    Unauthorized,

    #[error("Token expired")]
    TokenExpired,

    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("Initial setup required")]
    SetupRequired,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Already exists: {0}")]
    AlreadyExists(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Bad request: {message}")]
    BadRequestWithDetails {
        message: String,
        details: Vec<ValidationIssue>,
    },

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

/// JSON-RPC error codes per ADD spec.
pub mod error_codes {
    // JSON-RPC standard errors
    pub const PARSE_ERROR: i64 = -32700;
    pub const INVALID_REQUEST: i64 = -32600;
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    pub const INTERNAL_ERROR: i64 = -32603;

    // Auth errors (1000-1999)
    pub const UNAUTHORIZED: i64 = 1001;
    pub const TOKEN_EXPIRED: i64 = 1002;
    pub const INVALID_CREDENTIALS: i64 = 1003;
    pub const SETUP_REQUIRED: i64 = 1004;

    // Process management errors (2000-2999)
    pub const PROCESS_NOT_FOUND: i64 = 2001;
    pub const PROCESS_ALREADY_RUNNING: i64 = 2002;
    pub const PROCESS_START_FAILED: i64 = 2003;

    // Nginx/Site errors (3000-3999)
    pub const CONFIG_INVALID: i64 = 3001;
    pub const PORT_CONFLICT: i64 = 3002;

    // Docker errors (4000-4999)
    pub const DOCKER_NOT_AVAILABLE: i64 = 4001;
    pub const CONTAINER_NOT_FOUND: i64 = 4002;

    // Certificate errors (5000-5999)
    pub const ACME_CHALLENGE_FAILED: i64 = 5001;

    // Node errors (6000-6999)
    pub const NODE_UNREACHABLE: i64 = 6001;
}

impl AppError {
    pub fn bad_request_with_details(
        message: impl Into<String>,
        details: Vec<ValidationIssue>,
    ) -> Self {
        Self::BadRequestWithDetails {
            message: message.into(),
            details,
        }
    }

    /// Map error to JSON-RPC error code.
    pub fn error_code(&self) -> i64 {
        match self {
            AppError::Database(_) => error_codes::INTERNAL_ERROR,
            AppError::Unauthorized => error_codes::UNAUTHORIZED,
            AppError::TokenExpired => error_codes::TOKEN_EXPIRED,
            AppError::InvalidCredentials => error_codes::INVALID_CREDENTIALS,
            AppError::SetupRequired => error_codes::SETUP_REQUIRED,
            AppError::NotFound(_) => error_codes::METHOD_NOT_FOUND,
            AppError::AlreadyExists(_) => error_codes::INVALID_PARAMS,
            AppError::BadRequest(_) => error_codes::INVALID_PARAMS,
            AppError::BadRequestWithDetails { .. } => error_codes::INVALID_PARAMS,
            AppError::Internal(_) => error_codes::INTERNAL_ERROR,
            AppError::Other(_) => error_codes::INTERNAL_ERROR,
        }
    }

    /// Optional structured payload for JSON-RPC error.data.
    pub fn error_data(&self) -> Option<serde_json::Value> {
        match self {
            AppError::BadRequestWithDetails { details, .. } => {
                Some(serde_json::json!({ "details": details }))
            }
            _ => None,
        }
    }
}
