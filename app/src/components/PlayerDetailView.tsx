import { useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DemoGameSummary, DemoSummary } from '../types';
import { formatTime } from '../format';
import {
  blockStats,
  damageGiven,
  damageTotals,
  meanValue,
  medianValue,
  movementCounts,
  opponentDamage,
  opponentSwingCombos,
  playerCombos,
  playerLabel,
  stripColors,
  successRate,
  swingBuckets,
  swingTotals
} from '../saber';
import type { SaberComboStats, SaberContactComboStats, SwingWindow } from '../saber';
import { ChartMomentBar } from './ChartMomentBar';
import { DamageHeatmapPanel } from './DamageHeatmapPanel';
import { PLAYER_HEATMAP_MODES } from '../map/damageHeatmap';

const SERIES_COLORS = [
  '#5fb3ff',
  '#f2b134',
  '#7bdc9a',
  '#ff8fa3',
  '#c792ea',
  '#4dd0e1',
  '#ffa94d',
  '#a3e635'
];

interface PlayerDetailViewProps {
  summary: DemoSummary;
  /** Start the demo at an absolute demo time, in ms. */
  onPlayFrom?: (timeMs: number) => void;
  busy?: boolean;
  canPlay?: boolean;
  /** Map name from the wizard; the game's own map is preferred. */
  mapName: string;
  /** PK3s the heatmap image is generated from. */
  mapFiles: readonly Blob[];
}

