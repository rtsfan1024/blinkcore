use anyhow::Result;
use rusqlite::Connection;

use crate::search::fts::query_fts;
use crate::search::rewrite::rewrite_jump_url;
use crate::search::rrf::reciprocal_rank_fusion;
use crate::search::vec::query_vec;
use crate::storage::pool::{is_vec_available, AppState};
use crate::types::search::{SearchMode, SearchResponse, SearchResultItem};

/// 搜索处理器核心逻辑（异步，从 read_pool 取连接）
///
/// 若 query_vector 存在: 并行 FTS5 + vec0 → RRF 融合 → Top-5 (Hybrid)
/// 若 query_vector 不存在: 仅 FTS5 → Top-5 (FtsOnly)
pub async fn search(
    state: &AppState,
    query_text: &str,
    query_vector: Option<&[f32; 384]>,
    client_verify: &str,
) -> Result<SearchResponse> {
    if let Some(vec) = query_vector {
        // 有限性校验
        for (i, &v) in vec.iter().enumerate() {
            if v.is_nan() {
                anyhow::bail!("query_vector contains NaN at index {}", i);
            }
            if v.is_infinite() {
                anyhow::bail!("query_vector contains Inf at index {}", i);
            }
        }

        let qtext = query_text.to_string();
        let qvec = *vec;
        let cverify = client_verify.to_string();

        let (conn1, conn2) = take_two_read_conns(state)?;

        let fts_handle = tokio::task::spawn_blocking(move || query_fts(&conn1, &qtext, 20));
        let vec_handle =
            tokio::task::spawn_blocking(move || query_vec_if_available(&conn2, &qvec, 20));

        let (fts_res, vec_res) = tokio::join!(fts_handle, vec_handle);

        let fts_hits = fts_res
            .map_err(|e| anyhow::anyhow!("FTS spawn_blocking join: {}", e))?
            .unwrap_or_default();
        let vec_hits = vec_res
            .map_err(|e| anyhow::anyhow!("vec spawn_blocking join: {}", e))?
            .unwrap_or_default();

        let fused = reciprocal_rank_fusion(fts_hits, vec_hits, 60);

        let results = fused
            .into_iter()
            .map(|hit| {
                let jump_url =
                    rewrite_jump_url(&hit.slug, &hit.slug_anchor, &hit.visibility, &cverify);
                SearchResultItem {
                    slug: hit.slug,
                    title: hit.title,
                    heading_text: hit.heading_text,
                    slug_anchor: hit.slug_anchor,
                    snippet: hit.snippet,
                    jump_url,
                    rrf_score: hit.rrf_score,
                }
            })
            .collect();

        Ok(SearchResponse {
            mode: SearchMode::Hybrid,
            results,
        })
    } else {
        let qtext = query_text.to_string();
        let cverify = client_verify.to_string();
        let conn = take_read_conn(state)?;

        let fts_handle = tokio::task::spawn_blocking(move || query_fts(&conn, &qtext, 5));

        let fts_res = fts_handle.await;
        let fts_hits = fts_res
            .map_err(|e| anyhow::anyhow!("FTS spawn_blocking join: {}", e))?
            .unwrap_or_default();

        let results = fts_hits
            .into_iter()
            .map(|hit| {
                let jump_url =
                    rewrite_jump_url(&hit.slug, &hit.slug_anchor, &hit.visibility, &cverify);
                SearchResultItem {
                    slug: hit.slug,
                    title: hit.title,
                    heading_text: hit.heading_text,
                    slug_anchor: hit.slug_anchor,
                    snippet: hit.snippet,
                    jump_url,
                    rrf_score: hit.rrf_score,
                }
            })
            .collect();

        Ok(SearchResponse {
            mode: SearchMode::FtsOnly,
            results,
        })
    }
}

