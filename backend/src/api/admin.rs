use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::api::middleware::mtls_guard;
use crate::storage::gc::manifest_gc;
use crate::storage::pool::AppState;
use crate::storage::write::write_article_transaction;
use crate::types::search::ErrorResponse;
use crate::types::sync::{SyncRequest, SyncResponse, SyncedArticle};

pub type SharedState = Arc<AppState>;

/// 自定义应用层错误，自动映射 HTTP 状态码 + JSON error body
#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Forbidden(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, msg) = match self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (status, Json(ErrorResponse { error: msg })).into_response()
    }
}

/// R1: POST /api/v1/admin/sync
///
/// 接收 Obsidian 同步客户端的文章 payload，执行写入事务 + manifest GC。
/// X-Client-Verify 必须为 "SUCCESS"（由 Nginx mTLS 注入），否则 403。
pub async fn sync_handler(
    State(state): State<SharedState>,
    headers: HeaderMap,
    req: Json<SyncRequest>,
) -> Result<Json<SyncResponse>, AppError> {
    // mTLS 鉴权
    mtls_guard(&headers).map_err(|_| {
        AppError::Forbidden("mTLS client certificate required".into())
    })?;

    // 字段校验
    if req.api_version != "knowledge.your-domain.com/v1alpha1" {
        return Err(AppError::BadRequest(format!(
            "invalid api_version: expected 'knowledge.your-domain.com/v1alpha1', got '{}'",
            req.api_version
        )));
    }
    if req.kind != "KnowledgeSyncPayload" {
        return Err(AppError::BadRequest(format!(
            "invalid kind: expected 'KnowledgeSyncPayload', got '{}'",
            req.kind
        )));
    }

    let articles = req.articles.clone();
    let articles_len = articles.len();
    let active_manifest = req.active_manifest.clone();
    let write_conn = state.write_conn.clone();

    let sync_result = tokio::task::spawn_blocking(move || {
        let conn = write_conn.blocking_lock();
        let mut synced: Vec<SyncedArticle> = Vec::new();
        let mut errors: Vec<String> = Vec::new();

        for payload in &articles {
            match write_article_transaction(&conn, &payload.metadata, &payload.spec) {
                Ok((article_id, chunk_count)) => {
                    tracing::info!(
                        "synced article: slug={}, id={}, chunks={}",
                        payload.metadata.slug,
                        article_id,
                        chunk_count
                    );
                    synced.push(SyncedArticle {
                        slug: payload.metadata.slug.clone(),
                        article_id,
                        chunk_count,
                    });
                }
                Err(e) => {
                    tracing::warn!(
                        "failed to sync article {}: {:#}",
                        payload.metadata.slug,
                        e
                    );
                    errors.push(payload.metadata.slug.clone());
                }
            }
        }

        let pruned = manifest_gc(&conn, &active_manifest).unwrap_or_else(|e| {
            tracing::warn!("manifest GC failed: {:#}", e);
            vec![]
        });

        (synced, pruned, errors)
    })
    .await
    .map_err(|e| AppError::Internal(format!("spawn_blocking join: {}", e)))?;

    let (synced, pruned, errors) = sync_result;

    // 全部失败 → 500
    if articles_len > 0 && errors.len() == articles_len {
        return Err(AppError::Internal(
            "all articles failed to sync, no articles written".into(),
        ));
    }

    // 部分成功 → 200 + synced 列表
    if !errors.is_empty() {
        tracing::warn!(
            "sync partial success: {} synced, {} failed: {:?}",
            synced.len(),
            errors.len(),
            errors
        );
    }

    Ok(Json(SyncResponse { synced, pruned }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::types::sync::{ArticleMetadata, ArticleSpec, ChunkData};
    use axum::http::HeaderValue;

    fn make_test_payload(slug: &str, hash: &str) -> crate::types::sync::ArticlePayload {
        crate::types::sync::ArticlePayload {
            metadata: ArticleMetadata {
                slug: slug.into(),
                title: format!("Article {}", slug),
                visibility: "public".into(),
                content_hash: hash.into(),
                tags: vec![],
            },
            spec: ArticleSpec {
                raw_content: format!("# {}\n\nContent", slug),
                excalidraw_data: None,
                chunks: vec![ChunkData {
                    chunk_index: 0,
                    heading_level: 2,
                    heading_text: "Intro".into(),
                    slug_anchor: "intro".into(),
                    content: format!("Content for {}", slug),
                    dense_embedding: vec![0.1f32; 384],
                }],
            },
        }
    }

    #[tokio::test]
    async fn test_sync_handler_ok() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");
        let state = Arc::new(init_db(db_path).expect("init_db"));

        let req = SyncRequest {
            api_version: "knowledge.your-domain.com/v1alpha1".into(),
            kind: "KnowledgeSyncPayload".into(),
            active_manifest: vec!["article-a".into()],
            articles: vec![make_test_payload("article-a", "a".repeat(64).as_str())],
        };

        let mut headers = HeaderMap::new();
        headers.insert("X-Client-Verify", HeaderValue::from_static("SUCCESS"));

        let response = sync_handler(State(state), headers, Json(req))
            .await
            .expect("sync_handler should succeed");

        assert_eq!(response.synced.len(), 1);
        assert_eq!(response.synced[0].slug, "article-a");
        assert_eq!(response.synced[0].chunk_count, 1);
    }

    #[tokio::test]
    async fn test_sync_handler_forbidden() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");
        let state = Arc::new(init_db(db_path).expect("init_db"));

        let req = SyncRequest {
            api_version: "knowledge.your-domain.com/v1alpha1".into(),
            kind: "KnowledgeSyncPayload".into(),
            active_manifest: vec![],
            articles: vec![],
        };

        // 无 X-Client-Verify header
        let headers = HeaderMap::new();
        let result = sync_handler(State(state), headers, Json(req)).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Forbidden(_) => {} // expected
            other => panic!("expected Forbidden, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_sync_handler_invalid_api_version() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");
        let state = Arc::new(init_db(db_path).expect("init_db"));

        let req = SyncRequest {
            api_version: "invalid".into(),
            kind: "KnowledgeSyncPayload".into(),
            active_manifest: vec![],
            articles: vec![],
        };

        let mut headers = HeaderMap::new();
        headers.insert("X-Client-Verify", HeaderValue::from_static("SUCCESS"));

        let result = sync_handler(State(state), headers, Json(req)).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::BadRequest(_) => {} // expected
            other => panic!("expected BadRequest, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_sync_handler_empty_articles_ok() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");
        let state = Arc::new(init_db(db_path).expect("init_db"));

        let req = SyncRequest {
            api_version: "knowledge.your-domain.com/v1alpha1".into(),
            kind: "KnowledgeSyncPayload".into(),
            active_manifest: vec!["nonexistent".into()],
            articles: vec![],
        };

        let mut headers = HeaderMap::new();
        headers.insert("X-Client-Verify", HeaderValue::from_static("SUCCESS"));

        let response = sync_handler(State(state), headers, Json(req))
            .await
            .expect("sync_handler with empty articles should succeed");

        assert!(response.synced.is_empty());
        // manifest GC: "nonexistent" not in DB, so nothing to prune
        assert!(response.pruned.is_empty());
    }

    #[tokio::test]
    async fn test_sync_handler_manifest_gc() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");
        let state = Arc::new(init_db(db_path).expect("init_db"));

        // 先写入 article-a
        let req1 = SyncRequest {
            api_version: "knowledge.your-domain.com/v1alpha1".into(),
            kind: "KnowledgeSyncPayload".into(),
            active_manifest: vec![],
            articles: vec![make_test_payload("article-a", "b".repeat(64).as_str())],
        };
        let mut headers = HeaderMap::new();
        headers.insert("X-Client-Verify", HeaderValue::from_static("SUCCESS"));
        let _ = sync_handler(State(state.clone()), headers, Json(req1))
            .await
            .expect("first sync");

        // 第二次 sync，manifest 只包含 article-a，但不包含 article-b
        // 由于 DB 中没有 article-b，GC 无操作
        let req2 = SyncRequest {
            api_version: "knowledge.your-domain.com/v1alpha1".into(),
            kind: "KnowledgeSyncPayload".into(),
            active_manifest: vec!["article-a".into()],
            articles: vec![],
        };
        let mut headers2 = HeaderMap::new();
        headers2.insert("X-Client-Verify", HeaderValue::from_static("SUCCESS"));
        let response = sync_handler(State(state), headers2, Json(req2))
            .await
            .expect("second sync");

        assert!(response.pruned.is_empty(), "no articles should be pruned");
    }
}