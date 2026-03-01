use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 Request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

/// JSON-RPC 2.0 Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 Error Object
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// JSON-RPC 2.0 Notification (no id)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcResponse {
    /// Create a success response.
    pub fn success(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Create an error response.
    pub fn error(id: Option<Value>, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }

    /// Create an error response with additional data.
    pub fn error_with_data(
        id: Option<Value>,
        code: i64,
        message: impl Into<String>,
        data: Value,
    ) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: Some(data),
            }),
        }
    }
}

impl JsonRpcNotification {
    /// Create a new notification (server push event).
    pub fn new(method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            method: method.into(),
            params: Some(params),
        }
    }
}

impl JsonRpcRequest {
    /// Validate that this is a well-formed JSON-RPC 2.0 request.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.jsonrpc != "2.0" {
            return Err("Invalid JSON-RPC version");
        }
        if self.method.is_empty() {
            return Err("Method must not be empty");
        }
        Ok(())
    }

    /// Check if this is a notification (no id).
    pub fn is_notification(&self) -> bool {
        self.id.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_request() {
        let json = r#"{"jsonrpc":"2.0","id":"req-001","method":"process.list","params":{"filter":{"status":"running"}}}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.jsonrpc, "2.0");
        assert_eq!(req.method, "process.list");
        assert!(req.id.is_some());
        assert!(req.params.is_some());
        assert!(req.validate().is_ok());
    }

    #[test]
    fn test_parse_notification() {
        let json =
            r#"{"jsonrpc":"2.0","method":"event.subscribe","params":{"topics":["process.*"]}}"#;
        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert!(req.is_notification());
    }

    #[test]
    fn test_success_response() {
        let resp = JsonRpcResponse::success(
            Some(Value::String("req-001".to_string())),
            serde_json::json!({"processes": []}),
        );
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"result\""));
        assert!(!json.contains("\"error\""));
    }

    #[test]
    fn test_error_response() {
        let resp = JsonRpcResponse::error(
            Some(Value::String("req-001".to_string())),
            -32601,
            "Method not found",
        );
        let json = serde_json::to_string(&resp).unwrap();
        assert!(!json.contains("\"result\""));
        assert!(json.contains("\"error\""));
        assert!(json.contains("-32601"));
    }
}
