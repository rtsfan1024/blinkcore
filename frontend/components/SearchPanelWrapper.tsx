"use client";

import dynamic from "next/dynamic";
import type { EmbedFn } from "@/components/SearchPanel";

const SearchPanel = dynamic(() => import("@/components/SearchPanel"), {
  ssr: false,
});

/**
 * Lazy import the embedding engine so Transformers.js (large ESM) is
 * only loaded on first Cmd+K invocation.
 */
let _embedFn: EmbedFn | null = null;

async function getEmbedFn(): Promise<EmbedFn> {
  if (!_embedFn) {
    const mod = await import("@/lib/embedding");
    _embedFn = mod.embed;
  }
  return _embedFn;
}

export default function SearchPanelWrapper() {
  return <SearchPanel embedFnPromise={getEmbedFn} />;
}