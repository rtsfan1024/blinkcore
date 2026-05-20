import { DEMO_ARTICLES, type ArticleContent, type ArticleMeta } from "./demo-data";
export type { ArticleMeta };

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export interface ArticleListResponse {
  articles: ArticleMeta[];
  total: number;
  page: number;
  per_page: number;
}

/** Fetch article list from backend API, fallback to demo data. */
export async function fetchArticleList(): Promise<ArticleListResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/public/articles?page=1&per_page=10000`, {
      cache: "no-store",
    });
    if (res.ok) return res.json();
  } catch {
    // API unavailable — use demo data for SSG build
  }
  const articles: ArticleMeta[] = DEMO_ARTICLES.map((a) => ({
    slug: a.slug,
    title: a.title,
    created_at: a.created_at,
    tags: a.tags ?? [],
  }));
  return { articles, total: articles.length, page: 1, per_page: 50 };
}

/** Fetch article content by slug from backend, fallback to demo data. */
export async function fetchArticleBySlug(slug: string): Promise<ArticleContent | null> {
  try {
    // Normalize slug: strip trailing slash to match backend route
    const s = slug.replace(/\/+$/, "");
    const res = await fetch(`${API_BASE}/api/v1/public/articles/${s}`, {
      cache: "no-store",
    });
    if (res.ok) return res.json();
  } catch {
    // API unavailable — try demo data
  }

  // Fallback to demo data for SSG builds
  const { DEMO_ARTICLES } = await import("./demo-data");
  const demo = DEMO_ARTICLES.find((a) => a.slug === slug);
  if (demo) return demo;

  return null;
}