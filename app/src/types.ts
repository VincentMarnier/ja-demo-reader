export interface LocalFile {
  /** Display name, e.g. assets0.pk3 or demo.dm_26 */
  name: string;
  file: File;
  /** Normalized path below base/, when known. */
  path?: string;
}

export interface AssetSelection {
  files: LocalFile[];
  demos: LocalFile[];
  label: string;
}

export interface DemoStatus {
  state: number;
  demo: number;
  serverTime: number;
  snapTime: number;
  clientNum: number;
  map: string;
  ended: number;
  ready?: number;
}

export interface StageProgress {
  loaded: number;
  total: number;
  current: string;
}

export type Phase =
  | 'launcher'
  | 'validating'
  | 'staging'
  | 'booting'
  | 'loading'
  | 'stopping'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface ValidationResult {
  assets: LocalFile[];
  demos: LocalFile[];
  warnings: string[];
  errors: string[];
}

export const CA_DISCONNECTED = 1;
export const CA_CONNECTED = 5;
export const CA_LOADING = 6;
export const CA_PRIMED = 7;
export const CA_ACTIVE = 8;

export function stateLabel(state: number): string {
  switch (state) {
    case 0:
      return 'Initialising';
    case 1:
      return 'Disconnected';
    case 3:
      return 'Connecting';
    case 5:
      return 'Connected';
    case 6:
      return 'Loading map';
    case 7:
      return 'Primed';
    case 8:
      return 'Playing';
    default:
      return `State ${state}`;
  }
}
