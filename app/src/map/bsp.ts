/**
 * Static top-down map image built from a JKA BSP.
 *
 * The minimap background is a one-off raster of the world surfaces as seen
 * from above, not a live render.  Every up-facing polygon is projected onto
 * the XY plane and kept only when it is the highest surface for that pixel, so
 * bridges and upper floors occlude what is below them.  Void pixels stay
 * transparent: there is no background fill.
 *
 * JKA's RBSP format is the Quake 3 BSP layout with fixed-size records; the
 * offsets below are the ones the engine's own loader uses (dsurface_t is 148
 * bytes, drawVert_t 80, dshader_t 72).
 */

const LUMP_SHADERS = 1;
const LUMP_MODELS = 7;
const LUMP_DRAWVERTS = 10;
const LUMP_DRAWINDEXES = 11;
const LUMP_SURFACES = 13;

const HEADER_LUMPS = 18;
const SHADER_SIZE = 72;
const VERTEX_SIZE = 80;
const SURFACE_SIZE = 148;
const MODEL_SIZE = 40;

const SURF_SKY = 0x00002000;
const SURF_NODRAW = 0x00200000;

const MST_PLANAR = 1;
const MST_PATCH = 2;
const MST_TRIANGLE_SOUP = 3;

/** Surfaces that never contribute to the visible world seen from above. */
const UTILITY_SHADER =
  /(?:^noshader)|(?:^textures\/(?:system|common)\/)|common\/(?:caulk|clip|trigger|hint|areaportal|portal|weapclip|monsterclip|origin|curtain|nodraw|sky)/;

/** Patch tessellation steps.  Eight per span reads well at minimap size. */
const PATCH_STEPS = 8;

export type Rgb = readonly [number, number, number];

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MinimapImage {
  width: number;
  height: number;
  /** RGBA, alpha 0 where the map has no geometry (void). */
  data: Uint8ClampedArray;
  /** World rectangle the image covers; +X is right, +Y is up. */
  bounds: MapBounds;
}

interface BspSurface {
  shader: number;
  type: number;
  firstVert: number;
  numVerts: number;
  firstIndex: number;
  numIndexes: number;
  patchWidth: number;
  patchHeight: number;
}

export interface BspWorld {
  shaderNames: string[];
  shaderFlags: Int32Array;
  /** SoA vertex arrays: position and normal. */
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  indices: Int32Array;
  surfaces: BspSurface[];
  /** Bounds of every drawable surface, used to frame the image. */
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
}

function readName(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = Math.min(bytes.length, offset + length);
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

export function isDrawableShader(name: string, flags: number): boolean {
  if (flags & (SURF_NODRAW | SURF_SKY)) return false;
  return !UTILITY_SHADER.test(name.toLowerCase());
}

export function isWaterShader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('water') || lower.includes('slime') || lower.includes('lava');
}

