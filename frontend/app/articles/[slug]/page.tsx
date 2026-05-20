import { notFound } from "next/navigation";
import { fetchArticleBySlug, fetchArticleList } from "@/lib/api";
import ArticlePageClient from "./ArticlePageClient";

/** Pre-generate all known article slugs (including non-ASCII). */
export async function generateStaticParams() {
  try {
    const list = await fetchArticleList();
    return list.articles.map((article) => ({
      slug: article.slug,
    }));
  } catch {
    // Fallback if API unavailable
    const { DEMO_ARTICLES } = await import("@/lib/demo-data");
    return DEMO_ARTICLES.map((article) => ({
      slug: article.slug,
    }));
  }
}

export const dynamicParams = true;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await fetchArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  return (
    <ArticlePageClient
      slug={article.slug}
      createdAt={article.created_at}
      rawContent={article.raw_content}
    />
  );
}