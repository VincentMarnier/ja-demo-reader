/**
 * M9 Phase 3: the OPFS asset cache is gone.  This module only removes the
 * tree left by older builds (`jka-demo-player/assets/<key>/...`, about 1.14 GB
 * for the retail PK3s) so existing users recover the storage once.  Parsed
 * demo summaries live in IndexedDB and are handled by demoCache.ts.
 */

const LEGACY_ROOT = 'jka-demo-player';
const LEGACY_ASSETS = 'assets';

function storage(): StorageManager | null {
  if (typeof navigator === 'undefined' || !navigator.storage) return null;
  return navigator.storage;
}

/**
 * Deletes the legacy OPFS asset tree.  Returns true when a tree was present
 * and removed.  Never creates the directory.
 */
export async function clearLegacyAssetCache(): Promise<boolean> {
  const manager = storage();
  if (!manager || typeof manager.getDirectory !== 'function') return false;

  let root: FileSystemDirectoryHandle;
  try {
    root = await manager.getDirectory();
  } catch {
    return false;
  }

  let cache: FileSystemDirectoryHandle;
  try {
    cache = await root.getDirectoryHandle(LEGACY_ROOT);
  } catch {
    return false;
  }

  try {
    await cache.getDirectoryHandle(LEGACY_ASSETS);
  } catch {
    return false;
  }

  try {
    await cache.removeEntry(LEGACY_ASSETS, { recursive: true });
    return true;
  } catch {
    return false;
  }
}
