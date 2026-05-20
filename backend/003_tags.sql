-- ============================================================
-- BlinkCore Migration 003: Add tags column (JSON array text)
-- ============================================================

ALTER TABLE articles ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
