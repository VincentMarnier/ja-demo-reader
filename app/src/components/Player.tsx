import { useState } from 'react';
import type { Phase, ScoreboardData, ViewStats } from '../types';
import { ScoreStrip } from './ScoreStrip';
import { SeekBar } from './SeekBar';
import { VitalsHud } from './VitalsHud';

interface PlayerProps {
  matchTime: string;
  speed: number;
  onSpeedChange: (value: number) => void;
  volumes: { effects: number; music: number; voice: number };
  onVolumeChange: (kind: 'effects' | 'music' | 'voice', value: number) => void;
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
  const [popover, setPopover] = useState<'speed' | 'sound' | null>(null);
  const volumeRows = [
    { kind: 'effects' as const, label: 'Effects', value: props.volumes.effects },
    { kind: 'music' as const, label: 'Music', value: props.volumes.music },
    { kind: 'voice' as const, label: 'Voice', value: props.volumes.voice }
  ];
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
        {popover === 'speed' ? (
          <div className="speed-popover">
            <div className="speed-popover-head">
              <span>Playback speed</span>
              <strong>{props.speed.toFixed(2)}×</strong>
            </div>
            <input
              type="range"
              min={0.25}
              max={2.5}
              step={0.25}
              value={props.speed}
              disabled={ended}
              aria-label="Playback speed"
              onChange={event => props.onSpeedChange(Number(event.target.value))}
            />
          </div>
        ) : null}

        {popover === 'sound' ? (
          <div className="speed-popover audio-popover">
            <div className="speed-popover-head">
              <span>Sound</span>
            </div>
            {volumeRows.map(row => (
              <div className="audio-row" key={row.kind}>
                <div className="audio-row-head">
                  <span>{row.label}</span>
                  <strong>{Math.round(row.value * 100)}%</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={row.value}
                  aria-label={`${row.label} volume`}
                  onChange={event => props.onVolumeChange(row.kind, Number(event.target.value))}
                />
              </div>
            ))}
          </div>
        ) : null}

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
          <button
            type="button"
            className={popover === 'speed' ? 'secondary active' : 'ghost'}
            onClick={() => setPopover(open => (open === 'speed' ? null : 'speed'))}
            aria-expanded={popover === 'speed'}
          >
            Speed {props.speed.toFixed(2)}×
          </button>
          <button
            type="button"
            className={popover === 'sound' ? 'secondary active' : 'ghost'}
            onClick={() => setPopover(open => (open === 'sound' ? null : 'sound'))}
            aria-expanded={popover === 'sound'}
          >
            Sound
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
