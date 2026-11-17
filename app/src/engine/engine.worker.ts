/// M9 Phase 3 engine worker (classic).
///
/// The Emscripten module is not modularized: its glue declares a global
/// `Module`.  We configure that object and `importScripts()` the engine, so the
/// same build also serves the main-thread fallback.  Retail PK3s are mounted
/// read-only with WORKERFS; only demos and added map PK3s are copied into the
/// writable `/userdata/base` MEMFS.

import type { DemoStatus, FreeCamPose, ScoreboardData } from '../types';
import type { WorkerMemory, WorkerRequest, WorkerResponse } from './protocol';

// Keep CA_ACTIVE inline: Vite dev serves a classic worker as an unbundled
// script, so any runtime import would become an ESM `import` statement and the
// worker would fail to parse.  This mirrors app/src/types.ts.
const CA_ACTIVE = 8;

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

interface FsNode {
  contents?: Uint8Array | Record<string, FsNode>;
}

interface EmscriptenFS {
  mkdirTree(path: string): void;
  mount(filesystem: unknown, options: Record<string, unknown>, mountpoint: string): void;
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string, options?: { encoding?: string }): string | Uint8Array;
  lookupPath(path: string): { node?: FsNode };
  filesystems?: Record<string, unknown>;
}

interface WorkerFsNode {
  name?: string;
  size?: number;
  contents?: File;
}

interface WorkerFsStream {
  node?: WorkerFsNode;
}

interface WorkerFsStreamOps {
  read(stream: WorkerFsStream, buffer: Uint8Array, offset: number, length: number, position: number): number;
}

interface WorkerFsFilesystem {
  stream_ops?: WorkerFsStreamOps;
}

interface CentralDirectoryCache {
  start: number;
  end: number;
  bytes: Uint8Array;
}

