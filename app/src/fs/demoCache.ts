import type { DemoSummary } from '../types';

const DB_NAME = 'jka-demo-player';
const DB_VERSION = 1;
const STORE = 'demo-summaries';

interface StoredSummary {
  key: string;
  savedAt: number;
  summary: DemoSummary;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function isValid(summary: unknown): summary is DemoSummary {
  if (!summary || typeof summary !== 'object') return false;
  const value = summary as DemoSummary;
  return (
    Number.isFinite(value.first) &&
    Number.isFinite(value.duration) &&
    Array.isArray(value.games)
  );
}

export async function loadDemoSummary(key: string): Promise<DemoSummary | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => {
      const record = request.result as StoredSummary | undefined;
      resolve(record && isValid(record.summary) ? record.summary : null);
    };
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
  });
}

export async function saveDemoSummary(key: string, summary: DemoSummary): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    const record: StoredSummary = { key, savedAt: Date.now(), summary };
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      resolve();
    };
  });
}

export async function clearDemoSummaries(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}
