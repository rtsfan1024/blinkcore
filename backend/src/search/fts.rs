use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::types::search::SearchHit;

/// 清理 FTS5 查询文本，移除或转义特殊操作符
///
/// FTS5 特殊操作符: AND, OR, NOT, NEAR, (, ), ", *, ^
/// 策略：将整个输入包裹在双引号中作为精确短语搜索，
/// 并转义内部的引号，避免语法错误。
pub fn sanitize_fts_query(input: &str) -> String {
    if input.is_empty() {
        return String::new();
    }

    // 移除 FTS5 操作符字符，保留字母、数字、空格、连字符和下划线
    let sanitized: String = input
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    if sanitized.is_empty() {
        return String::new();
    }

    // 用双引号包裹以禁用 FTS5 操作符解析
    format!("\"{}\"", sanitized)
}

/// FTS5 bm25 稀疏搜索 + 标题回退
///
/// SQL:
///   SELECT ac.id, a.slug, a.title, ac.heading_text, ac.slug_anchor,
///          snippet(article_chunks_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
///          a.visibility,
///          bm25(article_chunks_fts) AS score
///   FROM article_chunks_fts fts
///   JOIN article_chunks ac ON fts.rowid = ac.id
///   JOIN articles a ON ac.article_id = a.id
///   WHERE a.visibility = 'public'
///     AND article_chunks_fts MATCH ?
///   ORDER BY bm25(article_chunks_fts)
///   LIMIT ?
///
/// 当 FTS5 无结果时，回退到基于标题的 LIKE 模糊匹配，
/// 使文章标题（包括中文标题）可被搜索到。
pub fn query_fts(
    conn: &Connection,
    query_text: &str,
    limit: i32,
) -> Result<Vec<SearchHit>> {
    let sanitized = sanitize_fts_query(query_text);

    let mut hits: Vec<SearchHit> = Vec::new();

    // 尝试 FTS5 搜索（仅当 sanitized 非空时，如英文、数字等）
    if !sanitized.is_empty() {
        let sql = "\
            SELECT ac.id, a.slug, a.title, ac.heading_text, ac.slug_anchor, \
                   snippet(article_chunks_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet, \
                   a.visibility, \
                   bm25(article_chunks_fts) AS score \
            FROM article_chunks_fts fts \
            JOIN article_chunks ac ON fts.rowid = ac.id \
            JOIN articles a ON ac.article_id = a.id \
            WHERE a.visibility = 'public' \
              AND article_chunks_fts MATCH ? \
            ORDER BY bm25(article_chunks_fts) \
            LIMIT ?";

        let mut stmt = conn
            .prepare(sql)
            .context("failed to prepare FTS5 query")?;

        hits = stmt
            .query_map(rusqlite::params![sanitized, limit], |row| {
                let score: f64 = row.get(7)?;
                Ok(SearchHit {
                    id: row.get(0)?,
                    slug: row.get(1)?,
                    title: row.get(2)?,
                    heading_text: row.get(3)?,
                    slug_anchor: row.get(4)?,
                    snippet: row.get(5)?,
                    visibility: row.get(6)?,
                    rrf_score: -score, // bm25 越小越好，取负值转为正分用于 RRF
                })
            })
            .context("failed to execute FTS5 query")?
            .filter_map(|r| r.ok())
            .collect();
    }

    // Stage 2: title + raw_content LIKE 模糊匹配（FTS5 无结果时的兜底）
    // FTS5 unicode61 分词器不拆分连续中文字符，所以"翻车"无法被分词命中，
    // 必须通过 LIKE 进行子串匹配。此处同时提取上下文片段作为 snippet。
    if hits.is_empty() {
        let fallback_sql = "\
            SELECT id, slug, title, '' AS heading_text, '' AS slug_anchor, \
                   CASE \
                     WHEN instr(raw_content, ?1) > 0 THEN \
                       substr(raw_content, max(1, instr(raw_content, ?1) - 20), 80) \
                     ELSE '' \
                   END AS snippet, \
                   visibility, 0.0 AS score \
            FROM articles \
            WHERE visibility = 'public' \
              AND (title LIKE ?2 OR raw_content LIKE ?3) \
            LIMIT ?4";

        let pattern = format!("%{}%", query_text);
        if let Ok(mut stmt) = conn.prepare(fallback_sql) {
            hits = stmt
                .query_map(
                    rusqlite::params![query_text, pattern, pattern, limit],
                    |row| {
                        let visibility: String = row.get(6)?;
                        Ok(SearchHit {
                            id: 0,
                            slug: row.get(1)?,
                            title: row.get(2)?,
                            heading_text: String::new(),
                            slug_anchor: String::new(),
                            snippet: row.get(5)?,
                            visibility,
                            rrf_score: 0.5,
                        })
                    },
                )
                .context("failed to execute fallback LIKE query")?
                .filter_map(|r| r.ok())
                .collect();
        }
    }

    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::storage::write::write_article_transaction;
    use crate::types::sync::{ArticleMetadata, ArticleSpec, ChunkData};

    fn insert_test_article(conn: &Connection, slug: &str, content: &str, heading: &str) {
        let meta = ArticleMetadata {
            slug: slug.into(),
            title: format!("Article {}", slug),
            visibility: "public".into(),
            content_hash: "t".repeat(64),
            tags: vec![],
        };
        let spec = ArticleSpec {
            raw_content: content.into(),
            excalidraw_data: None,
            chunks: vec![ChunkData {
                chunk_index: 0,
                heading_level: 2,
                heading_text: heading.into(),
                slug_anchor: slug.into(),
                content: content.into(),
                dense_embedding: vec![0.1f32; 384],
            }],
        };
        write_article_transaction(conn, &meta, &spec).expect("write article");
    }

    #[test]
    fn test_sanitize_fts_query() {
        assert_eq!(sanitize_fts_query("hello"), "\"hello\"");
        assert_eq!(sanitize_fts_query(""), "");
        assert_eq!(sanitize_fts_query("OR AND NOT"), "\"OR AND NOT\"");
        assert_eq!(
            sanitize_fts_query("kubernetes"),
            "\"kubernetes\""
        );
    }

    #[test]
    fn test_query_fts() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        insert_test_article(
            &conn,
            "k8s-deploy",
            "Kubernetes deployment strategies including rolling update and blue-green deployment",
            "Deployment Strategies",
        );

        // 查询
        let results = query_fts(&conn, "kubernetes", 20).expect("query_fts");
        assert!(!results.is_empty(), "should find kubernetes article");

        let hit = &results[0];
        assert_eq!(hit.slug, "k8s-deploy");
        assert!(hit.rrf_score > 0.0, "score should be positive");
    }

    #[test]
    fn test_query_fts_empty_sanitized_returns_empty() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        let results = query_fts(&conn, "!!!", 20).expect("query_fts with special chars");
        assert!(results.is_empty(), "fully sanitized input should return empty");
    }
}