export function parseBsp(buffer: ArrayBuffer): BspWorld | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 + HEADER_LUMPS * 8) return null;
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'RBSP') return null;

  const view = new DataView(buffer);
  if (view.getInt32(4, true) !== 1) return null;

  const lumps: Array<{ offset: number; length: number }> = [];
  for (let i = 0; i < HEADER_LUMPS; i++) {
    lumps.push({ offset: view.getInt32(8 + i * 8, true), length: view.getInt32(12 + i * 8, true) });
  }
  const lump = (index: number): { offset: number; length: number } => {
    const value = lumps[index];
    if (!value || value.offset < 0 || value.length < 0 || value.offset + value.length > bytes.length) {
      return { offset: 0, length: 0 };
    }
    return value;
  };

  const shaderLump = lump(LUMP_SHADERS);
  if (shaderLump.length === 0) return null;
  const shaderCount = Math.floor(shaderLump.length / SHADER_SIZE);
  const shaderNames: string[] = new Array(shaderCount);
  const shaderFlags = new Int32Array(shaderCount);
  for (let i = 0; i < shaderCount; i++) {
    const offset = shaderLump.offset + i * SHADER_SIZE;
    shaderNames[i] = readName(bytes, offset, 64);
    shaderFlags[i] = view.getInt32(offset + 64, true);
  }

  const vertLump = lump(LUMP_DRAWVERTS);
  const vertexCount = Math.floor(vertLump.length / VERTEX_SIZE);
  const vx = new Float32Array(vertexCount);
  const vy = new Float32Array(vertexCount);
  const vz = new Float32Array(vertexCount);
  const nx = new Float32Array(vertexCount);
  const ny = new Float32Array(vertexCount);
  const nz = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const offset = vertLump.offset + i * VERTEX_SIZE;
    vx[i] = view.getFloat32(offset, true);
    vy[i] = view.getFloat32(offset + 4, true);
    vz[i] = view.getFloat32(offset + 8, true);
    nx[i] = view.getFloat32(offset + 52, true);
    ny[i] = view.getFloat32(offset + 56, true);
    nz[i] = view.getFloat32(offset + 60, true);
  }

  const indexLump = lump(LUMP_DRAWINDEXES);
  const indexCount = Math.floor(indexLump.length / 4);
  const indices = new Int32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    indices[i] = view.getInt32(indexLump.offset + i * 4, true);
  }

  const surfaceLump = lump(LUMP_SURFACES);
  const surfaceCount = Math.floor(surfaceLump.length / SURFACE_SIZE);
  const surfaces: BspSurface[] = new Array(surfaceCount);
  for (let i = 0; i < surfaceCount; i++) {
    const offset = surfaceLump.offset + i * SURFACE_SIZE;
    surfaces[i] = {
      shader: view.getInt32(offset, true),
      type: view.getInt32(offset + 8, true),
      firstVert: view.getInt32(offset + 12, true),
      numVerts: view.getInt32(offset + 16, true),
      firstIndex: view.getInt32(offset + 20, true),
      numIndexes: view.getInt32(offset + 24, true),
      patchWidth: view.getInt32(offset + 140, true),
      patchHeight: view.getInt32(offset + 144, true)
    };
  }

  const modelLump = lump(LUMP_MODELS);
  const world = {
    shaderNames,
    shaderFlags,
    vx,
    vy,
    vz,
    nx,
    ny,
    nz,
    indices,
    surfaces,
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
  };
  if (modelLump.length >= MODEL_SIZE) {
    const offset = modelLump.offset;
    world.bounds = {
      minX: view.getFloat32(offset, true),
      minY: view.getFloat32(offset + 4, true),
      minZ: view.getFloat32(offset + 8, true),
      maxX: view.getFloat32(offset + 12, true),
      maxY: view.getFloat32(offset + 16, true),
      maxZ: view.getFloat32(offset + 20, true)
    };
  }

  return world;
}

function hashName(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function bezier(values: number[], t: number): number {
  const work = values.slice();
  for (let level = 1; level < work.length; level++) {
    for (let i = 0; i < work.length - level; i++) {
      work[i] = work[i] * (1 - t) + work[i + 1] * t;
    }
  }
  return work[0];
}

/**
 * Average texture colour per shader name.  Missing entries fall back to a
 * muted height-tinted slate so the map still reads without its textures.
 */
export type ShaderColors = ReadonlyMap<string, Rgb>;

interface SurfaceInfo {
  color: Rgb;
  alpha: number;
  water: boolean;
  jitter: number;
  nx: number;
  ny: number;
  nz: number;
}

function surfaceInfo(world: BspWorld, surface: BspSurface, colors: ShaderColors): SurfaceInfo | null {
  const name = world.shaderNames[surface.shader] ?? '';
  if (!isDrawableShader(name, world.shaderFlags[surface.shader] ?? 0)) return null;

  const water = isWaterShader(name);
  const found = colors.get(name);
  let color: Rgb;
  if (found) {
    color = found;
  } else if (water) {
    color = [64, 118, 150];
  } else {
    const hash = hashName(name);
    const warmth = (hash % 24) / 100;
    color = [92 + warmth * 40, 96 + warmth * 34, 104 + warmth * 26];
  }

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let count = 0;
  const limit = Math.min(surface.numVerts, 8);
  for (let i = 0; i < limit; i++) {
    const vertex = surface.firstVert + i;
    if (vertex < 0 || vertex >= world.vx.length) continue;
    nx += world.nx[vertex];
    ny += world.ny[vertex];
    nz += world.nz[vertex];
    count++;
  }
  if (count > 0) {
    nx /= count;
    ny /= count;
    nz /= count;
  } else {
    nz = 1;
  }

  return {
    color,
    alpha: water ? 0.82 : 1,
    water,
    jitter: 0.95 + ((hashName(name) >>> 3) % 9) / 100,
    nx,
    ny,
    nz
  };
}

/** World-space bounds of the geometry that will actually be drawn. */
function drawableBounds(world: BspWorld, infos: ReadonlyArray<SurfaceInfo | null>) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };

  for (let index = 0; index < world.surfaces.length; index++) {
    const info = infos[index];
    if (!info || info.nz < -0.3) continue;
    const surface = world.surfaces[index];
    const first = Math.max(0, surface.firstVert);
    const last = Math.min(world.vx.length, surface.firstVert + surface.numVerts);
    for (let vertex = first; vertex < last; vertex++) {
      const x = world.vx[vertex];
      const y = world.vy[vertex];
      const z = world.vz[vertex];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < bounds.minX) bounds.minX = x;
      if (x > bounds.maxX) bounds.maxX = x;
      if (y < bounds.minY) bounds.minY = y;
      if (y > bounds.maxY) bounds.maxY = y;
      if (z < bounds.minZ) bounds.minZ = z;
      if (z > bounds.maxZ) bounds.maxZ = z;
    }
  }

  if (!Number.isFinite(bounds.minX) || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    return null;
  }
  return bounds;
}

