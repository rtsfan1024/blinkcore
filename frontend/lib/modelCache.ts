/**
 * Model Cache — IndexedDB-backed storage for Transformers.js model blobs.
 *
 * spec.md §4.3: Cache check / store lifecycle.
 *
 * Key design decisions:
 * - Single-object store keyed by model name (e.g. "Xenova/all-MiniLM-L6-v2").
 * - Stores the full model data as a single `ArrayBuffer` blob (quantized ~23 MB).
 * - The entire check/read/write API is Promise-based.
 */

const DB_NAME = "blinkcore-model-cache";
const DB_VERSION = 1;
const STORE_NAME = "models";

/** Open (or create) the IndexedDB database. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface CacheEntry {
  modelName: string;
  data: ArrayBuffer;
  cachedAt: number; // unix ts
}

/**
 * Check whether `modelName` exists in cache.
 * Returns true if a record exists.
 */
export async function hasModel(modelName: string): Promise<boolean> {
  const db = await openDb();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.count(modelName);
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Read cached model data for `modelName`.
 * Returns ArrayBuffer or null if missing.
 */
export async function readModel(
  modelName: string,
): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(modelName);
    req.onsuccess = () => {
      const entry = req.result as CacheEntry | undefined;
      resolve(entry?.data ?? null);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Write model data into cache.
 */
export async function writeModel(
  modelName: string,
  data: ArrayBuffer,
): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const entry: CacheEntry = {
      modelName,
      data,
      cachedAt: Date.now(),
    };
    store.put(entry, modelName);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}