/**
 * On-device embedding engine using Transformers.js.
 *
 * spec.md §4.3 — 6-state DFA:
 *   UNLOADED → CHECKING_CACHE → DOWNLOADING / LOADING_WASM → READY / FAILED
 *
 * Heavy operations (pipeline init, embed computation) are gated behind
 * a global pipeline singleton to avoid repeated WASM loads.
 *
 * Fallback behaviour:
 *   If the model fails to load → the consumer falls back to FTS5-only search.
 *   If embed() is called while still loading → it queues and resolves in order.
 */

import { hasModel, readModel, writeModel } from "./modelCache";
import type { EmbedFn } from "@/components/SearchPanel";

/* ------------------------------------------------------------------ */
/*  DFA state type                                                     */
/* ------------------------------------------------------------------ */

export type EmbeddingState =
  | "UNLOADED"
  | "CHECKING_CACHE"
  | "DOWNLOADING"
  | "LOADING_WASM"
  | "READY"
  | "FAILED";

/* ------------------------------------------------------------------ */
/*  EmbeddingEngine — singleton wrapper around Transformers.js        */
/* ------------------------------------------------------------------ */

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

/** Global singleton pipeline reference. */
let pipelineInstance: unknown = null;
let pipelinePromise: Promise<unknown> | null = null;

/**
 * Lazy-init the Transformers.js pipeline.
 * Returns the cached instance if already loaded.
 */
async function getPipeline(): Promise<unknown> {
  if (pipelineInstance) return pipelineInstance;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    // Dynamic import — Transformers.js is ESM-only and large
    const { pipeline } = await import(
      "@huggingface/transformers"
    );
    const pipe = await pipeline("feature-extraction", MODEL_NAME, {
      quantized: true,
    } as Record<string, unknown>);
    pipelineInstance = pipe;
    return pipe;
  })();

  return pipelinePromise;
}

/* ------------------------------------------------------------------ */
/*  EmbeddingEngine class                                              */
/* ------------------------------------------------------------------ */

export class EmbeddingEngine {
  private _state: EmbeddingState = "UNLOADED";
  private _queue: Array<{
    resolve: (vec: Float32Array) => void;
    reject: (err: unknown) => void;
    text: string;
  }> = [];
  private _processing = false;

  get state(): EmbeddingState {
    return this._state;
  }

  /* -- state transitions -- */

  private setState(s: EmbeddingState) {
    this._state = s;
  }

  /* -- public API -- */

  /** Called once to initialise the engine (cache check → download → WASM load). */
  async init(): Promise<void> {
    if (this._state !== "UNLOADED") return;

    this.setState("CHECKING_CACHE");

    try {
      const cached = await hasModel(MODEL_NAME);

      if (cached) {
        // M2: CACHE_HIT → LOADING_WASM
        this.setState("LOADING_WASM");
      } else {
        // M3: CACHE_MISS → DOWNLOADING
        this.setState("DOWNLOADING");
        // Trigger download by loading pipeline (Transformers.js handles download)
      }

      // Load the pipeline (may download if not cached)
      await getPipeline();

      // If we were in DOWNLOADING, store the model bytes into IndexedDB
      if (this._state as string === "DOWNLOADING") {
        // M5: DOWNLOAD_COMPLETE → LOADING_WASM → store in cache
        // Transformers.js 3.x stores models in its internal cache;
        // we attempt to pull from its cache dir if accessible
        try {
          // The HF Transformers library uses its own cache, so we mark
          // that we've completed the download. For actual IndexedDB
          // persistence we'd need access to the model files, which
          // Transformers.js 3.x may not expose directly.
          // As a best-effort, we write a sentinel record.
          await writeModel(MODEL_NAME, new ArrayBuffer(0));
        } catch {
          // Non-critical — pipeline is loaded regardless
        }
      }

      // M7: WASM_READY → READY
      this.setState("READY");
    } catch (err) {
      // M6 / M8: DOWNLOAD_FAIL / WASM_FAIL → FAILED
      this.setState("FAILED");
      this.drainQueue(err);
      throw err;
    }
  }

  /**
   * Compute a 384-dim embedding from `text`.
   * If engine is READY it returns immediately.
   * If still loading it enqueues and resolves after init completes.
   */
  embed: EmbedFn = async (text: string): Promise<Float32Array> => {
    return new Promise<Float32Array>((resolve, reject) => {
      this._queue.push({ resolve, reject, text });
      this.processQueue();
    });
  };

  /* -- queue processing -- */

  private async processQueue(): Promise<void> {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const item = this._queue.shift()!;

      if (this._state === "FAILED") {
        item.reject(new Error("Embedding engine failed"));
        continue;
      }

      if (this._state !== "READY") {
        try {
          await this.init();
        } catch {
          item.reject(new Error("Embedding engine failed"));
          continue;
        }
      }

      try {
        const pipe = await getPipeline();
        const output = await (pipe as (text: string, options?: unknown) => PromiseLike<{ data: Float32Array }>)(
          item.text,
          { pooling: "mean", normalize: true },
        );
        item.resolve(output.data);
      } catch (err) {
        item.reject(err);
      }
    }

    this._processing = false;
  }

  /** Reject all queued items (used on failure). */
  private drainQueue(err: unknown): void {
    while (this._queue.length > 0) {
      const item = this._queue.shift()!;
      item.reject(err);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Global singleton + helper for embed()                             */
/* ------------------------------------------------------------------ */

let _engine: EmbeddingEngine | null = null;

function getEngine(): EmbeddingEngine {
  if (!_engine) {
    _engine = new EmbeddingEngine();
  }
  return _engine;
}

/**
 * High-level embed function.
 *
 * Lazy-inits the engine on first call. Subsequent calls reuse the
 * cached pipeline.
 *
 * On failure → throws (caller falls back to FTS5-only).
 */
export async function embed(text: string): Promise<Float32Array> {
  const engine = getEngine();
  return engine.embed(text);
}

/**
 * Get the current engine state (for UI binding, e.g. terminal effect).
 */
export function getEmbeddingState(): EmbeddingState {
  if (!_engine) return "UNLOADED";
  return _engine.state;
}