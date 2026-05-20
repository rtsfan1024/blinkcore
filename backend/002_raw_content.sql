-- ============================================================
-- BlinkCore Migration 002: Add raw_content column
-- ============================================================

ALTER TABLE articles ADD COLUMN raw_content TEXT NOT NULL DEFAULT '';