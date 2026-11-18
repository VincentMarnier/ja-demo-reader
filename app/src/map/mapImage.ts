import {
  isDrawableShader,
  parseBsp,
  renderMinimap,
  type MinimapImage,
  type Rgb
} from './bsp';
import { findZipEntries, findZipEntriesBySuffix, readZipEntry, type ZipEntry } from './zipReader';
import { parseShaderScripts, textureCandidates } from './shaderScripts';

/**
 * Builds the minimap background for a map from the user's own PK3s.
 *
 * The BSP is read straight from the PK3 that contains it, and each world
 * shader's texture is decoded once to a small average colour.  Shaders defined
 * by a .shader script (whose name does not match an image file) fall back to
 * the script's first stage map or qer_editorimage.  The engine does not need to
 * be involved, so the image is ready while the demo plays and is generated once
 * per map.
 */

const CACHE_LIMIT = 3;
const TEXTURE_SIZE = 16;
const DECODE_CONCURRENCY = 6;

const cache = new Map<string, MinimapImage | null>();
const pending = new Map<string, Promise<MinimapImage | null>>();

function fileName(blob: Blob): string {
  return (blob as File).name ?? '';
}

/** `mp/ffa2`, `maps/mp/ffa2.bsp` and `MP/FFA2` are the same map. */
function normalizeMapName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/^maps\//, '')
    .replace(/\.bsp$/, '');
}

function signature(files: readonly Blob[]): string {
  return files
    .map(file => `${fileName(file).toLowerCase()}:${file.size}`)
    .sort()
    .join('|');
}

/** Engine load order: sorted archive names, later archives override earlier ones. */
function sortedArchives(files: readonly Blob[]): Blob[] {
  return [...files]
    .filter(file => file.size > 0)
    .sort((a, b) => fileName(a).localeCompare(fileName(b), 'en', { sensitivity: 'base' }));
}

async function averageTexture(blob: Blob): Promise<Rgb | null> {
  try {
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: TEXTURE_SIZE,
      resizeHeight: TEXTURE_SIZE,
      resizeQuality: 'low'
    });
    const canvas = new OffscreenCanvas(TEXTURE_SIZE, TEXTURE_SIZE);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3] / 255;
      if (alpha <= 0) continue;
      red += pixels[i] * alpha;
      green += pixels[i + 1] * alpha;
      blue += pixels[i + 2] * alpha;
      weight += alpha;
    }
    if (weight === 0) return null;
    return [red / weight, green / weight, blue / weight];
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildMapImage(mapName: string, files: readonly Blob[]): Promise<MinimapImage | null> {
  const archives = sortedArchives(files);
  if (archives.length === 0) return null;

  const bspName = `maps/${normalizeMapName(mapName)}.bsp`;
  let bspEntry: ZipEntry | null = null;
  for (const archive of archives) {
    const found = await findZipEntries(archive, new Set([bspName]));
    const entry = found.get(bspName);
    if (entry) bspEntry = entry;
  }
  if (!bspEntry) return null;

  const bspBytes = await readZipEntry(bspEntry);
  if (bspBytes.length === 0) return null;
  const world = parseBsp(
    bspBytes.buffer.slice(bspBytes.byteOffset, bspBytes.byteOffset + bspBytes.byteLength) as ArrayBuffer
  );
  if (!world) return null;

  const shaderNames: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < world.shaderNames.length; i++) {
    const name = world.shaderNames[i];
    if (!name || seen.has(name) || !isDrawableShader(name, world.shaderFlags[i])) continue;
    seen.add(name);
    shaderNames.push(name);
  }

  // Candidate image path per shader, in priority order.  A direct name match
  // is the common case; unresolved names get one entry from the shader scripts.
  const candidates = new Map<string, string[]>();
  const wanted = new Set<string>();
  for (const name of shaderNames) {
    const paths = ['.jpg', '.png'].map(extension => `${name.toLowerCase()}${extension}`);
    candidates.set(name, paths);
    for (const path of paths) wanted.add(path);
  }

  const entries = new Map<string, ZipEntry>();
  const scan = async (paths: ReadonlySet<string>): Promise<void> => {
    for (const archive of archives) {
      const found = await findZipEntries(archive, paths);
      for (const [path, entry] of found) entries.set(path, entry);
    }
  };
  await scan(wanted);

  const hasTexture = (name: string): boolean =>
    (candidates.get(name) ?? []).some(path => entries.has(path));
  const unresolved = shaderNames.filter(name => !hasTexture(name));

  if (unresolved.length > 0) {
    const scripts: string[] = [];
    for (const archive of archives) {
      const found = await findZipEntriesBySuffix(archive, '.shader');
      for (const entry of [...found.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        try {
          const bytes = await readZipEntry(entry);
          if (bytes.length > 0) scripts.push(new TextDecoder().decode(bytes));
        } catch {
          // A broken script should not prevent the map image.
        }
      }
    }
    const definitions = new Map<string, string>();
    parseShaderScripts(scripts, definitions);

    const extra = new Set<string>();
    for (const name of unresolved) {
      const image = definitions.get(name.toLowerCase());
      if (!image) continue;
      const paths = textureCandidates(image);
      candidates.set(name, [...(candidates.get(name) ?? []), ...paths]);
      for (const path of paths) extra.add(path);
    }
    if (extra.size > 0) await scan(extra);
  }

  const chosen = new Map<string, ZipEntry>();
  for (const name of shaderNames) {
    for (const path of candidates.get(name) ?? []) {
      const entry = entries.get(path);
      if (entry) {
        chosen.set(name, entry);
        break;
      }
    }
  }

  const colors = new Map<string, Rgb>();
  const names = [...chosen.keys()];
  const decoded = await mapLimit(names, DECODE_CONCURRENCY, async name => {
    const entry = chosen.get(name);
    if (!entry) return null;
    try {
      const data = await readZipEntry(entry);
      if (data.length === 0) return null;
      return await averageTexture(new Blob([data]));
    } catch {
      return null;
    }
  });
  names.forEach((name, index) => {
    const color = decoded[index];
    if (color) colors.set(name, color);
  });

  return renderMinimap(world, colors);
}

export function loadMapImage(mapName: string, files: readonly Blob[]): Promise<MinimapImage | null> {
  const key = `${normalizeMapName(mapName)}|${signature(files)}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const running = pending.get(key);
  if (running) return running;

  const task = buildMapImage(mapName, files)
    .catch(() => null)
    .then(image => {
      pending.delete(key);
      cache.set(key, image);
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return image;
    });
  pending.set(key, task);
  return task;
}

export function clearMapImageCache(): void {
  cache.clear();
  pending.clear();
}
