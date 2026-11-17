import { useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DemoGameSummary } from '../types';
import { formatTime } from '../format';

export type TrendMetric = 'kills' | 'kd' | 'damage' | 'net';

export const TREND_METRICS: Array<{ value: TrendMetric; label: string }> = [
  { value: 'kills', label: 'Kills over time' },
  { value: 'kd', label: 'Kills − deaths over time' },
  { value: 'damage', label: 'Damage over time' },
  { value: 'net', label: 'Damage given − received' }
];

interface TrendSeries {
  key: string;
  label: string;
  color: string;
  points: Array<{ time: number; value: number }>;
  final: number;
}

const PLAYER_COLORS = [
  '#5fb3ff',
  '#f2b134',
  '#7bdc9a',
  '#ff8fa3',
  '#c792ea',
  '#4dd0e1',
  '#ffa94d',
  '#a3e635',
  '#e0e6ef',
  '#f78fb3'
];

function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

/** Same player set and order as the summary table, so colours stay stable. */
function orderedPlayers(game: DemoGameSummary) {
  return [...game.players]
    .filter(player => player.team !== 3 || player.kills > 0 || player.deaths > 0)
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
}

/** Builds one cumulative series per player for one game. */
function buildTrendSeries(game: DemoGameSummary, metric: TrendMetric): TrendSeries[] {
  const duration = Math.max(1, game.duration);
  const players = orderedPlayers(game);
  const byNum = new Map(players.map(player => [player.num, player]));
  const paletteIndex = new Map(players.map((player, index) => [player.num, index]));
  const seriesByKey = new Map<string, TrendSeries>();

  const ensure = (key: string, label: string, color: string): TrendSeries => {
    let series = seriesByKey.get(key);
    if (!series) {
      series = { key, label, color, points: [{ time: 0, value: 0 }], final: 0 };
      seriesByKey.set(key, series);
    }
    return series;
  };

  const seriesFor = (num: number): TrendSeries | null => {
    const player = byNum.get(num);
    if (!player) return null;
    return ensure(
      `p${player.num}`,
      stripColors(player.name),
      PLAYER_COLORS[(paletteIndex.get(player.num) ?? 0) % PLAYER_COLORS.length]
    );
  };

  const add = (num: number, time: number, delta: number) => {
    const series = seriesFor(num);
    if (!series) return;
    const at = Math.min(duration, Math.max(0, time - game.startTime));
    const last = series.points[series.points.length - 1];
    const value = last.value + delta;
    if (last.time === at) last.value = value;
    else series.points.push({ time: at, value });
  };

  if (metric === 'kills' || metric === 'kd') {
    for (const event of game.events) {
      if (event.attacker >= 0 && event.attacker !== event.target) add(event.attacker, event.time, 1);
      if (metric === 'kd') add(event.target, event.time, -1);
    }
  } else {
    for (const event of game.damages ?? []) {
      if (event.damage <= 0 || event.attacker < 0) continue;
      add(event.attacker, event.time, event.damage);
      if (metric === 'net') add(event.target, event.time, -event.damage);
    }
  }

  const series: TrendSeries[] = [];
  for (const entry of seriesByKey.values()) {
    if (!entry.points.some(point => point.value !== 0)) continue;
    const last = entry.points[entry.points.length - 1];
    if (last.time < duration) entry.points.push({ time: duration, value: last.value });
    entry.final = last.value;
    series.push(entry);
  }
  series.sort((a, b) => b.final - a.final || a.label.localeCompare(b.label));
  return series;
}

function valueAt(series: TrendSeries, time: number): number {
  let value = 0;
  for (const point of series.points) {
    if (point.time > time) break;
    value = point.value;
  }
  return value;
}

function formatValue(value: number, metric: TrendMetric): string {
  const rounded = Math.round(value);
  if (metric === 'kd' || metric === 'net') return `${rounded > 0 ? '+' : ''}${rounded}`;
  return String(rounded);
}

function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(value));
}

function valueScale(series: TrendSeries[]): { min: number; max: number; ticks: number[] } {
  let min = 0;
  let max = 0;
  for (const entry of series) {
    for (const point of entry.points) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }
  }
  if (min === max) max = min + 1;

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

const TIME_STEPS = [10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600].map(seconds => seconds * 1000);