/**
 * Rasterises the map from above.  `maxSize` is the longest image edge; the
 * result is cropped to the drawn footprint so the UI does not show empty
 * padding around the level.
 */
export function renderMinimap(
  world: BspWorld,
  colors: ShaderColors,
  maxSize = 1024
): MinimapImage | null {
  const infos: Array<SurfaceInfo | null> = world.surfaces.map(surface =>
    surfaceInfo(world, surface, colors)
  );
  const bounds = drawableBounds(world, infos);
  if (!bounds) return null;

  const padX = (bounds.maxX - bounds.minX) * 0.005;
  const padY = (bounds.maxY - bounds.minY) * 0.005;
  const minX = bounds.minX - padX;
  const maxX = bounds.maxX + padX;
  const minY = bounds.minY - padY;
  const maxY = bounds.maxY + padY;
  const scale = maxSize / Math.max(maxX - minX, maxY - minY);
  const width = Math.max(16, Math.round((maxX - minX) * scale));
  const height = Math.max(16, Math.round((maxY - minY) * scale));

  const depth = new Float32Array(width * height).fill(Number.NEGATIVE_INFINITY);
  const surfaceAt = new Int32Array(width * height).fill(-1);
  // +X is right; +Y is up in the image, so canvas Y is mirrored.
  const toX = (x: number): number => (x - minX) * scale;
  const toY = (y: number): number => (maxY - y) * scale;

  let current = -1;

  const triangle = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
  ): void => {
    const x0 = toX(ax), y0 = toY(ay);
    const x1 = toX(bx), y1 = toY(by);
    const x2 = toX(cx), y2 = toY(cy);
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0 || !Number.isFinite(area)) return;
    let px1 = x1, py1 = y1, px2 = x2, py2 = y2;
    if (area < 0) {
      px1 = x2;
      py1 = y2;
      px2 = x1;
      py2 = y1;
      area = -area;
    }
    const minPixelX = Math.max(0, Math.floor(Math.min(x0, px1, px2)));
    const maxPixelX = Math.min(width - 1, Math.ceil(Math.max(x0, px1, px2)));
    const minPixelY = Math.max(0, Math.floor(Math.min(y0, py1, py2)));
    const maxPixelY = Math.min(height - 1, Math.ceil(Math.max(y0, py1, py2)));
    if (minPixelX > maxPixelX || minPixelY > maxPixelY) return;
    const inverse = 1 / area;

    for (let y = minPixelY; y <= maxPixelY; y++) {
      const sampleY = y + 0.5;
      const row = y * width;
      for (let x = minPixelX; x <= maxPixelX; x++) {
        const sampleX = x + 0.5;
        const w0 =
          ((px1 - sampleX) * (py2 - sampleY) - (px2 - sampleX) * (py1 - sampleY)) * inverse;
        const w1 =
          ((px2 - sampleX) * (y0 - sampleY) - (x0 - sampleX) * (py2 - sampleY)) * inverse;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const index = row + x;
        if (!(z > depth[index])) continue;
        depth[index] = z;
        surfaceAt[index] = current;
      }
    }
  };

  for (let index = 0; index < world.surfaces.length; index++) {
    const surface = world.surfaces[index];
    const info = infos[index];
    if (!info) continue;
    if (info.nz < -0.3) continue;
    current = index;

    if (surface.type === MST_PLANAR) {
      const first = surface.firstVert;
      const count = surface.numVerts;
      if (first < 0 || count < 3 || first + count > world.vx.length) continue;
      for (let i = 0; i + 2 < surface.numIndexes; i += 3) {
        const ia = world.indices[surface.firstIndex + i];
        const ib = world.indices[surface.firstIndex + i + 1];
        const ic = world.indices[surface.firstIndex + i + 2];
        if (ia === undefined || ib === undefined || ic === undefined) continue;
        if (ia < 0 || ia >= count || ib < 0 || ib >= count || ic < 0 || ic >= count) continue;
        const va = first + ia;
        const vb = first + ib;
        const vc = first + ic;
        triangle(
          world.vx[va], world.vy[va], world.vz[va],
          world.vx[vb], world.vy[vb], world.vz[vb],
          world.vx[vc], world.vy[vc], world.vz[vc]
        );
      }
    } else if (surface.type === MST_TRIANGLE_SOUP) {
      for (let i = 0; i + 2 < surface.numIndexes; i += 3) {
        const ia = world.indices[surface.firstIndex + i];
        const ib = world.indices[surface.firstIndex + i + 1];
        const ic = world.indices[surface.firstIndex + i + 2];
        if (ia === undefined || ib === undefined || ic === undefined) continue;
        const va = surface.firstVert + ia;
        const vb = surface.firstVert + ib;
        const vc = surface.firstVert + ic;
        if (va < 0 || vb < 0 || vc < 0) continue;
        if (va >= world.vx.length || vb >= world.vx.length || vc >= world.vx.length) continue;
        if ((world.nz[va] + world.nz[vb] + world.nz[vc]) / 3 < -0.3) continue;
        triangle(
          world.vx[va], world.vy[va], world.vz[va],
          world.vx[vb], world.vy[vb], world.vz[vb],
          world.vx[vc], world.vy[vc], world.vz[vc]
        );
      }
    } else if (surface.type === MST_PATCH) {
      const patchWidth = surface.patchWidth;
      const patchHeight = surface.patchHeight;
      if (
        patchWidth < 3 ||
        patchHeight < 3 ||
        patchWidth > 17 ||
        patchHeight > 17 ||
        surface.firstVert < 0 ||
        surface.firstVert + patchWidth * patchHeight > world.vx.length
      ) {
        continue;
      }
      const gridX: number[] = [];
      const gridY: number[] = [];
      const gridZ: number[] = [];
      const rowX: number[] = new Array(patchWidth);
      const rowY: number[] = new Array(patchWidth);
      const rowZ: number[] = new Array(patchWidth);
      const steps = PATCH_STEPS;
      for (let j = 0; j <= steps; j++) {
        const v = j / steps;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const valuesX: number[] = new Array(patchHeight);
          const valuesY: number[] = new Array(patchHeight);
          const valuesZ: number[] = new Array(patchHeight);
          for (let row = 0; row < patchHeight; row++) {
            const base = surface.firstVert + row * patchWidth;
            for (let column = 0; column < patchWidth; column++) {
              rowX[column] = world.vx[base + column];
              rowY[column] = world.vy[base + column];
              rowZ[column] = world.vz[base + column];
            }
            valuesX[row] = bezier(rowX, u);
            valuesY[row] = bezier(rowY, u);
            valuesZ[row] = bezier(rowZ, u);
          }
          gridX.push(bezier(valuesX, v));
          gridY.push(bezier(valuesY, v));
          gridZ.push(bezier(valuesZ, v));
        }
      }
      const stride = steps + 1;
      for (let j = 0; j < steps; j++) {
        for (let i = 0; i < steps; i++) {
          const a = j * stride + i;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          triangle(gridX[a], gridY[a], gridZ[a], gridX[b], gridY[b], gridZ[b], gridX[d], gridY[d], gridZ[d]);
          triangle(gridX[a], gridY[a], gridZ[a], gridX[d], gridY[d], gridZ[d], gridX[c], gridY[c], gridZ[c]);
        }
      }
    }
  }

  let minPixelX = width;
  let maxPixelX = -1;
  let minPixelY = height;
  let maxPixelY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (surfaceAt[row + x] < 0) continue;
      if (x < minPixelX) minPixelX = x;
      if (x > maxPixelX) maxPixelX = x;
      if (y < minPixelY) minPixelY = y;
      if (y > maxPixelY) maxPixelY = y;
    }
  }
  if (maxPixelX < 0) return null;

  const margin = 2;
  const cropLeft = Math.max(0, minPixelX - margin);
  const cropTop = Math.max(0, minPixelY - margin);
  const cropRight = Math.min(width - 1, maxPixelX + margin);
  const cropBottom = Math.min(height - 1, maxPixelY + margin);
  const cropWidth = cropRight - cropLeft + 1;
  const cropHeight = cropBottom - cropTop + 1;
  const pixels = new Uint8ClampedArray(cropWidth * cropHeight * 4);

  const minZ = bounds.minZ;
  const heightRange = Math.max(1, bounds.maxZ - bounds.minZ);
  // Light from the image's upper left, so slopes and ledges get a direction.
  const lightX = -0.42;
  const lightY = 0.52;
  const lightZ = 0.74;
  const edgeDepth = Math.max(10, (bounds.maxZ - bounds.minZ) * 0.012);

  for (let y = 0; y < cropHeight; y++) {
    const sourceRow = (cropTop + y) * width;
    const outRow = y * cropWidth;
    for (let x = 0; x < cropWidth; x++) {
      const sourceIndex = sourceRow + cropLeft + x;
      const surfaceIndex = surfaceAt[sourceIndex];
      if (surfaceIndex < 0) continue;
      const info = infos[surfaceIndex];
      if (!info) continue;

      const height = (depth[sourceIndex] - minZ) / heightRange;
      const diffuse = Math.max(
        0,
        info.nx * lightX + info.ny * lightY + info.nz * lightZ
      );
      let brightness = 0.92 + 0.55 * diffuse;
      brightness *= 0.9 + 0.24 * Math.min(1, Math.max(0, height));
      brightness *= info.jitter;

      const out = (outRow + x) * 4;
      pixels[out] = info.color[0] * brightness;
      pixels[out + 1] = info.color[1] * brightness;
      pixels[out + 2] = info.color[2] * brightness;
      pixels[out + 3] = Math.round(info.alpha * 255);
    }
  }

  // Darken silhouette and height-step edges a little; coplanar triangle seams
  // stay invisible because only a real depth jump or a void neighbour counts.
  for (let y = 0; y < cropHeight; y++) {
    const sourceRow = (cropTop + y) * width;
    const outRow = y * cropWidth;
    for (let x = 0; x < cropWidth; x++) {
      const sourceIndex = sourceRow + cropLeft + x;
      if (surfaceAt[sourceIndex] < 0) continue;
      let edge = false;
      const neighbours = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ] as const;
      for (const [dx, dy] of neighbours) {
        const nx = cropLeft + x + dx;
        const ny = cropTop + y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          edge = true;
          break;
        }
        const neighbour = ny * width + nx;
        if (surfaceAt[neighbour] < 0) {
          edge = true;
          break;
        }
        if (Math.abs(depth[neighbour] - depth[sourceIndex]) > edgeDepth) {
          edge = true;
          break;
        }
      }
      if (!edge) continue;
      const out = (outRow + x) * 4;
      pixels[out] *= 0.74;
      pixels[out + 1] *= 0.74;
      pixels[out + 2] *= 0.74;
    }
  }

  return {
    width: cropWidth,
    height: cropHeight,
    data: pixels,
    bounds: {
      minX: minX + cropLeft / scale,
      maxX: minX + (cropRight + 1) / scale,
      minY: maxY - (cropBottom + 1) / scale,
      maxY: maxY - cropTop / scale
    }
  };
}

export { MST_PLANAR, MST_PATCH, MST_TRIANGLE_SOUP };
