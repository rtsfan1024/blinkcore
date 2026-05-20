export interface ArticleMeta {
  slug: string;
  title: string;
  created_at: string;
  tags: string[];
}

export interface ArticleContent extends ArticleMeta {
  raw_content: string;
  tags: string[];
}

export const DEMO_ARTICLES: ArticleContent[] = [
  {
    slug: "getting-started",
    title: "Getting Started with BlinkCore",
    created_at: "2025-01-15T10:00:00Z",
    tags: ["后端", "Rust"],
    raw_content:
      "# Getting Started\n\n## Introduction\n\nWelcome to **BlinkCore** — a high-performance knowledge base backend built with Rust and SQLite.\n\n## Key Features\n\n- **Full-Text Search**: Powered by SQLite FTS5 with BM25 ranking\n- **Semantic Search**: 384-dim vector search via sqlite-vec\n- **Hybrid Search**: RRF fusion combining sparse + dense signals\n- **Zero External Dependencies**: Single binary, no Postgres/Redis needed\n\n## Architecture\n\n```\nObsidian ──→ Pipeline ──→ API (Axum) ──→ SQLite\n                  ↓\n            Static Site (Next.js SSG)\n```\n\n## Quick Start\n\n```bash\n# Start the server\nBLINKCORE_DB_PATH=/data/blog.db cargo run --release\n\n# Build the frontend\ncd frontend && npm run build\n```",
  },
  {
    slug: "architecture-overview",
    title: "Architecture Overview",
    created_at: "2025-01-20T14:30:00Z",
    tags: ["后端", "架构"],
    raw_content:
      "# Architecture Overview\n\n## System Design\n\nBlinkCore follows a **layered architecture** with strict separation of concerns.\n\n### Storage Layer\n\nThe storage layer uses **SQLite with WAL mode** for concurrent reads:\n\n- `articles` — Article metadata with visibility control\n- `article_chunks` — Section-level content storage\n- `article_chunks_fts` — FTS5 virtual table for full-text search\n- `article_chunks_vec` — vec0 virtual table for vector search\n\n### Write Path\n\n```mermaid\nsequenceDiagram\n    Client->>API: POST /api/v1/admin/sync\n    API->>Write Transaction: write_article_transaction()\n    Write Transaction->>SQLite: BEGIN IMMEDIATE\n    Write Transaction->>SQLite: UPSERT article\n    Write Transaction->>SQLite: DELETE chunks\n    loop Each chunk\n        Write Transaction->>SQLite: INSERT chunk\n        Write Transaction->>SQLite: INSERT embedding\n    end\n    Write Transaction->>SQLite: COMMIT\n```\n\n### Read Path\n\n```mermaid\nsequenceDiagram\n    Client->>API: POST /api/v1/public/search\n    API->>FTS5: query_fts(text, 20)\n    API->>Vec0: query_vec(vector, 20)\n    FTS5->>RRF: SearchHit[]{}\n    Vec0->>RRF: SearchHit[]{}\n    RRF->>API: Top-5 fused results\n    API->>Client: SearchResponse\n```",
  },
];
