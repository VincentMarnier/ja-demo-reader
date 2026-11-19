/** Player colours shared by the minimap dots, trails and damage heatmaps. */

/** FFA colours, used when the player has no red/blue team. */
const FREE_COLORS = [
  [38, 82, 58],
  [198, 78, 60],
  [152, 62, 52],
  [322, 72, 64],
  [18, 88, 58],
  [268, 64, 66],
  [178, 72, 52],
  [92, 62, 50],
  [350, 78, 62],
  [224, 66, 64]
] as const;

/**
 * Per-client tone inside a team colour.  Red stays warm and blue stays cool,
 * but eight fixed offsets and brightness steps make teammates easy to tell
 * apart at minimap size.
 */
const TEAM_TONE_HUE = [-9, 9, -15, 15, -4, 4, 12, -12] as const;
const TEAM_TONE_LIGHT = [62, 55, 69, 58, 65, 51, 71, 60] as const;

export interface Tone {
  h: number;
  s: number;
  l: number;
}

function teamTone(num: number, baseHue: number, saturation: number): Tone {
  const tone = Math.abs(num) % TEAM_TONE_HUE.length;
  return {
    h: (baseHue + TEAM_TONE_HUE[tone] + 360) % 360,
    s: saturation,
    l: TEAM_TONE_LIGHT[tone]
  };
}

export function playerTone(num: number, team: number | undefined): Tone {
  if (team === 1) return teamTone(num, 0, 78);
  if (team === 2) return teamTone(num, 212, 82);
  const color = FREE_COLORS[Math.abs(num) % FREE_COLORS.length];
  return { h: color[0], s: color[1], l: color[2] };
}

export function toneColor(tone: Tone, alpha = 1): string {
  return alpha >= 1
    ? `hsl(${tone.h} ${tone.s}% ${tone.l}%)`
    : `hsla(${tone.h}, ${tone.s}%, ${tone.l}%, ${alpha})`;
}
