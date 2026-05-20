use anyhow::{Context, Result};
use rusqlite::Connection;

use super::pool;

/// 必需表列表（供健康检查使用）
#[allow(dead_code)]
const REQUIRED_TABLES: &[&str] = &[
    "articles",
    "article_canvas",
    "article_chunks",
    "article_chunks_fts",
    "pending_leads",
];

/// vec0 表（供健康检查使用）
#[allow(dead_code)]
const VEC_REQUIRED_TABLES: &[&str] = &["article_chunks_vec"];

/// 启动自检：验证数据库完整性、表结构、vec 扩展状态
#[allow(dead_code)]
pub fn health_check(conn: &Connection) -> Result<()> {
    // 1. integrity_check
    let integrity: String = conn
        .pragma_query_value(None, "integrity_check", |row| row.get(0))
        .context("failed to run PRAGMA integrity_check")?;
    if integrity != "ok" {
        anyhow::bail!("integrity_check failed: {}", integrity);
    }

    // 2. 检查必需表存在
    let mut all_tables = REQUIRED_TABLES.to_vec();
    // vec0 表仅在扩展可用时纳入检查
    if pool::is_vec_available(conn) {
        all_tables.extend_from_slice(VEC_REQUIRED_TABLES);
    }

    for table in all_tables {
        let count: i32 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .context(format!("failed to check table existence: {}", table))?;
        if count == 0 {
            anyhow::bail!("required table '{}' not found", table);
        }
    }

    // 3. 若 vec 表存在但扩展不可用，发出警告
    let vec_table_count: i32 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='article_chunks_vec'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if vec_table_count > 0 && !pool::is_vec_available(conn) {
        tracing::warn!("article_chunks_vec table exists but sqlite-vec extension is not loaded");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::pool::init_db;

    #[test]
    fn test_health_check_ok() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db should succeed");
        let conn = state.write_conn.blocking_lock();

        let result = health_check(&conn);
        assert!(result.is_ok(), "health_check should succeed: {:?}", result.err());
    }
}