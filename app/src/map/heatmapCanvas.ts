import type { HeatmapGrid } from './damageHeatmap';

/**
 * Turns a damaged-cell grid into a small RGBA canvas.  The canvas has the
 * grid's own resolution and is scaled up with image smoothing by the minimap,
 * so the Gaussian splat reads as a soft glow instead of a blocky raster.
 */

interface RampStop {
  at: number;
  hue: number;
  saturation: number;
  lightness: number;
  alpha: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** HSL -> RGB, all channels 0..255. */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = clamp01(saturation / 100);
  const l = clamp01(lightness / 100);
  if (s === 0) {
    const grey = Math.round(l * 255);
    return [grey, grey, grey];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255)
  ];
}

function ramp(hue: number, saturation: number, coreLightness = 76): RampStop[] {
  return [
    { at: 0, hue, saturation, lightness: 36, alpha: 0 },
    { at: 0.08, hue, saturation, lightness: 42, alpha: 0.3 },
    { at: 0.35, hue, saturation, lightness: 52, alpha: 0.62 },
    { at: 0.7, hue, saturation, lightness: 62, alpha: 0.84 },
    // The core warms toward yellow-white, so the hottest cells stay readable.
    { at: 1, hue: hue + 18, saturation: Math.min(100, saturation + 8), lightness: coreLightness, alpha: 0.94 }
  ];
}

function sample(stops: readonly RampStop[], t: number): [number, number, number, number] {
  let index = 0;
  while (index < stops.length - 2 && t > stops[index + 1].at) index++;
  const from = stops[index];
  const to = stops[index + 1] ?? from;
  const span = Math.max(1e-6, to.at - from.at);
  const k = clamp01((t - from.at) / span);
  const hue = from.hue + (to.hue - from.hue) * k;
  const saturation = from.saturation + (to.saturation - from.saturation) * k;
  const lightness = from.lightness + (to.lightness - from.lightness) * k;
  const alpha = from.alpha + (to.alpha - from.alpha) * k;
  const [r, g, b] = hslToRgb(hue, saturation, lightness);
  return [r, g, b, Math.round(clamp01(alpha) * 255)];
}

/**
 * Builds the layer for one grid.  `max` can be a shared peak (both teams) or
 * the grid's own peak (a single player).  Returns null when nothing is placed.
 */
export function heatmapCanvas(
  grid: HeatmapGrid,
  max: number,
  hue: number,
  saturation = 88
): HTMLCanvasElement | null {
  if (grid.max <= 0 || max <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = grid.columns;
  canvas.height = grid.rows;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(grid.columns, grid.rows);
  const data = image.data;
  const stops = ramp(hue, saturation);
  const scale = 1 / max;

  for (let i = 0; i < grid.weights.length; i++) {
    const weight = grid.weights[i];
    if (weight <= 0) continue;
    // A square root keeps the low end visible without flattening the peak.
    const t = Math.pow(clamp01(weight * scale), 0.55);
    if (t < 0.035) continue;
    const [r, g, b, a] = sample(stops, t);
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = a;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Team hues: the same red/blue families the minimap dots use. */
export const TEAM_HEAT_HUE: Record<number, number> = { 1: 2, 2: 212 };

/**
 * One canvas for both teams.  Each cell takes the dominant team's intensity
 * but mixes its colour with the other team's share, so contested ground reads
 * as purple instead of washing out to white the way two screen-blended layers
 * would.  `max` is the shared peak of the two grids.
 */
export function teamHeatmapCanvas(
  first: HeatmapGrid,
  second: HeatmapGrid,
  max: number
): HTMLCanvasElement | null {
  if (max <= 0 || (first.max <= 0 && second.max <= 0)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = first.columns;
  canvas.height = first.rows;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(first.columns, first.rows);
  const data = image.data;
  const redStops = ramp(TEAM_HEAT_HUE[1], 92, 64);
  const blueStops = ramp(TEAM_HEAT_HUE[2], 88, 64);
  const scale = 1 / max;

  for (let i = 0; i < first.weights.length; i++) {
    const red = first.weights[i];
    const blue = second.weights[i];
    if (red <= 0 && blue <= 0) continue;
    // The dominant team sets the heat; the other team shifts the hue.
    const intensity = Math.pow(clamp01(Math.max(red, blue) * scale), 0.55);
    if (intensity < 0.035) continue;
    const share = red / (red + blue);
    const [r1, g1, b1, a1] = sample(redStops, intensity);
    const [r2, g2, b2, a2] = sample(blueStops, intensity);
    const offset = i * 4;
    data[offset] = Math.round(r1 * share + r2 * (1 - share));
    data[offset + 1] = Math.round(g1 * share + g2 * (1 - share));
    data[offset + 2] = Math.round(b1 * share + b2 * (1 - share));
    data[offset + 3] = Math.max(a1, a2);
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
