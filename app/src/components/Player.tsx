import { useCallback, useEffect, useRef, useState } from 'react';
import type { KillMarker, Phase, RadarData, ScoreboardData, ViewStats } from '../types';
import { ScoreStrip } from './ScoreStrip';
import { SeekBar } from './SeekBar';
import { VitalsHud } from './VitalsHud';
import { Minimap } from './Minimap';

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
  showMinimap: boolean;
  /** The demo plays in the map's corner slot and the map fills the stage. */
  swapMinimap: boolean;
  mapName: string;
  mapFiles: readonly Blob[];
  radar: RadarData | null;
  fov: number;
  /** Player to ring on the minimap: the demo POV or the followed player. */
  highlightClient: number | null;
  onFollow: (clientNum: number) => void;
  onToggleMinimap: () => void;
  onToggleSwap: () => void;
  currentMs: number;
  durationMs: number;
  killMarkers: KillMarker[];
  onPause: () => void;
  onRestart: () => void;
  onStop: () => void;
  onFullscreen: () => void;
  onSeek: (positionMs: number) => void;
}

/** Controls fade out after this long without pointer movement. */
const HIDE_DELAY_MS = 2600;

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="5" width="3.6" height="14" rx="1.1" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.4v13.2L19 12z" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 9h3.1L12 5.2v13.6L7.1 15H4z" />
      <path d="M15 8.4a5.4 5.4 0 0 1 0 7.2l-1.2-1.3a3.6 3.6 0 0 0 0-4.6z" />
      <path d="M17.4 5.9a8.8 8.8 0 0 1 0 12.2l-1.2-1.3a7 7 0 0 0 0-9.6z" />
    </svg>
  );
}

function VolumeMuteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 9h3.1L12 5.2v13.6L7.1 15H4z" />
      <path
        d="M15.4 9.4 19.8 14m0-4.6L15.4 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 6.6 12 12l-8 5.4z" />
      <path d="M13 6.6 21 12l-8 5.4z" opacity="0.75" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5L3.5 20z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <rect x="13" y="6.5" width="5.8" height="4.4" rx="1" fill="currentColor" stroke="none" />
      <path d="M7 12.4h10M14.2 9.6 17 12.4l-2.8 2.8" />
      <path d="M17 16.6H7M9.8 13.8 7 16.6l2.8 2.8" opacity="0.55" />
    </svg>
  );
}

