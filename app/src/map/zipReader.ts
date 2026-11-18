/**
 * Minimal read-only ZIP reader for PK3 archives.
 *
 * The app already has the user's File objects on the page, so the minimap can
 * read the BSP and the map's texture averages without asking the engine.  Only
 * what the map image needs is implemented: a central-directory lookup by exact
 * (lower-case) entry name and a stored/deflate-raw read.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipEntry {
  archive: Blob;
  /** Lower-case entry name, e.g. maps/ffa_crypt.bsp. */
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

/** How many bytes at the end of the archive can hold the EOCD record. */
const EOCD_SEARCH = 66_000;

async function readEocd(zip: Blob): Promise<{ total: number; cdSize: number; cdOffset: number } | null> {
  if (zip.size < 22) return null;
  const length = Math.min(zip.size, EOCD_SEARCH);
  const view = new DataView(await zip.slice(zip.size - length).arrayBuffer());
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIGNATURE) continue;
    const total = view.getUint16(i + 10, true);
    const cdSize = view.getUint32(i + 12, true);
    const cdOffset = view.getUint32(i + 16, true);
    // ZIP64 (a >65k-entry archive) would need the extra record; retail and
    // community PK3s stay well below both limits.
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
    return { total, cdSize, cdOffset };
  }
  return null;
}

/**
 * Collects the wanted entries from one archive.  Matching is exact on
 * lower-case names so a missing map texture costs one directory pass, not a
 * per-name scan of every entry.
 */
export async function findZipEntries(
  zip: Blob,
  wanted: ReadonlySet<string>
): Promise<Map<string, ZipEntry>> {
  return scanCentralDirectory(zip, name => wanted.has(name));
}

/** Collects every entry whose name ends with `suffix` (lower-case). */
export async function findZipEntriesBySuffix(
  zip: Blob,
  suffix: string
): Promise<Map<string, ZipEntry>> {
  return scanCentralDirectory(zip, name => name.endsWith(suffix));
}

async function scanCentralDirectory(
  zip: Blob,
  predicate: (name: string) => boolean
): Promise<Map<string, ZipEntry>> {
  const found = new Map<string, ZipEntry>();
  if (zip.size === 0) return found;
  const eocd = await readEocd(zip);
  if (!eocd || eocd.cdSize === 0 || eocd.cdOffset + eocd.cdSize > zip.size) return found;

  const directory = new DataView(
    await zip.slice(eocd.cdOffset, eocd.cdOffset + eocd.cdSize).arrayBuffer()
  );
  const decoder = new TextDecoder();
  let offset = 0;

  for (let index = 0; index < eocd.total; index++) {
    if (offset + 46 > directory.byteLength) break;
    if (directory.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const method = directory.getUint16(offset + 10, true);
    const compressedSize = directory.getUint32(offset + 20, true);
    const size = directory.getUint32(offset + 24, true);
    const nameLength = directory.getUint16(offset + 28, true);
    const extraLength = directory.getUint16(offset + 30, true);
    const commentLength = directory.getUint16(offset + 32, true);
    const localOffset = directory.getUint32(offset + 42, true);

    if (offset + 46 + nameLength <= directory.byteLength) {
      const name = decoder.decode(
        new Uint8Array(directory.buffer, directory.byteOffset + offset + 46, nameLength)
      ).toLowerCase();
      if (predicate(name)) {
        found.set(name, { archive: zip, name, method, compressedSize, size, offset: localOffset });
      }
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return found;
}

/** Reads and inflates one entry.  Returns an empty array for an unsupported method. */
export async function readZipEntry(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.offset + 30 > entry.archive.size) return new Uint8Array(0);
  const header = new DataView(
    await entry.archive.slice(entry.offset, entry.offset + 30).arrayBuffer()
  );
  if (header.getUint32(0, true) !== LOCAL_SIGNATURE) return new Uint8Array(0);
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const compressed = await entry.archive.slice(start, start + entry.compressedSize).arrayBuffer();

  if (entry.method === 0) return new Uint8Array(compressed);
  if (entry.method !== 8) return new Uint8Array(0);

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
