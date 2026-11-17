import type { LocalFile } from '../types';

/**
 * Stable identity for a set of selected files.  Used to compare the assets a
 * running engine was mounted with; it is no longer a cache key because no
 * asset copy is written to browser storage.
 */
export function assetSetKey(files: LocalFile[]): string {
  return files
    .map(file => `${file.name}:${file.file.size}:${file.file.lastModified}`)
    .sort()
    .join('|');
}
