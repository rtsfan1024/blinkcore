use axum::{
    http::Method,
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};

use crate::api::admin::{sync_handler, SharedState};
use crate::api::public_articles::article_detail_handler;
use crate::api::public_articles::article_list_handler;
use crate::api::public_leads::leads_handler;
use crate::api::public_search::search_handler;
use crate::storage::pool::AppState;

async fn health() -> &'static str {
    "ok"
}

/// 构建完整 Axum Router，包含所有路由：
/// - GET  /health
/// - POST /api/v1/admin/sync      (mTLS 在 handler 内部校验)
/// - POST /api/v1/public/search
/// - POST /api/v1/public/leads
/// - GET  /api/v1/public/articles
pub fn build_app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    let shared_state: SharedState = std::sync::Arc::new(state);

    Router::new()
        .route("/health", get(health))
        .route("/api/v1/admin/sync", post(sync_handler))
        .route("/api/v1/public/search", post(search_handler))
        .route("/api/v1/public/leads", post(leads_handler))
        .route("/api/v1/public/articles", get(article_list_handler))
        .route(
            "/api/v1/public/articles/:slug",
            get(article_detail_handler),
        )
        .layer(cors)
        .with_state(shared_state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };

    #[tokio::test]
    async fn test_router_build() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");
        let state = init_db(db_path).expect("init_db");
        let _app = build_app(state);
        // Router 构建不 panic 即通过
    }

    #[tokio::test]
    async fn test_router_routes_exist() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");
        let state = init_db(db_path).expect("init_db");
        let app = build_app(state);

        use tower::ServiceExt;

        // GET /health → 200
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("health request");
        assert_eq!(response.status(), StatusCode::OK);

        // POST /api/v1/public/search → 400 (empty query_text)
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/public/search")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"query_text":""}"#))
                    .unwrap(),
            )
            .await
            .expect("search request");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        // POST /api/v1/public/leads → 400 (empty target_slug)
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/public/leads")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"target_slug":"","trigger_keyword":"contact","contact_method":"email","contact_value":"test@example.com"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .expect("leads request");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        // GET /api/v1/public/articles → 200
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/v1/public/articles")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("articles request");
        assert_eq!(response.status(), StatusCode::OK);

        // POST /api/v1/admin/sync → 403 (no mTLS)
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/admin/sync")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"apiVersion":"x","kind":"y","active_manifest":[],"articles":[]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .expect("admin sync request");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}