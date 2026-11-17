import type { DemoInfo, DemoStatus, DemoSummary, FreeCamPose, LocalFile, ScoreboardData } from '../types';
import { prepareAndStage } from '../fs/stage';
import type { BootOptions, EngineCallbacks, EngineHostApi } from './shared';
import { buildEngineArgs, ENGINE_BASE } from './shared';

interface FsNode {
  contents?: Uint8Array | Record<string, FsNode>;
}

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

// Keep the whole diagnostic build log; the old 5000-line cap could drop boot
// timing lines before the user presses Download log.
const LOG_LIMIT = 20000;

/**
 * Degraded host: the whole engine runs on the main thread and the PK3s are
 * copied into MEMFS.  Kept for browsers without Worker/OffscreenCanvas or
 * WebGL2-in-worker, and forceable with ?worker=0.
 */
export class MainThreadEngineHost implements EngineHostApi {
  readonly mode = 'main-thread' as const;
  private module: ModuleLike | null = null;
  private statusTimer: number | null = null;
  private ready = false;
  private fatal = false;
  private logs: string[] = [];
  private callbacks: EngineCallbacks;
  private currentDemo: string | null = null;
  private asyncInFlight = false;
  private queue: Promise<unknown> = Promise.resolve();
  private playInFlight: Promise<void> | null = null;
  private prepareInFlight: Promise<void> | null = null;
  private runtimeReady = false;
  private stagedBytes = 0;
  private lastMarkAt = 0;

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
  }

  get logText(): string {
    return this.logs.join('\n');
  }

  async boot(options: BootOptions): Promise<void> {
    const { canvas, files, signal } = options;
    this.markStage('boot-start');

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

      const engineArgs = buildEngineArgs(options);
      const args = engineArgs.args;

      this.logBrowserProfile(
        engineArgs.fastProfile,
        engineArgs.diagnostics,
        engineArgs.picmip,
        engineArgs.textureMipmaps
      );

      const module: ModuleLike = {
        arguments: args,
        canvas,
        locateFile: (path: string) => `${ENGINE_BASE}${path}`,
        print: (text: string) => {
          this.logs.push(text);
          if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
          this.callbacks.onLog(text);
        },
        printErr: (text: string) => {
          const line = `ERR ${text}`;
          this.logs.push(line);
          if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
          this.callbacks.onLog(line);
        },
        onAbort: (what: unknown) => {
          fail(new Error(`Engine aborted: ${String(what)}`));
        },
        onRuntimeInitialized: () => {
          this.module = module;
          this.runtimeReady = true;
          this.markStage('runtime-init');
          this.startPolling();
        },
        preRun: [
          () => {
            this.markStage('stage-start');
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
              onProgress: progress => {
                if (progress.total > 0) this.stagedBytes = progress.loaded;
                this.callbacks.onProgress(progress);
              }
            })
              .then(() => {
                this.markStage('stage-done');
                removeDependency('jka-stage');
              })
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
      script.onload = () => this.markStage('script-loaded');
      script.onerror = () => fail(new Error('Could not load the engine script. Did you stage the engine build?'));
      document.body.appendChild(script);

      const readyPoll = window.setInterval(() => {
        if (this.ready) {
          window.clearInterval(readyPoll);
          this.markStage('engine-ready');
          resolve();
        }
        if (this.fatal) {
          window.clearInterval(readyPoll);
        }
      }, 100);
    });
  }

  /**
   * M9 diagnostics marker: a log line with the elapsed time since the last
   * stage plus a memory sample. App.tsx calls this around check map, Play,
   * Restart, seek and Stop; boot marks are added here.
   */
  markStage(stage: string): void {
    const now = performance.now();
    const since = this.lastMarkAt > 0 ? now - this.lastMarkAt : 0;
    this.lastMarkAt = now;
    this.profile(`stage=${stage} sinceMs=${since.toFixed(1)} uptimeMs=${now.toFixed(1)}`);
    void this.sampleMemory(stage);
  }

  private profile(line: string): void {
    const text = line.startsWith('JKA_PROFILE ') ? line : `JKA_PROFILE ${line}`;
    this.logs.push(text);
    if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
    this.callbacks.onLog(text);
  }

  private logBrowserProfile(
    fastProfile: boolean,
    diagnostics: boolean,
    picmip: number,
    textureMipmaps: BootOptions['textureMipmaps']
  ): void {
    let webgl2 = false;
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      webgl2 = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
    const hasWorker = typeof Worker !== 'undefined';
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    const hasTransfer =
      typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.profile(
      `browser path=main-thread worker=${hasWorker ? 1 : 0} offscreen=${hasOffscreen ? 1 : 0} ` +
        `transfer=${hasTransfer ? 1 : 0} webgl2=${webgl2 ? 1 : 0} cores=${navigator.hardwareConcurrency ?? 'n/a'} ` +
        `deviceMemory=${deviceMemory ?? 'n/a'} ua=${navigator.userAgent}`
    );
    this.profile(
      `session texture=${fastProfile ? 'fast (url)' : `picmip${picmip}/${textureMipmaps ?? 'off'}`} ` +
        `diagnostics=${diagnostics ? 1 : 0}`
    );
  }

  private async sampleMemory(stage: string): Promise<void> {
    let engine = '';
    if (this.runtimeReady && this.module?.ccall && !this.asyncInFlight) {
      try {
        const raw = this.module.ccall('JKA_MemoryJson', 'string', [], []) as string;
        if (raw) {
          const memory = JSON.parse(raw) as { heap?: number; heapMax?: number; hunkFree?: number };
          engine = ` heap=${memory.heap ?? 'n/a'} heapMax=${memory.heapMax ?? 'n/a'} hunkFree=${memory.hunkFree ?? 'n/a'}`;
        }
      } catch {
        engine = ' heap=n/a';
      }
    }

    const memfs = this.fsBytes();
    const perfMemory = (
      performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
      }
    ).memory;
    const jsHeap = perfMemory
      ? ` jsHeapUsed=${perfMemory.usedJSHeapSize} jsHeapTotal=${perfMemory.totalJSHeapSize}`
      : '';
    const staged = this.stagedBytes > 0 ? ` staged=${this.stagedBytes}` : '';

    let storage = '';
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate) {
        storage = ` storageUsage=${estimate.usage ?? 'n/a'} quota=${estimate.quota ?? 'n/a'}`;
      }
    } catch {
      storage = ' storage=n/a';
    }

    this.profile(`memory stage=${stage}${engine} memfs=${memfs ?? 'n/a'}${staged}${jsHeap}${storage}`);
  }

  // Sums regular-file bytes in the Emscripten filesystem. MEMFS keeps file
  // contents as Uint8Array and directories as name->node objects.
  private fsBytes(): number | null {
    const FS = (
      window as unknown as {
        FS?: { root?: FsNode; lookupPath?: (path: string) => { node?: FsNode } };
      }
    ).FS;
    if (!FS) return null;

    let root: FsNode | undefined;
    try {
      root = FS.lookupPath ? FS.lookupPath('/').node : FS.root;
    } catch {
      return null;
    }
    if (!root) return null;

    let total = 0;
    const seen = new Set<object>();
    const walk = (node: FsNode | undefined): void => {
      if (!node) return;
      const contents = node.contents;
      if (contents instanceof Uint8Array) {
        total += contents.byteLength;
        return;
      }
      if (!contents || typeof contents !== 'object' || seen.has(contents)) return;
      seen.add(contents);
      for (const child of Object.values(contents)) {
        if (child && typeof child === 'object') walk(child);
      }
    };
    walk(root);
    return total;
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

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      this.asyncInFlight = true;
      try {
        return await task();
      } finally {
        this.asyncInFlight = false;
      }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async playDemo(name: string): Promise<void> {
    if (!this.module?.ccall) throw new Error('Engine is not ready.');
    // Coalesce a second click while the map is still loading.  A queued second
    // JKA_PlayDemo would start another map load after the first async call
    // returns, which is what produced the Asyncify "already in flight" abort.
    if (this.playInFlight) return this.playInFlight;
    this.currentDemo = name;
    this.playInFlight = this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_SetPaused', null, ['number'], [0], { async: true });
      await this.module?.ccall?.('JKA_Resume', null, [], [], { async: true });
      await this.module?.ccall?.('JKA_PlayDemo', null, ['string'], [name], { async: true });
    }).finally(() => {
      this.playInFlight = null;
    });
    return this.playInFlight;
  }

  async prepareDemo(name: string): Promise<void> {
    if (this.prepareInFlight) return this.prepareInFlight;
    if (!this.module?.ccall) return;
    this.currentDemo = name;
    this.prepareInFlight = this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_PrepareDemo', null, ['string'], [name], { async: true });
    }).finally(() => {
      this.prepareInFlight = null;
    });
    return this.prepareInFlight;
  }

  async resumeDemo(): Promise<void> {
    if (!this.module?.ccall) return;
    await this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_ResumeDemo', null, [], [], { async: true });
    });
  }

  async suspendDemo(): Promise<void> {
    if (!this.module?.ccall) return;
    await this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_Suspend', null, [], [], { async: true });
    });
  }

  async releaseEngine(): Promise<void> {
    if (!this.module?.ccall) return;
    await this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_Release', null, [], [], { async: true });
    });
    this.currentDemo = null;
  }

  async setPaused(paused: boolean): Promise<void> {
    if (!this.module?.ccall) return;
    await this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_SetPaused', null, ['number'], [paused ? 1 : 0], { async: true });
      if (!paused) {
        await this.module?.ccall?.('JKA_Resume', null, [], [], { async: true });
      }
    });
  }

  async stopDemo(): Promise<void> {
    if (!this.module?.ccall) return;
    await this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_StopDemo', null, [], [], { async: true });
      // Stop can be pressed while paused; leave the engine loop running so the
      // disconnected scene can render behind the wizard.
      await this.module?.ccall?.('JKA_SetPaused', null, ['number'], [0], { async: true });
      await this.module?.ccall?.('JKA_Resume', null, [], [], { async: true });
      this.currentDemo = null;
    });
  }

  get demoName(): string | null {
    return this.currentDemo;
  }

  async parseDemoMap(name: string): Promise<string | null> {
    if (!this.module?.ccall) return null;
    const map = this.module.ccall('JKA_ParseDemoMap', 'string', ['string'], [name]) as string;
    return map && map.length ? map : null;
  }

  async hasMap(map: string): Promise<boolean> {
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
    await this.runExclusive(async () => {
      // Re-adding the same map should replace it rather than fail with EEXIST.
      try {
        FS.unlink?.(`/jka/base/${file.name}`);
      } catch {
        // not staged yet
      }
      FS.createDataFile('/jka/base', file.name, new Uint8Array(buffer), true, false, true);
      await this.module?.ccall?.('JKA_RestartFS', null, [], [], { async: true });
    });
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
    await this.runExclusive(async () => {
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
    });
  }

  async demoInfo(name: string): Promise<DemoInfo | null> {
    if (!this.module?.ccall) return null;
    try {
      return await this.runExclusive(async () => {
        const raw = await this.module?.ccall?.('JKA_DemoInfo', 'string', ['string'], [name], { async: true });
        if (!raw) return null;
        const info = JSON.parse(String(raw)) as DemoInfo;
        if (!Number.isFinite(info.first) || !Number.isFinite(info.duration) || info.duration <= 0) return null;
        return info;
      });
    } catch {
      return null;
    }
  }

  async demoSummary(): Promise<DemoSummary | null> {
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
    await this.runExclusive(async () => {
      await this.module?.ccall?.('JKA_SeekDemo', null, ['string', 'number'], [name, Math.max(0, Math.round(targetMs))], {
        async: true
      });
    });
  }

  setCvar(name: string, value: string): void {
    if (!this.module?.ccall || this.asyncInFlight) return;
    this.module.ccall('JKA_SetCvar', null, ['string', 'string'], [name, value]);
  }

  async getScoreboard(): Promise<ScoreboardData | null> {
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

  async enableFreeCam(): Promise<FreeCamPose | null> {
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
