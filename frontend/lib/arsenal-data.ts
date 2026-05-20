import type { ArticleMeta } from "./api";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface SecondaryGroup {
  tag: string;
  articles: ArticleMeta[];
}

export interface ArsenalGroup {
  primary: string;
  color: string;
  secondaries: SecondaryGroup[];
  uncategorized: ArticleMeta[];
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Deterministic color from tag name                                 */
/* ------------------------------------------------------------------ */

const TAG_PALETTE = [
  "#3fb950", "#58a6ff", "#d2a8ff", "#ff7b72", "#f0883e",
  "#a5d6ff", "#79c0ff", "#7ee787", "#ffa657", "#ffc107",
  "#ff6b6b", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd",
];

export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i);
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

/* ------------------------------------------------------------------ */
/*  Group articles into two-level hierarchy                            */
/* ------------------------------------------------------------------ */

export function groupArsenal(articles: ArticleMeta[]): ArsenalGroup[] {
  const map = new Map<string, ArsenalGroup>();

  for (const article of articles) {
    const tags = article.tags.length > 0 ? article.tags : ["未分类"];
    const primary = tags[0];
    const secondaryTags = tags.slice(1);

    if (!map.has(primary)) {
      map.set(primary, {
        primary,
        color: tagColor(primary),
        secondaries: [],
        uncategorized: [],
        total: 0,
      });
    }

    const group = map.get(primary)!;
    group.total++;

    if (secondaryTags.length === 0) {
      group.uncategorized.push(article);
    } else {
      // Deduplicate secondary tags
      const seen = new Set(group.secondaries.map((s) => s.tag));
      for (const st of secondaryTags) {
        if (!seen.has(st)) {
          seen.add(st);
          group.secondaries.push({ tag: st, articles: [] });
        }
        const sg = group.secondaries.find((s) => s.tag === st)!;
        sg.articles.push(article);
      }
    }
  }

  // Sort groups by total count descending, then alphabetically
  return Array.from(map.values()).sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    return a.primary.localeCompare(b.primary);
  });
}
