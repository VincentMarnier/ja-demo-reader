import { formatTime } from '../format';

interface ChartMomentBarProps {
  /** Time within this chart, in ms; null when nothing is pinned. */
  selected: number | null;
  /** The full range the chart shows, used by the empty hint. */
  duration: number;
  /** Start playback at the pinned time (relative to the chart). */
  onPlay: (relativeMs: number) => void;
  onClear: () => void;
  busy?: boolean;
  canPlay?: boolean;
}

/**
 * The footer shared by the summary charts: click a chart to pin a moment, then
 * start the demo from exactly there. The chart reports its own relative time;
 * the page adds the game's start offset before seeking.
 */
export function ChartMomentBar({
  selected,
  duration,
  onPlay,
  onClear,
  busy,
  canPlay = true
}: ChartMomentBarProps) {
  if (selected === null) {
    return (
      <p className="fineprint chart-moment-hint">
        Click the chart to pick a time, then start playing from there.
      </p>
    );
  }

  const label = formatTime(selected);

  return (
    <div className="chart-moment">
      <button
        type="button"
        className="primary chart-moment-play"
        disabled={busy || !canPlay}
        title={canPlay ? undefined : 'The map is not ready yet.'}
        onClick={() => onPlay(selected)}
      >
        Play from here
      </button>
      <span className="chart-moment-at">
        {label} <span className="muted">of {formatTime(duration)}</span>
      </span>
      <button type="button" className="text-link chart-moment-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