function initialGameIndex(games: DemoGameSummary[]): number {
  let best = 0;
  let bestScore = -1;
  games.forEach((game, index) => {
    const score = (game.swings?.length ?? 0) + game.events.length * 2;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

function detailPlayers(game: DemoGameSummary) {
  // One option per slot.  A slot can be reused after a leave; the latest
  // record wins and its firstSeen/lastSeen window scopes the stats.
  const byNum = new Map<number, DemoGameSummary['players'][number]>();
  for (const player of game.players) {
    if (player.team === 3 && player.kills === 0 && player.deaths === 0) continue;
    const existing = byNum.get(player.num);
    if (!existing || player.lastSeen > existing.lastSeen) byNum.set(player.num, player);
  }
  return [...byNum.values()].sort(
    (a, b) =>
      b.kills - a.kills ||
      a.deaths - b.deaths ||
      stripColors(a.name).localeCompare(stripColors(b.name))
  );
}

function pickPlayer(game: DemoGameSummary, players: DemoGameSummary['players']): number {
  if (game.pov !== undefined && players.some(player => player.num === game.pov)) return game.pov;
  return players[0]?.num ?? 0;
}

function bucketFor(duration: number): number {
  if (duration <= 120000) return 5000;
  if (duration <= 600000) return 15000;
  return 30000;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDamage(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function comboName(combo: { saberLabel: string; stanceLabel: string }): string {
  return `${combo.saberLabel} · ${combo.stanceLabel}`;
}

type SwingCombo = SaberComboStats | SaberContactComboStats;

/**
 * The grouped swing-type table. The global view reports the swing total and
 * hit rate; a single-opponent view drops them because swing totals cannot be
 * attributed to one target, leaving the swings that connected.
 */
function SwingTypesTable({ combos, scoped }: { combos: SwingCombo[]; scoped: boolean }) {
  return (
    <div className="detail-scroll">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Swing</th>
            {scoped ? null : <th className="num">Swings</th>}
            <th className="num">{scoped ? 'Successful swings' : 'Successful'}</th>
            {scoped ? null : <th className="num">Hit rate</th>}
            <th className="num">Hit events</th>
            <th
              className="num"
              title={
                scoped
                  ? 'Attributed damage to this opponent on these swings'
                  : 'Raw damage of these swings; ally damage is included'
              }
            >
              Damage
            </th>
            <th className="num" title="Damage per swing that carried a damage sample">
              Avg / swing
            </th>
          </tr>
        </thead>
        {combos.map(combo => {
          const comboSwings = 'swings' in combo ? combo.swings : undefined;
          return (
            <tbody key={combo.key}>
              <tr className="detail-group">
                <td colSpan={scoped ? 5 : 7}>
                  {comboName(combo)}
                  <span className="muted">
                    {' '}
                    · {combo.saberName} ·{' '}
                    {scoped ? `${combo.successful} successful swings` : `${comboSwings} swings`} ·{' '}
                    {combo.hits} hit events
                  </span>
                </td>
              </tr>
              {combo.types.map(type => {
                const typeSwings = 'swings' in type ? type.swings : undefined;
                return (
                  <tr key={`${combo.key}-${type.move}`}>
                    <td>{type.label}</td>
                    {scoped ? null : <td className="num">{typeSwings}</td>}
                    <td className="num">{type.successful}</td>
                    {scoped ? null : (
                      <td className="num">
                        {formatPercent(successRate(type.successful, typeSwings ?? 0))}
                      </td>
                    )}
                    <td className="num">{type.hits}</td>
                    <td className="num">{type.damage}</td>
                    <td
                      className="num"
                      title={`${type.samples.length} swings with a damage sample`}
                    >
                      {type.samples.length ? formatDamage(meanValue(type.samples)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

interface ChartPoint {
  time: number;
  value: number;
}

interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: ChartPoint[];
  /** Value shown in the legend when not hovering (e.g. the overall rate). */
  summary?: number;
}

interface LineChartProps {
  series: ChartSeries[];
  duration: number;
  yMax?: number;
  yFormat: (value: number) => string;
  ariaLabel: string;
  emptyText: string;
  /** Legend word for the non-hover value; "final" for cumulative charts. */
  summaryLabel?: string;
  /** Start playback at the pinned moment (relative to the chart). */
  onPlayFrom?: (timeMs: number) => void;
  busy?: boolean;
  canPlay?: boolean;
}

const WIDTH = 560;
const HEIGHT = 190;
const PAD_LEFT = 42;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

function niceScale(series: ChartSeries[], yMax?: number): { min: number; max: number; ticks: number[] } {
  let min = 0;
  let max = yMax ?? 0;
  if (yMax === undefined) {
    for (const entry of series) {
      for (const point of entry.points) {
        if (point.value > max) max = point.value;
      }
    }
  }
  if (max <= min) max = min + 1;

  if (yMax !== undefined) {
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(ratio => min + (max - min) * ratio);
    return { min, max, ticks };
  }

  const rawStep = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  const norm = rawStep / magnitude;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude);
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step * 1e-6; value += step) ticks.push(value);
  return { min: low, max: high, ticks };
}

function timeTicks(duration: number): number[] {
  const steps = [10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600].map(seconds => seconds * 1000);
  const step = steps.find(candidate => duration / candidate <= 5) ?? 5400 * 1000;
  const ticks: number[] = [];
  for (let time = 0; time < duration - step * 0.35; time += step) ticks.push(time);
  ticks.push(duration);
  return ticks;
}

function valueAt(series: ChartSeries, time: number): number {
  let value = 0;
  for (const point of series.points) {
    if (point.time > time) break;
    value = point.value;
  }
  return value;
}

function LineChart({
  series,
  duration,
  yMax,
  yFormat,
  ariaLabel,
  emptyText,
  summaryLabel = 'final',
  onPlayFrom,
  busy,
  canPlay
}: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const plotDuration = Math.max(1, duration);
  const scale = niceScale(series, yMax);
  const x = (time: number) => PAD_LEFT + (Math.min(plotDuration, Math.max(0, time)) / plotDuration) * PLOT_WIDTH;
  const y = (value: number) => {
    const ratio = (value - scale.min) / Math.max(1e-6, scale.max - scale.min);
    return PAD_TOP + (1 - ratio) * PLOT_HEIGHT;
  };

  if (!series.some(entry => entry.points.length > 1)) {
    return <p className="muted detail-empty">{emptyText}</p>;
  }

  const onMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    setHover(Math.min(plotDuration, Math.max(0, ratio * plotDuration)));
  };

  const onSelect = (event: ReactPointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    const time = Math.min(plotDuration, Math.max(0, ratio * plotDuration));
    setSelected(time);
    setHover(time);
  };

  // The crosshair follows the pointer, then falls back to the pinned moment.
  const cursor = hover ?? selected;

  return (
    <div className="detail-chart">
      <svg className="demo-trend-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {scale.ticks.map(value => (
          <g key={`y-${value}`}>
            <line
              className={value === 0 ? 'demo-trend-zero' : 'demo-trend-grid'}
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={y(value)}
              y2={y(value)}
            />
            <text className="demo-trend-axis" x={PAD_LEFT - 6} y={y(value) + 3} textAnchor="end">
              {yFormat(value)}
            </text>
          </g>
        ))}
        {timeTicks(plotDuration).map(time => (
          <text
            className="demo-trend-axis"
            key={`x-${time}`}
            x={x(time)}
            y={HEIGHT - 7}
            textAnchor={time === 0 ? 'start' : time === plotDuration ? 'end' : 'middle'}
          >
            {formatTime(time)}
          </text>
        ))}
        {series.map(entry => {
          if (!entry.points.length) return null;
          const path = entry.points
            .map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(1)} ${y(point.value).toFixed(1)}`)
            .join(' ');
          return <path className="demo-trend-line" key={entry.key} d={path} style={{ stroke: entry.color }} />;
        })}
        {selected !== null ? (
          <line
            className="demo-trend-select"
            x1={x(selected)}
            x2={x(selected)}
            y1={PAD_TOP}
            y2={HEIGHT - PAD_BOTTOM}
          />
        ) : null}
        {hover !== null && hover !== selected ? (
          <g>
            <line className="demo-trend-hover" x1={x(hover)} x2={x(hover)} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} />
            {series.map(entry => (
              <circle
                className="demo-trend-dot"
                key={`hover-${entry.key}`}
                cx={x(hover)}
                cy={y(valueAt(entry, hover))}
                r={2.4}
                style={{ fill: entry.color }}
              />
            ))}
          </g>
        ) : null}
        {cursor !== null ? (
          <g>
            {series.map(entry => (
              <circle
                className="demo-trend-dot"
                key={`cursor-${entry.key}`}
                cx={x(cursor)}
                cy={y(valueAt(entry, cursor))}
                r={2.4}
                style={{ fill: entry.color }}
              />
            ))}
          </g>
        ) : null}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={PLOT_WIDTH}
          height={PLOT_HEIGHT}
          fill="none"
          pointerEvents="all"
          onPointerMove={onMove}
          onPointerDown={onSelect}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <div className="demo-trend-legend">
        <span className="demo-trend-time">{cursor !== null ? `at ${formatTime(cursor)}` : summaryLabel}</span>
        {series.map(entry => {
          const lastValue = entry.points[entry.points.length - 1]?.value ?? 0;
          return (
            <span className="demo-trend-key" key={entry.key}>
              <i style={{ background: entry.color }} />
              <span className="demo-trend-name">{entry.label}</span>
              <b>{yFormat(cursor !== null ? valueAt(entry, cursor) : entry.summary ?? lastValue)}</b>
            </span>
          );
        })}
      </div>
      {onPlayFrom ? (
        <ChartMomentBar
          selected={selected}
          duration={plotDuration}
          onPlay={onPlayFrom}
          onClear={() => setSelected(null)}
          busy={busy}
          canPlay={canPlay}
        />
      ) : null}
    </div>
  );
}

export function PlayerDetailView({
  summary,
  onPlayFrom,
  busy,
  canPlay,
  mapName,
  mapFiles
}: PlayerDetailViewProps) {
  const games = summary.games;
  const [gameIndex, setGameIndex] = useState(() => initialGameIndex(games));
  const game = games[Math.min(gameIndex, Math.max(0, games.length - 1))];
  const players = useMemo(() => detailPlayers(game), [game]);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [selectedOpponent, setSelectedOpponent] = useState<number | null>(null);
  const num =
    selectedPlayer !== null && players.some(player => player.num === selectedPlayer)
      ? selectedPlayer
      : pickPlayer(game, players);
  const record = players.find(player => player.num === num);
  const windowFrom = record?.firstSeen;
  const windowTo = record?.lastSeen;
  const window = useMemo<SwingWindow | undefined>(
    () => (windowFrom !== undefined && windowTo !== undefined ? { from: windowFrom, to: windowTo } : undefined),
    [windowFrom, windowTo]
  );

  const opponents = useMemo(() => players.filter(player => player.num !== num), [players, num]);
  const opponentNum =
    selectedOpponent !== null && opponents.some(player => player.num === selectedOpponent)
      ? selectedOpponent
      : null;
  const playerName = playerLabel(game, num);
  const opponentName = opponentNum !== null ? playerLabel(game, opponentNum) : null;

  const combos = useMemo(() => playerCombos(game, num, window), [game, num, window]);
  const totals = useMemo(() => swingTotals(combos), [combos]);
  const pairs = useMemo(() => opponentDamage(game, num, window), [game, num, window]);
  const opponentPair =
    opponentNum === null ? null : pairs.find(entry => entry.num === opponentNum) ?? null;
  const blocks = useMemo(
    () => blockStats(game, num, window, opponentNum ?? undefined),
    [game, num, window, opponentNum]
  );
  const movement = useMemo(
    () => movementCounts(game, num, window, opponentNum ?? undefined),
    [game, num, window, opponentNum]
  );
  const given = useMemo(() => damageGiven(game, num, window), [game, num, window]);
  const contactCombos = useMemo(
    () => (opponentNum === null ? [] : opponentSwingCombos(game, num, opponentNum, window)),
    [game, num, opponentNum, window]
  );
  const bucketMs = bucketFor(game.duration);
  const buckets = useMemo(
    () => swingBuckets(game, num, bucketMs, undefined, window),
    [game, num, bucketMs, window]
  );

  const rateSeries = useMemo<ChartSeries[]>(() => {
    const series: ChartSeries[] = [];
    const bucketCount = buckets.length;
    const rates = new Map<string, Array<{ swings: number; successful: number }>>();
    for (const swing of game.swings ?? []) {
      if (swing.num !== num) continue;
      if (window && (swing.time < window.from || swing.time > window.to)) continue;
      const key = `${swing.saber}:${swing.stance}`;
      let list = rates.get(key);
      if (!list) {
        list = Array.from({ length: bucketCount }, () => ({ swings: 0, successful: 0 }));
        rates.set(key, list);
      }
      const relative = Math.min(game.duration, Math.max(0, swing.time - game.startTime));
      const index = Math.min(bucketCount - 1, Math.floor(relative / bucketMs));
      list[index].swings++;
      if (swing.hits > 0) list[index].successful++;
    }

    const overallPoints = buckets
      .filter(bucket => bucket.swings > 0)
      .map(bucket => ({
        time: (bucket.time + bucket.end) / 2,
        value: successRate(bucket.successful, bucket.swings) * 100
      }));
    if (overallPoints.length > 1) {
      series.push({
        key: 'all',
        label: 'All swings',
        color: 'rgba(224, 230, 239, 0.75)',
        points: overallPoints,
        summary: successRate(totals.successful, totals.swings) * 100
      });
    }
    combos.forEach((combo, comboIndex) => {
      const list = rates.get(combo.key);
      if (!list) return;
      const points = list
        .map((bucket, index) => ({ bucket, index }))
        .filter(({ bucket }) => bucket.swings > 0)
        .map(({ bucket, index }) => ({
          time: (buckets[index].time + buckets[index].end) / 2,
          value: (bucket.successful / bucket.swings) * 100
        }));
      if (points.length) {
        series.push({
          key: combo.key,
          label: comboName(combo),
          color: SERIES_COLORS[comboIndex % SERIES_COLORS.length],
          points,
          summary: successRate(combo.successful, combo.swings) * 100
        });
      }
    });
    return series;
  }, [buckets, bucketMs, combos, game, num, totals, window]);

  const damageSeries = useMemo<ChartSeries[]>(() => {
    if (opponentNum !== null) {
      if (!opponentPair) return [];
      return [
        {
          key: 'given',
          label: `Given to ${opponentPair.name}`,
          color: SERIES_COLORS[0],
          points: opponentPair.givenSeries
        },
        {
          key: 'received',
          label: `Received from ${opponentPair.name}`,
          color: SERIES_COLORS[3],
          points: opponentPair.receivedSeries
        }
      ];
    }
    const all = damageTotals(game, num, window);
    return [
      {
        key: 'given',
        label: 'Given to players',
        color: SERIES_COLORS[0],
        points: all.givenSeries
      },
      {
        key: 'received',
        label: 'Received from players',
        color: SERIES_COLORS[3],
        points: all.receivedSeries
      }
    ];
  }, [game, num, window, opponentNum, opponentPair]);

  if (!game) return null;

  const recordedPov = game.pov !== undefined && game.pov === num;
  const hasSwings = (game.swings?.length ?? 0) > 0;
  const scopedCombos = opponentNum === null ? combos : contactCombos;
  const damageRows = opponentNum === null ? pairs : pairs.filter(entry => entry.num === opponentNum);
  const movementTotal =
    movement.dealt.air +
    movement.dealt.ground +
    movement.dealt.land +
    movement.received.air +
    movement.received.ground +
    movement.received.land;
  const blockTotal = blocks.won + blocks.lost;
  const blockRate = blockTotal > 0 ? formatPercent(blocks.won / blockTotal) : '—';

  return (
    <section className="player-detail" aria-label="Player detail">
      <div className="player-detail-controls">
        {games.length > 1 ? (
          <label>
            <span>Game</span>
            <select
              value={Math.min(gameIndex, games.length - 1)}
              onChange={event => {
                setGameIndex(Number(event.target.value));
                setSelectedPlayer(null);
                setSelectedOpponent(null);
              }}
            >
              {games.map((entry, index) => (
                <option key={`${entry.startTime}-${index}`} value={index}>
                  {entry.map} · {formatTime(entry.duration)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <span>Player</span>
          <select
            value={num}
            onChange={event => {
              setSelectedPlayer(Number(event.target.value));
              setSelectedOpponent(null);
            }}
          >
            {players.map(player => (
              <option key={player.num} value={player.num}>
                {stripColors(player.name) || `Client ${player.num}`}
                {player.num === game.pov ? ' (recorded POV)' : ''}
              </option>
            ))}
          </select>
        </label>
        {recordedPov ? <span className="detail-tag">Recorded POV</span> : null}
      </div>

      <h4 className="detail-heading">Demo summary</h4>
      {!hasSwings || !game.swings ? (
        <p className="muted detail-empty">
          This summary has no saber swing data. Run Check map again to rescan the demo with the current
          scanner.
        </p>
      ) : (
        <>
          <div className="detail-kpis">
            <div>
              <span className="detail-value">{totals.swings}</span>
              <span className="detail-label">Swings</span>
            </div>
            <div>
              <span className="detail-value">{totals.successful}</span>
              <span className="detail-label">Successful swings</span>
            </div>
            <div>
              <span className="detail-value">{formatPercent(successRate(totals.successful, totals.swings))}</span>
              <span className="detail-label">Hit rate</span>
            </div>
            <div>
              <span className="detail-value">{totals.hits}</span>
              <span className="detail-label">Hit events</span>
            </div>
            <div title="Damage to opponents minus damage to allies">
              <span className="detail-value">{given}</span>
              <span className="detail-label">Damage given</span>
            </div>
            <div>
              <span className="detail-value">{totals.damage}</span>
              <span className="detail-label">Swing damage</span>
            </div>
            <div>
              <span className="detail-value">{totals.samples.length ? formatDamage(meanValue(totals.samples)) : '—'}</span>
              <span className="detail-label">Avg / damaging swing</span>
            </div>
            <div>
              <span className="detail-value">{totals.samples.length ? formatDamage(medianValue(totals.samples)) : '—'}</span>
              <span className="detail-label">Median / damaging swing</span>
            </div>
          </div>

          <h4 className="detail-heading">By saber &amp; stance</h4>
          {combos.length === 0 ? (
            <p className="muted detail-empty">No saber swings were recorded for this player in this game.</p>
          ) : (
            <div className="detail-scroll">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>Saber &amp; stance</th>
                    <th className="num">Swings</th>
                    <th className="num">Successful</th>
                    <th className="num">Hit rate</th>
                    <th className="num">Hit events</th>
                    <th className="num" title="Raw damage of these swings; ally damage is included">Damage</th>
                    <th className="num" title="Damage per swing that carried a damage sample">Avg</th>
                    <th className="num" title="Damage per swing that carried a damage sample">Median</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map(combo => (
                    <tr key={combo.key}>
                      <td title={`${combo.saberName} · ${combo.stanceLabel}`}>
                        {combo.saberLabel} · {combo.stanceLabel}
                      </td>
                      <td className="num">{combo.swings}</td>
                      <td className="num">{combo.successful}</td>
                      <td className="num">{formatPercent(successRate(combo.successful, combo.swings))}</td>
                      <td className="num">{combo.hits}</td>
                      <td className="num">{combo.damage}</td>
                      <td className="num" title={`${combo.samples.length} swings with a damage sample`}>
                        {combo.samples.length ? formatDamage(meanValue(combo.samples)) : '—'}
                      </td>
                      <td className="num" title={`${combo.samples.length} swings with a damage sample`}>
                        {combo.samples.length ? formatDamage(medianValue(combo.samples)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 className="detail-heading">Hit rate over time</h4>
          <p className="fineprint detail-note">
            Successful swings that hit at least one player. Buckets are {Math.round(bucketMs / 1000)} s wide.
          </p>
          <LineChart
            key={`${game.map}-${game.startTime}-rate`}
            series={rateSeries}
            duration={game.duration}
            yMax={100}
            yFormat={value => `${Math.round(value)}%`}
            ariaLabel={`Swing success rate over time for ${playerName} on ${game.map}`}
            emptyText="Not enough swings to chart a hit rate."
            summaryLabel="overall"
            onPlayFrom={onPlayFrom ? time => onPlayFrom(game.startTime + time) : undefined}
            busy={busy}
            canPlay={canPlay}
          />
        </>
      )}

      <div className="detail-section">
        <div className="detail-section-head">
          <h4 className="detail-heading">Against opponents</h4>
          <label className="detail-opponent">
            <span>Opponent</span>
            <select
              aria-label="Opponent scope"
              value={opponentNum ?? 'all'}
              onChange={event =>
                setSelectedOpponent(event.target.value === 'all' ? null : Number(event.target.value))
              }
            >
              <option value="all">All players (global)</option>
              {opponents.map(player => (
                <option key={player.num} value={player.num}>
                  {stripColors(player.name) || `Client ${player.num}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="fineprint detail-note">
          {opponentNum === null
            ? 'Global shows every other player. Pick one opponent to scope the damage, heatmaps, swing types, blocks and movement below.'
            : `Scoped to ${opponentName}. The sections below only count what passed between ${playerName} and ${opponentName}.`}
        </p>

        <h4 className="detail-heading">Damage over time</h4>
        <p className="fineprint detail-note">
          {opponentNum === null
            ? "Attributed damage from the demo's health updates, raw and positive for every other player. The Damage given KPI above subtracts ally damage."
            : `Attributed damage between ${playerName} and ${opponentName}, from the demo's health updates. Damage the demo never exposes stays unknown.`}
        </p>
        <LineChart
          key={`${game.map}-${game.startTime}-pairs-${opponentNum ?? 'all'}`}
          series={damageSeries}
          duration={game.duration}
          yFormat={value => String(Math.round(value))}
          ariaLabel={`Damage given and received by ${playerName}${
            opponentNum === null ? '' : ` against ${opponentName}`
          }`}
          emptyText={
            opponentNum === null
              ? 'No attributed damage against other players was recorded.'
              : `No attributed damage with ${opponentName} was recorded.`
          }
          onPlayFrom={onPlayFrom ? time => onPlayFrom(game.startTime + time) : undefined}
          busy={busy}
          canPlay={canPlay}
        />
        {damageRows.length ? (
          <div className="detail-scroll">
            <table className="detail-table">
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th className="num">Given</th>
                  <th className="num">Received</th>
                  <th className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {damageRows.map(entry => (
                  <tr key={entry.num}>
                    <td>{entry.name}</td>
                    <td className="num">{entry.given || '—'}</td>
                    <td className="num">{entry.received || '—'}</td>
                    <td className="num">{entry.given - entry.received}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <h4 className="detail-heading">Player damage heatmaps</h4>
        <DamageHeatmapPanel
          game={game}
          num={num}
          mapName={mapName}
          files={mapFiles}
          modes={PLAYER_HEATMAP_MODES}
          opponent={opponentNum}
        />

        <h4 className="detail-heading">Swing types</h4>
        <p className="fineprint detail-note">
          {opponentNum === null
            ? 'The demo stores the resolved swing, not the keys held. The seven basic attacks are named after the direction that produces them (forward + attack, forward + left + attack, …).'
            : `Only swings that connected with ${opponentName} are counted. A saber contact is matched to the swing that produced it; swing totals and hit rate are hidden because a swing can hit several players.`}
        </p>
        {scopedCombos.length ? (
          <SwingTypesTable combos={scopedCombos} scoped={opponentNum !== null} />
        ) : (
          <p className="muted detail-empty">
            {opponentNum === null
              ? 'No saber swings were recorded for this player in this game.'
              : `No saber contacts with ${opponentName} were recorded for this player.`}
          </p>
        )}

        <h4 className="detail-heading">Saber blocks</h4>
        <p className="fineprint detail-note">
          A block win is a broken guard: the opponent was parrying and the strike broke the parry,
          or their strike was knocked away, leaving them exposed. Only exchanges with a saber
          contact are counted; wall bounces without one are not.
        </p>
        <div className="detail-inline-stats">
          <span>Won <b>{blocks.won}</b></span>
          <span>Lost <b>{blocks.lost}</b></span>
          <span>
            Win rate <b>{blockRate}</b>
          </span>
        </div>
        {blockTotal > 0 ? (
          <div className="detail-scroll">
            <table className="detail-table">
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th className="num">Won</th>
                  <th className="num">Lost</th>
                </tr>
              </thead>
              <tbody>
                {blocks.opponents.map(entry => (
                  <tr key={entry.num}>
                    <td>{entry.name}</td>
                    <td className="num">{entry.won || '—'}</td>
                    <td className="num">{entry.lost || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted detail-empty">
            {opponentNum === null
              ? 'No broken guards were recorded for this player.'
              : `No broken guards were recorded between ${playerName} and ${opponentName}.`}
          </p>
        )}

        <h4 className="detail-heading">Hits by movement</h4>
        <p className="fineprint detail-note">
          {opponentNum === null
            ? 'Where this player was when the saber contact landed. “Just landed” is within 0.4 s of touching the ground. Counts every saber contact, including ones outside a recorded swing.'
            : `Saber contacts between ${playerName} and ${opponentName}, split by where each player was when the hit landed. “Just landed” is within 0.4 s of touching the ground.`}
        </p>
        {game.saberHits ? (
          opponentNum !== null && movementTotal === 0 ? (
            <p className="muted detail-empty">
              No saber contacts with {opponentName} were recorded for this player.
            </p>
          ) : (
            <div className="detail-scroll">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="num">Dealt</th>
                    <th className="num">Received</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Airborne</td>
                    <td className="num">{movement.dealt.air}</td>
                    <td className="num">{movement.received.air}</td>
                  </tr>
                  <tr>
                    <td>On ground</td>
                    <td className="num">{movement.dealt.ground}</td>
                    <td className="num">{movement.received.ground}</td>
                  </tr>
                  <tr>
                    <td>Just landed</td>
                    <td className="num">{movement.dealt.land}</td>
                    <td className="num">{movement.received.land}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p className="muted detail-empty">
            Movement data is not in this cached summary. Run Check map again to rescan.
          </p>
        )}
      </div>

      {game.swingsOverflow ? (
        <p className="fineprint">Some swings were truncated from this very long demo.</p>
      ) : null}
      {game.saberHitOverflow ? (
        <p className="fineprint">Some saber hits were truncated from this very long demo.</p>
      ) : null}
      {game.blockOverflow ? (
        <p className="fineprint">Some block outcomes were truncated from this very long demo.</p>
      ) : null}
      <p className="fineprint">
        Hit events come from the demo&apos;s saber-hit events, which also fire when the target blocks the
        blade. Damage is only known where the demo exposes the target&apos;s health, so averages and
        medians use the swings that carried a damage sample.
      </p>
    </section>
  );
}
