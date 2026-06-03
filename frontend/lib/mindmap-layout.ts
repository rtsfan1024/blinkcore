/**
 * Mindmap tree layout algorithm — supports N-level heading hierarchy (H1–H6).
 *
 * Input: heading chunks extracted from article markdown.
 * Output: positioned nodes with x/y/width/height ready for SVG rendering.
 *
 * Tree structure:
 *   - Each heading level becomes a tree level
 *   - H1 → roots; H2 → children of H1; H3 → children of H2; etc.
 *   - Orphan headings (e.g. H3 before any H2) are promoted to roots.
 *
 * Slug generation matches rehype-slug (github-slugger) exactly,
 * so mindmap node clicks always find the matching heading anchor.
 */

import BananaSlug from "github-slugger";

/* ------------------------------------------------------------------ */
/*  LaTeX helper: strip/convert LaTeX in heading text for mindmap     */
/* ------------------------------------------------------------------ */

/** Map common LaTeX commands to Unicode equivalents. */
const LATEX_UNICODE_MAP: Record<string, string> = {
  "\\rightarrow": "→",
  "\\leftarrow": "←",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
  "\\leftrightarrow": "↔",
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ε",
  "\\theta": "θ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\pi": "π",
  "\\sigma": "σ",
  "\\omega": "ω",
  "\\phi": "φ",
  "\\psi": "ψ",
  "\\infty": "∞",
  "\\sum": "∑",
  "\\prod": "∏",
  "\\int": "∫",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\times": "×",
  "\\cdot": "·",
  "\\pm": "±",
  "\\leq": "≤",
  "\\geq": "≥",
  "\\neq": "≠",
  "\\approx": "≈",
  "\\equiv": "≡",
  "\\subset": "⊂",
  "\\supset": "⊃",
  "\\in": "∈",
  "\\notin": "∉",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\neg": "¬",
  "\\land": "∧",
  "\\lor": "∨",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\emptyset": "∅",
  "\\sqrt": "√",
  "\\ldots": "…",
  "\\cdots": "⋯",
  "\\quad": " ",
  "\\qquad": "  ",
  "\\text": "",
  "\\mathrm": "",
  "\\mathbf": "",
  "\\mathit": "",
  "\\mathcal": "",
  "\\mathbb": "",
  "\\frac": "",
  "\\overset": "",
  "\\underset": "",
  "\\\\": " ",
};

/**
 * Strip LaTeX delimiters from heading text and convert known commands
 * to Unicode. Keeps the text readable in the mindmap.
 */
function stripLatex(text: string): string {
  // Replace $$...$$ (block math) first, then $...$ (inline math)
  let result = text.replace(/\$\$([^$]+?)\$\$/g, (_, expr) => convertLatex(expr));
  result = result.replace(/\$([^$]+?)\$/g, (_, expr) => convertLatex(expr));
  return result;
}

/** Convert a LaTeX expression body to plain text. */
function convertLatex(expr: string): string {
  let s = expr.trim();
  // Remove braces: {x} → x, but keep nested content
  s = s.replace(/\{([^{}]+)\}/g, "$1");
  s = s.replace(/[{}]/g, "");
  // Replace known commands
  for (const [cmd, unicode] of Object.entries(LATEX_UNICODE_MAP)) {
    s = s.replaceAll(cmd, unicode);
  }
  // Remove remaining backslash commands (e.g. \mathbb{R} → R)
  s = s.replace(/\\[a-zA-Z]+/g, "");
  // Clean up extra spaces
  s = s.replace(/\s+/g, " ").trim();
  return s || expr.trim();
}


export interface ChunkInfo {
  chunk_index: number;
  heading_level: 1 | 2 | 3 | 4 | 5 | 6;
  heading_text: string;
  slug_anchor: string;
}

