/**
 * Helpers for resolving a shader name to a texture image.
 *
 * Most map surfaces use a shader whose name is the texture path, so a direct
 * `<shader>.jpg/png` lookup is enough.  Quake-style shader scripts cover the
 * rest: a block such as
 *
 *   textures/korriban/korriban1_phong
 *   {
 *       qer_editorimage textures/h_evil/evil_rock12
 *       { map textures/h_evil/evil_rock12 }
 *       { map textures/h_evil/evil_rock13 ... }
 *   }
 *
 * names its first stage map (or an editor image) that the minimap can decode.
 * The parser deliberately ignores blending and tcMod: only a representative
 * average colour is needed.
 */

const DECODE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const LOOKUP_EXTENSIONS = ['.jpg', '.png'] as const;

/** Image paths that can represent one shader texture reference, best first. */
export function textureCandidates(path: string): string[] {
  const lower = path.toLowerCase().replace(/\\/g, '/');
  const dot = lower.lastIndexOf('.');
  const slash = lower.lastIndexOf('/');
  const base = dot > slash ? lower.slice(0, dot) : lower;
  const extension = dot > slash ? lower.slice(dot) : '';
  const candidates: string[] = [];
  if (DECODE_EXTENSIONS.has(extension)) candidates.push(lower);
  for (const wanted of LOOKUP_EXTENSIONS) candidates.push(`${base}${wanted}`);
  // An extension-less sibling is preferred, but try an exotic extension last
  // in case a browser can decode it after all.
  if (extension && !DECODE_EXTENSIONS.has(extension)) candidates.push(lower);
  return [...new Set(candidates)];
}

/**
 * Adds every shader definition found in the given script texts to `out`.
 * Later definitions win, matching the engine's archive order.
 */
export function parseShaderScripts(scripts: Iterable<string>, out: Map<string, string>): void {
  for (const text of scripts) {
    let pendingName = '';
    let current: string | null = null;
    let depth = 0;
    let image = '';
    let imageIsStageMap = false;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) continue;

      if (depth === 0) {
        if (line === '{') {
          if (pendingName) {
            current = pendingName;
            pendingName = '';
            depth = 1;
            image = '';
            imageIsStageMap = false;
          }
          continue;
        }
        if (line === '}') continue;
        const inline = /^([^\s{}]+)\s*\{$/.exec(line);
        if (inline) {
          current = inline[1];
          pendingName = '';
          depth = 1;
          image = '';
          imageIsStageMap = false;
          continue;
        }
        pendingName = line;
        continue;
      }

      if (line.startsWith('{')) {
        depth++;
        continue;
      }
      if (line.startsWith('}')) {
        depth--;
        if (depth === 0 && current) {
          if (image) out.set(current.toLowerCase(), image);
          current = null;
          image = '';
        }
        continue;
      }

      const stageMap = /^map\s+(\S+)/i.exec(line);
      if (stageMap && !stageMap[1].startsWith('$')) {
        if (!imageIsStageMap) {
          image = stageMap[1];
          imageIsStageMap = true;
        }
        continue;
      }
      if (!image) {
        const editorImage = /^qer_editorimage\s+(\S+)/i.exec(line);
        if (editorImage && !editorImage[1].startsWith('$')) image = editorImage[1];
      }
    }
  }
}
