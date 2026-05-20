use axum::{
    extract::State,
    http::HeaderMap,
    Json,
};
use std::sync::Arc;

use crate::api::admin::AppError;
use crate::search::handler::search;
use crate::storage::pool::AppState;
use crate::types::search::{SearchRequest, SearchResponse};

pub type SharedState = Arc<AppState>;

/// R2: POST /api/v1/public/search
///
/// 接收搜索请求，可选 query_vector（Vec<f64>），
/// 转换为 [f32; 384] 后委托 search() 执行 FTS5 + Hybrid 搜索。
pub async fn search_handler(
    state: State<SharedState>,
    headers: HeaderMap,
    req: Json<SearchRequest>,
) -> Result<Json<SearchResponse>, AppError> {
    // 校验 query_text 非空
    let query_text = req.query_text.trim();
    if query_text.is_empty() {
        return Err(AppError::BadRequest("query_text is required".into()));
    }
    if query_text.len() > 200 {
        return Err(AppError::BadRequest(
            "query_text must not exceed 200 characters".into(),
        ));
    }

    // 提取 client_verify（可选，默认空字符串）
    let client_verify = headers
        .get("X-Client-Verify")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Option<Vec<f64>> → Option<[f32; 384]> 转换
    let query_vector: Option<[f32; 384]> = if let Some(vec_f64) = &req.query_vector {
        if vec_f64.len() != 384 {
            return Err(AppError::BadRequest(format!(
                "query_vector must have 384 dimensions, got {}",
                vec_f64.len()
            )));
        }
        let mut arr = [0.0f32; 384];
        for (i, &v) in vec_f64.iter().enumerate() {
            let f = v as f32;
            if f.is_nan() {
                return Err(AppError::BadRequest(format!(
                    "query_vector contains NaN at index {}",
                    i
                )));
            }
            if f.is_infinite() {
                return Err(AppError::BadRequest(format!(
                    "query_vector contains Inf at index {}",
                    i
                )));
            }
            arr[i] = f;
        }
        Some(arr)
    } else {
        None
    };

    // 委托 search() 执行异步搜索
    let response = search(
        &state,
        query_text,
        query_vector.as_ref(),
        &client_verify,
    )
    .await
    .map_err(|e| {
        tracing::error!("search failed: {:#}", e);
        AppError::Internal("internal server error".into())
    })?;

    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::types::sync::{ArticleMetadata, ArticleSpec, ChunkData};
    use crate::storage::write::write_article_transaction;

    struct TestContext {
        _tmp: tempfile::NamedTempFile,
        state: SharedState,
    }

    async fn setup_test_db() -> TestContext {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path").to_string();
        std::env::set_var("BLINKCORE_DB_PATH", &db_path);
        let state = Arc::new(init_db(&db_path).expect("init_db"));

        // 插入测试文章
        let conn = state.write_conn.lock().await;
        let meta = ArticleMetadata {
            slug: "rust-intro".into(),
            title: "Rust Introduction".into(),
            visibility: "public".into(),
            content_hash: "c".repeat(64),
            tags: vec![],
        };
        let spec = ArticleSpec {
            raw_content: "Rust programming language".into(),
            excalidraw_data: None,
            chunks: vec![ChunkData {
                chunk_index: 0,
                heading_level: 2,
                heading_text: "Rust Basics".into(),
                slug_anchor: "rust-basics".into(),
                content: "Rust is a systems programming language".into(),
                dense_embedding: vec![0.1f32; 384],
            }],
        };
        write_article_transaction(&*conn, &meta, &spec).expect("write article");
        drop(conn);

        TestContext { _tmp: tmp, state }
    }

    #[tokio::test]
    async fn test_search_route_fts_only() {
        let tc = setup_test_db().await;
        let headers = HeaderMap::new();

        let req = SearchRequest {
            query_text: "Rust".into(),
            query_vector: None,
        };

        let response = search_handler(State(tc.state), headers, Json(req))
            .await
            .expect("search should succeed");

        assert_eq!(response.mode, crate::types::search::SearchMode::FtsOnly);
        assert!(!response.results.is_empty(), "should find results");
        assert_eq!(response.results.len(), 1);
    }

    #[tokio::test]
    async fn test_search_route_hybrid() {
        let tc = setup_test_db().await;
        let headers = HeaderMap::new();

        let req = SearchRequest {
            query_text: "Rust".into(),
            query_vector: Some(vec![0.1f64; 384]),
        };

        let response = search_handler(State(tc.state), headers, Json(req))
            .await
            .expect("search should succeed");

        assert_eq!(response.mode, crate::types::search::SearchMode::Hybrid);
    }

    #[tokio::test]
    async fn test_search_route_empty_query() {
        let tc = setup_test_db().await;
        let headers = HeaderMap::new();

        let req = SearchRequest {
            query_text: "".into(),
            query_vector: None,
        };

        let result = search_handler(State(tc.state), headers, Json(req)).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::BadRequest(msg) => {
                assert!(msg.contains("query_text is required"));
            }
            other => panic!("expected BadRequest, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_search_route_wrong_dim() {
        let tc = setup_test_db().await;
        let headers = HeaderMap::new();

        let req = SearchRequest {
            query_text: "Rust".into(),
            query_vector: Some(vec![0.1f64; 128]), // 维度错误
        };

        let result = search_handler(State(tc.state), headers, Json(req)).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::BadRequest(msg) => {
                assert!(msg.contains("384 dimensions"), "msg: {}", msg);
            }
            other => panic!("expected BadRequest, got {:?}", other),
        }
    }
}