export interface LayoutNode {
  chunk_index: number;
  heading_level: number;
  heading_text: string;
  slug_anchor: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const NODE_WIDTH = 210;
const LEVEL_GAP = 60; // vertical gap between root rows
const COLUMN_GAP_X = 56; // horizontal gap between successive heading levels
const ROW_GAP_Y = 10; // vertical gap between siblings
const PADDING_TOP = 32;
const PADDING_LEFT = 28;

// Dynamic node height estimation
const CHARS_PER_LINE = 13; // conservative estimate for CJK chars (~14px each)
const LINE_HEIGHT = 20; // px per text line
const TEXT_PAD_Y = 10; // vertical padding (top + bottom)
const MIN_NODE_HEIGHT = 36;

function calcNodeHeight(text: string): number {
  const lines = Math.ceil(text.length / CHARS_PER_LINE);
  return Math.max(MIN_NODE_HEIGHT, lines * LINE_HEIGHT + TEXT_PAD_Y);
}

/* ------------------------------------------------------------------ */
/*  Build tree from flat chunks (stack-based, arbitrary depth)        */
/* ------------------------------------------------------------------ */

export function buildTree(chunks: ChunkInfo[]): LayoutNode[] {
  const roots: LayoutNode[] = [];
  const stack: LayoutNode[] = [];

  function makeNode(chunk: ChunkInfo): LayoutNode {
    return {
      chunk_index: chunk.chunk_index,
      heading_level: chunk.heading_level,
      heading_text: chunk.heading_text,
      slug_anchor: chunk.slug_anchor,
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: calcNodeHeight(chunk.heading_text),
      children: [],
    };
  }

  for (const chunk of chunks) {
    const node = makeNode(chunk);

    // Pop stack until we find a parent whose level < current heading level
    while (stack.length > 0 && stack[stack.length - 1].heading_level >= chunk.heading_level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Level 1 heading or orphan — add as root
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return roots;
}

/* ------------------------------------------------------------------ */
/*  Layout: recursive N-level positioning                             */
/* ------------------------------------------------------------------ */

export interface LayoutBox {
  width: number;
  height: number;
}

/**
 * Measure the total vertical span of a node's subtree.
 */
function subtreeHeight(node: LayoutNode): number {
  if (node.children.length === 0) {
    return node.height;
  }
  let total = 0;
  for (const child of node.children) {
    total += subtreeHeight(child) + ROW_GAP_Y;
  }
  return Math.max(node.height, total - ROW_GAP_Y);
}

/**
 * Recursively position a node and its children.
 *
 * @param node    The node to position
 * @param x       Column x for this node
 * @param y       Center y for this node's block (the node itself is centered)
 */
function layoutNode(node: LayoutNode, x: number, y: number): void {
  const mySpan = subtreeHeight(node);

  // Center this node vertically within its subtree block
  node.x = x;
  node.y = y + (mySpan - node.height) / 2;

  if (node.children.length === 0) return;

  const childX = x + NODE_WIDTH + COLUMN_GAP_X;
  let childY = y;

  for (const child of node.children) {
    layoutNode(child, childX, childY);
    childY += subtreeHeight(child) + ROW_GAP_Y;
  }
}

/**
 * Measure the deepest width reachable from this node.
 */
function subtreeMaxX(node: LayoutNode): number {
  if (node.children.length === 0) return node.x + NODE_WIDTH;
  let mx = 0;
  for (const child of node.children) {
    mx = Math.max(mx, subtreeMaxX(child));
  }
  // Include the node itself in the width
  return Math.max(mx, node.x + NODE_WIDTH);
}

export function layoutTree(roots: LayoutNode[]): LayoutBox {
  let yCursor = PADDING_TOP;
  let maxWidth = PADDING_LEFT;

  for (const root of roots) {
    const span = subtreeHeight(root);
    layoutNode(root, PADDING_LEFT, yCursor);
    yCursor += span + LEVEL_GAP;

    const rightEdge = subtreeMaxX(root) + PADDING_LEFT;
    maxWidth = Math.max(maxWidth, rightEdge);
  }

  const totalHeight = yCursor - LEVEL_GAP + PADDING_TOP;
  return { width: maxWidth, height: Math.max(totalHeight, 200) };
}

/* ------------------------------------------------------------------ */
/*  Collapsed-chunks filter                                           */
/* ------------------------------------------------------------------ */

/**
 * Given a flat chunk list and a set of collapsed H1 slugs, filter out
 * all descendant chunks under each collapsed heading.
 * The collapsed heading itself is kept as a summary entry.
 *
 * Uses a single-pass stack-free approach: once a collapsed heading
 * is encountered, skip all subsequent headings with
 * `level > collapsedLevel` (i.e. its children).
 */
export function filterCollapsedChunks(
  chunks: ChunkInfo[],
  collapsedSlugs: Set<string>,
): ChunkInfo[] {
  const result: ChunkInfo[] = [];
  let skipUntilLevel = 0;

  for (const chunk of chunks) {
    if (skipUntilLevel > 0 && chunk.heading_level > skipUntilLevel) {
      continue;
    }
    skipUntilLevel = 0;

    if (collapsedSlugs.has(chunk.slug_anchor)) {
      result.push(chunk);
      skipUntilLevel = chunk.heading_level;
    } else {
      result.push(chunk);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Extract headings from raw markdown text (rehype-slug compatible)  */
/* ------------------------------------------------------------------ */

/**
 * Parse raw markdown and extract h1–h6 heading entries.
 * Uses github-slugger (same as rehype-slug) for slug generation.
 * Handles duplicate headings by numbering them (结论, 结论-1, …).
 */
export function extractHeadingsFromMarkdown(markdown: string): ChunkInfo[] {
  const lines = markdown.split("\n");
  const chunks: ChunkInfo[] = [];
  let chunkIndex = 0;
  const slugger = new BananaSlug();

  // Match H1 through H6
  const headingRe = /^(#{1,6})\s+(.+)/;
  const fenceRe = /^```/; // fenced code block start/end

  let inCodeBlock = false;

  for (const line of lines) {
    // Toggle code block state on ``` lines (must happen before heading check)
    if (fenceRe.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip headings inside code blocks
    if (inCodeBlock) continue;

    const m = line.match(headingRe);
    if (!m) continue;
    const level = m[1].length as 1 | 2 | 3 | 4 | 5 | 6;
    const text = m[2].trim();

    chunks.push({
      chunk_index: chunkIndex++,
      heading_level: level,
      heading_text: stripLatex(text),
      slug_anchor: slugger.slug(text),
    });
  }

  // Auto-promote headings: if no H1 exists, shift all levels up
  // so the shallowest heading becomes the root level.
  if (chunks.length > 0) {
    const minLevel = Math.min(...chunks.map(c => c.heading_level));
    if (minLevel > 1) {
      const shift = minLevel - 1;
      for (const chunk of chunks) {
        chunk.heading_level = Math.max(1, chunk.heading_level - shift) as 1|2|3|4|5|6;
      }
    }
  }

  return chunks;
}