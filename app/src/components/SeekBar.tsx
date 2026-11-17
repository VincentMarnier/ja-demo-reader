import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { KillMarker } from '../types';

interface SeekBarProps {
  currentMs: number;
  durationMs: number;
  killMarkers?: KillMarker[];
  disabled?: boolean;
  onSeek: (positionMs: number) => void;
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Range inputs inset their track by half the thumb on each side. */
const THUMB_INSET = 8;
/** Keep the floating label away from the seek bar's rounded ends. */
const LABEL_MARGIN = 26;
/** Kill markers closer than this share one tick instead of stacking. */
const MARK_STEPS = 900;

export function SeekBar({
  currentMs,
  durationMs,
  killMarkers,
  disabled,
  onSeek
}: SeekBarProps) {
  const [value, setValue] = useState(currentMs);
  const [hover, setHover] = useState<{ left: number; ms: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setValue(currentMs);
  }, [currentMs]);

  useEffect(() => {
    if (disabled) setHover(null);
  }, [disabled]);

  // Bucket the kills to about one tick per pixel so dense fights stay cheap.
  const marks = useMemo(() => {
    if (!killMarkers || killMarkers.length === 0 || durationMs <= 0) return [];
    const buckets = new Map<number, number>();
    for (const marker of killMarkers) {
      const ratio = Math.min(1, Math.max(0, marker.at / durationMs));
      const bucket = Math.round(ratio * MARK_STEPS);
      if (!buckets.has(bucket)) buckets.set(bucket, marker.team);
    }
    return [...buckets.entries()].map(([bucket, team]) => ({
      key: bucket,
      left: (bucket / MARK_STEPS) * 100,
      team
    }));
  }, [killMarkers, durationMs]);

  if (durationMs <= 0) return null;

  const commit = () => {
    dragging.current = false;
    onSeek(value);
  };

  // Show the time under the pointer before seeking, like a video player.
  const trackHover = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.pointerType === 'touch') return;
    const bar = barRef.current;
    if (!bar) return;
    const inputRect = event.currentTarget.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const usable = Math.max(1, inputRect.width - THUMB_INSET * 2);
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - inputRect.left - THUMB_INSET) / usable)
    );
    const left = Math.min(
      Math.max(event.clientX - barRect.left, LABEL_MARGIN),
      Math.max(LABEL_MARGIN, barRect.width - LABEL_MARGIN)
    );
    setHover({ left, ms: Math.round(ratio * durationMs) });
  };

  return (
    <div className="seek-bar" ref={barRef}>
      {hover ? (
        <span className="seek-hover" style={{ left: `${hover.left}px` }} aria-hidden="true">
          {format(hover.ms)}
        </span>
      ) : null}
      <span className="seek-time">{format(value)}</span>
      <div className="seek-track">
        <input
          type="range"
          min={0}
          max={Math.max(1, durationMs)}
          step={250}
          value={Math.min(value, durationMs)}
          disabled={disabled}
          aria-label="Seek demo time"
          onPointerDown={event => {
            dragging.current = true;
            trackHover(event);
          }}
          onPointerMove={trackHover}
          onPointerLeave={() => setHover(null)}
          onChange={event => {
            dragging.current = true;
            setValue(Number(event.target.value));
          }}
          onPointerUp={commit}
          onKeyUp={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
              commit();
            }
          }}
        />
        {marks.length > 0 ? (
          <div className="seek-marks" aria-hidden="true">
            {marks.map(mark => (
              <span
                key={mark.key}
                className={
                  mark.team === 1 ? 'seek-mark team-1' : mark.team === 2 ? 'seek-mark team-2' : 'seek-mark'
                }
                style={{ left: `${mark.left}%` }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <span className="seek-time duration">{format(durationMs)}</span>
    </div>
  );
}
