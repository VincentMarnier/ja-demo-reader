import { MainThreadEngineHost } from './EngineHost';
import { WorkerEngineHost, workerHostSupported } from './WorkerEngineHost';
import type { EngineCallbacks, EngineHostApi, EngineMode } from './shared';

export type { BootOptions, EngineCallbacks, EngineHostApi, EngineMode, RenderSize } from './shared';
export { WorkerUnsupportedError, resolveRenderSize } from './shared';
export { workerHostSupported };

/**
 * Both hosts implement the same interface and share the engine build and boot
 * arguments.  The worker path is the default; browsers without the required
 * APIs (or ?worker=0) get the MEMFS main-thread fallback.
 */
export function createEngineHost(callbacks: EngineCallbacks, force?: EngineMode): EngineHostApi {
  if (force === 'worker' || (!force && workerHostSupported())) {
    return new WorkerEngineHost(callbacks);
  }
  return new MainThreadEngineHost(callbacks);
}
