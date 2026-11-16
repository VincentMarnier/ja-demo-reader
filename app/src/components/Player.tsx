import type { DemoStatus, Phase } from '../types';
import { stateLabel } from '../types';

interface PlayerProps {
  status: DemoStatus | null;
  mapName: string;
  elapsed: string;
  paused: boolean;
  phase: Phase;
  demoName: string;
  demos: Array<{ name: string }>;
  onPause: () => void;
  onRestart: () => void;
  onStop: () => void;
  onFullscreen: () => void;
  onSelectDemo: (name: string) => void;
  onShowLogs: () => void;
}

export function Player(props: PlayerProps) {
  const ended = props.phase === 'ended';
  const active = props.status?.state === 8;

  return (
    <div className="player-ui">
      <div className="hud-top">
        <div className="hud-block">
          <span className="hud-label">Map</span>
          <strong>{props.mapName || '—'}</strong>
        </div>
        <div className="hud-block">
          <span className="hud-label">State</span>
          <strong className={active ? 'ok' : ''}>{stateLabel(props.status?.state ?? 0)}</strong>
        </div>
        <div className="hud-block right">
          <span className="hud-label">Demo time</span>
          <strong className="mono">{props.elapsed}</strong>
        </div>
      </div>

      <div className="player-controls">
        <button className="primary" onClick={props.onPause} disabled={ended}>
          {props.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="secondary" onClick={props.onRestart}>Restart</button>
        <button className="ghost" onClick={props.onStop}>Stop</button>
        <button className="ghost" onClick={props.onFullscreen}>Fullscreen</button>
        <button className="ghost" onClick={props.onShowLogs}>Log</button>

        {props.demos.length > 1 ? (
          <label className="inline-field">
            <span>Demo</span>
            <select value={props.demoName} onChange={e => props.onSelectDemo(e.target.value)}>
              {props.demos.map(demo => <option key={demo.name} value={demo.name}>{demo.name}</option>)}
            </select>
          </label>
        ) : null}
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
