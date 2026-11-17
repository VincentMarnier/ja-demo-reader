import type {
  DemoInfo,
  DemoStatus,
  DemoSummary,
  FreeCamPose,
  LocalFile,
  ScoreboardData,
  StageProgress
} from '../types';
import type { TextureMipmapMode } from '../settings';

/** Which host is driving the wasm module. */
export type EngineMode = 'worker' | 'main-thread';

export interface EngineCallbacks {
  onLog(line: string): void;
  onStatus(status: DemoStatus): void;
  onProgress(progress: StageProgress): void;
  onFatal(message: string): void;
}

export interface BootOptions {
  canvas: HTMLCanvasElement;
  files: LocalFile[];
  signal: AbortSignal;
  texturePicmip?: number;
  textureMipmaps?: TextureMipmapMode;
}

/**
 * The app-facing engine surface.  Both hosts implement it, so the wizard and
 * player never branch on the host.  Calls that reach the wasm module are
 * asynchronous in the worker host, hence the Promise return type everywhere
 * a result is needed.
 */
export interface EngineHostApi {
  readonly mode: EngineMode;
  readonly logText: string;
  readonly demoName: string | null;
  boot(options: BootOptions): Promise<void>;
  markStage(stage: string): void;
  playDemo(name: string): Promise<void>;
  prepareDemo(name: string): Promise<void>;
  resumeDemo(): Promise<void>;
  suspendDemo(): Promise<void>;
  releaseEngine(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  stopDemo(): Promise<void>;
  parseDemoMap(name: string): Promise<string | null>;
  hasMap(map: string): Promise<boolean>;
  addPk3Files(files: File[]): Promise<void>;
  addDemoFile(file: LocalFile): Promise<void>;
  demoInfo(name: string): Promise<DemoInfo | null>;
  demoSummary(): Promise<DemoSummary | null>;
  seekDemo(name: string, targetMs: number): Promise<void>;
  setCvar(name: string, value: string): void;
  getScoreboard(): Promise<ScoreboardData | null>;
  followClient(clientNum: number): void;
  enableFreeCam(): Promise<FreeCamPose | null>;
  setFreeCamPose(pose: FreeCamPose): void;
  disableFreeCam(): void;
  downloadLogs(): void;
  destroy(): void;
}

/**
 * Thrown only before the canvas is transferred.  The app may then retry with
 * the main-thread host in the same page; once an OffscreenCanvas has been
 * transferred the element cannot be given a main-thread context.
 */
export class WorkerUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerUnsupportedError';
  }
}

// Absolute so the worker's locateFile also works from Vite's /assets/ URL.
export const ENGINE_BASE = new URL(`${import.meta.env.BASE_URL}engine/`, window.location.href).href;

export interface EngineArgs {
  args: string[];
  fastProfile: boolean;
  diagnostics: boolean;
  picmip: number;
  textureMipmaps: TextureMipmapMode;
}

/**
 * Boot arguments are shared by both hosts.  Texture cvars are latched: they
 * must be set before the renderer starts, so a texture change applies on the
 * next engine boot/reload.
 */
export function buildEngineArgs(options: {
  texturePicmip?: number;
  textureMipmaps?: TextureMipmapMode;
}): EngineArgs {
  const textureMipmaps = options.textureMipmaps ?? 'off';
  const picmip = Math.min(16, Math.max(0, Math.round(options.texturePicmip ?? 2)));
  const textureMode =
    textureMipmaps === 'trilinear'
      ? 'GL_LINEAR_MIPMAP_LINEAR'
      : textureMipmaps === 'bilinear'
        ? 'GL_LINEAR_MIPMAP_NEAREST'
        : 'GL_LINEAR';

  const args = [
    '+set', 'cl_renderer', 'rd-rend2',
    '+set', 'fs_basepath', '/jka',
    '+set', 'fs_homepath', '/userdata',
    '+set', 'cl_allowDownload', '0',
    '+set', 's_initsound', '1',
    '+set', 'com_bootlogo', '0',
    '+set', 'r_fullscreen', '0',
    '+set', 'r_mode', '4',
    '+set', 'r_hdr', '0',
    '+set', 'r_cubeMapping', '0',
    '+set', 'r_ssao', '0',
    '+set', 'cg_shadows', '0',
    '+set', 'r_ext_compressed_textures', '0',
    '+set', 'cg_fov', '97',
    '+set', 'cg_externalHud', '1',
    '+set', 'cg_drawScores', '0',
    '+set', 'cg_drawTimer', '0',
    '+set', 'cg_drawRadar', '0',
    '+set', 'cg_drawStatus', '0',
    '+set', 'cg_hudFiles', '0',
    '+set', 'cg_drawCrosshair', '0',
    '+set', 'cg_killMessage', '0',
    '+set', 'com_maxfps', '60',
    '+set', 'logfile', '0',
    '+set', 'r_picmip', String(picmip),
    '+set', 'r_textureMode', textureMode
  ];

  const params = new URLSearchParams(window.location.search);
  const diagnostics = params.get('diagnostics') === '1';
  const fastProfile = params.get('profile') === 'fast';
  if (params.get('norefresh') === '1') {
    args.push('+set', 'r_norefresh', '1');
  }
  if (params.get('sound') === '0') {
    // Diagnostic fallback for browsers where the Web Audio bridge is not
    // wanted or causes trouble.
    args.push('+set', 's_initsound', '0');
  }
  if (params.get('quality') === 'low') {
    // Software rasterisers / low-end GPUs: fewer texture pixels and a lower
    // frame cap, while keeping the same rd-rend2 path.
    args.push(
      '+set', 'r_mode', '4',
      '+set', 'r_picmip', '3',
      '+set', 'com_maxfps', '10',
      '+set', 'r_swapInterval', '0'
    );
  }
  if (fastProfile) {
    // M9 baseline session 2: no picmip mip pyramid, linear filtering.
    args.push('+set', 'r_picmip', '2', '+set', 'r_textureMode', 'GL_LINEAR');
  }
  if (diagnostics) {
    // A release engine build keeps jka_profile off; ?diagnostics=1 turns the
    // same M9 timing/usage lines on without a PROFILE=1 build.
    args.push('+set', 'jka_profile', '1');
  }

  return { args, fastProfile, diagnostics, picmip, textureMipmaps };
}
