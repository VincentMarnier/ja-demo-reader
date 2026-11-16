import { useEffect, useRef, useState } from 'react';

interface SeekBarProps {
  currentMs: number;
  durationMs: number;
  disabled?: boolean;
  onSeek: (positionMs: number) => void;
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SeekBar({ currentMs, durationMs, disabled, onSeek }: SeekBarProps) {
  const [value, setValue] = useState(currentMs);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setValue(currentMs);
  }, [currentMs]);

  if (durationMs <= 0) return null;

  const commit = () => {
    dragging.current = false;
    onSeek(value);
  };

  return (
    <div className="seek-bar">
      <span className="seek-time">{format(value)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(1, durationMs)}
        step={250}
        value={Math.min(value, durationMs)}
        disabled={disabled}
        aria-label="Seek demo time"
        onPointerDown={() => {
          dragging.current = true;
        }}
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
      <span className="seek-time duration">{format(durationMs)}</span>
    </div>
  );
}