function timeTicks(duration: number): number[] {
  const step = TIME_STEPS.find(candidate => duration / candidate <= 5) ?? 5400 * 1000;
  const ticks: number[] = [];
  for (let time = 0; time < duration - step * 0.35; time += step) ticks.push(time);
  ticks.push(duration);
  return ticks;
}

const WIDTH = 560;
const HEIGHT = 190;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

function seriesPath(series: TrendSeries, x: (time: number) => number, y: (value: number) => number): string {
  const first = series.points[0];
  let path = `M${x(first.time).toFixed(1)} ${y(first.value).toFixed(1)}`;
  for (let index = 1; index < series.points.length; index++) {
    const point = series.points[index];
    path += `H${x(point.time).toFixed(1)}V${y(point.value).toFixed(1)}`;
  }
  return path;
}

interface DemoTrendChartProps {
  game: DemoGameSummary;
  metric: TrendMetric;
}

export function DemoTrendChart({ game, metric }: DemoTrendChartProps) {
  const series = useMemo(() => buildTrendSeries(game, metric), [game, metric]);
  const [hover, setHover] = useState<number | null>(null);
  const duration = Math.max(1, game.duration);

  const model = useMemo(() => {
    const scale = valueScale(series);
    const x = (time: number) => PAD_LEFT + (Math.min(duration, Math.max(0, time)) / duration) * PLOT_WIDTH;
    const y = (value: number) => {
      const ratio = (value - scale.min) / Math.max(1e-6, scale.max - scale.min);
      return PAD_TOP + (1 - ratio) * PLOT_HEIGHT;
    };
    return {
      scale,
      x,
      y,
      path: new Map(series.map(entry => [entry.key, seriesPath(entry, x, y)])),
      times: timeTicks(duration)
    };
  }, [series, duration]);

  const emptyText =
    metric === 'damage' || metric === 'net'
      ? game.damages
        ? 'No attributed damage was recorded in this game.'
        : 'Damage records are not available for this summary.'
      : 'No kills were recorded in this game.';

  if (series.length === 0) {
    return <p className="muted demo-trend-empty">{emptyText}</p>;
  }

  const onHoverMove = (event: ReactPointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    setHover(Math.min(duration, Math.max(0, ratio * duration)));
  };

  const label =
    metric === 'kills'
      ? 'Cumulative kills'
      : metric === 'kd'
        ? 'Cumulative kills minus deaths'
        : metric === 'damage'
          ? 'Cumulative damage dealt'
          : 'Cumulative damage given minus received';

  return (
    <div className="demo-trend">
      <svg
        className="demo-trend-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label} for ${game.map}, per player`}
      >
        <title>{`${label} — ${game.map}`}</title>

        {model.scale.ticks.map(value => (
          <g key={`y-${value}`}>
            <line
              className={value === 0 ? 'demo-trend-zero' : 'demo-trend-grid'}
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={model.y(value)}
              y2={model.y(value)}
            />
            <text className="demo-trend-axis" x={PAD_LEFT - 6} y={model.y(value) + 3} textAnchor="end">
              {formatTick(value)}
            </text>
          </g>
        ))}

        {model.times.map(time => (
          <text
            className="demo-trend-axis"
            key={`x-${time}`}
            x={model.x(time)}
            y={HEIGHT - 7}
            textAnchor={time === 0 ? 'start' : time === duration ? 'end' : 'middle'}
          >
            {formatTime(time)}
          </text>
        ))}

        {series.map(entry => (
          <path
            className="demo-trend-line"
            key={entry.key}
            d={model.path.get(entry.key)}
            style={{ stroke: entry.color }}
          />
        ))}

        {hover !== null ? (
          <g>
            <line
              className="demo-trend-hover"
              x1={model.x(hover)}
              x2={model.x(hover)}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
            />
            {series.map(entry => (
              <circle
                className="demo-trend-dot"
                key={`hover-${entry.key}`}
                cx={model.x(hover)}
                cy={model.y(valueAt(entry, hover))}
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
          onPointerMove={onHoverMove}
          onPointerDown={onHoverMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      <div className="demo-trend-legend">
        <span className="demo-trend-time">{hover !== null ? `at ${formatTime(hover)}` : 'final'}</span>
        {series.map(entry => (
          <span className="demo-trend-key" key={entry.key}>
            <i style={{ background: entry.color }} />
            <span className="demo-trend-name">{entry.label}</span>
            <b>{formatValue(hover !== null ? valueAt(entry, hover) : entry.final, metric)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
