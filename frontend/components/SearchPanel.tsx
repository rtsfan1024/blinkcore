"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TerminalEffect from "./TerminalEffect";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SearchState =
  | "CLOSED"
  | "OPEN_EMPTY"
  | "OPEN_TYPING"
  | "EMBEDDING"
  | "API_PENDING"
  | "RESULTS"
  | "ERROR";

export interface SearchResultItem {
  slug: string;
  title: string;
  heading_text: string;
  slug_anchor: string;
  snippet: string;
  jump_url: string;
  rrf_score: number;
}

export interface SearchResponse {
  mode: "hybrid" | "fts_only";
  results: SearchResultItem[];
}

export type EmbedFn = (text: string) => Promise<Float32Array>;

/* ------------------------------------------------------------------ */
/*  Default embed placeholder                                           */
/* ------------------------------------------------------------------ */

const FAKE_EMBED: EmbedFn = async () => new Float32Array(384);

/* ------------------------------------------------------------------ */
/*  SearchPanel props                                                  */
/* ------------------------------------------------------------------ */

interface SearchPanelProps {
  /** Lazy-loading promise for the embedding function. */
  embedFnPromise?: () => Promise<EmbedFn>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function SearchPanel({
  embedFnPromise,
}: SearchPanelProps) {
  const router = useRouter();

  /* ---- DFA state ---- */
  const [state, setState] = useState<SearchState>("CLOSED");
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const embedFnRef = useRef<EmbedFn | null>(null);

  /* ---- Refs ---- */
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ---- helpers ---- */

  const clearDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const cancelApi = useCallback(() => {
    if (abortRef.current !== null) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const resetToOpenEmpty = useCallback(() => {
    clearDebounce();
    cancelApi();
    setInputValue("");
    setResults([]);
    setErrorMessage("");
    setSelectedIndex(0);
    setState("OPEN_EMPTY");
  }, [clearDebounce, cancelApi]);

  const sendSearchRequest = useCallback(
    async (text: string, vector: Float32Array | null) => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body: Record<string, unknown> = { query_text: text };
        if (vector !== null) {
          body.query_vector = Array.from(vector);
        }

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/v1/public/search`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );

        if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        }

        const data: SearchResponse = await res.json();
        // T6: API_RESPONSE → RESULTS
        setResults(data.results);
        setSelectedIndex(0);
        setState("RESULTS");
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // T8: API_ERROR → ERROR
        setErrorMessage("API unreachable. Check connection and try again.");
        setState("ERROR");
      }
    },
    [],
  );

  /* ---- event: TYPE_CHAR (T2, T3, T9, T10) ---- */

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);

      // From ERROR (T9) or RESULTS (T10) → OPEN_TYPING
      if (state === "ERROR" || state === "RESULTS") {
        setResults([]);
        setErrorMessage("");
      }

      setState("OPEN_TYPING");
      clearDebounce();

      if (value.length > 0) {
        debounceRef.current = setTimeout(async () => {
          // T4: DEBOUNCE_FIRE → EMBEDDING
          setState("EMBEDDING");

          // Lazy-resolve the embed function
          let fn: EmbedFn;
          if (embedFnPromise) {
            try {
              const mod = await embedFnPromise();
              fn = mod;
            } catch {
              fn = FAKE_EMBED;
            }
          } else {
            fn = FAKE_EMBED;
          }
          embedFnRef.current = fn;

          fn(value)
            .then((vec) => {
              // T5: EMBED_COMPLETE → API_PENDING
              setState("API_PENDING");
              sendSearchRequest(value, vec);
            })
            .catch(() => {
              // T7: EMBED_FAIL → API_PENDING (FTS5-only fallback)
              setState("API_PENDING");
              sendSearchRequest(value, null);
            });
        }, 300);
      }
    },
    [state, clearDebounce, embedFnPromise, sendSearchRequest],
  );

  /* ---- event: SELECT_RESULT (T11) ---- */

  const navigateToResult = useCallback(
    (result: SearchResultItem) => {
      if (state === "RESULTS") {
        cancelApi();
        clearDebounce();
        setState("CLOSED");
        router.push(result.jump_url);
      }
    },
    [state, cancelApi, clearDebounce, router],
  );

  /* ---- event: CMD_K (T1) ---- */

  const open = useCallback(() => {
    if (state === "CLOSED") {
      resetToOpenEmpty();
    }
  }, [state, resetToOpenEmpty]);

  /* ---- event: ESCAPE (T12, T14, T15, T18, T19, T20) ---- */

  const close = useCallback(() => {
    cancelApi();
    clearDebounce();
    setState("CLOSED");
  }, [cancelApi, clearDebounce]);

  /* ---- Global keyboard: Cmd+K ---- */

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (state === "CLOSED") {
          resetToOpenEmpty();
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* ---- ESC specific handler ---- */

  useEffect(() => {
    if (state === "CLOSED") return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, close]);

  /* ---- Keyboard navigation within RESULTS ---- */

  useEffect(() => {
    if (state !== "RESULTS") return;

    function handler(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        navigateToResult(results[selectedIndex]);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, results, selectedIndex, navigateToResult]);

  /* ---- Click outside (T13, T16, T17, T21) ---- */

  useEffect(() => {
    if (state === "CLOSED") return;

    function handler(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        close();
      }
    }

    // Use mousedown to fire before any potential focus change
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [state, close]);

  /* ---- Auto-focus input when open ---- */

  useEffect(() => {
    if (
      (state === "OPEN_EMPTY" || state === "OPEN_TYPING") &&
      inputRef.current
    ) {
      inputRef.current.focus();
    }
  }, [state]);

  /* ---- Render nothing when closed ---- */

  if (state === "CLOSED") {
    return null;
  }

  /* ---- Decide terminal visibility ---- */

  const showTerminal =
    state === "EMBEDDING" || state === "API_PENDING";

  return (
    /* Overlay backdrop */
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]">
      {/* Panel */}
      <div
        ref={panelRef}
        className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] shadow-2xl"
      >
        {/* Input row */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <svg
            className="h-4 w-4 shrink-0 text-[var(--text-secondary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
            placeholder="Search articles..."
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
          />
          <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Terminal effect during EMBEDDING / API_PENDING */}
        {showTerminal && (
          <div className="border-b border-[var(--border)] px-4 py-2">
            <TerminalEffect
              visible
              inputLength={inputValue.length}
            />
          </div>
        )}

        {/* Results list */}
        {state === "RESULTS" && results.length > 0 && (
          <ul className="max-h-64 overflow-y-auto py-2">
            {results.map((item, idx) => (
              <li key={`${item.slug}-${item.slug_anchor}`}>
                <button
                  type="button"
                  className={`flex w-full flex-col gap-0.5 px-4 py-2 text-left transition-colors ${
                    idx === selectedIndex
                      ? "bg-[var(--accent)]/10"
                      : "hover:bg-[var(--bg-secondary)]"
                  }`}
                  onClick={() => navigateToResult(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {item.title}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {item.heading_text}
                  </span>
                  <span
                    className="text-xs text-[var(--text-secondary)] line-clamp-1"
                    dangerouslySetInnerHTML={{ __html: item.snippet }}
                  />
                  <span className="text-[10px] text-[var(--accent)]">
                    {item.jump_url}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Results empty state */}
        {state === "RESULTS" && results.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
            No results found.
          </div>
        )}

        {/* Error state */}
        {state === "ERROR" && (
          <div className="px-4 py-6 text-center text-sm text-[var(--error)]">
            {errorMessage}
          </div>
        )}

        {/* Footer hint */}
        <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--text-secondary)]">
          {state === "EMBEDDING" && "Embedding query..."}
          {state === "API_PENDING" && "Fetching results..."}
          {state === "OPEN_EMPTY" && "Type to search"}
          {state === "OPEN_TYPING" && "Typing..."}
          {state === "RESULTS" &&
            `Found ${results.length} result${results.length !== 1 ? "s" : ""}`}
          {state === "ERROR" && "Search failed"}
        </div>
      </div>
    </div>
  );
}