/// 同步搜索（供测试使用，绕开 spawn_blocking + async 复杂性）
#[allow(dead_code)]
pub fn search_sync(
    conn_fts: &Connection,
    conn_vec: Option<&Connection>,
    query_text: &str,
    query_vector: Option<&[f32; 384]>,
    client_verify: &str,
) -> Result<SearchResponse> {
    if let Some(vec) = query_vector {
        for (i, &v) in vec.iter().enumerate() {
            if v.is_nan() {
                anyhow::bail!("query_vector contains NaN at index {}", i);
            }
            if v.is_infinite() {
                anyhow::bail!("query_vector contains Inf at index {}", i);
            }
        }

        let fts_hits = query_fts(conn_fts, query_text, 20)?;
        let vec_hits = if let Some(cv) = conn_vec {
            query_vec_if_available(cv, query_vector.unwrap(), 20)?
        } else {
            vec![]
        };

        let fused = reciprocal_rank_fusion(fts_hits, vec_hits, 60);

        let results = fused
            .into_iter()
            .map(|hit| {
                let jump_url =
                    rewrite_jump_url(&hit.slug, &hit.slug_anchor, &hit.visibility, client_verify);
                SearchResultItem {
                    slug: hit.slug,
                    title: hit.title,
                    heading_text: hit.heading_text,
                    slug_anchor: hit.slug_anchor,
                    snippet: hit.snippet,
                    jump_url,
                    rrf_score: hit.rrf_score,
                }
            })
            .collect();

        Ok(SearchResponse {
            mode: SearchMode::Hybrid,
            results,
        })
    } else {
        let fts_hits = query_fts(conn_fts, query_text, 5)?;

        let results = fts_hits
            .into_iter()
            .map(|hit| {
                let jump_url =
                    rewrite_jump_url(&hit.slug, &hit.slug_anchor, &hit.visibility, client_verify);
                SearchResultItem {
                    slug: hit.slug,
                    title: hit.title,
                    heading_text: hit.heading_text,
                    slug_anchor: hit.slug_anchor,
                    snippet: hit.snippet,
                    jump_url,
                    rrf_score: hit.rrf_score,
                }
            })
            .collect();

        Ok(SearchResponse {
            mode: SearchMode::FtsOnly,
            results,
        })
    }
}

/// 取一个只读连接（通过文件路径重新打开）
fn take_read_conn(_state: &AppState) -> Result<Connection> {
    let db_path = std::env::var("BLINKCORE_DB_PATH").unwrap_or_else(|_| "blog.db".to_string());
    let conn = Connection::open(&db_path)
        .map_err(|e| anyhow::anyhow!("failed to open read connection: {}", e))?;
    let _ = crate::storage::pool::apply_pragmas(&conn);
    Ok(conn)
}

/// 取两个只读连接
fn take_two_read_conns(_state: &AppState) -> Result<(Connection, Connection)> {
    let db_path = std::env::var("BLINKCORE_DB_PATH").unwrap_or_else(|_| "blog.db".to_string());
    let conn1 = Connection::open(&db_path)
        .map_err(|e| anyhow::anyhow!("failed to open read connection 1: {}", e))?;
    let conn2 = Connection::open(&db_path)
        .map_err(|e| anyhow::anyhow!("failed to open read connection 2: {}", e))?;
    let _ = crate::storage::pool::apply_pragmas(&conn1);
    let _ = crate::storage::pool::apply_pragmas(&conn2);
    Ok((conn1, conn2))
}

/// 仅在 vec 扩展可用时执行向量搜索
fn query_vec_if_available(
    conn: &Connection,
    query_vector: &[f32; 384],
    limit: i32,
) -> Result<Vec<crate::types::search::SearchHit>> {
    if !is_vec_available(conn) {
        return Ok(vec![]);
    }
    query_vec(conn, query_vector, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::storage::write::write_article_transaction;
    use crate::types::sync::{ArticleMetadata, ArticleSpec, ChunkData};

    fn insert_article(conn: &Connection, slug: &str, content: &str, heading: &str) {
        let meta = ArticleMetadata {
            slug: slug.into(),
            title: format!("Article {}", slug),
            visibility: "public".into(),
            content_hash: format!("{:0>64}", slug.chars().next().unwrap_or('x') as u8),
            tags: vec![],
        };
        let spec = ArticleSpec {
            raw_content: content.into(),
            excalidraw_data: None,
            chunks: vec![ChunkData {
                chunk_index: 0,
                heading_level: 2,
                heading_text: heading.into(),
                slug_anchor: heading.to_lowercase().replace(' ', "-"),
                content: content.into(),
                dense_embedding: vec![0.1f32; 384],
            }],
        };
        write_article_transaction(conn, &meta, &spec).expect("write article");
    }

    #[test]
    fn test_search_fts_only() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        insert_article(&conn, "rust-intro", "Rust programming language introduction", "Rust Intro");
        insert_article(&conn, "go-guide", "Go language quick start guide", "Go Guide");

        let response = search_sync(&conn, None, "rust", None, "").expect("search");
        assert_eq!(response.mode, SearchMode::FtsOnly);
        assert!(!response.results.is_empty(), "should find results");

        for item in &response.results {
            assert!(
                item.jump_url.starts_with("/articles/"),
                "public article jump_url should start with /articles/"
            );
        }
    }

    #[test]
    fn test_search_hybrid_mode_detection() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        insert_article(&conn, "test-article", "some content here", "Test");

        let response_no_vec = search_sync(&conn, None, "content", None, "").expect("search no vec");
        assert!(
            matches!(response_no_vec.mode, SearchMode::FtsOnly),
            "no query_vector should produce FtsOnly"
        );

        let dummy_vec = [0.1f32; 384];
        let response_with_vec =
            search_sync(&conn, None, "content", Some(&dummy_vec), "").expect("search with vec");
        assert!(
            matches!(response_with_vec.mode, SearchMode::Hybrid),
            "query_vector present should produce Hybrid"
        );
    }
}