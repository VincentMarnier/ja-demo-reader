import type { ChangeEvent, RefObject } from 'react';
import type { AssetSelection, ValidationResult } from '../types';

interface LauncherProps {
  selection: AssetSelection | null;
  validation: ValidationResult | null;
  selectedDemo: string;
  savedHandle: FileSystemDirectoryHandle | null;
  busy: boolean;
  onPick: () => void;
  onSaved: () => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDemoChange: (name: string) => void;
  onPlay: () => void;
}

export function Launcher(props: LauncherProps) {
  const { selection, validation, selectedDemo, savedHandle, busy } = props;

  return (
    <div className="launcher-layer">
      <div className="panel launcher">
        <div className="eyebrow">Jedi Academy · multiplayer demos</div>
        <h1>Play a local <span className="accent">.dm_26</span> demo</h1>
        <p className="lede">
          Select your <code>GameData</code> folder. The player reads the retail PK3s and the demo
          from this device; nothing is uploaded and the engine makes no network requests.
        </p>

        {!selection ? (
          <div className="launcher-actions">
            <button className="primary" onClick={props.onPick} disabled={busy}>
              Select GameData folder
            </button>
            <button className="secondary" onClick={() => props.fileInputRef.current?.click()} disabled={busy}>
              Choose files instead
            </button>
            {savedHandle ? (
              <button className="ghost" onClick={props.onSaved} disabled={busy}>
                Use last folder
              </button>
            ) : null}
            {busy ? <span className="muted">Checking files…</span> : null}
          </div>
        ) : (
          <div className="selection">
            <div className="selection-head">
              <div>
                <div className="eyebrow">Selected</div>
                <strong>{selection.label}</strong>
              </div>
              <button className="ghost" onClick={props.onPick}>Change folder</button>
            </div>

            <div className="facts">
              <div><span className="fact-value">{validation?.assets.length ?? 0}/4</span><span className="fact-label">PK3s</span></div>
              <div><span className="fact-value">{validation?.demos.length ?? 0}</span><span className="fact-label">demos</span></div>
              <div><span className="fact-value">{validation?.errors.length ? '!' : 'OK'}</span><span className="fact-label">validation</span></div>
            </div>

            {validation && validation.errors.length > 0 ? (
              <ul className="alerts error">
                {validation.errors.map(e => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            {validation && validation.warnings.length > 0 ? (
              <ul className="alerts warn">
                {validation.warnings.map(w => <li key={w}>{w}</li>)}
              </ul>
            ) : null}

            {validation && validation.demos.length > 0 ? (
              <>
                <label className="field">
                  <span>Demo</span>
                  <select value={selectedDemo} onChange={e => props.onDemoChange(e.target.value)}>
                    {validation.demos.map(demo => (
                      <option key={demo.name} value={demo.name}>{demo.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary wide"
                  onClick={props.onPlay}
                  disabled={busy || validation.errors.length > 0 || !selectedDemo}
                >
                  Play demo
                </button>
              </>
            ) : null}
          </div>
        )}

        <input
          ref={props.fileInputRef}
          type="file"
          multiple
          accept=".pk3,.dm_26"
          className="hidden-input"
          onChange={props.onFileInput}
        />

        <p className="fineprint">
          Requires a complete retail <code>base/assets0..3.pk3</code> set and a protocol-26 demo.
          Game data stays on this device.
        </p>
      </div>
    </div>
  );
}