interface EngineModule {
  ccall?(
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    options?: { async?: boolean }
  ): unknown;
  FS?: EmscriptenFS;
  canvas?: OffscreenCanvas;
  arguments?: string[];
  locateFile?: (path: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  onAbort?: (what: unknown) => void;
  onRuntimeInitialized?: () => void;
  preRun?: Array<() => void>;
  jkaAudio?: Record<string, unknown>;
}

declare function importScripts(...urls: string[]): void;

const scope = self as unknown as WorkerScope;
const LOG_LIMIT = 20000;

let engineModule: EngineModule | null = null;
let runtimeReady = false;
let workerModeSet = false;
let readySent = false;
let asyncInFlight = false;
let queue: Promise<unknown> = Promise.resolve();
let lastStatus: DemoStatus | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let scoreboardTimer: ReturnType<typeof setInterval> | null = null;
let logBuffer: string[] = [];
let logTimer: ReturnType<typeof setTimeout> | null = null;
let mountedBytes = 0;
let mountedFiles = 0;
let workerBootStart = 0;
let audioOutRate = 0;
let audioChannels = 2;
let audioClockFrame = 0;
let audioClockAt = 0;
let audioClockLogged = false;
let audioClockStarted = false;
let audioLastCallAt = 0;
let audioLastFrame = 0;
let audioHasPcm = false;

/**
 * Audio clock the engine reads through SNDDMA_GetDMAPos.  The page owns the
 * AudioContext; it sends its audible frame roughly ten times a second, and the
 * worker extrapolates with the wall clock between messages.
 */
function audioPlayFrame(): number {
  // Until the page has scheduled its first block there is no playback position;
  // returning a value extrapolated from a stale timestamp would invent time
  // while a long worker task (boot) has kept the clock messages queued.
  if (!audioOutRate || !audioClockStarted) return 0;
  const now = Date.now();
  const stalled = audioHasPcm && audioLastCallAt > 0 && now - audioLastCallAt > 1500;
  if (stalled) {
    // A long main-thread stall (map load, background tab) would otherwise make
    // the engine's DMA position jump several ring buffers at once.  Continue
    // from the last audible frame with a small lead and re-anchor the page.
    audioClockFrame = audioLastFrame + Math.round(audioOutRate * 0.1);
    audioClockAt = now;
    post({ type: 'audio-rebase', frame: audioClockFrame });
  }
  const elapsed = Math.max(0, now - audioClockAt) * (audioOutRate / 1000);
  const frame = Math.max(0, Math.floor(audioClockFrame + elapsed));
  audioLastCallAt = now;
  audioLastFrame = frame;
  return frame;
}

/**
 * Implements Module.jkaAudio for the wasm module.  AudioContext does not exist
 * in a dedicated worker, so PCM is forwarded to the page, which schedules it.
 * Keep this object plain: the worker is served as a classic script.
 */
const audioBridge: Record<string, unknown> = {
  open(requestedRate: number, frames: number, channels: number): number {
    if (!audioOutRate) return 0;
    if (requestedRate > 0 && requestedRate !== audioOutRate) {
      sendLog(`JKA_PROFILE audio rate requested=${requestedRate} using=${audioOutRate}`);
    }
    audioChannels = channels;
    // The page anchors frame 0 when it receives audio-open; start the local
    // extrapolation from the same moment instead of from worker boot.
    audioClockFrame = 0;
    audioClockAt = Date.now();
    audioLastCallAt = 0;
    audioLastFrame = 0;
    audioHasPcm = false;
    audioClockStarted = false;
    post({ type: 'audio-open', rate: audioOutRate, frames, channels });
    return audioOutRate;
  },
  submit(startFrame: number, pcm: ArrayBuffer, count: number): void {
    if (!audioOutRate || count <= 0) return;
    if (pcm.byteLength < count * audioChannels * 2) return;
    audioHasPcm = true;
    post({ type: 'audio-data', start: startFrame, pcm }, [pcm]);
  },
  playFrame(): number {
    return audioPlayFrame();
  },
  clear(): void {
    post({ type: 'audio-clear' });
  },
  close(): void {
    post({ type: 'audio-close' });
  },
  activate(): void {
    // The page owns the context lifecycle.
  }
};

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

function sendLog(line: string): void {
  logBuffer.push(line);
  if (logBuffer.length > LOG_LIMIT) logBuffer.splice(0, logBuffer.length - LOG_LIMIT);
  if (logTimer === null) {
    logTimer = setTimeout(flushLogs, 50);
  }
}

function flushLogs(): void {
  logTimer = null;
  if (!logBuffer.length) return;
  const lines = logBuffer;
  logBuffer = [];
  post({ type: 'log', lines });
}

function fatal(message: string): void {
  flushLogs();
  post({ type: 'fatal', message });
}

function runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
  const result = queue.then(async () => {
    asyncInFlight = true;
    try {
      return await task();
    } finally {
      asyncInFlight = false;
    }
  });
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function ccallValue(returnType: string, name: string, argTypes: string[], args: unknown[]): unknown {
  const ccall = engineModule?.ccall;
  if (!ccall) throw new Error('Engine is not ready.');
  return ccall(name, returnType, argTypes, args);
}

function ccallString(name: string, argTypes: string[], args: unknown[]): string {
  return String(ccallValue('string', name, argTypes, args) ?? '');
}

function ccallNumber(name: string, argTypes: string[], args: unknown[]): number {
  return Number(ccallValue('number', name, argTypes, args) ?? 0);
}

function ccallAsync(name: string, argTypes: string[], args: unknown[]): Promise<unknown> {
  const ccall = engineModule?.ccall;
  if (!ccall) return Promise.reject(new Error('Engine is not ready.'));
  return Promise.resolve(ccall(name, null, argTypes, args, { async: true }));
}

function ccallAsyncString(name: string, argTypes: string[], args: unknown[]): Promise<string> {
  const ccall = engineModule?.ccall;
  if (!ccall) return Promise.reject(new Error('Engine is not ready.'));
  return Promise.resolve(ccall(name, 'string', argTypes, args, { async: true }) as Promise<string> | string).then(
    value => String(value ?? '')
  );
}

function ensureWorkerMode(): void {
  if (workerModeSet || !engineModule?.ccall) return;
  try {
    engineModule.ccall('JKA_SetWorkerMode', null, ['number'], [1]);
    workerModeSet = true;
  } catch {
    // ccall is not available yet; the next poll retries.
  }
}

function readStatus(): DemoStatus | null {
  if (!runtimeReady || asyncInFlight || !engineModule?.ccall) return lastStatus;
  ensureWorkerMode();
  try {
    const raw = engineModule.ccall('JKA_StatusJson', 'string', [], []) as string;
    if (!raw) return lastStatus;
    lastStatus = JSON.parse(raw) as DemoStatus;
    return lastStatus;
  } catch {
    return lastStatus;
  }
}

function pollStatus(): void {
  if (asyncInFlight) return;
  const status = readStatus();
  if (!status) return;
  post({ type: 'status', status });
  if (!readySent && status.ready === 1) {
    readySent = true;
    sendLog(`JKA_PROFILE worker engine-ready ms=${(performance.now() - workerBootStart).toFixed(0)}`);
    flushLogs();
    post({ type: 'ready' });
  }
}

function pollScoreboard(): void {
  if (asyncInFlight || !engineModule?.ccall) return;
  const status = lastStatus;
  if (!status || status.demo !== 1 || status.state !== CA_ACTIVE) return;
  try {
    const raw = engineModule.ccall('JKA_ScoreboardJson', 'string', [], []) as string;
    if (!raw) return;
    const scoreboard = JSON.parse(raw) as ScoreboardData;
    if (scoreboard && Array.isArray(scoreboard.players)) {
      post({ type: 'scoreboard', scoreboard });
    }
  } catch {
    // The cgame may not be active on this frame; the next tick retries.
  }
}

function startPolling(): void {
  if (statusTimer === null) {
    statusTimer = setInterval(pollStatus, 250);
    // Do not call into wasm synchronously from onRuntimeInitialized: main()
    // has not started yet.  The first poll runs after main() has begun.
    setTimeout(pollStatus, 250);
  }
  if (scoreboardTimer === null) {
    scoreboardTimer = setInterval(pollScoreboard, 500);
  }
}

function getFs(): EmscriptenFS | undefined {
  // Module.FS is exported by the build; the classic non-modularized glue also
  // publishes FS on the worker global, which is a useful fallback.
  return engineModule?.FS ?? (scope as unknown as { FS?: EmscriptenFS }).FS;
}

function fsBytes(path: string): number {
  const FS = getFs();
  if (!FS?.lookupPath) return 0;
  let root: FsNode | undefined;
  try {
    root = FS.lookupPath(path).node;
  } catch {
    return 0;
  }
  if (!root) return 0;

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

function memorySample(): WorkerMemory {
  let heap = 0;
  let heapMax = 0;
  let hunkFree = 0;
  if (!asyncInFlight && engineModule?.ccall) {
    try {
      const raw = engineModule.ccall('JKA_MemoryJson', 'string', [], []) as string;
      const parsed = JSON.parse(raw) as { heap?: number; heapMax?: number; hunkFree?: number };
      heap = parsed.heap ?? 0;
      heapMax = parsed.heapMax ?? 0;
      hunkFree = parsed.hunkFree ?? 0;
    } catch {
      // Keep the zeroes; the line still reports MEMFS/mounted bytes.
    }
  }
  return {
    heap,
    heapMax,
    hunkFree,
    memfs: fsBytes('/userdata'),
    mounted: mountedBytes,
    mountedFiles
  };
}

function sendMemory(stage: string): void {
  // Do not log a fake heap=0 sample while Asyncify is suspended.
  if (asyncInFlight) return;
  post({ type: 'memory', stage, memory: memorySample() });
}

function requireFs(): EmscriptenFS {
  const FS = getFs();
  if (!FS) throw new Error('Emscripten filesystem unavailable.');
  return FS;
}

function baseName(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] || name;
}

/**
 * WORKERFS serves every read with FileReaderSync.  minizip walks each PK3's
 * central directory one entry at a time (twice), which is tens of thousands of
 * small synchronous reads and made the first FS_Startup take ~85 s.  Cache
 * each PK3's central directory on its WORKERFS node: the tail/EOCD and the
 * central-directory range are read once, and subsequent reads inside that
 * range are served from a Uint8Array.  File data (BSP, textures, models)
 * still goes through the normal lazy WORKERFS read path.
 */
function installPakCentralDirectoryCache(FS: EmscriptenFS): void {
  const filesystem = FS.filesystems?.WORKERFS as WorkerFsFilesystem | undefined;
  const operations = filesystem?.stream_ops;
  if (!filesystem || !operations?.read) return;

  const originalRead = operations.read;
  const caches = new WeakMap<object, CentralDirectoryCache | null>();

  const readRaw = (
    stream: WorkerFsStream,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): number => originalRead.call(operations, stream, buffer, offset, length, position);

  const buildCache = (stream: WorkerFsStream): CentralDirectoryCache | null => {
    const node = stream.node;
    if (!node?.name || !/\.pk3$/i.test(node.name)) return null;
    const size = node.size ?? 0;
    if (size < 22) return null;

    // The EOCD is in the last 22 bytes plus an optional 64 KiB comment.
    const tailLength = Math.min(size, 22 + 65535);
    const tail = new Uint8Array(tailLength);
    if (readRaw(stream, tail, 0, tailLength, size - tailLength) !== tailLength) return null;

    let eocd = -1;
    let view: DataView | null = null;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
        const candidate = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
        // A comment can contain the signature; the real EOCD ends exactly at
        // the end of the tail (22 bytes + comment length).
        if (i + 22 + candidate.getUint16(i + 20, true) === tailLength) {
          eocd = i;
          view = candidate;
          break;
        }
      }
    }
    if (eocd < 0 || !view) return null;

    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    if (!directorySize || directoryOffset + directorySize > size) return null;

