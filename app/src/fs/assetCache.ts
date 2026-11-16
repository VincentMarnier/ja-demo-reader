import type { LocalFile } from '../types';

const ROOT = 'jka-demo-player';
const ASSETS = 'assets';
const MANIFEST = 'manifest.json';

interface AssetManifest {
  key: string;
  label: string;
  savedAt: number;
  files: Array<{ name: string; size: number; lastModified: number }>;
}

export interface CachedAssets {
  key: string;
  label: string;
  savedAt: number;
  files: LocalFile[];
}

function storage(): StorageManager | null {
  if (typeof navigator === 'undefined' || !navigator.storage) return null;
  return navigator.storage;
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  const manager = storage();
  if (!manager || typeof manager.getDirectory !== 'function') return null;
  try {
    return await manager.getDirectory();
  } catch {
    return null;
  }
}

export function assetCacheKey(files: LocalFile[]): string {
  return files
    .map(file => `${file.name}:${file.file.size}:${file.file.lastModified}`)
    .sort()
    .join('|');
}

async function assetsRoot(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await opfsRoot();
  if (!root) return null;
  try {
    const cache = await root.getDirectoryHandle(ROOT, { create });
    return await cache.getDirectoryHandle(ASSETS, { create });
  } catch {
    return null;
  }
}

function childHandles(dir: FileSystemDirectoryHandle): AsyncIterableIterator<FileSystemDirectoryHandle> {
  return (dir as unknown as {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle>;
  }).values();
}

async function readManifest(dir: FileSystemDirectoryHandle): Promise<AssetManifest | null> {
  try {
    const handle = await dir.getFileHandle(MANIFEST);
    const file = await handle.getFile();
    const parsed = JSON.parse(await file.text()) as AssetManifest;
    if (!parsed || !Array.isArray(parsed.files) || typeof parsed.key !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadCachedAssets(): Promise<CachedAssets | null> {
  const root = await assetsRoot(false);
  if (!root) return null;
  let best: { dir: FileSystemDirectoryHandle; manifest: AssetManifest } | null = null;
  try {
    for await (const handle of childHandles(root)) {
      if (handle.kind !== 'directory') continue;
      const manifest = await readManifest(handle);
      if (!manifest) continue;
      if (!best || manifest.savedAt > best.manifest.savedAt) {
        best = { dir: handle, manifest };
      }
    }
  } catch {
    return null;
  }
  if (!best) return null;

  const files: LocalFile[] = [];
  try {
    for (const entry of best.manifest.files) {
      const handle = await best.dir.getFileHandle(entry.name);
      const file = await handle.getFile();
      if (file.size !== entry.size) return null;
      files.push({ name: entry.name, file });
    }
  } catch {
    return null;
  }
  return {
    key: best.manifest.key,
    label: best.manifest.label,
    savedAt: best.manifest.savedAt,
    files
  };
}

export interface CacheProgress {
  loaded: number;
  total: number;
}

export async function saveAssetFiles(
  files: LocalFile[],
  label: string,
  onProgress?: (progress: CacheProgress) => void
): Promise<CachedAssets | null> {
  const root = await assetsRoot(true);
  if (!root) return null;

  const key = assetCacheKey(files);
  const total = files.reduce((sum, file) => sum + file.file.size, 0);
  let loaded = 0;

  const manager = storage();
  if (manager?.estimate) {
    try {
      const estimate = await manager.estimate();
      if (estimate.quota && estimate.usage && estimate.quota - estimate.usage < total * 1.2) {
        return null;
      }
      await manager.persist?.().catch(() => undefined);
    } catch {
      // Quota information is best-effort.
    }
  }

  let target: FileSystemDirectoryHandle;
  try {
    target = await root.getDirectoryHandle(key, { create: true });
  } catch {
    return null;
  }

  const manifest: AssetManifest = {
    key,
    label,
    savedAt: Date.now(),
    files: files.map(file => ({
      name: file.name,
      size: file.file.size,
      lastModified: file.file.lastModified
    }))
  };

  try {
    for (const file of files) {
      const handle = await target.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.file);
      await writable.close();
      loaded += file.file.size;
      onProgress?.({ loaded, total });
    }
    const handle = await target.getFileHandle(MANIFEST, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(manifest));
    await writable.close();
  } catch {
    return null;
  }

  // Keep the new set and drop older ones only after the manifest is complete.
  try {
    for await (const handle of childHandles(root)) {
      if (handle.kind === 'directory' && handle.name !== key) {
        await root.removeEntry(handle.name, { recursive: true }).catch(() => undefined);
      }
    }
  } catch {
    // Old cache entries are harmless.
  }

  return {
    key,
    label,
    savedAt: manifest.savedAt,
    files
  };
}

export async function clearAssetCache(): Promise<void> {
  const manager = storage();
  const root = await opfsRoot();
  if (!manager || !root) return;
  try {
    const cache = await root.getDirectoryHandle(ROOT);
    await cache.removeEntry(ASSETS, { recursive: true });
  } catch {
    // Nothing cached.
  }
}
