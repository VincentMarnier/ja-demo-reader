import type { DemoInfo, DemoSummary, FreeCamPose, LocalFile, ScoreboardData } from '../types';
import type { BootOptions, EngineCallbacks, EngineHostApi } from './shared';
import { buildEngineArgs, ENGINE_BASE, WorkerUnsupportedError } from './shared';
import type { BootFile, WorkerMemory, WorkerRequest, WorkerResponse } from './protocol';

const LOG_LIMIT = 20000;

/** Browser-side gate for the worker path.  ?worker=0 forces the fallback. */
export function workerHostSupported(): boolean {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  if (
    typeof HTMLCanvasElement === 'undefined' ||
    !('transferControlToOffscreen' in HTMLCanvasElement.prototype)
  ) {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('worker') === '0') return false;
  } catch {
    return false;
  }
  let webgl2 = false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    webgl2 = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Primary host: the engine runs in a dedicated worker and renders to an
 * OffscreenCanvas.  The worker serializes wasm calls; this class only holds
 * the RPC, the cached status/scoreboard used by the synchronous UI reads, and
 * the log buffer.
 */
export class WorkerEngineHost implements EngineHostApi {
  readonly mode = 'worker' as const;
  private worker: Worker | null = null;
  private callbacks: EngineCallbacks;
  private logs: string[] = [];
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private scoreboard: ScoreboardData | null = null;
  private currentDemo: string | null = null;
  private playInFlight: Promise<void> | null = null;
  private prepareInFlight: Promise<void> | null = null;
  private ready = false;
  private fatal = false;
  private bootResolve: (() => void) | null = null;
  private bootReject: ((error: Error) => void) | null = null;
  private bootTimer: number | null = null;
  private lastMarkAt = 0;

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
  }

  get logText(): string {
    return this.logs.join('\n');
  }

  get demoName(): string | null {
    return this.currentDemo;
  }

  async boot(options: BootOptions): Promise<void> {
    if (!workerHostSupported()) {
      throw new WorkerUnsupportedError('Worker/OffscreenCanvas/WebGL2 is not available.');
    }
    if (options.signal.aborted) {
      throw new Error('Engine boot cancelled.');
    }

    this.markStage('boot-start');
    await this.checkEngineBuild();
    const engineArgs = buildEngineArgs(options);
    this.logBrowserProfile(
      engineArgs.fastProfile
        ? 'fast (url)'
        : `picmip${engineArgs.picmip}/${engineArgs.textureMipmaps ?? 'off'}`,
      engineArgs.diagnostics
    );

    const bootFileList: BootFile[] = options.files
      .filter(file => /\.pk3$/i.test(file.name))
      .map(file => ({ name: file.name, file: file.file }));

    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'classic',
      name: 'jka-engine'
    });
    this.worker = worker;

    await this.preflight(worker);

    const ready = new Promise<void>((resolve, reject) => {
      this.bootResolve = resolve;
      this.bootReject = reject;
    });

    worker.onmessage = event => this.onMessage(event.data as WorkerResponse);
    worker.onerror = event => {
      event.preventDefault();
      this.fail(event.message ? `Engine worker error: ${event.message}` : 'Engine worker error.');
    };
    worker.onmessageerror = () => this.fail('Engine worker message could not be deserialized.');

    const abort = () => {
      this.fail('Engine boot cancelled.');
      this.destroy();
    };
    options.signal.addEventListener('abort', abort, { once: true });

    let offscreen: OffscreenCanvas;
    try {
      offscreen = options.canvas.transferControlToOffscreen();
    } catch (error) {
      options.signal.removeEventListener('abort', abort);
      this.destroy();
      throw new Error(
        `Could not transfer the canvas to the engine worker: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const message: WorkerRequest = {
      id: this.nextId++,
      type: 'boot',
      canvas: offscreen,
      base: ENGINE_BASE,
      args: engineArgs.args,
      files: bootFileList
    };

    this.bootTimer = window.setTimeout(() => {
      this.fail('The engine did not become ready in the worker. Download the log and reload.');
    }, 120000);

    worker.postMessage(message, [offscreen]);
    await ready;
    options.signal.removeEventListener('abort', abort);
    this.ready = true;
    this.markStage('engine-ready');
  }

  /**
   * Catch an engine staged before M9 Phase 3 before the canvas transfer is
   * irreversible.  The WORKERFS filesystem lives in the JS glue and is only
   * present when -lworkerfs.js was linked; a stale build has only IDBFS and
   * its SDL window layer cannot run in a worker.  The app can still use the
   * stale build on the main thread.
   */
  private async checkEngineBuild(): Promise<void> {
    let text: string;
    try {
      const response = await fetch(`${ENGINE_BASE}openjk.x86.js`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new WorkerUnsupportedError(
          `Could not load the engine script (HTTP ${response.status}). Did you stage the engine build?`
        );
      }
      text = await response.text();
    } catch (error) {
      if (error instanceof WorkerUnsupportedError) throw error;
      throw new WorkerUnsupportedError(`Could not verify the engine build: ${String(error)}`);
    }

    if (!text.includes('WORKERFS')) {
      throw new WorkerUnsupportedError(
        'The staged engine build has no WORKERFS (it predates M9 Phase 3). Rebuild and stage the engine; using the main-thread fallback for now.'
      );
    }
  }

  private async preflight(worker: Worker): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new WorkerUnsupportedError('The engine worker did not start.'));
      }, 5000);
      const onMessage = (event: MessageEvent) => {
        const pong = event.data as { type?: string; webgl2?: boolean } | null;
        if (pong?.type === 'pong') {
          cleanup();
          if (pong.webgl2) {
            resolve();
          } else {
            reject(new WorkerUnsupportedError('WebGL2 is not available inside the engine worker.'));
          }
        }
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new WorkerUnsupportedError(`The engine worker failed to load: ${event.message || 'unknown error'}`));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      try {
        worker.postMessage({ type: 'ping' });
      } catch (error) {
        cleanup();
        reject(new WorkerUnsupportedError(`The engine worker could not be started: ${String(error)}`));
      }
    });
  }

  private onMessage(response: WorkerResponse): void {
    if (!response) return;

    if ('id' in response) {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.value);
      } else {
        pending.reject(new Error(response.error));
      }
      return;
    }

    const event = response as Exclude<WorkerResponse, { id: number }>;
    switch (event.type) {
      case 'pong':
        return;
      case 'log':
        for (const line of event.lines) {
          this.appendLog(line);
          this.callbacks.onLog(line);
        }
        return;
      case 'progress':
        this.callbacks.onProgress(event.progress);
        return;
      case 'ready':
        this.ready = true;
        if (this.bootTimer !== null) {
          window.clearTimeout(this.bootTimer);
          this.bootTimer = null;
        }
        this.bootResolve?.();
        this.bootResolve = null;
        this.bootReject = null;
        return;
      case 'status':
        this.callbacks.onStatus(event.status);
        return;
      case 'scoreboard':
        this.scoreboard = event.scoreboard;
        return;
      case 'memory':
        void this.logWorkerMemory(event.stage, event.memory);
        return;
      case 'fatal':
        this.fail(event.message);
        return;
      default:
        return;
    }
  }

  private appendLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > LOG_LIMIT) {
      this.logs.splice(0, this.logs.length - LOG_LIMIT);
    }
  }

  private call<T>(type: string, payload: Record<string, unknown> = {}, transfer?: Transferable[]): Promise<T> {
    if (!this.worker) return Promise.reject(new Error('Engine worker is not running.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      });
      const message = { id, type, ...payload };
      if (transfer) {
        this.worker?.postMessage(message, transfer);
      } else {
        this.worker?.postMessage(message);
      }
    });
  }

  private fail(message: string): void {
    if (this.fatal) return;
    this.fatal = true;
    if (this.bootTimer !== null) {
      window.clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    this.appendLog(`JKA_PROFILE worker fatal=${message}`);
    this.callbacks.onFatal(message);
    const error = new Error(message);
    this.bootReject?.(error);
    this.bootResolve = null;
    this.bootReject = null;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  markStage(stage: string): void {
    const now = performance.now();
    const since = this.lastMarkAt > 0 ? now - this.lastMarkAt : 0;
    this.lastMarkAt = now;
    this.profile(`stage=${stage} sinceMs=${since.toFixed(1)} uptimeMs=${now.toFixed(1)}`);
    this.worker?.postMessage({ type: 'stage', stage });
  }

  private profile(line: string): void {
    const text = line.startsWith('JKA_PROFILE ') ? line : `JKA_PROFILE ${line}`;
    this.appendLog(text);
    this.callbacks.onLog(text);
  }

  private logBrowserProfile(session: string, diagnostics: boolean): void {
    let webgl2 = false;
    let offscreenWebgl2 = false;
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      webgl2 = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
    try {
      const probe = new OffscreenCanvas(1, 1);
      const gl = probe.getContext('webgl2');
      offscreenWebgl2 = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      offscreenWebgl2 = false;
    }
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.profile(
      `browser path=worker worker=1 offscreen=1 transfer=1 webgl2=${webgl2 ? 1 : 0} ` +
        `offscreenWebgl2=${offscreenWebgl2 ? 1 : 0} cores=${navigator.hardwareConcurrency ?? 'n/a'} ` +
        `deviceMemory=${deviceMemory ?? 'n/a'} ua=${navigator.userAgent}`
    );
    this.profile(`session texture=${session} diagnostics=${diagnostics ? 1 : 0}`);
  }

  private async logWorkerMemory(stage: string, memory: WorkerMemory): Promise<void> {
    const perfMemory = (
      performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
      }
    ).memory;
    const jsHeap = perfMemory
      ? ` jsHeapUsed=${perfMemory.usedJSHeapSize} jsHeapTotal=${perfMemory.totalJSHeapSize}`
      : '';
    let storage = '';
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate) {
        storage = ` storageUsage=${estimate.usage ?? 'n/a'} quota=${estimate.quota ?? 'n/a'}`;
      }
    } catch {
      storage = ' storage=n/a';
    }
    this.profile(
      `memory stage=${stage} path=worker heap=${memory.heap} heapMax=${memory.heapMax} ` +
        `hunkFree=${memory.hunkFree} memfs=${memory.memfs} mounted=${memory.mounted} ` +
        `mountedFiles=${memory.mountedFiles}${jsHeap}${storage}`
    );
  }

  async playDemo(name: string): Promise<void> {
    if (this.playInFlight) return this.playInFlight;
    this.currentDemo = name;
    this.playInFlight = this.call<void>('play', { name }).finally(() => {
      this.playInFlight = null;
    });
    return this.playInFlight;
  }

  async prepareDemo(name: string): Promise<void> {
    if (this.prepareInFlight) return this.prepareInFlight;
    this.currentDemo = name;
    this.prepareInFlight = this.call<void>('prepare', { name }).finally(() => {
      this.prepareInFlight = null;
    });
    return this.prepareInFlight;
  }

  async resumeDemo(): Promise<void> {
    await this.call<void>('resume');
  }

  async suspendDemo(): Promise<void> {
    await this.call<void>('suspend');
  }

  async releaseEngine(): Promise<void> {
    await this.call<void>('release');
    this.currentDemo = null;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.call<void>('pause', { paused });
  }

  async stopDemo(): Promise<void> {
    await this.call<void>('stop');
    this.currentDemo = null;
  }

  async parseDemoMap(name: string): Promise<string | null> {
    return (await this.call<string | null>('parse-map', { name })) ?? null;
  }

  async hasMap(map: string): Promise<boolean> {
    return !!(await this.call<boolean>('has-map', { map }));
  }

  async addMapFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.pk3')) {
      throw new Error('The map must be supplied as a .pk3 file.');
    }
    await this.call<void>('add-map', { name: file.name, file });
  }

  async addDemoFile(file: LocalFile): Promise<void> {
    const name = file.name.split('/').pop() || file.name;
    // The worker reads the File; only the reference crosses the boundary.
    await this.call<void>('add-demo', { name, file: file.file });
  }

  async demoInfo(name: string): Promise<DemoInfo | null> {
    try {
      const info = await this.call<DemoInfo | null>('demo-info', { name });
      if (!info) return null;
      if (!Number.isFinite(info.first) || !Number.isFinite(info.duration) || info.duration <= 0) return null;
      return info;
    } catch {
      return null;
    }
  }

  async demoSummary(): Promise<DemoSummary | null> {
    try {
      const summary = await this.call<DemoSummary | null>('summary');
      if (!summary || !Array.isArray(summary.games)) return null;
      return summary;
    } catch {
      return null;
    }
  }

  async seekDemo(name: string, targetMs: number): Promise<void> {
    await this.call<void>('seek', { name, target: Math.max(0, Math.round(targetMs)) });
  }

  setCvar(name: string, value: string): void {
    if (!this.ready) return;
    this.worker?.postMessage({ type: 'cvar', name, value });
  }

  async getScoreboard(): Promise<ScoreboardData | null> {
    return this.scoreboard;
  }

  followClient(clientNum: number): void {
    if (!this.ready) return;
    this.worker?.postMessage({ type: 'follow', client: clientNum });
  }

  async enableFreeCam(): Promise<FreeCamPose | null> {
    try {
      return (await this.call<FreeCamPose | null>('freecam-on')) ?? null;
    } catch {
      return null;
    }
  }

  setFreeCamPose(pose: FreeCamPose): void {
    if (!this.ready) return;
    this.worker?.postMessage({ type: 'freecam-pose', pose });
  }

  disableFreeCam(): void {
    if (!this.ready) return;
    this.worker?.postMessage({ type: 'freecam-off' });
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
    if (this.bootTimer !== null) {
      window.clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (!this.worker) return;
    this.ready = false;
    this.worker.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Engine worker stopped.'));
    }
    this.pending.clear();
  }
}
