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
  const loading = phase === 'loading';
  const stopping = phase === 'stopping';
  const seeking = phase === 'seeking';
  const booting = phase === 'booting';

  return (
    <div className="overlay">
      <div className="panel compact">
        <div className="eyebrow">
          {seeking ? 'Seeking demo' : stopping ? 'Stopping demo' : loading ? 'Loading demo' : booting ? 'Starting engine' : 'Staging assets'}
        </div>
        <h2 className="overlay-title">
          {booting || loading || seeking || stopping ? <span className="spinner" aria-hidden="true" /> : null}
          <span>
            {seeking ? 'Jumping to the selected time' : stopping ? 'Returning to the map' : loading ? 'Preparing the map' : booting ? 'Preparing the player' : 'Reading local files'}
          </span>
        </h2>
        <p className="muted">
          {seeking
            ? 'Rebuilding the demo state at the requested time.'
            : stopping
            ? 'The engine is tearing down the demo.'
            : loading
            ? 'The engine is loading the map and compiling shaders. The interface stays responsive; this can take a moment.'
            : booting
              ? 'The wasm engine is initialising. The first frame can take a moment.'
              : progress?.current || 'Preparing the virtual filesystem…'}
        </p>
        {!loading && !stopping && !seeking ? (
          <>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${percent}%` }} />
            </div>
            <div className="progress-meta">
              <span>{total ? `${stagingBytesLabel(loaded)} / ${stagingBytesLabel(total)}` : ''}</span>
              <span>{total ? `${percent.toFixed(0)}%` : ''}</span>
            </div>
          </>
        ) : null}
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
