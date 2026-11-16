import type { DemoStatus, LocalFile, StageProgress } from '../types';
import { prepareAndStage } from '../fs/stage';

interface ModuleLike {
  ccall?(name: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown;
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
          '+set', 'cl_renderer', 'rd-vanilla',
          '+set', 'fs_basepath', '/jka',
          '+set', 'fs_homepath', '/userdata',
          '+set', 'cl_allowDownload', '0',
          '+set', 's_initsound', '0',
          '+set', 'com_bootlogo', '0',
          '+set', 'r_fullscreen', '0',
          '+set', 'r_mode', '4',
          '+set', 'com_maxfps', '60',
          '+set', 'logfile', '0'
      ];
      if (new URLSearchParams(window.location.search).get('norefresh') === '1') {
        args.push('+set', 'r_norefresh', '1');
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
      const status = this.getStatus();
      if (!status) return;
      this.callbacks.onStatus(status);
      if (!this.ready && status.state > 0) {
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

  playDemo(name: string): void {
    if (!this.module?.ccall) throw new Error('Engine is not ready.');
    this.currentDemo = name;
    this.module.ccall?.('JKA_Resume', null, [], []);
    this.module.ccall?.('JKA_PlayDemo', null, ['string'], [name]);
  }

  setPaused(paused: boolean): void {
    if (!this.module?.ccall) return;
    this.module.ccall?.('JKA_SetPaused', null, ['number'], [paused ? 1 : 0]);
    if (!paused) this.module.ccall?.('JKA_Resume', null, [], []);
  }

  stopDemo(): void {
    if (!this.module?.ccall) return;
    this.module.ccall?.('JKA_StopDemo', null, [], []);
    this.currentDemo = null;
  }

  get demoName(): string | null {
    return this.currentDemo;
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
