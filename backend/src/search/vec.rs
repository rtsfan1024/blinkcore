use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::types::search::SearchHit;

/// sqlite-vec 稠密向量搜索
///
/// SQL:
///   SELECT ac.id, a.slug, a.title, ac.heading_text, ac.slug_anchor,
///          '' AS snippet,
///          a.visibility,
///          v.distance AS score
///   FROM article_chunks_vec v
///   JOIN article_chunks ac ON v.chunk_id = ac.id
///   JOIN articles a ON ac.article_id = a.id
///   WHERE a.visibility = 'public'
///     AND v.dense_embedding MATCH vec_f32(?)
///   ORDER BY v.distance
///   LIMIT ?
///
/// bind: query_vector 以 little-endian f32 字节切片传入 vec_f32(?)
pub fn query_vec(
    conn: &Connection,
    query_vector: &[f32; 384],
    limit: i32,
) -> Result<Vec<SearchHit>> {
    // 【有限性校验断言】拦截 NaN 与 Inf
    for (i, &v) in query_vector.iter().enumerate() {
        if v.is_nan() {
            anyhow::bail!("query_vector contains NaN at index {}", i);
        }
        if v.is_infinite() {
            anyhow::bail!("query_vector contains Inf at index {}", i);
        }
    }

    let sql = "\
        SELECT ac.id, a.slug, a.title, ac.heading_text, ac.slug_anchor, \
               '' AS snippet, \
               a.visibility, \
               v.distance AS score \
        FROM article_chunks_vec v \
        JOIN article_chunks ac ON v.chunk_id = ac.id \
        JOIN articles a ON ac.article_id = a.id \
        WHERE a.visibility = 'public' \
          AND v.dense_embedding MATCH vec_f32(?) \
        ORDER BY v.distance \
        LIMIT ?";

    let mut stmt = conn
        .prepare(sql)
        .context("failed to prepare vec0 query")?;

    // f32 切片 → little-endian 字节切片
    let embedding_bytes = query_vector.as_slice().as_bytes();

    let hits = stmt
        .query_map(rusqlite::params![embedding_bytes, limit], |row| {
            let score: f64 = row.get(7)?;
            Ok(SearchHit {
                id: row.get(0)?,
                slug: row.get(1)?,
                title: row.get(2)?,
                heading_text: row.get(3)?,
                slug_anchor: row.get(4)?,
                snippet: row.get::<_, String>(5).unwrap_or_default(),
                visibility: row.get(6)?,
                rrf_score: score,
            })
        })
        .context("failed to execute vec0 query")?
        .filter_map(|r| r.ok())
        .collect();

    Ok(hits)
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
    use crate::storage::pool::{init_db, is_vec_available};
    use crate::storage::write::write_article_transaction;
    use crate::types::sync::{ArticleMetadata, ArticleSpec, ChunkData};

    #[test]
    fn test_query_vec() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        // 仅在 vec 扩展可用时执行向量搜索测试
        if !is_vec_available(&conn) {
            eprintln!("SKIP: sqlite-vec extension not available");
            return;
        }

        let meta = ArticleMetadata {
            slug: "vec-test".into(),
            title: "Vector Test".into(),
            visibility: "public".into(),
            content_hash: "v".repeat(64),
            tags: vec![],
        };

        // 写入一个向量
        let embedding = vec![0.1f32; 384];
        let spec = ArticleSpec {
            raw_content: "vector content".into(),
            excalidraw_data: None,
            chunks: vec![ChunkData {
                chunk_index: 0,
                heading_level: 2,
                heading_text: "Vector Heading".into(),
                slug_anchor: "vector-heading".into(),
                content: "vector body".into(),
                dense_embedding: embedding.clone(),
            }],
        };
        write_article_transaction(&conn, &meta, &spec).expect("write article");

        // 用相似向量搜索
        let query: [f32; 384] = std::array::from_fn(|i| 0.1 + (i as f32 * 0.0001));
        let results = query_vec(&conn, &query, 20).expect("query_vec");

        assert!(!results.is_empty(), "should find results");
        assert!(
            results.len() <= 20,
            "should return at most 20 results"
        );

        // distance 应有序递增
        for i in 1..results.len() {
            assert!(
                results[i - 1].rrf_score <= results[i].rrf_score,
                "distance should be ordered"
            );
        }
    }

    #[test]
    fn test_query_vec_nan_rejected() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db");
        let conn = state.write_conn.blocking_lock();

        let mut bad_vec = [0.1f32; 384];
        bad_vec[10] = f32::NAN;

        let result = query_vec(&conn, &bad_vec, 20);
        assert!(result.is_err(), "NaN should be rejected");
        assert!(
            result.err().unwrap().to_string().contains("NaN"),
            "error should mention NaN"
        );
    }
}