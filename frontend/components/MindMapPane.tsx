"use client";

import { forwardRef } from "react";

interface MindMapPaneProps {
  children?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** Additional classes for responsive display control. */
  className?: string;
}

/**
 * Right pane: full-height, mindmap container.
 * No visible scrollbar — auto-scrolls via JS to track
 * the currently active article section.
 */
const MindMapPane = forwardRef<HTMLDivElement, MindMapPaneProps>(
  function MindMapPane({ children, toolbar, className }, ref) {
    return (
      <aside
        className={`overflow-hidden border-l border-[var(--border)] min-w-[280px] ${className ?? ""}`}
        style={{ height: "100dvh", maxWidth: "44vw" }}
      >
        {toolbar && (
          <div className="flex items-center justify-end gap-3 h-8 px-4 border-b border-[var(--border)]">
            {toolbar}
          </div>
        )}
        <div
          ref={ref}
          className="overflow-auto scrollbar-none"
          style={{ height: toolbar ? "calc(100dvh - 32px)" : "100dvh" }}
        >
          {children ?? (
            <p className="mt-8 text-center text-xs text-[var(--text-secondary)]">
              Mind Map
            </p>
          )}
        </div>
      </aside>
    );
  },
);

export default MindMapPane;
