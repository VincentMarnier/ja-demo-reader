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
  /** Total attributed damage dealt by this player in the current game. */
  damageDealt?: number;
  /** Total attributed damage received from other players in the current game. */
  damageReceived?: number;
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

/**
 * One player position polled for the minimap. Coordinates are the demo's world
 * units; `yaw` is the view yaw in degrees (0 faces +X).  The recorded POV comes
 * from its playerState, remote players from the current snapshot.
 */
export interface RadarPlayer {
  num: number;
  x: number;
  y: number;
  /** Feet height in world units, used to scale the airborne effect. */
  z: number;
  yaw: number;
  /** 1 when the player is dead; the minimap dims those dots. */
  dead: number;
  /** 1 when the player stands on something; 0 while airborne. */
  g: number;
}

export interface RadarData {
  time: number;
  players: RadarPlayer[];
}

/**
 * Recorded positions around the live time, from the demo scan.  Each entry is
 * [clientNum, serverTime, x, y]; `serverTime` is the same clock as RadarData.time
 * so the minimap can draw trails on either side of the current position.
 */
export interface TrajectoryData {
  /** True when the scan hit its sample cap; the newest positions are missing. */
  overflow?: boolean;
  samples: Array<[number, number, number, number]>;
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
  /** 1 when attacker and target were on the same team (1/2). */
  friendly?: number;
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

/**
 * One observed damage instance. `attacker` is -1 when the demo does not identify
 * the attacker (hitscan guns, force, environment, hits outside the POV's PVS).
 * The app keeps the full attacker→target matrix even though the scoreboard only
 * shows totals.
 */
export interface DemoDamageEvent {
  time: number;
  target: number;
  attacker: number;
  damage: number;
  /** 0 unknown, 1 saber, 2 missile, 3 POV outgoing, 4 POV incoming, 5 kill. */
  source: number;
  /** 1 when attacker and target were on the same team (1/2). */
  friendly?: number;
}

/**
 * One saber contact with the movement state of both players at that moment
 * (0 on ground, 1 airborne, 2 just landed). The scan records these separately
 * from the swings so dealt/received hits can be split by movement.
 */
export interface DemoSaberHit {
  time: number;
  attacker: number;
  target: number;
  attackerState: number;
  targetState: number;
}

/**
 * A broken guard: `loser` was parrying, `winner`'s strike broke the parry
 * (`LS_H1_*`) and left `loser` exposed. Wall bounces and saber-lock clashes
 * are not blocks and are not recorded.
 */
export interface DemoBlock {
  time: number;
  winner: number;
  loser: number;
  /** 1 guard broken (H1), 2 saber knocked away (V1). */
  kind?: number;
}

/**
 * One possible input-script (macro) finding from the view-angle scan.
 *
 * The demo stores no usercmds, so this is the proxy's anti-macro guard applied
 * to the per-snapshot view angles: a run of view reversals faster and more
 * regular than a hand can make, with a turn-key-like step profile. `channel`
 * is 0 for yaw and 1 for pitch, `swing` is in tenths of a degree and `step`
 * the mean/peak percentage of the per-snapshot step.
 */
export interface DemoScriptFlag {
  /** Server time of the first reversal in the burst. */
  time: number;
  /** Server time of the last reversal merged into the finding. */
  endTime: number;
  num: number;
  channel: number;
  reversals: number;
  /** Separate bursts merged into this finding (1 for a single press). */
  bursts: number;
  /** Mean interval between reversals, milliseconds. */
  meanMs: number;
  /** Peak-to-peak view swing, tenths of a degree. */
  swing: number;
  /** Mean per-snapshot step as a percentage of the peak step. */
  step: number;
  /** Directional snapshots that fed the run. */
  samples: number;
  /** 1 when the burst passes the stricter "strong" thresholds. */
  confidence: number;
}

/** A kill on the seek bar: when it happened and the killer's team. */
export interface KillMarker {
  /** Milliseconds since the first snapshot of the demo. */
  at: number;
  /** Attacker team — 1 is red and 2 is blue; anything else uses the primary colour. */
  team: number;
}

/** A saber name interned during the scan; swings reference it by id. */
export interface DemoSaberName {
  id: number;
  name: string;
}

/**
 * One saber swing observed in the demo. `move` is the numeric `LS_*` saber
 * move the server resolved from the player's input; `stance` is the corrected
 * saber style (6 dual, 7 staff). `hits` counts saber hit events, and `damage`
 * is the health loss the demo exposed for those hits (0 when it did not).
 */
export interface DemoSwingEvent {
  time: number;
  num: number;
  move: number;
  stance: number;
  saber: number;
  hits: number;
  damage: number;
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
  /** Recorded client (the demo's POV), or absent on older caches. */
  pov?: number;
  eventOverflow?: boolean;
  vitalsOverflow?: boolean;
  stancesOverflow?: boolean;
  damageOverflow?: boolean;
  swingsOverflow?: boolean;
  players: DemoPlayerSummary[];
  events: DemoEvent[];
  /** Health/armor timeline scraped during the scan. Absent on older caches. */
  vitals?: DemoVitalsSample[];
  /** Saber-stance timeline scraped during the scan. Absent on older caches. */
  stances?: DemoStanceSample[];
  /** Attributed and unattributed damage instances. Absent on older caches. */
  damages?: DemoDamageEvent[];
  /** Saber names referenced by the swings. Absent on older caches. */
  sabers?: DemoSaberName[];
  /** Saber swings scraped during the scan. Absent on older caches. */
  swings?: DemoSwingEvent[];
  /** Saber contacts with both players' movement state. Absent on older caches. */
  saberHits?: DemoSaberHit[];
  /** Broken guards. Absent on older caches. */
  blocks?: DemoBlock[];
  saberHitOverflow?: boolean;
  blockOverflow?: boolean;
  /** Possible input-script (macro) findings. Absent on older caches. */
  scripts?: DemoScriptFlag[];
  scriptOverflow?: boolean;
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
