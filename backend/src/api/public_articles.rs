use axum::{
    extract::{Path, Query, State},
    Json,
};
use std::sync::Arc;

use crate::api::admin::AppError;
use crate::storage::pool::AppState;
use crate::types::search::{
    ArticleContentResponse, ArticleListParams, ArticleListResponse, ArticleSummary,
};

pub type SharedState = Arc<AppState>;

/// R4: GET /api/v1/public/articles
///
/// 返回公开文章列表，支持分页。SQL 硬锁 WHERE visibility = 'public'。
pub async fn article_list_handler(
    State(state): State<SharedState>,
    Query(params): Query<ArticleListParams>,
) -> Result<Json<ArticleListResponse>, AppError> {
    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(20).max(1);
    let offset = ((page - 1) * per_page) as i64;

    let write_conn = state.write_conn.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = write_conn.blocking_lock();

        // 查询公开文章
        let mut stmt = conn
            .prepare(
                "SELECT slug, title, created_at, tags FROM articles WHERE visibility = 'public' ORDER BY created_at DESC LIMIT ? OFFSET ?",
            )
            .map_err(|e| format!("prepare select failed: {}", e))?;

        let articles: Vec<ArticleSummary> = stmt
            .query_map(rusqlite::params![per_page, offset], |row| {
                let tags_str: String = row.get(3)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(ArticleSummary {
                    slug: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    tags,
                })
            })
            .map_err(|e| format!("query_map failed: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("collect failed: {}", e))?;

        // 查询总数
        let total: i64 = conn
            .query_row(
                "SELECT count(*) FROM articles WHERE visibility = 'public'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("count query failed: {}", e))?;

        Ok::<_, String>((articles, total))
    })
    .await
    .map_err(|e| AppError::Internal(format!("spawn_blocking join: {}", e)))?
    .map_err(|e| AppError::Internal(e))?;

    let (articles, total) = result;

    Ok(Json(ArticleListResponse {
        articles,
        total,
        page,
        per_page,
    }))
}

/// R5: GET /api/v1/public/articles/:slug
///
/// 返回单篇公开文章的完整内容。如果文章不存在或为 private 则 404。
pub async fn article_detail_handler(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
) -> Result<Json<ArticleContentResponse>, AppError> {
    let write_conn = state.write_conn.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = write_conn.blocking_lock();
        conn.query_row(
            "SELECT slug, title, created_at, raw_content, tags FROM articles WHERE slug = ? AND visibility = 'public'",
            rusqlite::params![slug],
            |row| {
                let tags_str: String = row.get(4)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(ArticleContentResponse {
                    slug: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    raw_content: row.get(3)?,
                    tags,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::BadRequest(format!("article not found: {}", slug))
            }
            other => AppError::Internal(format!("query failed: {}", other)),
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("spawn_blocking join: {}", e)))?
    .map_err(|e| e)?;

    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::storage::write::write_article_transaction;
    use crate::types::sync::{ArticleMetadata, ArticleSpec, ChunkData};
    use axum::extract::{Query, State};

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

    fn insert_article(
        conn: &rusqlite::Connection,
        slug: &str,
        title: &str,
        visibility: &str,
    ) {
        let meta = ArticleMetadata {
            slug: slug.into(),
            title: title.into(),
            visibility: visibility.into(),
            content_hash: format!("{:0>64}", slug.len()),
            tags: vec![],
        };
        let spec = ArticleSpec {
            raw_content: format!("# {}\n\nContent", title),
            excalidraw_data: None,
            chunks: vec![ChunkData {
                chunk_index: 0,
                heading_level: 2,
                heading_text: "Intro".into(),
                slug_anchor: "intro".into(),
                content: format!("Content for {}", slug),
                dense_embedding: vec![0.1f32; 384],
            }],
        };
        write_article_transaction(conn, &meta, &spec).expect("write article");
    }

    #[tokio::test]
    async fn test_article_list_public_only() {
        let tc = setup_test_db();
        let conn = tc.state.write_conn.lock().await;

        // 插入一篇公开文章
        insert_article(&*conn, "rust-intro", "Rust Introduction", "public");
        // 插入一篇私密文章
        insert_article(&*conn, "secret-note", "Secret Note", "private");
        drop(conn);

        let params = ArticleListParams {
            page: None,
            per_page: None,
        };

        let response = article_list_handler(State(tc.state), Query(params))
            .await
            .expect("article_list_handler should succeed");

        assert_eq!(response.total, 1, "should only return public articles");
        assert_eq!(response.articles.len(), 1);
        assert_eq!(response.articles[0].slug, "rust-intro");
        assert_eq!(response.articles[0].title, "Rust Introduction");
    }

    #[tokio::test]
    async fn test_article_list_pagination() {
        let tc = setup_test_db();
        let conn = tc.state.write_conn.lock().await;

        // 插入 3 篇公开文章
        insert_article(&*conn, "article-a", "Article A", "public");
        insert_article(&*conn, "article-b", "Article B", "public");
        insert_article(&*conn, "article-c", "Article C", "public");
        drop(conn);

        // 每页 2 条，第 1 页
        let params = ArticleListParams {
            page: Some(1),
            per_page: Some(2),
        };
        let response = article_list_handler(State(tc.state.clone()), Query(params))
            .await
            .expect("article_list_handler should succeed");

        assert_eq!(response.total, 3);
        assert_eq!(response.articles.len(), 2);
        assert_eq!(response.page, 1);
        assert_eq!(response.per_page, 2);

        // 第 2 页
        let params = ArticleListParams {
            page: Some(2),
            per_page: Some(2),
        };
        let response = article_list_handler(State(tc.state), Query(params))
            .await
            .expect("article_list_handler should succeed");

        assert_eq!(response.articles.len(), 1);
        assert_eq!(response.page, 2);
    }

    #[tokio::test]
    async fn test_article_list_empty() {
        let tc = setup_test_db();

        let params = ArticleListParams {
            page: None,
            per_page: None,
        };

        let response = article_list_handler(State(tc.state), Query(params))
            .await
            .expect("article_list_handler should succeed");

        assert_eq!(response.total, 0);
        assert!(response.articles.is_empty());
    }
}