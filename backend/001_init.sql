-- ============================================================
-- BlinkCore SQLite 3 Production DDL
-- Execute: sqlite3 /opt/blinkcore/data/blog.db < migrations/001_init.sql
-- ============================================================

-- [持久化] 以下 PRAGMA 写入数据库文件头, 跨连接持久生效
PRAGMA journal_mode = WAL;
-- [会话级] 以下 PRAGMA 仅作用于当前连接, 必须在 Rust 侧每次连接时重新注入
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA mmap_size = 16777216;       -- 16MB
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -2000;         -- 2MB
PRAGMA temp_store = MEMORY;
PRAGMA wal_autocheckpoint = 1000;

-- ============================================================
-- TABLE 1: articles
-- ============================================================
CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    UNIQUE NOT NULL,
    title       TEXT    NOT NULL,
    visibility  TEXT    DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    content_hash TEXT   NOT NULL CHECK (length(content_hash) = 64),  -- SHA-256 hex digest
    created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_routing_flow
    ON articles(visibility, created_at DESC);

-- ============================================================
-- TABLE 2: article_canvas
-- ============================================================
CREATE TABLE IF NOT EXISTS article_canvas (
    article_id      INTEGER PRIMARY KEY,
    excalidraw_json TEXT    NOT NULL,
    FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- ============================================================
-- TABLE 3: article_chunks
-- ============================================================
CREATE TABLE IF NOT EXISTS article_chunks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id    INTEGER NOT NULL,
    chunk_index   INTEGER NOT NULL,
    heading_level INTEGER NOT NULL CHECK (heading_level IN (2, 3)),
    heading_text  TEXT    NOT NULL,
    slug_anchor   TEXT    NOT NULL,
    chunk_content TEXT    NOT NULL,
    FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_article_flow
    ON article_chunks(article_id, chunk_index);

-- ============================================================
-- VTABLE 4: article_chunks_fts (FTS5, content=external)
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS article_chunks_fts USING fts5(
    chunk_content,
    heading_text,
    content='article_chunks',
    tokenize="unicode61"
);

-- VTABLE 5: article_chunks_vec (sqlite-vec, 384-dim) 由 Rust 侧的 try_create_vec_table 按可用性创建

-- ============================================================
-- TABLE 6: pending_leads
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_leads (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id        TEXT UNIQUE NOT NULL,
    target_slug    TEXT NOT NULL,
    trigger_keyword TEXT NOT NULL,
    contact_method TEXT NOT NULL,
    contact_value  TEXT NOT NULL,
    user_comment   TEXT,
    retry_count    INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_retry_flow
    ON pending_leads(retry_count, created_at ASC);

-- ============================================================
-- TABLE: schema_migrations
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    checksum    TEXT NOT NULL CHECK (length(checksum) = 64)
);

-- ============================================================
-- TRIGGER: trg_chunks_cascade_prune_v2 (AFTER DELETE)
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_cascade_prune_v2
AFTER DELETE ON article_chunks
BEGIN
    INSERT INTO article_chunks_fts(article_chunks_fts, rowid, chunk_content, heading_text)
        VALUES('delete', old.id, old.chunk_content, old.heading_text);
    DELETE FROM article_chunks_vec WHERE chunk_id = old.id;
END;

-- ============================================================
-- TRIGGER: trg_chunks_cascade_insert (AFTER INSERT)
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_chunks_cascade_insert
AFTER INSERT ON article_chunks
BEGIN
    INSERT INTO article_chunks_fts(rowid, chunk_content, heading_text)
        VALUES (new.id, new.chunk_content, new.heading_text);
END;