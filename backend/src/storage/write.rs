use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::storage::pool;
use crate::types::sync::{ArticleMetadata, ArticleSpec};

/// 单篇文章微事务写入
///
/// 1. BEGIN IMMEDIATE
/// 2. 幂等检查 content_hash
/// 3. INSERT OR REPLACE 文章 + 保留原 created_at
/// 4. DELETE 旧 chunks（触发器级联清理 fts+vec）
/// 5. 循环写入新 chunks + fts + vec
/// 6. 可选 excalidraw_data
/// 7. COMMIT
pub fn write_article_transaction(
    conn: &Connection,
    metadata: &ArticleMetadata,
    spec: &ArticleSpec,
) -> Result<(i64, usize)> {
    let vec_available = pool::is_vec_available(conn);

    conn.execute_batch("BEGIN IMMEDIATE")
        .context("failed to begin transaction")?;

    // 幂等检查
    let idempotent_result: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, content_hash FROM articles WHERE slug = ?",
            [&metadata.slug],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((existing_id, existing_hash)) = &idempotent_result {
        if *existing_hash == metadata.content_hash {
            conn.execute_batch("COMMIT")
                .context("failed to commit idempotent skip")?;
            return Ok((*existing_id, 0));
        }
    }

    // 序列化 tags 为 JSON 数组字符串（例如 ["Rust","系统编程"]）
    let tags_json = serde_json::to_string(&metadata.tags)
        .unwrap_or_else(|_| "[]".to_string());

    // INSERT OR REPLACE — 先尝试 UPDATE 以保留 id，未命中则 INSERT
    let updated = conn
        .execute(
            "UPDATE articles SET title=?2, visibility=?3, content_hash=?4, raw_content=?5, tags=?6, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
             WHERE slug=?1",
            rusqlite::params![metadata.slug, metadata.title, metadata.visibility, metadata.content_hash, spec.raw_content, tags_json],
        )
        .context("failed to update article")?;

    let article_id: i64 = if updated > 0 {
        // UPDATE 命中，取现有 id
        conn.query_row(
            "SELECT id FROM articles WHERE slug = ?",
            [&metadata.slug],
            |row| row.get(0),
        )
        .context("failed to select article id after update")?
    } else {
        // 无此 slug，INSERT
        conn.execute(
            "INSERT INTO articles (slug, title, visibility, content_hash, raw_content, tags, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, \
                     strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), \
                     strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
            rusqlite::params![metadata.slug, metadata.title, metadata.visibility, metadata.content_hash, spec.raw_content, tags_json],
        )
        .context("failed to insert article")?;
        conn.last_insert_rowid()
    };

    // 删除旧 chunks（触发器自动清理 fts+vec）
    conn.execute("DELETE FROM article_chunks WHERE article_id = ?", [article_id])
        .context("failed to delete old chunks")?;

    // 循环写入新 chunks
    for chunk in &spec.chunks {
        chunk
            .validate_embedding()
            .map_err(|e| anyhow::anyhow!("chunk {} embedding validation failed: {}", chunk.chunk_index, e))?;

        conn.execute(
            "INSERT INTO article_chunks (article_id, chunk_index, heading_level, heading_text, slug_anchor, chunk_content) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                article_id,
                chunk.chunk_index,
                chunk.heading_level,
                chunk.heading_text,
                chunk.slug_anchor,
                chunk.content,
            ],
        )
        .context(format!("failed to insert chunk {}", chunk.chunk_index))?;

        let chunk_id: i64 = conn.last_insert_rowid();

        // 写入向量（仅 vec 扩展可用时）
        if vec_available {
            let embedding_bytes = chunk
                .dense_embedding
                .as_slice()
                .as_bytes();

            conn.execute(
                "INSERT INTO article_chunks_vec (chunk_id, dense_embedding) VALUES (?1, vec_f32(?2))",
                rusqlite::params![chunk_id, embedding_bytes],
            )
            .context(format!("failed to insert vec for chunk {}", chunk.chunk_index))?;
        }
    }

    // 可选 excalidraw_data
    if let Some(excalidraw) = &spec.excalidraw_data {
        let json_str = serde_json::to_string(excalidraw)
            .context("failed to serialize excalidraw_data")?;
        conn.execute(
            "INSERT OR REPLACE INTO article_canvas (article_id, excalidraw_json) VALUES (?1, ?2)",
            rusqlite::params![article_id, json_str],
        )
        .context("failed to insert excalidraw_data")?;
    }

    conn.execute_batch("COMMIT")
        .context("failed to commit transaction")?;

    Ok((article_id, spec.chunks.len()))
}

