import { useMemo } from 'react';
import type { DemoEvent, DemoGameSummary, DemoPlayerSummary } from '../types';

interface KillFeedProps {
  game: DemoGameSummary | null;
  /** Current demo server time; the feed shows kills from the last few seconds. */
  serverTime: number;
}

/** How long a kill stays in the feed, in demo time. */
const FEED_WINDOW_MS = 6500;
/** Keep the feed from covering the video on a busy fight. */
const MAX_ROWS = 4;

// bg_public.h meansOfDeath_t: group the splash variants with their weapon.
const MOD_LABELS: Record<number, string> = {
  1: 'Baton',
  2: 'Melee',
  3: 'Saber',
  4: 'Bryar',
  5: 'Bryar',
  6: 'Blaster',
  7: 'Blaster',
  8: 'Disruptor',
  9: 'Disruptor',
  10: 'Disruptor',
  11: 'Bowcaster',
  12: 'Repeater',
  13: 'Repeater',
  14: 'Repeater',
  15: 'DEMP2',
  16: 'DEMP2',
  17: 'Flechette',
  18: 'Flechette',
  19: 'Rocket',
  20: 'Rocket',
  21: 'Rocket',
  22: 'Rocket',
  23: 'Thermal',
  24: 'Thermal',
  25: 'Trip mine',
  26: 'Timed mine',
  27: 'Det pack',
  28: 'Vehicle',
  29: 'Concussion',
  30: 'Concussion',
  31: 'Force',
  32: 'Sentry',
  37: 'Telefrag'
};

function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

function teamClass(team: number | undefined): string {
  if (team === 1) return 'kill-feed-name team-1';
  if (team === 2) return 'kill-feed-name team-2';
  return 'kill-feed-name';
}

/** Index of the last event at or before `time`; events are in scan order. */
function lastEventAt(events: DemoEvent[], time: number): number {
  let low = 0;
  let high = events.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (events[mid].time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

interface FeedRow {
  key: string;
  killer: string;
  killerTeam: number | undefined;
  victim: string;
  victimTeam: number | undefined;
  weapon: string | undefined;
}

export function KillFeed({ game, serverTime }: KillFeedProps) {
  const players = useMemo(() => {
    const map = new Map<number, DemoPlayerSummary>();
    if (game) for (const player of game.players) map.set(player.num, player);
    return map;
  }, [game]);

  const rows = useMemo<FeedRow[]>(() => {
    if (!game || game.events.length === 0 || serverTime <= 0) return [];
    const rows: FeedRow[] = [];
    const last = lastEventAt(game.events, serverTime);
    for (let i = last; i >= 0 && rows.length < MAX_ROWS; i--) {
      const event = game.events[i];
      if (serverTime - event.time > FEED_WINDOW_MS) break;
      // Environment deaths and suicides have no killer to show.
      if (event.attacker < 0 || event.attacker === event.target) continue;
      const killer = players.get(event.attacker);
      const victim = players.get(event.target);
      rows.push({
        key: `${event.time}:${event.attacker}:${event.target}`,
        killer: stripColors(killer?.name ?? 'Unknown'),
        killerTeam: killer?.team,
        victim: stripColors(victim?.name ?? 'Unknown'),
        victimTeam: victim?.team,
        weapon: MOD_LABELS[event.mod]
      });
    }
    return rows;
  }, [game, players, serverTime]);

  if (rows.length === 0) return null;

  return (
    <div className="kill-feed" aria-live="polite">
      {rows.map(row => (
        <div className="kill-feed-row" key={row.key}>
          <span className={teamClass(row.killerTeam)}>{row.killer}</span>
          {row.weapon ? <span className="kill-feed-weapon">{row.weapon}</span> : null}
          <span className={teamClass(row.victimTeam)}>{row.victim}</span>
        </div>
      ))}
    </div>
  );
}
