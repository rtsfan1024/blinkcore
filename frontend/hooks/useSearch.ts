"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
/*  Default embed placeholder (resolves immediately)                   */
/* ------------------------------------------------------------------ */

const FAKE_EMBED: EmbedFn = async () => new Float32Array(384);

/* ------------------------------------------------------------------ */
/*  useSearch — 21-rule DFA implementation                            */
/* ------------------------------------------------------------------ */

export function useSearch(embedFn: EmbedFn = FAKE_EMBED) {
  const [state, setState] = useState<SearchState>("CLOSED");
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputLengthRef = useRef(0);

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

  /* ---- event dispatchers ---- */

  /** T2, T3, T9, T10 — TYPE_CHAR */
  const typeChar = useCallback(
    (value: string) => {
      setInputValue(value);
      inputLengthRef.current = value.length;

      // From ERROR (T9) or RESULTS (T10) → OPEN_TYPING
      if (state === "ERROR" || state === "RESULTS") {
        setResults([]);
        setErrorMessage("");
      }

      setState("OPEN_TYPING");

      // Restart debounce for T3/T4
      clearDebounce();
      if (value.length > 0) {
        debounceRef.current = setTimeout(() => {
          // T4: DEBOUNCE_FIRE → EMBEDDING
          setState("EMBEDDING");

          embedFn(value)
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
    [state, clearDebounce, embedFn, sendSearchRequest],
  );

  /** T1 — CMD_K: CLOSED → OPEN_EMPTY */
  const open = useCallback(() => {
    if (state === "CLOSED") {
      setInputValue("");
      setResults([]);
      setErrorMessage("");
      setState("OPEN_EMPTY");
    }
  }, [state]);

  /** T11 — SELECT_RESULT: RESULTS → CLOSED */
  const selectResult = useCallback(() => {
    if (state === "RESULTS") {
      cancelApi();
      clearDebounce();
      setState("CLOSED");
    }
  }, [state, cancelApi, clearDebounce]);

  /** T12, T14, T15, T18, T19, T20 — ESCAPE → CLOSED */
  const close = useCallback(() => {
    cancelApi();
    clearDebounce();
    setState("CLOSED");
  }, [cancelApi, clearDebounce]);

  /** T13, T16, T17, T21 — CLICK_OUTSIDE → CLOSED */
  const clickOutside = useCallback(() => {
    if (
      state === "OPEN_EMPTY" || // T16
      state === "RESULTS" || // T13
      state === "ERROR" || // T21
      state === "OPEN_TYPING" // T17
    ) {
      cancelApi();
      clearDebounce();
      setState("CLOSED");
    }
  }, [state, cancelApi, clearDebounce]);

  /** Cmd+K global listener */
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  /** ESC key listener */
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

  return {
    state,
    inputValue,
    results,
    errorMessage,
    typeChar,
    open,
    close,
    selectResult,
    clickOutside,
  };
}