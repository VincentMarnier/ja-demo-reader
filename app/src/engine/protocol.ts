import type { DemoInfo, DemoStatus, DemoSummary, FreeCamPose, ScoreboardData, StageProgress } from '../types';

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
    }
  | { id: number; type: 'play'; name: string }
  | { id: number; type: 'pause'; paused: boolean }
  | { id: number; type: 'stop' }
  | { id: number; type: 'parse-map'; name: string }
  | { id: number; type: 'has-map'; map: string }
  | { id: number; type: 'add-demo'; name: string; file: File }
  | { id: number; type: 'add-map'; name: string; file: File }
  | { id: number; type: 'demo-info'; name: string }
  | { id: number; type: 'summary' }
  | { id: number; type: 'seek'; name: string; target: number }
  | { id: number; type: 'freecam-on' }
  | { type: 'cvar'; name: string; value: string }
  | { type: 'follow'; client: number }
  | { type: 'freecam-pose'; pose: FreeCamPose }
  | { type: 'freecam-off' }
  | { type: 'stage'; stage: string };

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
  | { type: 'memory'; stage: string; memory: WorkerMemory }
  | { type: 'fatal'; message: string };

export interface WorkerValueMap {
  'parse-map': string | null;
  'has-map': boolean;
  'demo-info': DemoInfo | null;
  summary: DemoSummary | null;
  'freecam-on': FreeCamPose | null;
}
