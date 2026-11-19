import { useMemo, useState } from 'react';
import type { DemoGameSummary, DemoPlayerSummary, DemoScriptFlag, DemoSummary } from '../types';
import { formatTime } from '../format';
import { stripColors } from '../saber';

interface ScriptFlagsPanelProps {
  summary: DemoSummary;
  /** Seek to just before `time` and follow `followNum` (-1 keeps the demo POV). */
  onWatch: (time: number, followNum: number) => void;
  busy: boolean;
}

const CHANNEL_LABELS = ['Yaw wiggle', 'Pitch wiggle'];

interface FlagRow {
  gameIndex: number;
  game: DemoGameSummary;
  flag: DemoScriptFlag;
  player: DemoPlayerSummary | null;
}

/**
 * The demo's slot number can be reused after a player leaves, so prefer the
 * record whose time window contains the finding.
 */
function playerFor(game: DemoGameSummary, num: number, time: number): DemoPlayerSummary | null {
  const candidates = game.players.filter(player => player.num === num);
  if (candidates.length === 0) return null;
  return (
    candidates.find(player => player.firstSeen <= time && player.lastSeen >= time) ??
    candidates[candidates.length - 1]
  );
}

function playerLabel(player: DemoPlayerSummary | null, num: number): string {
  if (!player) return `Client ${num}`;
  const name = stripColors(player.name).trim();
  return name || `Client ${num}`;
}

function secondsBetween(from: number, to: number): string {
  return ((Math.max(0, to - from)) / 1000).toFixed(1);
}

function swingDegrees(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

/**
 * Possible input-script findings from the demo's view-angle scan. The panel is
 * informational: like the missing-asset warning it never gates Play. Expanding
 * it lists every flagged player with the figures behind the finding and a link
 * that seeks to the moment before the burst with that player followed.
 */
export function ScriptFlagsPanel({ summary, onWatch, busy }: ScriptFlagsPanelProps) {
  const [open, setOpen] = useState(false);

  const rows = useMemo<FlagRow[]>(() => {
    const list: FlagRow[] = [];
    summary.games.forEach((game, gameIndex) => {
      for (const flag of game.scripts ?? []) {
        list.push({ gameIndex, game, flag, player: playerFor(game, flag.num, flag.time) });
      }
    });
    return list.sort(
      (a, b) =>
        b.flag.confidence - a.flag.confidence ||
        a.flag.time - b.flag.time ||
        (a.flag.num - b.flag.num)
    );
  }, [summary]);

  const playerCount = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) seen.add(`${row.gameIndex}:${row.flag.num}`);
    return seen.size;
  }, [rows]);

  if (rows.length === 0) return null;

  const overflow = summary.games.some(game => game.scriptOverflow);

  return (
    <section className="script-flags" aria-label="Input-script findings">
      <button
        type="button"
        className="script-flags-toggle"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="script-flags-mark" aria-hidden="true">!</span>
        <span className="script-flags-copy">
          <strong>
            {rows.length} possible input {rows.length === 1 ? 'script' : 'scripts'} detected
          </strong>
          <span className="muted">
            {playerCount} {playerCount === 1 ? 'player' : 'players'} · view-angle bursts faster
            than a hand can make
          </span>
        </span>
        <span className="script-flags-more">{open ? 'Hide details' : 'Show details'}</span>
      </button>

      {open ? (
        <div className="script-flags-body">
          <p className="fineprint script-flags-intro">
            A demo does not store the keys a player pressed. These findings come from the view
            angles the server snapshots carry, which still show a config macro: five or more view
            reversals closer than 100 ms apart (four when the same bind was already flagged), with a
            turn-key step profile (every snapshot moves the view by close to the same amount) and a
            swing of at least 2°. A hand-driven mouse wiggle ramps up and down instead, and is
            ignored. Treat a finding as evidence to look at, not proof — a burst faster than the
            snapshot rate can also fold or hide.
          </p>

          <ul className="script-flags-list">
            {rows.map(row => {
              const { flag, game, gameIndex, player } = row;
              const label = CHANNEL_LABELS[flag.channel] ?? 'View wiggle';
              const isPov = game.pov !== undefined && game.pov === flag.num;
              const followNum = isPov ? -1 : flag.num;
              const strong = flag.confidence > 0;
              return (
                <li key={`${gameIndex}-${flag.num}-${flag.channel}-${flag.time}`}>
                  <div className="script-flags-row">
                    <span className="script-flags-player">
                      {playerLabel(player, flag.num)}
                      {isPov ? <span className="script-flags-tag">recorded POV</span> : null}
                    </span>
                    <span className={strong ? 'script-flags-badge strong' : 'script-flags-badge'}>
                      {strong ? 'strong' : 'possible'}
                    </span>
                    <span className="muted script-flags-when">
                      {game.map} · {formatTime(Math.max(0, flag.time - game.startTime))} into the game
                    </span>
                  </div>
                  <p className="script-flags-what">
                    {label} · {flag.reversals} reversals
                    {(flag.bursts ?? 1) > 1 ? ` per burst · ${flag.bursts} bursts` : ''} over{' '}
                    {secondsBetween(flag.time, flag.endTime)} s ·{' '}
                    {Math.max(1, Math.round(flag.meanMs))} ms apart
                  </p>
                  <p className="fineprint script-flags-evidence">
                    {swingDegrees(flag.swing)}° peak to peak · {flag.step}% step consistency over{' '}
                    {flag.samples} snapshots
                  </p>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => onWatch(flag.time, followNum)}
                  >
                    Watch this moment →
                  </button>
                </li>
              );
            })}
          </ul>

          {overflow ? (
            <p className="fineprint">Some findings were truncated from this very long demo.</p>
          ) : null}
          <p className="fineprint">
            “Watch this moment” starts the demo, seeks to two seconds before the first reversal and
            follows that player (the recorded POV stays first-person when it is the one flagged).
          </p>
        </div>
      ) : null}
    </section>
  );
}
