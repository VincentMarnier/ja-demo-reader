import type { MapBounds } from './bsp';
import type { DemoGameSummary } from '../types';

/**
 * Damage heatmaps over the generated top-down map image.
 *
 * Every placed damage instance contributes its damage to the world position of
 * one end of the exchange:
 *
 * - **given** uses the attacker's position (where the damage came from),
 * - **received** uses the victim's position (where the damage landed).
 *
 * The engine records both positions at scan time; an end outside the recorded
 * POV's PVS has no position and is skipped.  Team layers aggregate by the
 * team of the relevant end, so red/blue show where each team traded damage.
 * Player layers aggregate one client's given or received damage.
 *
 * The grids are laid out over the same world rectangle as `MinimapImage`
 * (`bounds`), row 0 at `maxY`, so a grid drawn over the map image lines up
 * exactly with the raster.
 */

/** Long edge of the grid. 160 keeps the buffer small and still reads smoothly. */
export const HEATMAP_MAX_EDGE = 160;

/** Gaussian splat radius in cells; the value is the damage at the centre. */
const KERNEL_RADIUS = 2;
const KERNEL_SIGMA = 1.1;

export type DamageHeatmapKind = 'given' | 'received';

export type DamageHeatmapMode =
  | 'off'
  | 'team-given'
  | 'team-received'
  | 'player-given'
  | 'player-received';

/** Team layers live in the Damage over time view; player layers in player detail. */
export const TEAM_HEATMAP_MODES: readonly DamageHeatmapMode[] = ['team-given', 'team-received'];
export const PLAYER_HEATMAP_MODES: readonly DamageHeatmapMode[] = ['player-given', 'player-received'];

export const HEATMAP_MODES: ReadonlyArray<{ value: DamageHeatmapMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'team-given', label: 'Team · damage given' },
  { value: 'team-received', label: 'Team · damage received' },
  { value: 'player-given', label: 'Player · damage given' },
  { value: 'player-received', label: 'Player · damage received' }
];

export function heatmapKind(mode: DamageHeatmapMode): DamageHeatmapKind | null {
  if (mode === 'off') return null;
  return mode.endsWith('given') ? 'given' : 'received';
}

export function heatmapIsTeam(mode: DamageHeatmapMode): boolean {
  return mode === 'team-given' || mode === 'team-received';
}

export interface DamageHeatmapEvent {
  time: number;
  damage: number;
  attacker: number;
  target: number;
  attackerTeam: number;
  targetTeam: number;
  /** Present when the attacker's world position was recorded. */
  ax?: number;
  ay?: number;
  /** Present when the victim's world position was recorded. */
  tx?: number;
  ty?: number;
}

export interface DamageHeatmapSource {
  bounds: MapBounds;
  columns: number;
  rows: number;
  /** World units per grid cell (the same on both axes). */
  cellSize: number;
  events: DamageHeatmapEvent[];
  /** All events, including the ones without a usable position. */
  totalEvents: number;
  /** Damage that could be placed for a given/received layer. */
  givenDamage: number;
  givenTotal: number;
  receivedDamage: number;
  receivedTotal: number;
}

export interface HeatmapGrid {
  columns: number;
  rows: number;
  /** Gaussian-weighted damage per cell. */
  weights: Float32Array;
  /** Peak cell weight; 0 when nothing could be placed. */
  max: number;
  /** Damage of the events that contributed (not the splatted sum). */
  total: number;
  /** Number of contributing damage events. */
  events: number;
}

export interface DamageHeatmapFilter {
  team?: number;
  player?: number;
}

/** Latest team per client. Teams can change between games, not inside one. */
export function playerTeams(game: DemoGameSummary): Map<number, number> {
  const teams = new Map<number, number>();
  for (const player of game.players) {
    // `players` is chronological; the last record for a reused slot wins.
    teams.set(player.num, player.team);
  }
  return teams;
}

function isPlaced(x: number | undefined, y: number | undefined, bounds: MapBounds): boolean {
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= bounds.minX &&
    x <= bounds.maxX &&
    y >= bounds.minY &&
    y <= bounds.maxY
  );
}

/**
 * Joins the scanned damage events with their recorded positions.  The summary
 * stores coordinates in world units; the map image bounds decide whether they
 * are inside the drawable footprint (players outside it would draw off-map).
 */
