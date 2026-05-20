"use client";

import { useMemo } from "react";
import {
  buildTree,
  layoutTree,
  extractHeadingsFromMarkdown,
  filterCollapsedChunks,
  type ChunkInfo,
  type LayoutNode,
} from "@/lib/mindmap-layout";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface MindMapProps {
  chunks?: ChunkInfo[];
  markdown?: string;
  activeAnchor?: string | null;
  onNodeClick?: (slugAnchor: string) => void;
  collapsedSlugs?: Set<string>;
  onToggleCollapse?: (slugAnchor: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Level-based color tokens                                          */
/* ------------------------------------------------------------------ */

const LEVEL_COLORS: Array<{
  fill: string;
  stroke: string;
  text: string;
  fillActive: string;
  strokeActive: string;
  textActive: string;
}> = [
  // Level 1 (H1) — most prominent
  {
    fill: "#1a2332",
    fillActive: "#1c2a3d",
    stroke: "#3fb950",
    strokeActive: "#3fb950",
    text: "#e6edf3",
    textActive: "#e6edf3",
  },
  // Level 2 (H2)
  {
    fill: "#161b22",
    fillActive: "#1a2332",
    stroke: "#58a6ff",
    strokeActive: "#3fb950",
    text: "#e6edf3",
    textActive: "#e6edf3",
  },
  // Level 3 (H3)
  {
    fill: "#0d1117",
    fillActive: "#161b22",
    stroke: "#30363d",
    strokeActive: "#58a6ff",
    text: "#8b949e",
    textActive: "#e6edf3",
  },
  // Level 4+ (H4–H6) — increasingly subtle
  {
    fill: "#0d1117",
    fillActive: "#161b22",
    stroke: "#21262d",
    strokeActive: "#58a6ff",
    text: "#6e7681",
    textActive: "#e6edf3",
  },
];

function getLevelColors(level: number, _maxLevel: number) {
  const idx = Math.min(level - 1, LEVEL_COLORS.length - 1);
  return LEVEL_COLORS[idx];
}

const LINE_COLOR = "#30363d";
const LINE_ACTIVE = "#3fb950";

/* ------------------------------------------------------------------ */
/*  Node size per level                                               */
/* ------------------------------------------------------------------ */

function nodeFontSize(level: number): number {
  if (level === 1) return 14;
  if (level === 2) return 13;
  if (level === 3) return 12;
  return 11;
}

function nodeFontWeight(level: number): number {
  return level <= 2 ? 600 : 400;
}

/* ------------------------------------------------------------------ */
/*  Single node renderer                                              */
/* ------------------------------------------------------------------ */

interface NodeShapeProps {
  node: LayoutNode;
  isActive: boolean;
  onClick?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

function NodeShape({ node, isActive, onClick, collapsed, onToggle }: NodeShapeProps) {
  const colors = getLevelColors(node.heading_level, 6);
  const fill = isActive ? colors.fillActive : colors.fill;
  const stroke = isActive ? colors.strokeActive : colors.stroke;
  const textFill = isActive ? colors.textActive : colors.text;
  const strokeW = isActive ? 2 : 1;
  const isH1 = node.heading_level === 1;
  const padLeft = isH1 ? 22 : 10;

  /* ---- Navigate (click text / blank area) ---- */
  function handleNavClick() {
    onClick?.();
  }

  /* ---- Toggle collapse (click chevron area) ---- */
  function handleToggleClick() {
    onToggle?.();
  }

  return (
    <g data-slug-anchor={node.slug_anchor} className="cursor-pointer">
      {/* Visual rect — no pointer events, rendering only */}
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={6}
        ry={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeW}
        style={{ pointerEvents: "none", transition: "fill 0.15s, stroke 0.15s" }}
      />

      {/* Text — no pointer events, rendering only */}
      <foreignObject
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: `0 10px 0 ${padLeft}px`,
            color: textFill,
            fontSize: nodeFontSize(node.heading_level),
            fontWeight: nodeFontWeight(node.heading_level),
            fontFamily: "'Cascadia Code', 'Fira Code', monospace",
            lineHeight: 1.4,
            wordBreak: "break-word",
            overflowWrap: "break-word",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          {node.heading_text}
        </div>
      </foreignObject>

      {/* Nav click zone — node minus chevron area */}
      <rect
        x={isH1 ? node.x + 20 : node.x}
        y={node.y}
        width={isH1 ? node.width - 20 : node.width}
        height={node.height}
        fill="transparent"
        onClick={handleNavClick}
      />

      {/* Chevron click zone — left 20 px (H1 only) */}
      {isH1 && (
        <g onClick={handleToggleClick} style={{ cursor: "pointer" }}>
          <rect
            x={node.x}
            y={node.y}
            width={20}
            height={node.height}
            fill="transparent"
          />
          <text
            x={node.x + 8}
            y={node.y + node.height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={textFill}
            fontSize={10}
            fontFamily="'Cascadia Code', monospace"
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            {collapsed ? "▸" : "▾"}
          </text>
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/*  Edge path (cubic bezier) between any two nodes                    */
/* ------------------------------------------------------------------ */

function EdgePath({
  from,
  to,
  isActive,
}: {
  from: LayoutNode;
  to: LayoutNode;
  isActive: boolean;
}) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const cx = (x1 + x2) / 2;
  const stroke = isActive ? LINE_ACTIVE : LINE_COLOR;

  const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;

  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={isActive ? 1.5 : 1}
      strokeLinecap="round"
      style={{ transition: "stroke 0.15s" }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Recursive renderers                                               */
/* ------------------------------------------------------------------ */

interface RenderTreeResult {
  edges: React.ReactNode[];
  nodes: React.ReactNode[];
}

function renderTree(
  roots: LayoutNode[],
  activeAnchor: string | null,
  onNodeClick?: (slugAnchor: string) => void,
  collapsedSlugs?: Set<string>,
  onToggleCollapse?: (slugAnchor: string) => void,
): RenderTreeResult {
  const edges: React.ReactNode[] = [];
  const nodes: React.ReactNode[] = [];

  function walk(node: LayoutNode) {
    const isActive = activeAnchor === node.slug_anchor;
    const isCollapsed = collapsedSlugs?.has(node.slug_anchor) ?? false;

    nodes.push(
      <NodeShape
        key={`n-${node.chunk_index}`}
        node={node}
        isActive={isActive}
        onClick={() => onNodeClick?.(node.slug_anchor)}
        collapsed={isCollapsed}
        onToggle={() => onToggleCollapse?.(node.slug_anchor)}
      />,
    );

    for (const child of node.children) {
      const childActive = activeAnchor === child.slug_anchor;
      edges.push(
        <EdgePath
          key={`e-${node.chunk_index}-${child.chunk_index}`}
          from={node}
          to={child}
          isActive={isActive || childActive}
        />,
      );
      walk(child);
    }
  }

  for (const root of roots) walk(root);
  return { edges, nodes };
}

/* ------------------------------------------------------------------ */
/*  MindMap component                                                 */
/* ------------------------------------------------------------------ */

export default function MindMap({
  chunks,
  markdown,
  activeAnchor,
  onNodeClick,
  collapsedSlugs,
  onToggleCollapse,
}: MindMapProps) {
  const { roots, box } = useMemo(() => {
    const data: ChunkInfo[] =
      chunks ?? (markdown ? extractHeadingsFromMarkdown(markdown) : []);
    const filtered =
      collapsedSlugs && collapsedSlugs.size > 0
        ? filterCollapsedChunks(data, collapsedSlugs)
        : data;
    const tree = buildTree(filtered);
    const b = layoutTree(tree);
    return { roots: tree, box: b };
  }, [chunks, markdown, collapsedSlugs]);

  if (roots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--text-secondary)]">
        No headings found
      </div>
    );
  }

  const { edges, nodes } = renderTree(
    roots,
    activeAnchor,
    onNodeClick,
    collapsedSlugs,
    onToggleCollapse,
  );

  return (
    <svg
      width={box.width + 40}
      height={Math.max(box.height + 40, 600)}
    >
      {edges}
      {nodes}
    </svg>
  );
}