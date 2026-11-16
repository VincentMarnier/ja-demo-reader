import type { Phase, ScoreboardData, ViewStats } from '../types';
import { ScoreStrip } from './ScoreStrip';
import { SeekBar } from './SeekBar';
import { VitalsHud } from './VitalsHud';

interface PlayerProps {
  matchTime: string;
  paused: boolean;
  phase: Phase;
  scores: ScoreboardData | null;
  view: ViewStats | null;
  showScores: boolean;
  showTimer: boolean;
  currentMs: number;
  durationMs: number;
  freeCam: boolean;
  followClient: number | null;
  pointerLocked: boolean;
  demoName: string;
  demos: Array<{ name: string }>;
  onPause: () => void;
  onRestart: () => void;
  onStop: () => void;
  onFullscreen: () => void;
  onToggleFreeCam: () => void;
  onDemoCamera: () => void;
  onCaptureMouse: () => void;
  onSeek: (positionMs: number) => void;
  onSelectDemo: (name: string) => void;
  onShowLogs: () => void;
}

export function Player(props: PlayerProps) {
  const ended = props.phase === 'ended';
  // A demo chosen from a file input may not be in the folder list.
  const demos = props.demos.some(d => d.name === props.demoName)
    ? props.demos
    : [{ name: props.demoName }, ...props.demos];

  return (
    <div className="player-ui">
      <ScoreStrip
        data={props.scores}
        matchTime={props.matchTime}
        showScores={props.showScores}
        showTimer={props.showTimer}
      />

      <div className="player-bottom">
        <VitalsHud view={props.view} />
        <SeekBar
          currentMs={props.currentMs}
          durationMs={props.durationMs}
          disabled={ended}
          onSeek={props.onSeek}
        />

        <div className="player-controls">
          <button className="primary" onClick={props.onPause} disabled={ended}>
            {props.paused ? 'Resume' : 'Pause'}
          </button>
          <button className="secondary" onClick={props.onRestart}>Restart</button>
          <button className="ghost" onClick={props.onStop}>Stop</button>
          <button className="ghost" onClick={props.onFullscreen}>Fullscreen</button>
          <button
            type="button"
            className={props.freeCam ? 'secondary active' : 'ghost'}
            onClick={props.onToggleFreeCam}
            aria-pressed={props.freeCam}
          >
            Free cam
          </button>
          {props.freeCam ? (
            <button
              type="button"
              className={props.pointerLocked ? 'secondary active' : 'ghost'}
              onClick={props.onCaptureMouse}
            >
              {props.pointerLocked ? 'Mouse captured' : 'Capture mouse'}
            </button>
          ) : null}
          {props.freeCam || props.followClient !== null ? (
            <button type="button" className="ghost" onClick={props.onDemoCamera}>
              Demo camera
            </button>
          ) : null}
          <button className="ghost" onClick={props.onShowLogs}>Log</button>

          {demos.length > 1 ? (
            <label className="inline-field">
              <span>Demo</span>
              <select value={props.demoName} onChange={e => props.onSelectDemo(e.target.value)}>
                {demos.map(demo => <option key={demo.name} value={demo.name}>{demo.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {ended ? (
        <div className="ready-layer">
          <div className="panel compact">
            <h2>Demo finished</h2>
            <p className="muted">{props.demoName}</p>
            <div className="row">
              <button className="primary" onClick={props.onRestart}>Watch again</button>
              <button className="ghost" onClick={props.onStop}>Stop</button>
            </div>
          </div>
        </div>
      ) : null}

      {props.paused && !ended ? <div className="paused-badge">Paused</div> : null}
    </div>
  );
}
