use anyhow::{Context, Result};
use rusqlite::Connection;

/// Manifest GC：删除不在 active_manifest 中的文章
///
/// 1. 空清单保护
/// 2. SELECT slug, id WHERE slug NOT IN (active_manifest)
/// 3. DELETE FROM articles WHERE id IN (orphans) — CASCADE 自动清理 chunks → 触发器清理 fts+vec
/// 4. FTS5 optimize
/// 5. PRAGMA optimize
/// 6. 返回被删除的 slug 列表
pub fn manifest_gc(conn: &Connection, active_manifest: &[String]) -> Result<Vec<String>> {
    // 空清单保护
    if active_manifest.is_empty() {
        tracing::warn!("Empty manifest, skipping GC");
        return Ok(vec![]);
    }

    // 构建 NOT IN 占位符
    let placeholders: Vec<String> = active_manifest
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();

    let sql = format!(
        "SELECT slug, id FROM articles WHERE slug NOT IN ({})",
        placeholders.join(", ")
    );

    // 收集孤儿
    let params: Vec<&dyn rusqlite::types::ToSql> =
        active_manifest.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();

    let orphans: Vec<(String, i64)> = conn
        .prepare(&sql)
        .context("failed to prepare orphan select")?
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .context("failed to query orphans")?
        .filter_map(|r| r.ok())
        .collect();

    if orphans.is_empty() {
        return Ok(vec![]);
    }

    // 删除孤儿文章（CASCADE 自动清理 chunks → 触发器清理 fts+vec）
    let orphan_ids: Vec<i64> = orphans.iter().map(|(_, id)| *id).collect();
    let delete_placeholders: Vec<String> = orphan_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();

    let delete_sql = format!(
        "DELETE FROM articles WHERE id IN ({})",
        delete_placeholders.join(", ")
    );

    let delete_params: Vec<&dyn rusqlite::types::ToSql> =
        orphan_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();

    conn.execute(&delete_sql, delete_params.as_slice())
        .context("failed to delete orphan articles")?;

    // FTS5 optimize
    conn.execute_batch(
        "INSERT INTO article_chunks_fts(article_chunks_fts) VALUES('optimize'); PRAGMA optimize;",
    )
    .context("failed to run post-gc optimize")?;

    let deleted_slugs: Vec<String> = orphans.into_iter().map(|(slug, _)| slug).collect();
    Ok(deleted_slugs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::storage::write::write_article_transaction;
    use crate::types::sync::{ArticleMetadata, ArticleSpec, ChunkData};

    fn insert_test_article(
        conn: &Connection,
        slug: &str,
        hash_suffix: char,
    ) -> Result<(i64, usize)> {
        let meta = ArticleMetadata {
            slug: slug.into(),
            title: format!("Article {}", slug),
            visibility: "public".into(),
            content_hash: hash_suffix.to_string().repeat(64),
            tags: vec![],
        };
        let spec = ArticleSpec {
            raw_content: format!("content {}", slug),
            excalidraw_data: None,
            chunks: vec![ChunkData {
                chunk_index: 0,
                heading_level: 2,
                heading_text: format!("Heading {}", slug),
                slug_anchor: slug.into(),
                content: format!("Body {}", slug),
                dense_embedding: vec![0.1f32; 384],
            }],
        };
        write_article_transaction(conn, &meta, &spec)
    }

    #[test]
    fn test_manifest_gc() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        insert_test_article(&conn, "article-a", 'a').expect("insert a");
        insert_test_article(&conn, "article-b", 'b').expect("insert b");

        // manifest 仅包含 a → b 应被删除
        let pruned = manifest_gc(
            &conn,
            &[String::from("article-a")],
        )
        .expect("gc");

        assert_eq!(pruned, vec!["article-b"]);

        let remaining: i64 = conn
            .query_row("SELECT count(*) FROM articles", [], |row| row.get(0))
            .expect("count");
        assert_eq!(remaining, 1);

        let remaining_slug: String = conn
            .query_row("SELECT slug FROM articles", [], |row| row.get(0))
            .expect("slug");
        assert_eq!(remaining_slug, "article-a");
    }

    #[test]
    fn test_empty_manifest_noop() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        insert_test_article(&conn, "article-a", 'a').expect("insert a");
        insert_test_article(&conn, "article-b", 'b').expect("insert b");

        // 空 manifest → 无删除
        let pruned: Vec<String> =
            manifest_gc(&conn, &[]).expect("gc with empty manifest");

        assert!(pruned.is_empty(), "empty manifest should prune nothing");

        let total: i64 = conn
            .query_row("SELECT count(*) FROM articles", [], |row| row.get(0))
            .expect("count");
        assert_eq!(total, 2, "all articles should remain");
    }
}