/// 将 f32 切片转换为 little-endian 字节切片（供 vec_f32 绑定）
trait AsBytes {
    fn as_bytes(&self) -> &[u8];
}

impl AsBytes for [f32] {
    fn as_bytes(&self) -> &[u8] {
        let byte_len = self.len() * 4;
        unsafe { std::slice::from_raw_parts(self.as_ptr() as *const u8, byte_len) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;
    use crate::types::sync::{ArticleSpec, ChunkData};

    fn make_test_chunk(index: i32, heading_level: i32, text: &str) -> ChunkData {
        ChunkData {
            chunk_index: index,
            heading_level,
            heading_text: text.into(),
            slug_anchor: text.to_lowercase().replace(' ', "-"),
            content: format!("Content for {}", text),
            dense_embedding: vec![0.1f32; 384],
        }
    }

    fn make_test_metadata(slug: &str, hash: &str) -> ArticleMetadata {
        ArticleMetadata {
            slug: slug.into(),
            title: format!("Article {}", slug),
            visibility: "public".into(),
            content_hash: hash.into(),
            tags: vec![],
        }
    }

    #[test]
    fn test_write_article() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");

        let meta = make_test_metadata("test-article", "a".repeat(64).as_str());
        let spec = ArticleSpec {
            raw_content: "# Test\n\nHello world".into(),
            excalidraw_data: None,
            chunks: vec![
                make_test_chunk(0, 2, "Introduction"),
                make_test_chunk(1, 3, "Details"),
            ],
        };

        let (article_id, count) =
            write_article_transaction(&state.write_conn.blocking_lock(), &meta, &spec)
                .expect("write article");

        assert!(article_id > 0);
        assert_eq!(count, 2);

        // 验证 articles 表
        let article_count: i64 = state
            .write_conn
            .blocking_lock()
            .query_row("SELECT count(*) FROM articles", [], |row| row.get(0))
            .expect("count articles");
        assert_eq!(article_count, 1);

        // 验证 chunks 表
        let chunk_count: i64 = state
            .write_conn
            .blocking_lock()
            .query_row(
                "SELECT count(*) FROM article_chunks WHERE article_id = ?",
                [article_id],
                |row| row.get(0),
            )
            .expect("count chunks");
        assert_eq!(chunk_count, 2);

        // 验证 FTS 可查
        let fts_count: i64 = state
            .write_conn
            .blocking_lock()
            .query_row(
                "SELECT count(*) FROM article_chunks_fts",
                [],
                |row| row.get(0),
            )
            .expect("count fts entries");
        assert_eq!(fts_count, 2);
    }

    #[test]
    fn test_idempotent_skip() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        let hash = "b".repeat(64);
        let meta = make_test_metadata("dup-article", &hash);
        let spec = ArticleSpec {
            raw_content: "content".into(),
            excalidraw_data: None,
            chunks: vec![make_test_chunk(0, 2, "Intro")],
        };

        // 第一次写入
        let (id, count) = write_article_transaction(&conn, &meta, &spec).expect("first write");
        assert!(id > 0);
        assert_eq!(count, 1);

        // 第二次写入（相同 hash）
        let (id2, count2) = write_article_transaction(&conn, &meta, &spec).expect("second write");
        assert_eq!(id2, id);
        assert_eq!(count2, 0, "idempotent skip should return chunk_count=0");
    }

    #[test]
    fn test_write_article_replaces_on_hash_change() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        let meta1 = make_test_metadata("replace-me", "c".repeat(64).as_str());
        let spec1 = ArticleSpec {
            raw_content: "v1".into(),
            excalidraw_data: None,
            chunks: vec![make_test_chunk(0, 2, "V1")],
        };
        let (id1, _) = write_article_transaction(&conn, &meta1, &spec1).expect("first write");

        let meta2 = ArticleMetadata {
            content_hash: "d".repeat(64),
            ..meta1
        };
        let spec2 = ArticleSpec {
            raw_content: "v2".into(),
            excalidraw_data: None,
            chunks: vec![make_test_chunk(0, 2, "V2"), make_test_chunk(1, 3, "V2b")],
        };
        let (id2, count2) = write_article_transaction(&conn, &meta2, &spec2).expect("second write");

        assert_eq!(id1, id2, "same slug should keep same id");
        assert_eq!(count2, 2, "replaced article should have new chunks");

        let title: String = conn
            .query_row("SELECT title FROM articles WHERE id = ?1", [id2], |row| {
                row.get(0)
            })
            .expect("query title");
        assert_eq!(title, meta2.title);
    }
}