    const bytes = new Uint8Array(directorySize);
    if (readRaw(stream, bytes, 0, directorySize, directoryOffset) !== directorySize) return null;
    return { start: directoryOffset, end: directoryOffset + directorySize, bytes };
  };

  operations.read = (stream, buffer, offset, length, position) => {
    const node = stream.node;
    if (!node) return readRaw(stream, buffer, offset, length, position);

    let cache = caches.get(node);
    if (cache === undefined) {
      cache = buildCache(stream);
      caches.set(node, cache);
    }
    if (cache && position >= cache.start && position + length <= cache.end) {
      buffer.set(cache.bytes.subarray(position - cache.start, position - cache.start + length), offset);
      return length;
    }
    return readRaw(stream, buffer, offset, length, position);
  };
}

function boot(request: Extract<WorkerRequest, { type: 'boot' }>): void {
  workerBootStart = performance.now();
  audioOutRate = request.audioRate > 0 ? request.audioRate : 0;
  audioClockFrame = 0;
  audioClockAt = Date.now();
  const files = request.files;
  sendLog(`JKA_PROFILE worker boot-message at=${workerBootStart.toFixed(0)} files=${files.length}`);
  const pk3s = files.filter(file => /\.pk3$/i.test(file.name));
  mountedBytes = pk3s.reduce((sum, file) => sum + file.file.size, 0);
  mountedFiles = pk3s.length;

  const total = mountedBytes;
  post({ type: 'progress', progress: { loaded: 0, total, current: 'Mounting game data…' } });

  const module: EngineModule = {
    arguments: request.args,
    canvas: request.canvas,
    locateFile: path => request.base + path,
    // SNDDMA_Init runs during engine boot in this worker; AudioContext is not
    // available here, so the bridge forwards to the page.
    jkaAudio: audioBridge,
    print: line => sendLog(String(line)),
    printErr: line => sendLog(`ERR ${line}`),
    onAbort: what => fatal(`Engine aborted: ${String(what)}`),
    onRuntimeInitialized: () => {
      runtimeReady = true;
      sendLog(`JKA_PROFILE worker runtime-init ms=${(performance.now() - workerBootStart).toFixed(0)}`);
      startPolling();
    },
    preRun: [
      () => {
        const FS = requireFs();
        const mountStart = performance.now();
        try {
          FS.mkdirTree('/jka/base');
          FS.mkdirTree('/userdata');
          FS.mkdirTree('/userdata/base');
          FS.mkdirTree('/userdata/base/demos');
        } catch (error) {
          fatal(`Could not create the engine directories: ${String(error)}`);
          throw error;
        }

        if (pk3s.length) {
          const filesystem = FS.filesystems?.WORKERFS;
          if (!filesystem) {
            fatal('WORKERFS is not linked into this engine build.');
            throw new Error('WORKERFS unavailable');
          }
          // WORKERFS `files` expects actual File/Blob objects (it reads .size
          // and .slice directly).  `blobs` is the shape that takes
          // { name, data } wrappers.
          FS.mount(filesystem, { files: pk3s.map(file => file.file) }, '/jka/base');
          installPakCentralDirectoryCache(FS);
        }

        // Do not create mpdefault.cfg in /userdata/base: that directory is a
        // search path before the PK3s, so a zero-length file would shadow the
        // real mpdefault.cfg inside assets2.pk3 and FS_InitFilesystem would
        // fail with "Couldn't load mpdefault.cfg".

        sendLog(`JKA_PROFILE worker mount files=${pk3s.length} bytes=${mountedBytes} ms=${(performance.now() - mountStart).toFixed(0)}`);
        post({
          type: 'progress',
          progress: { loaded: total, total, current: 'Game data mounted read-only' }
        });
      }
    ]
  };

  engineModule = module;
  (scope as unknown as { Module: EngineModule }).Module = module;

  try {
    const importStart = performance.now();
    importScripts(`${request.base}openjk.x86.js`);
    sendLog(`JKA_PROFILE worker import-returned ms=${(performance.now() - importStart).toFixed(0)} total=${(performance.now() - workerBootStart).toFixed(0)}`);
    post({ id: request.id, ok: true });
  } catch (error) {
    fatal(`Could not load the engine script: ${String(error)}`);
    post({ id: request.id, ok: false, error: String(error) });
  }
}

