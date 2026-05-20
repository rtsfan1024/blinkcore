import { fetchArticleList } from "@/lib/api";
import { StarfieldClient } from "@/components/StarfieldClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let data;

  try {
    data = await fetchArticleList();
  } catch {
    data = { articles: [], total: 0, page: 1, per_page: 50 };
  }

  return <StarfieldClient articles={data.articles} />;
}
