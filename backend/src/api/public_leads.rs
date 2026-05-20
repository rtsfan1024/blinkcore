use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::api::admin::AppError;
use crate::storage::pool::AppState;
use crate::types::search::{LeadsRequest, LeadsResponse};

pub type SharedState = Arc<AppState>;

/// R3: POST /api/v1/public/leads
///
/// 接收 Leads 提交请求，写入 pending_leads 表，返回 201 + lead_id。
pub async fn leads_handler(
    State(state): State<SharedState>,
    req: Json<LeadsRequest>,
) -> Result<(StatusCode, Json<LeadsResponse>), AppError> {
    // 校验 target_slug 非空
    let target_slug = req.target_slug.trim();
    if target_slug.is_empty() {
        return Err(AppError::BadRequest("target_slug is required".into()));
    }

    // 校验 trigger_keyword 非空
    let trigger_keyword = req.trigger_keyword.trim();
    if trigger_keyword.is_empty() {
        return Err(AppError::BadRequest("trigger_keyword is required".into()));
    }

    // 校验 contact_value 非空
    let contact_value = req.contact_value.trim();
    if contact_value.is_empty() {
        return Err(AppError::BadRequest("contact_value is required".into()));
    }

    // contact_method 由 serde 反序列化时已做 enum 校验，无需额外检查

    let lead_id = Uuid::new_v4().to_string();
    let contact_method_str = serde_json::to_string(&req.contact_method)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();
    let user_comment = req.user_comment.clone();

    let write_conn = state.write_conn.clone();
    let lid = lead_id.clone();
    let tslug = target_slug.to_string();
    let tkeyword = trigger_keyword.to_string();
    let cvalue = contact_value.to_string();

    tokio::task::spawn_blocking(move || {
        let conn = write_conn.blocking_lock();
        conn.execute(
            "INSERT INTO pending_leads (lead_id, target_slug, trigger_keyword, contact_method, contact_value, user_comment) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![lid, tslug, tkeyword, contact_method_str, cvalue, user_comment],
        )
    })
    .await
    .map_err(|e| AppError::Internal(format!("spawn_blocking join: {}", e)))?
    .map_err(|e| AppError::Internal(format!("failed to insert lead: {}", e)))?;

    Ok((
        StatusCode::CREATED,
        Json(LeadsResponse {
            lead_id,
            status: "received".into(),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::types::search::ContactMethod;
    use axum::extract::State;

    struct TestContext {
        _tmp: tempfile::NamedTempFile,
        state: SharedState,
    }

    fn setup_test_db() -> TestContext {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path").to_string();
        std::env::set_var("BLINKCORE_DB_PATH", &db_path);
        let state = Arc::new(init_db(&db_path).expect("init_db"));
        TestContext { _tmp: tmp, state }
    }

    #[tokio::test]
    async fn test_leads_create() {
        let tc = setup_test_db();

        let req = LeadsRequest {
            target_slug: "rust-intro".into(),
            trigger_keyword: "contact".into(),
            contact_method: ContactMethod::Email,
            contact_value: "test@example.com".into(),
            user_comment: Some("I have a question".into()),
        };

        let (status, response) =
            leads_handler(State(tc.state), Json(req))
                .await
                .expect("leads_handler should succeed");

        assert_eq!(status, StatusCode::CREATED);
        assert!(!response.lead_id.is_empty(), "lead_id should not be empty");
        assert_eq!(response.status, "received");

        // 验证 UUID 格式
        assert!(
            uuid::Uuid::parse_str(&response.lead_id).is_ok(),
            "lead_id should be a valid UUID v4"
        );
    }

    #[tokio::test]
    async fn test_leads_empty_target_slug() {
        let tc = setup_test_db();

        let req = LeadsRequest {
            target_slug: "".into(),
            trigger_keyword: "contact".into(),
            contact_method: ContactMethod::Email,
            contact_value: "test@example.com".into(),
            user_comment: None,
        };

        let result = leads_handler(State(tc.state), Json(req)).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::BadRequest(msg) => {
                assert!(msg.contains("target_slug"), "msg: {}", msg);
            }
            other => panic!("expected BadRequest, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_leads_empty_trigger_keyword() {
        let tc = setup_test_db();

        let req = LeadsRequest {
            target_slug: "rust-intro".into(),
            trigger_keyword: "".into(),
            contact_method: ContactMethod::Email,
            contact_value: "test@example.com".into(),
            user_comment: None,
        };

        let result = leads_handler(State(tc.state), Json(req)).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::BadRequest(msg) => {
                assert!(msg.contains("trigger_keyword"), "msg: {}", msg);
            }
            other => panic!("expected BadRequest, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_leads_empty_contact_value() {
        let tc = setup_test_db();

        let req = LeadsRequest {
            target_slug: "rust-intro".into(),
            trigger_keyword: "contact".into(),
            contact_method: ContactMethod::Email,
            contact_value: "".into(),
            user_comment: None,
        };

        let result = leads_handler(State(tc.state), Json(req)).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::BadRequest(msg) => {
                assert!(msg.contains("contact_value"), "msg: {}", msg);
            }
            other => panic!("expected BadRequest, got {:?}", other),
        }
    }
}