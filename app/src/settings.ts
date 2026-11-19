import type { DamageHeatmapMode } from './map/damageHeatmap';

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

export type TextureMipmapMode = 'off' | 'bilinear' | 'trilinear';

export type HeatmapMode = DamageHeatmapMode;

const HEATMAP_MODES: readonly HeatmapMode[] = [
  'off',
  'team-given',
  'team-received',
  'player-given',
  'player-received'
];

/** Corner the small demo player snaps to while the map fills the stage. */
export type PipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface AppSettings {
  cgFov: number;
  rGamma: number;
  texturePicmip: number;
  textureMipmaps: TextureMipmapMode;
  showScoreboard: boolean;
  showScores: boolean;
  showTimer: boolean;
  showMinimap: boolean;
  /** The map fills the stage and the demo plays in the corner. */
  mapExpanded: boolean;
  /** Corner of the small demo player while the map fills the stage. */
  pipCorner: PipCorner;
  /** Width of the small demo player, in percent of the stage width. */
  pipWidth: number;
  /** The last five seconds of movement, fading into the current position. */
  trailsPast: boolean;
  /** The next five seconds of movement, dashed and dimmer. */
  trailsFuture: boolean;
  /** Only draw trails for the camera subject instead of every player. */
  trailsFollowOnly: boolean;
  /** Damage heatmap drawn over the minimap: off, team or player, given/received. */
  heatmap: HeatmapMode;
  playbackSpeed: number;
  volumeEffects: number;
  volumeMusic: number;
  volumeVoice: number;
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
  rGamma: 1,
  texturePicmip: 2,
  textureMipmaps: 'off',
  showScoreboard: true,
  showScores: true,
  showTimer: true,
  showMinimap: true,
  mapExpanded: false,
  pipCorner: 'bottom-right',
  pipWidth: 33,
  trailsPast: true,
  trailsFuture: false,
  trailsFollowOnly: false,
  heatmap: 'off',
  playbackSpeed: 1,
  // The engine's own defaults: s_volume 0.5, s_musicvolume 0.25, s_volumeVoice 1.
  volumeEffects: 0.5,
  volumeMusic: 0.25,
  volumeVoice: 1,
  freeCamKeys: { ...DEFAULT_FREE_CAM_KEYS }
};

const STORAGE_KEY = 'jka-demo-player.settings.v1';
const MIN_FOV = 60;
const MAX_FOV = 130;
const MIN_GAMMA = 0.5;
const MAX_GAMMA = 3;
const MIN_PICMIP = 0;
const MAX_PICMIP = 6;
const MIN_SPEED = 0.25;
const MAX_SPEED = 2.5;
const SPEED_STEP = 0.25;
const MIN_PIP_WIDTH = 15;
const MAX_PIP_WIDTH = 55;
const PIP_CORNERS: readonly PipCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function clampFov(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.cgFov;
  return Math.min(MAX_FOV, Math.max(MIN_FOV, Math.round(n)));
}

function clampGamma(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.rGamma;
  return Math.min(MAX_GAMMA, Math.max(MIN_GAMMA, Math.round(n * 100) / 100));
}

export function clampPicmip(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.texturePicmip;
  return Math.min(MAX_PICMIP, Math.max(MIN_PICMIP, Math.round(n)));
}

export function clampSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.playbackSpeed;
  const stepped = Math.round(n / SPEED_STEP) * SPEED_STEP;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number(stepped.toFixed(2))));
}

export function clampPipWidth(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.pipWidth;
  return Math.min(MAX_PIP_WIDTH, Math.max(MIN_PIP_WIDTH, Math.round(n)));
}

function parsePipCorner(value: unknown): PipCorner {
  return PIP_CORNERS.includes(value as PipCorner) ? (value as PipCorner) : DEFAULT_SETTINGS.pipCorner;
}

function parseHeatmapMode(value: unknown): HeatmapMode {
  return HEATMAP_MODES.includes(value as HeatmapMode) ? (value as HeatmapMode) : DEFAULT_SETTINGS.heatmap;
}

export function clampVolume(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, freeCamKeys: { ...DEFAULT_FREE_CAM_KEYS } };
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      textureQuality?: string;
      swapMinimap?: boolean;
    };
    const keys = (parsed.freeCamKeys ?? {}) as Partial<FreeCamKeys>;
    const freeCamKeys = { ...DEFAULT_FREE_CAM_KEYS };
    for (const { action } of FREE_CAM_ACTIONS) {
      const value = keys[action];
      if (typeof value === 'string' && value.length > 0) freeCamKeys[action] = value;
    }
    // Migrate the short-lived preset field to the granular controls.
    const legacyQuality = parsed.textureQuality;
    const texturePicmip = clampPicmip(
      parsed.texturePicmip ?? (legacyQuality === 'high' ? 0 : legacyQuality === 'balanced' ? 1 : 2)
    );
    const textureMipmaps: TextureMipmapMode =
      parsed.textureMipmaps === 'bilinear' || parsed.textureMipmaps === 'trilinear'
        ? parsed.textureMipmaps
        : legacyQuality === 'high'
          ? 'trilinear'
          : legacyQuality === 'balanced'
            ? 'bilinear'
            : 'off';
    return {
      cgFov: clampFov(parsed.cgFov),
      rGamma: clampGamma(parsed.rGamma),
      texturePicmip,
      textureMipmaps,
      showScoreboard: parsed.showScoreboard !== false,
      showScores: parsed.showScores !== false,
      showTimer: parsed.showTimer !== false,
      showMinimap: parsed.showMinimap !== false,
      // `swapMinimap` was the short-lived action-bar switch name.
      mapExpanded: parsed.mapExpanded === true || parsed.swapMinimap === true,
      pipCorner: parsePipCorner(parsed.pipCorner),
      pipWidth: clampPipWidth(parsed.pipWidth),
      trailsPast: parsed.trailsPast !== false,
      trailsFuture: parsed.trailsFuture === true,
      trailsFollowOnly: parsed.trailsFollowOnly === true,
      heatmap: parseHeatmapMode(parsed.heatmap),
      playbackSpeed: clampSpeed(parsed.playbackSpeed),
      volumeEffects: clampVolume(parsed.volumeEffects, DEFAULT_SETTINGS.volumeEffects),
      volumeMusic: clampVolume(parsed.volumeMusic, DEFAULT_SETTINGS.volumeMusic),
      volumeVoice: clampVolume(parsed.volumeVoice, DEFAULT_SETTINGS.volumeVoice),
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
