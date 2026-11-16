import type { ViewStats } from '../types';

interface VitalsHudProps {
  view: ViewStats | null;
}

const SABER_STYLES = ['None', 'Fast', 'Medium', 'Strong', 'Desann', 'Tavion', 'Dual', 'Staff'];

function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

function barValue(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(100, value);
}

export function VitalsHud({ view }: VitalsHudProps) {
  const health = view && view.health >= 0 ? view.health : null;
  const armor = view && view.armor >= 0 ? view.armor : null;
  const style = view && view.saberStyle >= 0 ? SABER_STYLES[view.saberStyle] ?? null : null;
  const saberLabel = view
    ? [style, view.saberName].filter(Boolean).join(' · ') || 'Saber'
    : '—';
  const weaponLabel = view
    ? view.saber
      ? saberLabel
      : view.weapon > 0
        ? `Weapon ${view.weapon}`
        : 'Unarmed'
    : '—';

  return (
    <div className="vitals-hud">
      <div className="vitals-left">
        <div className="vitals-name">{view ? stripColors(view.name) : 'Demo player'}</div>
        <div className="vital-row">
          <span className="vital-label">HP</span>
          <div className="vital-track health">
            <div className="vital-fill" style={{ width: `${barValue(health ?? 0)}%` }} />
          </div>
          <span className="vital-number">{health ?? '—'}</span>
        </div>
        <div className="vital-row">
          <span className="vital-label">AP</span>
          <div className="vital-track armor">
            <div className="vital-fill" style={{ width: `${barValue(armor ?? 0)}%` }} />
          </div>
          <span className="vital-number">{armor ?? '—'}</span>
        </div>
      </div>

      <div className="vitals-right">
        <span className="vitals-label">{view?.saber ? 'Saber' : 'Equipment'}</span>
        <strong>{weaponLabel}</strong>
      </div>
    </div>
  );
}
