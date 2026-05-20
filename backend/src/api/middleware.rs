use axum::http::{HeaderMap, StatusCode};

use crate::types::search::ErrorResponse;

/// mTLS 守卫函数 — 检查 X-Client-Verify 是否为 "SUCCESS"
///
/// 在 sync_handler 中调用，返回 Result 而非中间件形式，
/// 避免 axum 0.7 的 middleware 路由分组复杂性。
pub fn mtls_guard(headers: &HeaderMap) -> Result<(), (StatusCode, axum::Json<ErrorResponse>)> {
    let verify = headers
        .get("X-Client-Verify")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if verify == "SUCCESS" {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            axum::Json(ErrorResponse {
                error: "mTLS client certificate required".into(),
            }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_mtls_guard_success() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Client-Verify", HeaderValue::from_static("SUCCESS"));
        assert!(mtls_guard(&headers).is_ok());
    }

    #[test]
    fn test_mtls_guard_forbidden_no_header() {
        let headers = HeaderMap::new();
        let result = mtls_guard(&headers);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_mtls_guard_forbidden_wrong_value() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Client-Verify", HeaderValue::from_static("FAILED"));
        let result = mtls_guard(&headers);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().0, StatusCode::FORBIDDEN);
    }
}