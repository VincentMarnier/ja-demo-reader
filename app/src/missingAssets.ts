/**
 * Missing map content reported by the engine while it loads a map.
 *
 * The engine already prints these as warnings (they are non-fatal: the prop,
 * texture stage or sound is skipped).  The player scans its log for the known
 * messages so a demo never silently loses models or textures, while playback
 * stays available.
 */

export type MissingAssetKind = 'model' | 'texture' | 'skin' | 'animation' | 'font' | 'sound';

export interface MissingAsset {
  /** Stable identity, used to collapse repeated engine warnings. */
  key: string;
  kind: MissingAssetKind;
  name: string;
  /** Extra context, such as the shader that wanted an image. */
  detail?: string;
}

export const MISSING_ASSET_LABEL: Record<MissingAssetKind, string> = {
  model: 'Models',
  texture: 'Textures & shaders',
  skin: 'Skins',
  animation: 'Animations',
  font: 'Fonts',
  sound: 'Sounds'
};

const KIND_ORDER: MissingAssetKind[] = ['model', 'texture', 'skin', 'animation', 'font', 'sound'];

function model(name: string): MissingAsset {
  const clean = name.trim();
  return { key: `model:${clean.toLowerCase()}`, kind: 'model', name: clean };
}

function texture(name: string, detail?: string): MissingAsset {
  const clean = name.trim();
  return { key: `texture:${clean.toLowerCase()}`, kind: 'texture', name: clean, detail };
}

function sound(name: string): MissingAsset {
  const clean = name.trim();
  return { key: `sound:${clean.toLowerCase()}`, kind: 'sound', name: clean };
}

type Matcher = (line: string) => MissingAsset | null;

const MATCHERS: Matcher[] = [
  line => {
    const match = /misc_model_static skipped missing model '([^']+)'/i.exec(line);
    return match ? model(match[1]) : null;
  },
  line => {
    const match = /Attempted to load an unsupported multiplayer model (.+?)! \(bad or missing bone/i.exec(line);
    return match ? model(match[1]) : null;
  },
  line => {
    const match = /R_Register(?:MD3|MDR|IQM|MDX_Server): couldn't load (.+)$/i.exec(line);
    return match ? model(match[1]) : null;
  },
  line => {
    const match = /R_FindImageFile could not find (?:normalMap |specMap )?'([^']+)' in shader '([^']+)'/i.exec(line);
    return match ? texture(match[1], `shader ${match[2]}`) : null;
  },
  line => {
    const match = /Shader (.+?), stage (\d+) has no image/i.exec(line);
    if (!match) return null;
    const shader = match[1].trim();
    return {
      key: `texture:${shader.toLowerCase()}:${match[2]}`,
      kind: 'texture',
      name: shader,
      detail: `stage ${match[2]}`
    };
  },
  line => {
    const match = /RE_RegisterSkin\( '([^']+)' \) failed to load/i.exec(line);
    return match
      ? { key: `skin:${match[1].toLowerCase()}`, kind: 'skin', name: match[1] }
      : null;
  },
  line => {
    const match = /R_LoadMDXM: missing animation file (.+?) for mesh (.+)$/i.exec(line);
    if (!match) return null;
    const file = match[1].trim();
    return {
      key: `animation:${file.toLowerCase()}`,
      kind: 'animation',
      name: file,
      detail: `mesh ${match[2].trim()}`
    };
  },
  line => {
    const match = /RE_RegisterFont: Couldn't find font (.+)$/i.exec(line);
    if (!match) return null;
    const name = match[1].trim();
    // The stock HUD asks for fonts/reallybigfont, which retail JKA does not
    // ship and the engine substitutes.  It is not map content, so do not show
    // it as a missing asset for every demo.
    if (/^fonts\/reallybigfont(?:\.fontdat)?$/i.test(name)) return null;
    return { key: `font:${name.toLowerCase()}`, kind: 'font', name };
  },
  line => {
    const match = /WARNING: could not find (.+?) - using default/i.exec(line);
    return match ? sound(match[1]) : null;
  },
  line => {
    const match = /(?:WARNING: )?couldn't open music file (.+)$/i.exec(line);
    return match ? sound(match[1]) : null;
  }
];

/** Strip Quake colour escapes (`^3`, `^7`, ...) before display or matching. */
function plain(line: string): string {
  return line.replace(/\^[0-9]/g, '');
}

export function collectMissingAssets(lines: readonly string[]): MissingAsset[] {
  const found: MissingAsset[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    const line = plain(raw);
    for (const matcher of MATCHERS) {
      const asset = matcher(line);
      if (asset) {
        found.push(asset);
        break;
      }
    }
  }
  return found;
}

export function groupMissingAssets(
  assets: readonly MissingAsset[]
): Array<{ kind: MissingAssetKind; label: string; items: MissingAsset[] }> {
  const groups = new Map<MissingAssetKind, MissingAsset[]>();
  for (const asset of assets) {
    const current = groups.get(asset.kind);
    if (current) current.push(asset);
    else groups.set(asset.kind, [asset]);
  }
  return KIND_ORDER
    .filter(kind => groups.has(kind))
    .map(kind => ({ kind, label: MISSING_ASSET_LABEL[kind], items: groups.get(kind)! }));
}
