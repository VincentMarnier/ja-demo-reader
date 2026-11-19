import type {
  DemoInfo,
  DemoStatus,
  DemoSummary,
  FreeCamPose,
  LocalFile,
  RadarData,
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
  renderWidth: number;
  renderHeight: number;
}

export interface RenderSize {
  width: number;
  height: number;
}

function evenPixels(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * The render target is sized to the screen, not to the 4:3 stage: the canvas
 * is stretched to fill the stage, and cg_fovAspect tells the cgame the real
 * displayed aspect so the projection stays square.  Fullscreen therefore uses
 * the screen's aspect and resolution instead of showing a 4:3 picture inside
 * a 16:9 screen.
 */
export function resolveRenderSize(): RenderSize {
  const low = new URLSearchParams(window.location.search).get('quality') === 'low';
  const screenWidth = Math.max(640, Math.round(window.screen?.width || window.innerWidth || 1280));
  const screenHeight = Math.max(480, Math.round(window.screen?.height || window.innerHeight || 720));
  const maxWidth = low ? 960 : 1920;
  const maxHeight = low ? 540 : 1080;
  const scale = Math.min(1, maxWidth / screenWidth, maxHeight / screenHeight);
  const width = evenPixels(Math.min(maxWidth, Math.max(640, screenWidth * scale)));
  const height = evenPixels(Math.min(maxHeight, Math.max(360, screenHeight * scale)));
  return { width, height };
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
  /** Live player positions for the minimap; null while a long call is running. */
  getRadar(): Promise<RadarData | null>;
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
  renderWidth: number;
  renderHeight: number;
}

/**
 * Boot arguments are shared by both hosts.  Texture cvars are latched: they
 * must be set before the renderer starts, so a texture change applies on the
 * next engine boot/reload.
 */
export function buildEngineArgs(options: {
  texturePicmip?: number;
  textureMipmaps?: TextureMipmapMode;
  renderWidth?: number;
  renderHeight?: number;
}): EngineArgs {
  const textureMipmaps = options.textureMipmaps ?? 'off';
  const picmip = Math.min(16, Math.max(0, Math.round(options.texturePicmip ?? 2)));
  const renderWidth = Math.max(320, Math.round(options.renderWidth ?? 800));
  const renderHeight = Math.max(240, Math.round(options.renderHeight ?? 600));
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
    // The canvas element carries the render size in the worker; the SDL
    // fallback takes the same custom mode so both hosts render the same target.
    '+set', 'r_mode', '-1',
    '+set', 'r_customwidth', String(renderWidth),
    '+set', 'r_customheight', String(renderHeight),
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
    '+set', 'cg_drawFriend', '0',
    '+set', 'cg_drawFollow', '0',
    '+set', 'cg_fovAspectAdjust', '1',
    // Overridden from the stage size by the app; 4:3 is the windowed stage.
    '+set', 'cg_fovAspect', '1.333333',
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
    // Software rasterisers / low-end GPUs: fewer texture pixels, a smaller
    // render target (resolveRenderSize caps it) and a lower frame cap, while
    // keeping the same rd-rend2 path.
    args.push(
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

  return { args, fastProfile, diagnostics, picmip, textureMipmaps, renderWidth, renderHeight };
}
