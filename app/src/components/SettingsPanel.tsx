import { useEffect, useState } from 'react';
import type { AppSettings, FreeCamAction } from '../settings';
import { DEFAULT_FREE_CAM_KEYS, FREE_CAM_ACTIONS, keyLabel } from '../settings';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
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

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
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

        <p className="fineprint">Settings are saved automatically in this browser.</p>
      </div>
    </div>
  );
}