export function buildDamageHeatmapSource(
  game: DemoGameSummary,
  bounds: MapBounds
): DamageHeatmapSource {
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const cellSize = Math.max(worldWidth, worldHeight) / HEATMAP_MAX_EDGE;
  const columns = Math.max(8, Math.ceil(worldWidth / cellSize));
  const rows = Math.max(8, Math.ceil(worldHeight / cellSize));
  const teams = playerTeams(game);

  const events: DamageHeatmapEvent[] = [];
  let givenDamage = 0;
  let givenTotal = 0;
  let receivedDamage = 0;
  let receivedTotal = 0;

  for (const damage of game.damages ?? []) {
    if (!(damage.damage > 0)) continue;
    const attackerTeam = teams.get(damage.attacker) ?? 0;
    const targetTeam = teams.get(damage.target) ?? 0;
    const ax = isPlaced(damage.ax, damage.ay, bounds) ? damage.ax : undefined;
    const ay = ax === undefined ? undefined : damage.ay;
    const tx = isPlaced(damage.tx, damage.ty, bounds) ? damage.tx : undefined;
    const ty = tx === undefined ? undefined : damage.ty;

    if (attackerTeam === 1 || attackerTeam === 2) givenTotal += damage.damage;
    if (targetTeam === 1 || targetTeam === 2) receivedTotal += damage.damage;
    if (ax !== undefined && (attackerTeam === 1 || attackerTeam === 2)) givenDamage += damage.damage;
    if (tx !== undefined && (targetTeam === 1 || targetTeam === 2)) receivedDamage += damage.damage;

    events.push({
      time: damage.time,
      damage: damage.damage,
      attacker: damage.attacker,
      target: damage.target,
      attackerTeam,
      targetTeam,
      ax,
      ay,
      tx,
      ty
    });
  }

  return {
    bounds,
    columns,
    rows,
    cellSize,
    events,
    totalEvents: game.damages?.length ?? 0,
    givenDamage,
    givenTotal,
    receivedDamage,
    receivedTotal
  };
}

function gaussian(distanceSquared: number): number {
  return Math.exp(-distanceSquared / (2 * KERNEL_SIGMA * KERNEL_SIGMA));
}

/**
 * Builds one grid for a team or a player.  A team filter aggregates every
 * player on that team; a player filter aggregates that one client.  Layers
 * with no filter would show all damage, which the UI never asks for.
 */
export function rasterizeHeatmap(
  source: DamageHeatmapSource,
  kind: DamageHeatmapKind,
  filter: DamageHeatmapFilter
): HeatmapGrid {
  const { columns, rows, bounds, cellSize } = source;
  const weights = new Float32Array(columns * rows);
  let total = 0;
  let events = 0;

  for (const event of source.events) {
    const x = kind === 'given' ? event.ax : event.tx;
    const y = kind === 'given' ? event.ay : event.ty;
    if (x === undefined || y === undefined) continue;
    if (filter.player !== undefined) {
      const num = kind === 'given' ? event.attacker : event.target;
      if (num !== filter.player) continue;
    }
    if (filter.team !== undefined) {
      const team = kind === 'given' ? event.attackerTeam : event.targetTeam;
      if (team !== filter.team) continue;
    }

    // Grid space: column 0 is the left edge, row 0 the top (max Y), matching
    // the minimap image orientation.
    const cx = (x - bounds.minX) / cellSize;
    const cy = (bounds.maxY - y) / cellSize;
    const baseColumn = Math.floor(cx);
    const baseRow = Math.floor(cy);
    total += event.damage;
    events++;
    for (let dy = -KERNEL_RADIUS; dy <= KERNEL_RADIUS; dy++) {
      const row = baseRow + dy;
      if (row < 0 || row >= rows) continue;
      const oy = row + 0.5 - cy;
      for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
        const column = baseColumn + dx;
        if (column < 0 || column >= columns) continue;
        const ox = column + 0.5 - cx;
        weights[row * columns + column] += event.damage * gaussian(ox * ox + oy * oy);
      }
    }
  }

  let max = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] > max) max = weights[i];
  }
  return { columns, rows, weights, max, total, events };
}

/** Peak of the grids, used to share a colour scale between two teams. */
export function combinedMax(grids: readonly HeatmapGrid[]): number {
  let max = 0;
  for (const grid of grids) {
    if (grid.max > max) max = grid.max;
  }
  return max;
}

/** A damage total per client, for the legend and the detail view. */
export function playerDamageTotals(
  game: DemoGameSummary,
  num: number
): { dealt: number; received: number; placedDealt: number; placedReceived: number } {
  let dealt = 0;
  let received = 0;
  let placedDealt = 0;
  let placedReceived = 0;
  for (const damage of game.damages ?? []) {
    if (!(damage.damage > 0)) continue;
    if (damage.attacker === num) {
      dealt += damage.damage;
      if (typeof damage.ax === 'number') placedDealt += damage.damage;
    }
    if (damage.target === num) {
      received += damage.damage;
      if (typeof damage.tx === 'number') placedReceived += damage.damage;
    }
  }
  return { dealt, received, placedDealt, placedReceived };
}

/** Team damage totals for the legend. */
export function teamDamageTotals(
  game: DemoGameSummary,
  team: number
): { given: number; received: number } {
  const teams = playerTeams(game);
  let given = 0;
  let received = 0;
  for (const damage of game.damages ?? []) {
    if (!(damage.damage > 0)) continue;
    if (teams.get(damage.attacker) === team) given += damage.damage;
    if (teams.get(damage.target) === team) received += damage.damage;
  }
  return { given, received };
}

/** True when this summary carries the scan-time damage positions. */
export function hasDamagePositions(game: DemoGameSummary): boolean {
  for (const damage of game.damages ?? []) {
    if (typeof damage.ax === 'number' || typeof damage.tx === 'number') return true;
  }
  return false;
}