export function Player(props: PlayerProps) {
  const ended = props.phase === 'ended';
  const [popover, setPopover] = useState<'speed' | 'sound' | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [barHovered, setBarHovered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | null>(null);
  const volumeRows = [
    { kind: 'effects' as const, label: 'Effects', value: props.volumes.effects },
    { kind: 'music' as const, label: 'Music', value: props.volumes.music },
    { kind: 'voice' as const, label: 'Voice', value: props.volumes.voice }
  ];
  const muted =
    props.volumes.effects <= 0 && props.volumes.music <= 0 && props.volumes.voice <= 0;
  // Keep the chrome up while it is being used, like a video player's controls.
  const keepOpen = props.paused || ended || popover !== null || barHovered;
  const keepOpenRef = useRef(keepOpen);
  const visible = revealed || keepOpen;

  useEffect(() => {
    keepOpenRef.current = keepOpen;
  }, [keepOpen]);

  const clearIdle = useCallback(() => {
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearIdle();
    if (keepOpenRef.current) return;
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = null;
      if (!keepOpenRef.current) setRevealed(false);
    }, HIDE_DELAY_MS);
  }, [clearIdle]);

  useEffect(() => {
    const stage = rootRef.current?.closest<HTMLElement>('.stage');
    if (!stage) return;
    const onMove = () => {
      // Pointer lock means free-cam mouse look: do not flash the controls.
      if (document.pointerLockElement) return;
      setRevealed(true);
      scheduleHide();
    };
    const onLeave = (event: PointerEvent) => {
      // Keep the bar up while a slider is being dragged past the stage edge.
      if (event.buttons !== 0) return;
      clearIdle();
      if (!keepOpenRef.current) setRevealed(false);
    };
    const onUp = () => scheduleHide();
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerdown', onMove);
    stage.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerup', onUp);
    scheduleHide();
    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerup', onUp);
      clearIdle();
    };
  }, [clearIdle, scheduleHide]);

  useEffect(() => {
    clearIdle();
    setRevealed(true);
    scheduleHide();
  }, [barHovered, popover, props.paused, ended, clearIdle, scheduleHide]);

  // Hide the cursor with the chrome, but only while the demo is playing.
  useEffect(() => {
    const stage = rootRef.current?.closest<HTMLElement>('.stage');
    if (!stage) return;
    stage.toggleAttribute('data-ui-idle', !visible);
    return () => stage.removeAttribute('data-ui-idle');
  }, [visible]);

  useEffect(() => {
    if (!popover) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.action-menu')) return;
      setPopover(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [popover]);

  return (
    <div className="player-ui" ref={rootRef}>
      <ScoreStrip
        data={props.scores}
        matchTime={props.matchTime}
        showScores={props.showScores}
        showTimer={props.showTimer}
      />

      {props.showMinimap ? (
        <Minimap
          mapName={props.mapName}
          files={props.mapFiles}
          radar={props.radar}
          scores={props.scores}
          fov={props.fov}
          highlightClient={props.highlightClient}
          onFollow={props.onFollow}
        />
      ) : null}

      <button
        type="button"
        className={visible ? 'player-back' : 'player-back is-hidden'}
        onClick={props.onStop}
        aria-label="Stop demo"
        title="Stop demo"
      >
        <ChevronLeftIcon />
      </button>

      <div className="player-bottom">
        <VitalsHud view={props.view} />

        <div
          className={visible ? 'action-bar' : 'action-bar is-hidden'}
          onPointerEnter={() => setBarHovered(true)}
          onPointerLeave={() => setBarHovered(false)}
        >
          <button
            type="button"
            className="icon-btn"
            onClick={props.onPause}
            disabled={ended}
            aria-label={props.paused ? 'Resume' : 'Pause'}
            title={props.paused ? 'Resume' : 'Pause'}
          >
            {props.paused ? <PlayIcon /> : <PauseIcon />}
          </button>

          <div className="action-menu">
            <button
              type="button"
              className={popover === 'sound' ? 'icon-btn active' : 'icon-btn'}
              onClick={() => setPopover(open => (open === 'sound' ? null : 'sound'))}
              aria-label="Sound"
              aria-expanded={popover === 'sound'}
              title="Sound"
            >
              {muted ? <VolumeMuteIcon /> : <VolumeIcon />}
            </button>
            {popover === 'sound' ? (
              <div className="control-popover sound">
                <div className="popover-head">
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
          </div>

          <SeekBar
            currentMs={props.currentMs}
            durationMs={props.durationMs}
            killMarkers={props.killMarkers}
            disabled={ended}
            onSeek={props.onSeek}
          />

          <div className="action-menu">
            <button
              type="button"
              className={popover === 'speed' ? 'icon-btn active' : 'icon-btn'}
              onClick={() => setPopover(open => (open === 'speed' ? null : 'speed'))}
              aria-label="Playback speed"
              aria-expanded={popover === 'speed'}
              title={`Playback speed (${props.speed.toFixed(2)}×)`}
            >
              <SpeedIcon />
            </button>
            {popover === 'speed' ? (
              <div className="control-popover speed">
                <div className="popover-head">
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
          </div>

          <button
            type="button"
            className={props.showMinimap ? 'icon-btn active' : 'icon-btn'}
            onClick={props.onToggleMinimap}
            aria-label={props.showMinimap ? 'Hide minimap' : 'Show minimap'}
            aria-pressed={props.showMinimap}
            title={props.showMinimap ? 'Hide minimap' : 'Show minimap'}
          >
            <MapIcon />
          </button>

          <button
            type="button"
            className={props.swapMinimap ? 'icon-btn active' : 'icon-btn'}
            onClick={props.onToggleSwap}
            aria-label={props.swapMinimap ? 'Show the demo full size' : 'Show the demo in the map corner'}
            aria-pressed={props.swapMinimap}
            title={props.swapMinimap ? 'Demo back to full stage' : 'Swap demo and map'}
          >
            <SwapIcon />
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={props.onFullscreen}
            aria-label="Fullscreen"
            title="Fullscreen"
          >
            <FullscreenIcon />
          </button>
        </div>
      </div>

      {ended ? (
        <div className="ready-layer">
          <div className="panel compact">
            <h2>Demo finished</h2>
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