async function handle(request: WorkerRequest): Promise<unknown> {
  ensureWorkerMode();
  switch (request.type) {
    case 'play': {
      await ccallAsync('JKA_SetPaused', ['number'], [0]);
      await ccallAsync('JKA_Resume', [], []);
      await ccallAsync('JKA_PlayDemo', ['string'], [request.name]);
      return undefined;
    }
    case 'prepare': {
      await ccallAsync('JKA_PrepareDemo', ['string'], [request.name]);
      return undefined;
    }
    case 'resume': {
      await ccallAsync('JKA_ResumeDemo', [], []);
      return undefined;
    }
    case 'suspend': {
      await ccallAsync('JKA_Suspend', [], []);
      return undefined;
    }
    case 'release': {
      await ccallAsync('JKA_Release', [], []);
      return undefined;
    }
    case 'pause': {
      await ccallAsync('JKA_SetPaused', ['number'], [request.paused ? 1 : 0]);
      if (!request.paused) {
        await ccallAsync('JKA_Resume', [], []);
      }
      return undefined;
    }
    case 'stop': {
      await ccallAsync('JKA_StopDemo', [], []);
      await ccallAsync('JKA_SetPaused', ['number'], [0]);
      await ccallAsync('JKA_Resume', [], []);
      return undefined;
    }
    case 'parse-map': {
      const map = ccallString('JKA_ParseDemoMap', ['string'], [request.name]);
      return map.length ? map : null;
    }
    case 'has-map':
      return ccallNumber('JKA_HasMap', ['string'], [request.map]) !== 0;
    case 'add-demo': {
      const FS = requireFs();
      const name = baseName(request.name);
      // Read the File in the worker so a large demo never stalls the UI.
      const buffer = await request.file.arrayBuffer();
      FS.writeFile(`/userdata/base/demos/${name}`, new Uint8Array(buffer));
      return undefined;
    }
    case 'add-map': {
      const FS = requireFs();
      const name = baseName(request.name);
      const buffer = await request.file.arrayBuffer();
      FS.writeFile(`/userdata/base/${name}`, new Uint8Array(buffer));
      await ccallAsync('JKA_RestartFS', [], []);
      return undefined;
    }
    case 'demo-info': {
      // JKA_DemoInfo pauses the loop, disconnects and scans; it Asyncify-sleeps
      // inside map loads, so this must be an async ccall like the main host's.
      const raw = await ccallAsyncString('JKA_DemoInfo', ['string'], [request.name]);
      if (!raw) return null;
      return JSON.parse(raw) as unknown;
    }
    case 'summary': {
      const raw = ccallString('JKA_DemoSummaryJson', [], []);
      if (!raw) return null;
      return JSON.parse(raw) as unknown;
    }
    case 'seek': {
      await ccallAsync('JKA_SeekDemo', ['string', 'number'], [request.name, Math.max(0, Math.round(request.target))]);
      return undefined;
    }
    case 'freecam-on': {
      const raw = ccallString('JKA_EnableFreeCam', [], []);
      if (!raw || raw === 'null') return null;
      const pose = JSON.parse(raw) as FreeCamPose;
      if (![pose.x, pose.y, pose.z, pose.pitch, pose.yaw].every(Number.isFinite)) return null;
      return pose;
    }
    default:
      return undefined;
  }
}

