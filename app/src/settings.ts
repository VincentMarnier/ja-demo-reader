export type FreeCamAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'lookLeft'
  | 'lookRight'
  | 'lookUp'
  | 'lookDown';

export type FreeCamKeys = Record<FreeCamAction, string>;

export interface AppSettings {
  cgFov: number;
  showScoreboard: boolean;
  showScores: boolean;
  showTimer: boolean;
  freeCamKeys: FreeCamKeys;
}

export const FREE_CAM_ACTIONS: Array<{ action: FreeCamAction; label: string }> = [
  { action: 'forward', label: 'Move forward' },
  { action: 'back', label: 'Move back' },
  { action: 'left', label: 'Strafe left' },
  { action: 'right', label: 'Strafe right' },
  { action: 'up', label: 'Move up' },
  { action: 'down', label: 'Move down' },
  { action: 'lookLeft', label: 'Look left' },
  { action: 'lookRight', label: 'Look right' },
  { action: 'lookUp', label: 'Look up' },
  { action: 'lookDown', label: 'Look down' }
];

export const DEFAULT_FREE_CAM_KEYS: FreeCamKeys = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  up: 'Space',
  down: 'ControlLeft',
  lookLeft: 'ArrowLeft',
  lookRight: 'ArrowRight',
  lookUp: 'ArrowUp',
  lookDown: 'ArrowDown'
};

export const DEFAULT_SETTINGS: AppSettings = {
  cgFov: 97,
  showScoreboard: true,
  showScores: true,
  showTimer: true,
  freeCamKeys: { ...DEFAULT_FREE_CAM_KEYS }
};

const STORAGE_KEY = 'jka-demo-player.settings.v1';
const MIN_FOV = 60;
const MAX_FOV = 130;

function clampFov(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.cgFov;
  return Math.min(MAX_FOV, Math.max(MIN_FOV, Math.round(n)));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, freeCamKeys: { ...DEFAULT_FREE_CAM_KEYS } };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const keys = (parsed.freeCamKeys ?? {}) as Partial<FreeCamKeys>;
    const freeCamKeys = { ...DEFAULT_FREE_CAM_KEYS };
    for (const { action } of FREE_CAM_ACTIONS) {
      const value = keys[action];
      if (typeof value === 'string' && value.length > 0) freeCamKeys[action] = value;
    }
    return {
      cgFov: clampFov(parsed.cgFov),
      showScoreboard: parsed.showScoreboard !== false,
      showScores: parsed.showScores !== false,
      showTimer: parsed.showTimer !== false,
      freeCamKeys
    };
  } catch {
    return { ...DEFAULT_SETTINGS, freeCamKeys: { ...DEFAULT_FREE_CAM_KEYS } };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can be unavailable in private contexts; settings still
    // apply for this session.
  }
}

export function keyLabel(code: string): string {
  if (!code) return '—';
  const labels: Record<string, string> = {
    Space: 'Space',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Tab: 'Tab'
  };
  if (labels[code]) return labels[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
