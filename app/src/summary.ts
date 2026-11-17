import type { DemoGameSummary, DemoSummary, ScoreboardData, ScoreboardPlayer } from './types';

export function chooseGame(summary: DemoSummary, serverTime: number): DemoGameSummary | null {
  if (!summary.games.length) return null;
  let previous: DemoGameSummary | null = null;
  for (const game of summary.games) {
    if (game.startTime <= serverTime) previous = game;
    if (serverTime >= game.startTime && serverTime <= game.endTime) return game;
  }
  // In the short gap between a game end and the next start, keep the previous
  // game's stats/timer rather than jumping to the last game.
  return previous ?? summary.games[0];
}

export interface PlayerStats {
  kills: number;
  deaths: number;
}

export interface PlayerVitals {
  health: number;
  armor: number;
  dead: boolean;
}

/**
 * Replays the scanned vitals samples up to `serverTime`. Players without a
 * sample yet (or demos/summaries without vitals) keep the spawn defaults:
 * 100 health and 25 armor.
 */
export function vitalsAt(game: DemoGameSummary, serverTime: number): Map<number, PlayerVitals> {
  const vitals = new Map<number, PlayerVitals>();
  const ensure = (num: number): PlayerVitals => {
    let value = vitals.get(num);
    if (!value) {
      value = { health: 100, armor: 25, dead: false };
      vitals.set(num, value);
    }
    return value;
  };

  for (const player of game.players) ensure(player.num);
  for (const sample of game.vitals ?? []) {
    if (sample.time > serverTime) break;
    const value = ensure(sample.num);
    if (sample.health >= 0) {
      value.health = sample.health;
      value.dead = sample.health <= 0;
    }
    if (sample.armor >= 0) value.armor = sample.armor;
  }
  return vitals;
}

/** Replays the scanned saber-stance samples up to `serverTime`. */
export function stanceAt(game: DemoGameSummary, serverTime: number): Map<number, number> {
  const stances = new Map<number, number>();
  for (const sample of game.stances ?? []) {
    if (sample.time > serverTime) break;
    stances.set(sample.num, sample.stance);
  }
  return stances;
}

export interface PlayerDamage {
  /** Damage this player dealt to other players (attributed only). */
  dealt: number;
  /** Damage this player received from other players (attributed only). */
  received: number;
  /** Damage this player received from unknown/world sources. */
  receivedUnknown: number;
  /** Per-target matrix, kept for the later per-player breakdown. */
  dealtTo: Map<number, number>;
  /** Per-attacker matrix, kept for the later per-player breakdown. */
  receivedFrom: Map<number, number>;
}

/** Replays the scanned damage instances up to `serverTime`. */
export function damageAt(game: DemoGameSummary, serverTime: number): Map<number, PlayerDamage> {
  const result = new Map<number, PlayerDamage>();
  const ensure = (num: number): PlayerDamage => {
    let value = result.get(num);
    if (!value) {
      value = {
        dealt: 0,
        received: 0,
        receivedUnknown: 0,
        dealtTo: new Map(),
        receivedFrom: new Map()
      };
      result.set(num, value);
    }
    return value;
  };

  for (const player of game.players) ensure(player.num);
  for (const event of game.damages ?? []) {
    if (event.time > serverTime) break;
    if (event.damage <= 0) continue;
    const target = ensure(event.target);
    target.receivedFrom.set(event.attacker, (target.receivedFrom.get(event.attacker) ?? 0) + event.damage);
    if (event.attacker < 0) {
      target.receivedUnknown += event.damage;
      continue;
    }
    const attacker = ensure(event.attacker);
    attacker.dealt += event.damage;
    attacker.dealtTo.set(event.target, (attacker.dealtTo.get(event.target) ?? 0) + event.damage);
    target.received += event.damage;
  }
  return result;
}

export function statsAt(game: DemoGameSummary, serverTime: number): Map<number, PlayerStats> {
  const stats = new Map<number, PlayerStats>();
  for (const player of game.players) {
    stats.set(player.num, { kills: 0, deaths: 0 });
  }
  for (const event of game.events) {
    if (event.time > serverTime) break;
    const target = stats.get(event.target);
    if (target) target.deaths++;
    if (event.attacker >= 0 && event.attacker !== event.target) {
      const attacker = stats.get(event.attacker);
      if (attacker) attacker.kills++;
    }
  }
  return stats;
}

/**
 * Replaces the cgame's event counters with the exact counts replayed from the
 * parsed demo summary, and keeps players who left the game in the list with
 * `left: true` so the UI can grey them out.
 */
export function mergeScoreboard(
  data: ScoreboardData,
  summary: DemoSummary | null,
  serverTime: number
): ScoreboardData {
  if (!summary) return data;
  const game = chooseGame(summary, serverTime);
  if (!game) return data;

  const stats = statsAt(game, serverTime);
  const vitals = game.vitals ? vitalsAt(game, serverTime) : new Map<number, PlayerVitals>();
  const stances = game.stances ? stanceAt(game, serverTime) : new Map<number, number>();
  const damage = game.damages ? damageAt(game, serverTime) : new Map<number, PlayerDamage>();
  const players: ScoreboardPlayer[] = [];
  const used = new Set<number>();

  for (const player of data.players) {
    const value = stats.get(player.num);
    const life = vitals.get(player.num);
    const hit = damage.get(player.num);
    players.push({
      ...player,
      score: value ? value.kills : player.score,
      kills: value ? value.kills : player.kills,
      deaths: value ? value.deaths : player.deaths,
      health: life ? life.health : player.health,
      armor: life ? life.armor : player.armor,
      damageDealt: hit ? hit.dealt : player.damageDealt,
      damageReceived: hit ? hit.received : player.damageReceived,
      left: false
    });
    used.add(player.num);
  }

  let synthetic = -1;
  for (const record of game.players) {
    if (record.team === 3) continue; // spectators
    const left = record.left && !record.returned;
    if (used.has(record.num) && !left) continue;
    const value = stats.get(record.num) ?? { kills: record.kills, deaths: record.deaths };
    const life = vitals.get(record.num) ?? { health: 100, armor: 25, dead: false };
    const hit = damage.get(record.num);
    const num = used.has(record.num) ? synthetic-- : record.num;
    players.push({
      num,
      name: record.name,
      score: value.kills,
      kills: value.kills,
      deaths: value.deaths,
      ping: 0,
      team: record.team,
      left,
      health: life.health,
      armor: life.armor,
      damageDealt: hit ? hit.dealt : undefined,
      damageReceived: hit ? hit.received : undefined
    });
    used.add(record.num);
  }

  let view = data.view;
  if (view) {
    const life = vitals.get(view.num);
    // Remote players have no health/armor/style in the snapshot; the scanned
    // timelines supply them. The recorded POV keeps its exact playerState style
    // (0-7), which is richer than the 2-bit fireflag the scan captures.
    const style = view.saberStyle < 0 ? stances.get(view.num) : undefined;
    if (life || style !== undefined) {
      view = {
        ...view,
        health: life ? life.health : view.health,
        armor: life ? life.armor : view.armor,
        saberStyle: style !== undefined ? style : view.saberStyle
      };
    }
  }

  return { ...data, players, view };
}
