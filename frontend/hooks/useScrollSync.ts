/**
 * Dual-pane scroll sync hook.
 *
 * L1–L5: IntersectionObserver left→right (article → mindmap scroll tracking)
 * L6–L8: SVG node click right→left (mindmap → article scroll)
 *
 * Key design:
 *  - activeAnchor updates immediately (no throttle) so the mindmap
 *    highlights the current section in real-time.
 *  - scrollIntoView on the mindmap pane is debounced (300ms) to avoid
 *    jarring jumps when scrolling quickly through headings.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface UseScrollSyncReturn {
  activeAnchor: string | null;
  onSvgNodeClick: (slugAnchor: string) => void;
}

export function useScrollSync(
  articlePaneRef: React.RefObject<HTMLDivElement | null>,
  svgContainerRef: React.RefObject<HTMLDivElement | null>,
): UseScrollSyncReturn {
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickNavRef = useRef(false);
  const lastAnchorRef = useRef<string | null>(null);

  /* ---- Scroll mindmap container to show the active node ---- */

  const scrollMindmapToNode = useCallback(
    (anchor: string) => {
      const container = svgContainerRef.current;
      if (!container) return;

      const el = container.querySelector<SVGElement>(
        `[data-slug-anchor="${anchor}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    },
    [svgContainerRef],
  );

  /* ---- IntersectionObserver — tracks which heading is in view ---- */

  useEffect(() => {
    const pane = articlePaneRef.current;
    if (!pane) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const anchor = entry.target.getAttribute("data-slug-anchor");
          if (!anchor) continue;

          // Immediate highlight update
          setActiveAnchor(anchor);
          lastAnchorRef.current = anchor;

          // Debounced mindmap scroll
          if (clickNavRef.current) return; // skip during click nav
          if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = setTimeout(() => {
            scrollMindmapToNode(anchor);
          }, 300);
        }
      },
      {
        root: pane,
        rootMargin: "-10% 0px -75% 0px",
        threshold: 0,
      },
    );

    const observe = () => {
      pane.querySelectorAll("[data-slug-anchor]").forEach((el) => io.observe(el));
    };

    observe();

    // Monitor for dynamic heading additions
    const mo = new MutationObserver(observe);
    mo.observe(pane, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [articlePaneRef, scrollMindmapToNode]);

  /* ---- Click on SVG node → scroll article to section ---- */

  const onSvgNodeClick = useCallback(
    (slugAnchor: string) => {
      const pane = articlePaneRef.current;
      if (!pane) return;

      clickNavRef.current = true;
      setActiveAnchor(slugAnchor);

      const target = pane.querySelector<HTMLElement>(
        `[data-slug-anchor="${slugAnchor}"]`,
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      // Reset click-nav flag after scroll completes
      setTimeout(() => {
        clickNavRef.current = false;
      }, 600);
    },
    [articlePaneRef],
  );

  return { activeAnchor, onSvgNodeClick };
}