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
  prepared?: number;
  suspended?: number;
}

export interface StageProgress {
  loaded: number;
  total: number;
  current: string;
}

export interface ScoreboardPlayer {
  num: number;
  name: string;
  score: number;
  kills?: number;
  deaths: number;
  ping: number;
  team: number;
  left?: boolean;
  /** Health at the polled server time, from the parsed demo vitals. */
  health?: number;
  /** Armor at the polled server time; -1 when the source carried none. */
  armor?: number;
}

export interface ViewStats {
  num: number;
  name: string;
  health: number;
  armor: number;
  weapon: number;
  saber: number;
  saberStyle: number;
  saberName: string;
}

export interface ScoreboardData {
  gametype: number;
  scores1: number;
  scores2: number;
  levelTime?: number;
  players: ScoreboardPlayer[];
  view?: ViewStats;
}

export interface FreeCamPose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
}

export interface DemoInfo {
  first: number;
  duration: number;
  fullSnapshots?: number;
  totalSnapshots?: number;
}

export interface DemoEvent {
  time: number;
  target: number;
  attacker: number;
  mod: number;
}

/**
 * One health/armor reading scraped from the demo. Samples are ordered by
 * server time and replayed against the seek target.
 *
 * Sources: 0 spawn, 1 death, 2 EV_PAIN (health only), 3 team overlay `tinfo`
 * (health and armor), 4 duel health configstring (health only), 5 the recorded
 * client's own playerState (health and armor).
 */
export interface DemoVitalsSample {
  time: number;
  num: number;
  /** Health left; 0 means dead. */
  health: number;
  /** Armor left, or -1 when this source did not carry armor. */
  armor: number;
  source: number;
}

/**
 * One saber-stance reading scraped from a player entity. The scan takes the
 * stance from `entityState.fireflag`, which the server mirrors from
 * `playerState.fd.saberAnimLevel`.
 */
export interface DemoStanceSample {
  time: number;
  num: number;
  /** 0 none, 1 fast, 2 medium, 3 strong. */
  stance: number;
}

/** A kill on the seek bar: when it happened and the killer's team. */
export interface KillMarker {
  /** Milliseconds since the first snapshot of the demo. */
  at: number;
  /** Attacker team — 1 is red and 2 is blue; anything else uses the primary colour. */
  team: number;
}

export interface DemoPlayerSummary {
  num: number;
  name: string;
  team: number;
  score: number;
  kills: number;
  deaths: number;
  left: boolean;
  leftAt: number;
  returned: boolean;
  firstSeen: number;
  lastSeen: number;
}

export interface DemoGameSummary {
  map: string;
  startTime: number;
  endTime: number;
  duration: number;
  levelTime: number;
  eventOverflow?: boolean;
  vitalsOverflow?: boolean;
  stancesOverflow?: boolean;
  players: DemoPlayerSummary[];
  events: DemoEvent[];
  /** Health/armor timeline scraped during the scan. Absent on older caches. */
  vitals?: DemoVitalsSample[];
  /** Saber-stance timeline scraped during the scan. Absent on older caches. */
  stances?: DemoStanceSample[];
}

export interface DemoSummary {
  first: number;
  duration: number;
  fullSnapshots?: number;
  totalSnapshots?: number;
  gamestates?: number;
  levelStartChanges?: number;
  mapRestarts?: number;
  games: DemoGameSummary[];
}

export type Phase =
  | 'launcher'
  | 'validating'
  | 'staging'
  | 'booting'
  | 'loading'
  | 'stopping'
  | 'seeking'
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
