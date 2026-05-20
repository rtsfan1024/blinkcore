use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use rusqlite::Connection;
use tokio::sync::Mutex;

/// PRAGMA 注入序列 — 每次新建连接时执行
const PRAGMA_INIT_SEQUENCE: &[&str] = &[
    "PRAGMA journal_mode = WAL;",
    "PRAGMA synchronous = NORMAL;",
    "PRAGMA mmap_size = 16777216;",
    "PRAGMA busy_timeout = 5000;",
    "PRAGMA cache_size = -2000;",
    "PRAGMA temp_store = MEMORY;",
    "PRAGMA wal_autocheckpoint = 1000;",
];

pub(crate) fn apply_pragmas(conn: &Connection) -> Result<()> {
    for pragma in PRAGMA_INIT_SEQUENCE {
        conn.execute_batch(pragma)
            .with_context(|| format!("failed to execute PRAGMA: {}", pragma.trim()))?;
    }
    Ok(())
}

/// 尝试加载 sqlite-vec 扩展，从以下位置依次搜索：
/// 1. BLINKCORE_VEC_DLL 环境变量指定路径
/// 2. 可执行文件同目录下的 `vec0.dll` (Windows) 或 `libvec0.so` (Unix)
/// 3. 系统库路径
///
/// 加载失败时仅记录 warning 而非 panic，vec0 virtual table 的 CREATE 语句
/// 受 IF NOT EXISTS 保护，搜索查询可通过 is_vec_available() 检查可用性。
pub fn load_vec_extension(conn: &Connection) -> Result<()> {
    let candidates = resolve_vec_candidates();

    for path in &candidates {
        if path.exists() {
            tracing::debug!("loading sqlite-vec extension from: {}", path.display());
            // SAFETY: sqlite-vec 是经过审计的开源向量扩展，从可信路径加载。
            unsafe {
                conn.load_extension_enable()
                    .context("failed to enable extension loading")?;
                let result = conn.load_extension(path, None);
                conn.load_extension_disable()
                    .context("failed to disable extension loading")?;
                return result.with_context(|| {
                    format!("failed to load vec0 extension from {}", path.display())
                });
            }
        }
    }

    anyhow::bail!(
        "sqlite-vec extension not found in any candidate path: {:?}",
        candidates
    );
}

fn resolve_vec_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // 1. 环境变量指定
    if let Ok(path) = std::env::var("BLINKCORE_VEC_DLL") {
        candidates.push(PathBuf::from(path));
    }

    // 2. 可执行文件同目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            if cfg!(target_os = "windows") {
                candidates.push(dir.join("vec0.dll"));
            } else {
                candidates.push(dir.join("libvec0.so"));
            }
        }
    }

    // 3. 平台默认加载名（由系统库路径解析）
    candidates.push(PathBuf::from("vec0"));

    candidates
}

/// 检查当前连接中 sqlite-vec 扩展是否可用
pub fn is_vec_available(conn: &Connection) -> bool {
    conn.query_row("SELECT vec_version()", [], |row| {
        let v: String = row.get(0)?;
        Ok(!v.is_empty())
    })
    .unwrap_or(false)
}

fn ensure_schema(conn: &Connection) -> Result<()> {
    // 执行 init.sql 中的 DDL（不含 vec0 表，因扩展可能未加载）
    let migration_sql = include_str!("../../migrations/001_init.sql");
    // 移除 VTABLE 5 的 CREATE 语句，由 try_create_vec_table 单独处理
    let filtered_sql = strip_vec_table_ddl(migration_sql);
    conn.execute_batch(&filtered_sql)
        .context("failed to execute init.sql DDL")?;

    // 尝试创建 vec0 表（扩展未加载时静默跳过）
    try_create_vec_table(conn)?;

    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, checksum) VALUES (1, 'placeholder_sha256_hex_64chars_xxxxxxxxxxxx')",
        [],
    )
    .context("failed to record schema migration")?;

    // Migration 002: add raw_content column (idempotent via try)
    let migration_002 = include_str!("../../migrations/002_raw_content.sql");
    if let Err(e) = conn.execute_batch(migration_002) {
        tracing::debug!("migration 002 skipped or already applied: {:#}", e);
    }
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, checksum) VALUES (2, 'placeholder_sha256_hex_64chars_xxxxxxxxxxxx')",
        [],
    )
    .context("failed to record schema migration 002")?;

    // Migration 003: add tags column (idempotent via try)
    let migration_003 = include_str!("../../migrations/003_tags.sql");
    if let Err(e) = conn.execute_batch(migration_003) {
        tracing::debug!("migration 003 skipped or already applied: {:#}", e);
    }
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, checksum) VALUES (3, 'placeholder_sha256_hex_64chars_xxxxxxxxxxxx')",
        [],
    )
    .context("failed to record schema migration 003")?;

    Ok(())
}

