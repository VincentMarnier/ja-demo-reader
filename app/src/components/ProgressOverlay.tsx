import type { Phase, StageProgress } from '../types';
import { stagingBytesLabel } from '../fs/stage';

interface ProgressOverlayProps {
  progress: StageProgress | null;
  phase: Phase;
  onCancel: () => void;
}

export function ProgressOverlay({ progress, phase, onCancel }: ProgressOverlayProps) {
  const total = progress?.total ?? 0;
  const loaded = progress?.loaded ?? 0;
  const percent = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;

  return (
    <div className="overlay">
      <div className="panel compact">
        <div className="eyebrow">{phase === 'booting' ? 'Starting engine' : 'Staging assets'}</div>
        <h2>{phase === 'booting' ? 'Preparing the player' : 'Reading local files'}</h2>
        <p className="muted">
          {phase === 'booting'
            ? 'The wasm engine is initialising. The first frame can take a moment.'
            : progress?.current || 'Preparing the virtual filesystem…'}
        </p>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
        <div className="progress-meta">
          <span>{total ? `${stagingBytesLabel(loaded)} / ${stagingBytesLabel(total)}` : ''}</span>
          <span>{total ? `${percent.toFixed(0)}%` : ''}</span>
        </div>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
