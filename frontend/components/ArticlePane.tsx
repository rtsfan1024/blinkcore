"use client";

import { ReactNode, forwardRef } from "react";

interface ArticlePaneProps {
  children: ReactNode;
}

/**
 * Left pane: full-height, scrollable article content.
 * Scrollbar hidden for cleaner look — scroll position is
 * visually mirrored by the mindmap tracking.
 */
const ArticlePane = forwardRef<HTMLDivElement, ArticlePaneProps>(
  function ArticlePane({ children }, ref) {
    return (
      <section
        ref={ref}
        className="overflow-y-auto px-10 max-lg:px-6 max-md:px-4 py-8 scrollbar-none"
        style={{ height: "100dvh" }}
      >
        {children}
      </section>
    );
  },
);

export default ArticlePane;