import type { DemoSummary } from '../types';

const DB_NAME = 'jka-demo-player';
const DB_VERSION = 2;
const STORE = 'demo-summaries';

interface StoredSummary {
  key: string;
  savedAt: number;
  summary: DemoSummary;
}

function openOnce(): Promise<IDBDatabase | null> {
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

function deleteDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function openDb(): Promise<IDBDatabase | null> {
  let db = await openOnce();
  if (db && !db.objectStoreNames.contains(STORE)) {
    // Older/broken databases can exist without the store. Recreate the cache
    // database rather than failing every transaction with NotFoundError.
    db.close();
    await deleteDatabase();
    db = await openOnce();
  }
  return db;
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
  try {
    return await new Promise(resolve => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => {
        const record = request.result as StoredSummary | undefined;
        resolve(record && isValid(record.summary) ? record.summary : null);
      };
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    db.close();
    return null;
  }
}

export async function saveDemoSummary(key: string, summary: DemoSummary): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
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
  } catch {
    db.close();
  }
}

export async function clearDemoSummaries(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
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
  } catch {
    db.close();
  }
}