scope.onmessage = event => {
  const request = event.data;
  if (!request || typeof request.type !== 'string') return;

  switch (request.type) {
    case 'ping': {
      // Prove WebGL2 is usable from this worker before the main thread hands
      // over the canvas (a transfer is irreversible).
      let webgl2 = false;
      try {
        const probe = new OffscreenCanvas(1, 1);
        const gl = probe.getContext('webgl2');
        webgl2 = !!gl;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        webgl2 = false;
      }
      post({ type: 'pong', webgl2 });
      return;
    }
    case 'boot':
      boot(request);
      return;
    case 'cvar':
      if (!asyncInFlight && runtimeReady) {
        try {
          engineModule?.ccall?.('JKA_SetCvar', null, ['string', 'string'], [request.name, request.value]);
        } catch {
          // Dropped while the engine is unavailable.
        }
      }
      return;
    case 'follow':
      if (!asyncInFlight && runtimeReady) {
        try {
          engineModule?.ccall?.('JKA_FollowClient', null, ['number'], [request.client]);
        } catch {
          // Dropped while the engine is unavailable.
        }
      }
      return;
    case 'freecam-pose':
      if (!asyncInFlight && runtimeReady) {
        try {
          engineModule?.ccall?.(
            'JKA_SetFreeCamPose',
            null,
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [request.pose.x, request.pose.y, request.pose.z, request.pose.pitch, request.pose.yaw, request.pose.roll]
          );
        } catch {
          // Dropped while the engine is unavailable.
        }
      }
      return;
    case 'freecam-off':
      if (!asyncInFlight && runtimeReady) {
        try {
          engineModule?.ccall?.('JKA_DisableFreeCam', null, [], []);
        } catch {
          // Dropped while the engine is unavailable.
        }
      }
      return;
    case 'stage':
      sendMemory(request.stage);
      return;
    case 'audio-clock':
      audioClockFrame = request.frame;
      audioClockStarted = request.started;
      audioClockAt = Date.now();
      if (!audioClockLogged) {
        audioClockLogged = true;
        sendLog(`JKA_PROFILE audio clock frame=${audioClockFrame}`);
      }
      return;
    default:
      break;
  }

  const id = (request as { id?: number }).id;
  if (typeof id !== 'number') return;
  runExclusive(() => handle(request))
    .then(value => post({ id, ok: true, value }))
    .catch(error => post({ id, ok: false, error: error instanceof Error ? error.message : String(error) }));
};
