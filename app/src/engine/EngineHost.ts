import type { DemoInfo, DemoStatus, DemoSummary, FreeCamPose, LocalFile, ScoreboardData, StageProgress } from '../types';
import { prepareAndStage } from '../fs/stage';

interface ModuleLike {
  ccall?(name: string, returnType: string | null, argTypes: string[], args: unknown[], opts?: { async?: boolean }): unknown;
  arguments?: string[];
  canvas?: HTMLCanvasElement;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  onAbort?: (what: unknown) => void;
  onRuntimeInitialized?: () => void;
  preRun?: Array<() => void>;
  locateFile?: (path: string) => string;
  FS?: unknown;
}

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
}

const ENGINE_BASE = `${import.meta.env.BASE_URL}engine/`;

export class EngineHost {
  private module: ModuleLike | null = null;
  private statusTimer: number | null = null;
  private ready = false;
  private fatal = false;
  private logs: string[] = [];
  private callbacks: EngineCallbacks;
  private currentDemo: string | null = null;
  private asyncInFlight = false;

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
  }

  get logText(): string {
    return this.logs.join('\n');
  }

  async boot(options: BootOptions): Promise<void> {
    const { canvas, files, signal } = options;

    return new Promise<void>((resolve, reject) => {
      const addDependency = (name: string) => {
        (window as unknown as { addRunDependency: (name: string) => void }).addRunDependency(name);
      };
      const removeDependency = (name: string) => {
        (window as unknown as { removeRunDependency: (name: string) => void }).removeRunDependency(name);
      };

      const fail = (error: unknown) => {
        if (this.fatal) return;
        this.fatal = true;
        const message = error instanceof Error ? error.message : String(error);
        this.callbacks.onFatal(message);
        reject(error instanceof Error ? error : new Error(message));
      };

      const args = [
          '+set', 'cl_renderer', 'rd-rend2',
          '+set', 'fs_basepath', '/jka',
          '+set', 'fs_homepath', '/userdata',
          '+set', 'cl_allowDownload', '0',
          '+set', 's_initsound', '0',
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
          '+set', 'com_maxfps', '60',
          '+set', 'logfile', '0'
      ];
      const params = new URLSearchParams(window.location.search);
      if (params.get('norefresh') === '1') {
        args.push('+set', 'r_norefresh', '1');
      }
      if (params.get('quality') === 'low') {
        // Software rasterisers / low-end GPUs: fewer texture pixels and a
        // lower frame cap, while keeping the same rd-rend2 path.
        args.push(
          '+set', 'r_mode', '4',
          '+set', 'r_picmip', '3',
          '+set', 'com_maxfps', '10',
          '+set', 'r_swapInterval', '0'
        );
      }

      const module: ModuleLike = {
        arguments: args,
        canvas,
        locateFile: (path: string) => `${ENGINE_BASE}${path}`,
        print: (text: string) => {
          this.logs.push(text);
          if (this.logs.length > 5000) this.logs.splice(0, this.logs.length - 5000);
          this.callbacks.onLog(text);
        },
        printErr: (text: string) => {
          const line = `ERR ${text}`;
          this.logs.push(line);
          if (this.logs.length > 5000) this.logs.splice(0, this.logs.length - 5000);
          this.callbacks.onLog(line);
        },
        onAbort: (what: unknown) => {
          fail(new Error(`Engine aborted: ${String(what)}`));
        },
        onRuntimeInitialized: () => {
          this.module = module;
          this.startPolling();
        },
        preRun: [
          () => {
            const FS = (window as unknown as { FS: unknown }).FS;
            if (!FS) {
              fail(new Error('Emscripten filesystem unavailable.'));
              return;
            }
            addDependency('jka-stage');
            prepareAndStage(FS as Parameters<typeof prepareAndStage>[0], {
              files,
              signal,
              addDependency,
              removeDependency,
              onProgress: progress => this.callbacks.onProgress(progress)
            })
              .then(() => removeDependency('jka-stage'))
              .catch(error => {
                console.error('staging failed', error);
                // Keep the dependency so the engine does not boot with a
                // partial asset set; the UI offers a reload.
                fail(error);
              });
          }
        ]
      };

      this.module = module;
      (window as unknown as { Module?: ModuleLike }).Module = module;

      const script = document.createElement('script');
      script.src = `${ENGINE_BASE}openjk.x86.js`;
      script.async = true;
      script.onerror = () => fail(new Error('Could not load the engine script. Did you stage the engine build?'));
      document.body.appendChild(script);

      const readyPoll = window.setInterval(() => {
        if (this.ready) {
          window.clearInterval(readyPoll);
          resolve();
        }
        if (this.fatal) {
          window.clearInterval(readyPoll);
        }
      }, 100);
    });
  }

  private startPolling(): void {
    if (this.statusTimer !== null) return;
    this.statusTimer = window.setInterval(() => {
      // Do not re-enter the wasm runtime while an asyncified engine call (the
      // map load during JKA_PlayDemo) is in flight.
      if (this.asyncInFlight) return;
      const status = this.getStatus();
      if (!status) return;
      this.callbacks.onStatus(status);
      if (!this.ready && status.ready === 1) {
        this.ready = true;
      }
    }, 250);
  }

  getStatus(): DemoStatus | null {
    if (!this.module?.ccall) return null;
    try {
      const raw = this.module.ccall('JKA_StatusJson', 'string', [], []) as string;
      return raw ? (JSON.parse(raw) as DemoStatus) : null;
    } catch {
      return null;
    }
  }

  async playDemo(name: string): Promise<void> {
    if (!this.module?.ccall) throw new Error('Engine is not ready.');
    this.currentDemo = name;
    this.asyncInFlight = true;
    try {
      await this.module.ccall?.('JKA_Resume', null, [], [], { async: true });
      // JKA_PlayDemo can yield while the renderer compiles shaders and loads
      // the map; ccall must therefore be asked for its async result.
      await this.module.ccall?.('JKA_PlayDemo', null, ['string'], [name], { async: true });
    } finally {
      this.asyncInFlight = false;
    }
  }

  async setPaused(paused: boolean): Promise<void> {
    if (!this.module?.ccall || this.asyncInFlight) return;
    this.asyncInFlight = true;
    try {
      await this.module.ccall?.('JKA_SetPaused', null, ['number'], [paused ? 1 : 0], { async: true });
      if (!paused) {
        await this.module.ccall?.('JKA_Resume', null, [], [], { async: true });
      }
    } finally {
      this.asyncInFlight = false;
    }
  }

  async stopDemo(): Promise<void> {
    if (!this.module?.ccall || this.asyncInFlight) return;
    this.asyncInFlight = true;
    try {
      await this.module.ccall?.('JKA_StopDemo', null, [], [], { async: true });
      // Stop can be pressed while paused; leave the engine loop running so the
      // disconnected scene can render behind the wizard.
      await this.module.ccall?.('JKA_SetPaused', null, ['number'], [0], { async: true });
      await this.module.ccall?.('JKA_Resume', null, [], [], { async: true });
      this.currentDemo = null;
    } finally {
      this.asyncInFlight = false;
    }
  }

  get demoName(): string | null {
    return this.currentDemo;
  }

  parseDemoMap(name: string): string | null {
    if (!this.module?.ccall) return null;
    const map = this.module.ccall('JKA_ParseDemoMap', 'string', ['string'], [name]) as string;
    return map && map.length ? map : null;
  }

  hasMap(map: string): boolean {
    if (!this.module?.ccall) return false;
    return !!this.module.ccall('JKA_HasMap', 'number', ['string'], [map]);
  }

  async addMapFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pk3')) {
      throw new Error('The map must be supplied as a .pk3 file.');
    }
    const FS = (window as unknown as {
      FS?: {
        createDataFile(parent: string, name: string, data: Uint8Array, read: boolean, write: boolean, own: boolean): void;
        unlink?(path: string): void;
        mkdirTree?(path: string): void;
        mkdir?(path: string): void;
      };
    }).FS;
    if (!FS) throw new Error('Engine filesystem unavailable.');
    const buffer = await file.arrayBuffer();
    // Re-adding the same map should replace it rather than fail with EEXIST.
    try {
      FS.unlink?.(`/jka/base/${file.name}`);
    } catch {
      // not staged yet
    }
    FS.createDataFile('/jka/base', file.name, new Uint8Array(buffer), true, false, true);
    this.asyncInFlight = true;
    try {
      await this.module?.ccall?.('JKA_RestartFS', null, [], [], { async: true });
    } finally {
      this.asyncInFlight = false;
    }
  }

  async addDemoFile(file: LocalFile): Promise<void> {
    const FS = (window as unknown as {
      FS?: {
        createDataFile(parent: string, name: string, data: Uint8Array, read: boolean, write: boolean, own: boolean): void;
        unlink?(path: string): void;
        mkdirTree?(path: string): void;
        mkdir?(path: string): void;
      };
    }).FS;
    if (!FS) throw new Error('Engine filesystem unavailable.');
    const name = file.name.split('/').pop() || file.name;
    let buffer: ArrayBuffer;
    try {
      buffer = await file.file.arrayBuffer();
    } catch (err) {
      throw new Error(`could not read ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Create every missing parent explicitly: some minimal Emscripten builds
    // do not expose mkdirTree, and the directory may not exist after a boot
    // that was started without the demo file.
    const directories = ['/jka', '/jka/base', '/jka/base/demos'];
    for (const directory of directories) {
      try {
        FS.mkdir?.(directory);
      } catch {
        // already exists
      }
    }
    try {
      FS.unlink?.(`/jka/base/demos/${name}`);
    } catch {
      // not staged yet
    }
    try {
      FS.createDataFile('/jka/base/demos', name, new Uint8Array(buffer), true, false, true);
    } catch (err) {
      throw new Error(`could not write ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async demoInfo(name: string): Promise<DemoInfo | null> {
    if (!this.module?.ccall || this.asyncInFlight) return null;
    this.asyncInFlight = true;
    try {
      const raw = await this.module.ccall('JKA_DemoInfo', 'string', ['string'], [name], { async: true });
      if (!raw) return null;
      const info = JSON.parse(String(raw)) as DemoInfo;
      if (!Number.isFinite(info.first) || !Number.isFinite(info.duration) || info.duration <= 0) return null;
      return info;
    } catch {
      return null;
    } finally {
      this.asyncInFlight = false;
    }
  }

  demoSummary(): DemoSummary | null {
    if (!this.module?.ccall || this.asyncInFlight) return null;
    try {
      const raw = this.module.ccall('JKA_DemoSummaryJson', 'string', [], []) as string;
      if (!raw) return null;
      const summary = JSON.parse(raw) as DemoSummary;
      if (!summary || !Array.isArray(summary.games)) return null;
      return summary;
    } catch {
      return null;
    }
  }

  async seekDemo(name: string, targetMs: number): Promise<void> {
    if (!this.module?.ccall) throw new Error('Engine is not ready.');
    this.asyncInFlight = true;
    try {
      await this.module.ccall('JKA_SeekDemo', null, ['string', 'number'], [name, Math.max(0, Math.round(targetMs))], {
        async: true
      });
    } finally {
      this.asyncInFlight = false;
    }
  }

  setCvar(name: string, value: string): void {
    if (!this.module?.ccall || this.asyncInFlight) return;
    this.module.ccall('JKA_SetCvar', null, ['string', 'string'], [name, value]);
  }

  getScoreboard(): ScoreboardData | null {
    if (!this.module?.ccall || this.asyncInFlight) return null;
    try {
      const raw = this.module.ccall('JKA_ScoreboardJson', 'string', [], []) as string;
      if (!raw) return null;
      const data = JSON.parse(raw) as ScoreboardData;
      if (!data || !Array.isArray(data.players)) return null;
      return data;
    } catch {
      return null;
    }
  }

  followClient(clientNum: number): void {
    if (!this.module?.ccall || this.asyncInFlight) return;
    this.module.ccall('JKA_FollowClient', null, ['number'], [clientNum]);
  }

  enableFreeCam(): FreeCamPose | null {
    if (!this.module?.ccall || this.asyncInFlight) return null;
    try {
      const raw = this.module.ccall('JKA_EnableFreeCam', 'string', [], []) as string;
      if (!raw || raw === 'null') return null;
      const pose = JSON.parse(raw) as FreeCamPose;
      if (![pose.x, pose.y, pose.z, pose.pitch, pose.yaw].every(Number.isFinite)) return null;
      return pose;
    } catch {
      return null;
    }
  }

  setFreeCamPose(pose: FreeCamPose): void {
    if (!this.module?.ccall || this.asyncInFlight) return;
    this.module.ccall('JKA_SetFreeCamPose', null, ['number', 'number', 'number', 'number', 'number', 'number'], [
      pose.x,
      pose.y,
      pose.z,
      pose.pitch,
      pose.yaw,
      pose.roll
    ]);
  }

  disableFreeCam(): void {
    if (!this.module?.ccall || this.asyncInFlight) return;
    this.module.ccall('JKA_DisableFreeCam', null, [], []);
  }

  downloadLogs(): void {
    const blob = new Blob([this.logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jka-demo-player.log';
    link.click();
    URL.revokeObjectURL(url);
  }

  destroy(): void {
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }
}
