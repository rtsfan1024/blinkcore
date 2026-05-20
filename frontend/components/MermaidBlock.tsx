"use client";

import { memo, useEffect, useId, useRef, useState } from "react";

interface MermaidBlockProps {
  /** Raw diagram definition text (e.g. "graph TB\n  A-->B") */
  definition: string;
}

function MermaidBlockInner({ definition }: MermaidBlockProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [errored, setErrored] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            primaryColor: "#1e2a3a",
            primaryTextColor: "#e2e8f0",
            primaryBorderColor: "#60a5fa",
            lineColor: "#60a5fa",
            secondaryColor: "#141b2d",
            tertiaryColor: "#2d3a4a",
            fontSize: "14px",
          },
          flowchart: { useMaxWidth: true, htmlLabels: true },
          sequence: { useMaxWidth: true },
          gantt: { useMaxWidth: true },
        });

        if (cancelled) return;

        const { svg } = await mermaid.render(`mermaid-${id}`, definition);
        if (cancelled) return;

        // Direct DOM injection — bypasses React reconciliation entirely.
        // The container div is always rendered (never conditionally unmounted),
        // so containerRef.current is guaranteed to be available from first render.
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setErrored(true);
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    }

    render();

    return () => {
      cancelled = true;
    };
    // Re-run only when definition or id changes — NOT on parent re-renders
    // (memo() on the exported component prevents those).
  }, [definition, id]);

  /* ---- Error state ---- */
  if (errored) {
    return (
      <div className="my-6">
        <div className="mb-1 flex items-center gap-2 rounded-t-lg border border-red-400/20 bg-red-950/20 px-3 py-1.5">
          <span className="text-xs text-red-400/70">mermaid</span>
          <span className="text-[10px] text-red-400/40" title={errorMsg}>
            render error
          </span>
        </div>
        <pre className="overflow-x-auto rounded-b-lg border border-t-0 border-[var(--border)]/30 bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
          <code>{definition}</code>
        </pre>
      </div>
    );
  }

  /* ---- Normal state — container div always rendered ---- */
  return (
    <div className="my-6">
      <div className="rounded-lg border border-[var(--border)]/30 bg-[var(--bg-secondary)]/30 p-2">
        <div className="mb-1 px-2">
          <span className="text-[11px] font-mono text-[var(--text-secondary)]/40">
            mermaid
          </span>
        </div>
        <div
          ref={containerRef}
          className="mermaid-svg-container flex justify-center overflow-x-auto py-4"
          style={{ contain: "layout style paint", willChange: "transform" }}
        >
          {/*
            Loading indicator — rendered as React children initially.
            Once the useEffect async finishes, innerHTML replaces this
            entire node with the SVG. No subsequent state change triggers
            a re-render (no "setStatus('ready')"), so React never attempts
            to touch the innerHTML content on reconciliation.
          */}
          <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]/60">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-[var(--accent)]" />
            Rendering diagram…
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders mermaid diagrams via direct DOM injection (ref + innerHTML).
 *
 * Container div is always rendered from the first render onward — never
 * conditionally — so the ref target exists before the async mermaid.render()
 * resolves. After injection, no React state is set, so scroll-triggered
 * re-renders from the parent (ArticlePageClient) cannot clear the SVG.
 */
export default memo(MermaidBlockInner);