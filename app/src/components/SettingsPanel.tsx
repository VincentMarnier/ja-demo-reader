import { useEffect, useState } from 'react';
import type { AppSettings, FreeCamAction } from '../settings';
import { DEFAULT_FREE_CAM_KEYS, FREE_CAM_ACTIONS, keyLabel } from '../settings';
import { HEATMAP_MODES } from '../map/damageHeatmap';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  onClearLocalData: () => void;
}

function KeyBindButton(props: {
  code: string;
  onChange: (code: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setCapturing(false);
        return;
      }
      props.onChange(event.code);
      setCapturing(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, props]);

  return (
    <button
      type="button"
      className={capturing ? 'keybind-btn capturing' : 'keybind-btn'}
      onClick={() => setCapturing(true)}
      aria-label={capturing ? 'Press a key' : `Rebind, currently ${keyLabel(props.code)}`}
    >
      {capturing ? 'Press a key…' : keyLabel(props.code)}
    </button>
  );
}

export function SettingsPanel({ settings, onChange, onClose, onClearLocalData }: SettingsPanelProps) {
  const setKey = (action: FreeCamAction, code: string) => {
    onChange({ freeCamKeys: { ...settings.freeCamKeys, [action]: code } });
  };

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-panel">
        <div className="settings-head">
          <div>
            <div className="eyebrow">Player settings</div>
            <h2>Settings</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </div>

        <section className="settings-section">
          <h3>View</h3>
          <label className="setting-row">
            <span>
              Field of view
              <small>Applied to the demo camera. Default is 97.</small>
            </span>
            <span className="setting-value">
              <input
                type="range"
                min={60}
                max={130}
                step={1}
                value={settings.cgFov}
                onChange={event => onChange({ cgFov: Number(event.target.value) })}
              />
              <output>{settings.cgFov}°</output>
            </span>
          </label>
          <label className="setting-row">
            <span>
              Gamma
              <small>Brightness of the rendered scene. Default is 1.00.</small>
            </span>
            <span className="setting-value">
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={settings.rGamma}
                onChange={event => onChange({ rGamma: Number(event.target.value) })}
              />
              <output>{settings.rGamma.toFixed(2)}</output>
            </span>
          </label>
          <label className="setting-row">
            <span>
              Texture picmip
              <small>
                Shrinks textures before upload. 2 is the fast default; 0 is the
                sharpest and uses the most texture memory.
              </small>
            </span>
            <span className="setting-value">
              <input
                type="range"
                min={0}
                max={6}
                step={1}
                value={settings.texturePicmip}
                onChange={event => onChange({ texturePicmip: Number(event.target.value) })}
              />
              <output>{settings.texturePicmip}</output>
            </span>
          </label>
          <label className="setting-row">
            <span>
              Texture mipmaps
              <small>
                Off uses GL_LINEAR (fast default). Bilinear and Trilinear restore
                mipmaps for distance quality. Applies after the engine is reloaded.
              </small>
            </span>
            <span className="setting-value">
              <select
                value={settings.textureMipmaps}
                onChange={event =>
                  onChange({ textureMipmaps: event.target.value as AppSettings['textureMipmaps'] })
                }
              >
                <option value="off">Off</option>
                <option value="bilinear">Bilinear</option>
                <option value="trilinear">Trilinear</option>
              </select>
            </span>
          </label>
        </section>

        <section className="settings-section">
          <h3>HUD</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.showScoreboard}
              onChange={event => onChange({ showScoreboard: event.target.checked })}
            />
            <span>Show scoreboard panel beside the demo</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.showScores}
              onChange={event => onChange({ showScores: event.target.checked })}
            />
            <span>Show scores at the top center</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.showTimer}
              onChange={event => onChange({ showTimer: event.target.checked })}
            />
            <span>Show the timer between the scores</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.showMinimap}
              onChange={event => onChange({ showMinimap: event.target.checked })}
            />
            <span>Show the top-down minimap with live player positions</span>
          </label>
        </section>

        <section className="settings-section">
          <h3>Damage heatmaps</h3>
          <label className="setting-row">
            <span>
              Overlay
              <small>
                Team heat aggregates both teams in red and blue; player heat follows the camera
                subject (or the recorded POV). Given uses the attacker's position, received the
                victim's. Needs a summary scanned with positions.
              </small>
            </span>
            <span className="setting-value">
              <select
                value={settings.heatmap}
                onChange={event =>
                  onChange({ heatmap: event.target.value as AppSettings['heatmap'] })
                }
              >
                {HEATMAP_MODES.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </span>
          </label>
        </section>

        <section className="settings-section">
          <h3>Minimap trails</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.trailsPast}
              onChange={event => onChange({ trailsPast: event.target.checked })}
            />
            <span>Draw the past five seconds of each player's movement, fading into the current position</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.trailsFuture}
              onChange={event => onChange({ trailsFuture: event.target.checked })}
            />
            <span>Draw the next five seconds as a dashed, dimmer line (from the demo scan)</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.trailsFollowOnly}
              onChange={event => onChange({ trailsFollowOnly: event.target.checked })}
            />
            <span>Only draw trails for the player you follow, not everyone</span>
          </label>
          <p className="muted settings-note">
            The trails line up with the player dots and need one demo scan per session, like the seek keyframes.
          </p>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <h3>Free camera keys</h3>
            <button
              type="button"
              className="ghost small"
              onClick={() => onChange({ freeCamKeys: { ...DEFAULT_FREE_CAM_KEYS } })}
            >
              Reset keys
            </button>
          </div>
          <p className="muted settings-note">
            Click a key, then press the replacement. Free cam moves with these keys while the demo is playing.
          </p>
          <div className="keybind-grid">
            {FREE_CAM_ACTIONS.map(({ action, label }) => (
              <div className="keybind-row" key={action}>
                <span>{label}</span>
                <KeyBindButton
                  code={settings.freeCamKeys[action]}
                  onChange={code => setKey(action, code)}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Local data</h3>
          <p className="muted settings-note">
            Parsed demo summaries stay on this device. Game assets are mounted read-only for the
            session and are not cached, so no asset copy is written to browser storage.
          </p>
          <button type="button" className="ghost" onClick={onClearLocalData}>
            Clear cached summaries
          </button>
        </section>

        <p className="fineprint">Settings are saved automatically in this browser.</p>
      </div>
    </div>
  );
}