/// 从 init.sql 中剥离 article_chunks_vec 的 DDL 行，避免扩展未加载时 CREATE 失败
fn strip_vec_table_ddl(sql: &str) -> String {
    sql.lines()
        .filter(|line| {
            let trimmed = line.trim().to_lowercase();
            !trimmed.contains("article_chunks_vec")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 尝试创建 vec0 表（仅扩展可用时）
fn try_create_vec_table(conn: &Connection) -> Result<()> {
    if is_vec_available(conn) {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS article_chunks_vec USING vec0(
                chunk_id        INTEGER PRIMARY KEY,
                dense_embedding float[384]
            );",
        )
        .context("failed to create article_chunks_vec table")?;
    } else {
        tracing::warn!("sqlite-vec not available, skipping article_chunks_vec creation");
    }
    Ok(())
}

/// 应用程序全局状态
pub struct AppState {
    pub write_conn: Arc<Mutex<Connection>>,
    /// 读连接池（当前搜索器改用直接打开新连接，此字段保留供后续重构使用）
    #[allow(dead_code)]
    pub read_pool: Vec<std::sync::Mutex<Connection>>,
}

/// 初始化数据库：创建连接、注入 PRAGMA、执行 DDL、加载 vec 扩展
pub fn init_db(db_path: &str) -> Result<AppState> {
    // ---- 写连接 ----
    let write_conn = Connection::open(db_path)
        .with_context(|| format!("failed to open database at {}", db_path))?;

    apply_pragmas(&write_conn)?;

    // 尝试加载 vec 扩展，失败仅警告
    if let Err(e) = load_vec_extension(&write_conn) {
        tracing::warn!("sqlite-vec extension not available: {:#}", e);
    } else {
        tracing::info!("sqlite-vec extension loaded successfully");
    }

    ensure_schema(&write_conn)?;

    // ---- 读连接 ----
    let mut read_pool = Vec::with_capacity(2);
    for i in 0..2 {
        let conn = Connection::open(db_path)
            .with_context(|| format!("failed to open read connection {} at {}", i, db_path))?;
        apply_pragmas(&conn)?;
        if is_vec_available(&write_conn) {
            let _ = load_vec_extension(&conn);
        }
        read_pool.push(std::sync::Mutex::new(conn));
    }

    Ok(AppState {
        write_conn: Arc::new(Mutex::new(write_conn)),
        read_pool,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_db() {
        let tmp = tempfile::NamedTempFile::new().expect("create temp file");
        let db_path = tmp.path().to_str().expect("valid path");

        let state = init_db(db_path).expect("init_db should succeed");

        // 验证 WAL 模式已持久化
        let wal_check: String = state
            .write_conn
            .blocking_lock()
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("query journal_mode");
        assert_eq!(wal_check.to_lowercase(), "wal", "journal_mode must be WAL");

        // 验证 cache_size
        let cache_check: i32 = state
            .write_conn
            .blocking_lock()
            .pragma_query_value(None, "cache_size", |row| row.get(0))
            .expect("query cache_size");
        assert_eq!(cache_check, -2000, "cache_size must be -2000");

        // 验证读连接数量
        assert_eq!(state.read_pool.len(), 2, "read_pool must have 2 connections");
    }
}