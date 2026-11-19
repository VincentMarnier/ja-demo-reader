import type { PipCorner } from '../settings';

/** Movement below this is a click, not a drag. */
export const CLICK_SLOP = 5;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Nearest corner of the stage to a point, used when a drag ends. */
export function cornerAt(centerX: number, centerY: number, stage: DOMRect): PipCorner {
  const right = centerX >= stage.left + stage.width / 2;
  const bottom = centerY >= stage.top + stage.height / 2;
  return `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}` as PipCorner;
}
