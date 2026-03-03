use serde::de::DeserializeOwned;

use crate::error::AppError;
use crate::rpc::router::{RequestContext, SessionAccess};

pub const WS_ONLY_ERROR: &str = "Only available over WebSocket";

/// Parse required JSON-RPC params into a strongly typed struct.
pub fn parse_required_params<T: DeserializeOwned>(
    params: Option<serde_json::Value>,
) -> Result<T, AppError> {
    let params = params.ok_or_else(|| AppError::BadRequest("Missing params".into()))?;
    serde_json::from_value(params)
        .map_err(|e| AppError::BadRequest(format!("Invalid params: {}", e)))
}

pub fn require_ws_session(ctx: &RequestContext) -> Result<&dyn SessionAccess, AppError> {
    ctx.session()
        .ok_or_else(|| AppError::BadRequest(WS_ONLY_ERROR.into()))
}
