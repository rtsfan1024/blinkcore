"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ArticlePane from "@/components/ArticlePane";
import MindMapPane from "@/components/MindMapPane";
import MindMap from "@/components/MindMap";
import { ArticleContent } from "@/components/ArticleContent";
import { useScrollSync } from "@/hooks/useScrollSync";
import { extractHeadingsFromMarkdown } from "@/lib/mindmap-layout";

interface ArticlePageClientProps {
  slug: string;
  createdAt: string;
  /** Raw markdown used to render content and extract headings for the mindmap. */
  rawContent: string;
}

export default function ArticlePageClient({
  slug,
  createdAt,
  rawContent,
}: ArticlePageClientProps) {
  const articlePaneRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const { activeAnchor, onSvgNodeClick } = useScrollSync(
    articlePaneRef,
    svgContainerRef,
  );

  /* ---- Collapse state ---- */

  const [collapsedSlugs, setCollapsedSlugs] = useState<Set<string>>(new Set());

  const hasH1 = useMemo(() => {
    if (!rawContent) return false;
    return extractHeadingsFromMarkdown(rawContent).some(
      (c) => c.heading_level === 1,
    );
  }, [rawContent]);

  const toggleCollapse = useCallback((slug: string) => {
    setCollapsedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    if (!rawContent) return;
    const slugs = new Set(
      extractHeadingsFromMarkdown(rawContent)
        .filter((c) => c.heading_level === 1)
        .map((c) => c.slug_anchor),
    );
    setCollapsedSlugs(slugs);
  }, [rawContent]);

  const expandAll = useCallback(() => {
    setCollapsedSlugs(new Set());
  }, []);

  /* ---- Reading progress ---- */

  const [readProgress, setReadProgress] = useState(0);
  const [showPercent, setShowPercent] = useState(false);

  const handleScroll = useCallback(() => {
    const pane = articlePaneRef.current;
    if (!pane) return;
    const { scrollTop, scrollHeight, clientHeight } = pane;
    const maxScroll = scrollHeight - clientHeight;
    setReadProgress(maxScroll > 0 ? scrollTop / maxScroll : 0);
  }, []);

  useEffect(() => {
    const pane = articlePaneRef.current;
    if (!pane) return;
    pane.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => pane.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  /* ---- Mobile drawer state ---- */

  const [mobileMindmapOpen, setMobileMindmapOpen] = useState(false);

  const handleMobileNodeClick = useCallback(
    (slugAnchor: string) => {
      onSvgNodeClick(slugAnchor);
      setMobileMindmapOpen(false);
    },
    [onSvgNodeClick],
  );

  /* ---- Mindmap toolbar ---- */

  const mmToolbar =
    rawContent ? (
      <>
        <Link
          href="/"
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors mr-auto"
        >
          ← Back
        </Link>
        {hasH1 && (
          <>
            <button
              onClick={collapseAll}
              title="折叠全部"
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              [−]
            </button>
            <button
              onClick={expandAll}
              title="展开全部"
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              [+]
            </button>
          </>
        )}
      </>
    ) : undefined;

  /* ---- Shared mindmap content ---- */

  const mindmapContent = rawContent ? (
    <MindMap
      markdown={rawContent}
      activeAnchor={activeAnchor}
      onNodeClick={onSvgNodeClick}
      collapsedSlugs={collapsedSlugs}
      onToggleCollapse={toggleCollapse}
    />
  ) : undefined;

  return (
    <>
      {/* Reading progress bar — fixed at viewport top */}
      <div
        className="fixed top-0 left-0 z-50 h-[3px] cursor-pointer"
        style={{ width: `${readProgress * 100}%` }}
        onMouseEnter={() => setShowPercent(true)}
        onMouseLeave={() => setShowPercent(false)}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, #3fb950 0%, #4ade80 50%, #58a6ff 100%)",
            boxShadow: "0 0 6px rgba(63, 185, 80, 0.4)",
          }}
        />
        {showPercent && (
          <span
            className="absolute -top-7 right-0 rounded bg-[#1a2332] px-2 py-0.5 text-xs text-[#e6edf3] shadow-lg"
            style={{ fontFamily: "'Cascadia Code', monospace" }}
          >
            {Math.round(readProgress * 100)}%
          </span>
        )}
      </div>

      {/* ================================================================ */}
      {/*  Main grid: side-by-side on desktop, single column on mobile     */}
      {/* ================================================================ */}
      <div className="grid h-screen max-lg:grid-cols-1 lg:grid-cols-[1fr_auto]">
        {/* Left: article content — scrolls naturally */}
        <ArticlePane ref={articlePaneRef}>
          <ArticleContent rawContent={rawContent} />

          <footer className="mt-16 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-secondary)]">
            slug: {slug} · created:{" "}
            {new Date(createdAt).toLocaleDateString("zh-CN")}
          </footer>
        </ArticlePane>

        {/* Right: mindmap — desktop only */}
        <MindMapPane
          ref={svgContainerRef}
          toolbar={mmToolbar}
          className="max-lg:hidden"
        >
          {mindmapContent}
        </MindMapPane>
      </div>

      {/* ================================================================ */}
      {/*  Mobile: floating action button + drawer overlay                */}
      {/* ================================================================ */}

      {/* FAB — visible only below lg breakpoint */}
      {rawContent && (
        <button
          className="fixed bottom-6 right-6 z-40 flex items-center justify-center lg:hidden rounded-full shadow-xl transition-transform active:scale-90"
          style={{
            width: 48,
            height: 48,
            background: "var(--accent)",
            color: "#fff",
          }}
          onClick={() => setMobileMindmapOpen(true)}
          aria-label="打开思维导图"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" />
            <line x1="14.5" y1="11.5" x2="17.5" y2="6.5" />
            <line x1="9.5" y1="14.5" x2="6.5" y2="17.5" />
          </svg>
        </button>
      )}

      {/* Mobile drawer overlay */}
      {mobileMindmapOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setMobileMindmapOpen(false)}
          />

          {/* Drawer panel — slides in from right */}
          <div
            className="absolute right-0 top-0 h-full bg-[var(--bg-primary)] border-l border-[var(--border)] shadow-2xl animate-slide-in flex flex-col"
            style={{ width: "85vw", maxWidth: 400 }}
          >
            {/* Drawer toolbar */}
            <div className="flex items-center justify-end gap-3 h-10 px-3 border-b border-[var(--border)] flex-shrink-0">
              <Link
                href="/"
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors mr-auto"
              >
                ← Back
              </Link>
              {hasH1 && (
                <>
                  <button
                    onClick={collapseAll}
                    title="折叠全部"
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
                  >
                    [−]
                  </button>
                  <button
                    onClick={expandAll}
                    title="展开全部"
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
                  >
                    [+]
                  </button>
                </>
              )}
              <button
                className="ml-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-2"
                onClick={() => setMobileMindmapOpen(false)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            {/* Drawer content — scrollable */}
            <div
              className="overflow-auto scrollbar-none flex-1"
              style={{ padding: "8px 0" }}
            >
              <MindMap
                markdown={rawContent}
                activeAnchor={activeAnchor}
                onNodeClick={handleMobileNodeClick}
                collapsedSlugs={collapsedSlugs}
                onToggleCollapse={toggleCollapse}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
