import type { DemoInfo, DemoStatus, DemoSummary, FreeCamPose, RadarData, ScoreboardData, StageProgress, TrajectoryData } from '../types';

export interface BootFile {
  name: string;
  file: File;
}

export type WorkerRequest =
  | { type: 'ping' }
  | {
      id: number;
      type: 'boot';
      canvas: OffscreenCanvas;
      base: string;
      args: string[];
      files: BootFile[];
      /** Page AudioContext rate; 0 when Web Audio is unavailable. */
      audioRate: number;
    }
  | { id: number; type: 'play'; name: string }
  | { id: number; type: 'prepare'; name: string }
  | { id: number; type: 'resume' }
  | { id: number; type: 'suspend' }
  | { id: number; type: 'release' }
  | { id: number; type: 'pause'; paused: boolean }
  | { id: number; type: 'stop' }
  | { id: number; type: 'parse-map'; name: string }
  | { id: number; type: 'has-map'; map: string }
  | { id: number; type: 'add-demo'; name: string; file: File }
  | { id: number; type: 'add-pk3s'; files: File[] }
  | { id: number; type: 'demo-info'; name: string }
  | { id: number; type: 'summary' }
  | { id: number; type: 'trajectory'; from: number; to: number }
  | { id: number; type: 'seek'; name: string; target: number }
  | { id: number; type: 'freecam-on' }
  | { type: 'cvar'; name: string; value: string }
  | { type: 'follow'; client: number }
  | { type: 'freecam-pose'; pose: FreeCamPose }
  | { type: 'freecam-off' }
  | { type: 'stage'; stage: string }
  | { type: 'audio-clock'; frame: number; started: boolean };

export interface WorkerMemory {
  heap: number;
  heapMax: number;
  hunkFree: number;
  memfs: number;
  mounted: number;
  mountedFiles: number;
}

export type WorkerResponse =
  | { id: number; ok: true; value?: unknown }
  | { id: number; ok: false; error: string }
  | { type: 'pong'; webgl2: boolean }
  | { type: 'log'; lines: string[] }
  | { type: 'progress'; progress: StageProgress }
  | { type: 'ready' }
  | { type: 'status'; status: DemoStatus }
  | { type: 'scoreboard'; scoreboard: ScoreboardData }
  | { type: 'radar'; radar: RadarData }
  | { type: 'memory'; stage: string; memory: WorkerMemory }
  | { type: 'audio-open'; rate: number; frames: number; channels: number }
  | { type: 'audio-data'; start: number; pcm: ArrayBuffer }
  | { type: 'audio-rebase'; frame: number }
  | { type: 'audio-clear' }
  | { type: 'audio-close' }
  | { type: 'fatal'; message: string };

export interface WorkerValueMap {
  'parse-map': string | null;
  'has-map': boolean;
  'demo-info': DemoInfo | null;
  summary: DemoSummary | null;
  trajectory: TrajectoryData | null;
  'freecam-on': FreeCamPose | null;
}
