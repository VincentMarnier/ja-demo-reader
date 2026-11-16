import type { LocalFile, StageProgress } from '../types';

interface EmscriptenFS {
  mkdir(path: string): void;
  mkdirTree?(path: string): void;
  createDataFile(parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean, canOwn: boolean): void;
  writeFile(path: string, data: Uint8Array): void;
  lookupPath?(path: string): unknown;
  mount?(filesystem: unknown, options: Record<string, never>, mountpoint: string): void;
  filesystems?: Record<string, unknown>;
  syncfs?(populate: boolean, callback: (error?: unknown) => void): void;
}

function mkdirp(FS: EmscriptenFS, path: string): void {
  if (FS.mkdirTree) {
    try {
      FS.mkdirTree(path);
      return;
    } catch (error) {
      console.error('mkdirTree failed', path, error);
    }
  }
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    try {
      FS.mkdir(current);
    } catch {
      // already exists
    }
  }
}

export interface StageOptions {
  files: LocalFile[];
  onProgress(progress: StageProgress): void;
  signal: AbortSignal;
  addDependency(name: string): void;
  removeDependency(name: string): void;
}

export async function prepareAndStage(FS: EmscriptenFS, options: StageOptions): Promise<void> {
  try {
  mkdirp(FS, '/jka/base');
  mkdirp(FS, '/jka/base/demos');
  mkdirp(FS, '/userdata');
  } catch (error) { console.error('stage: mkdir failed', error); throw error; }

  // The fixture build preloads mpdefault.cfg; tolerate a build without it.
  try {
    if (FS.lookupPath) FS.lookupPath('/jka/base/mpdefault.cfg');
  } catch {
    FS.writeFile('/jka/base/mpdefault.cfg', new Uint8Array(0));
  }

  // IDBFS is deferred; /userdata is a normal MEMFS directory for now.

  const total = options.files.reduce((sum, item) => sum + item.file.size, 0);
  let loaded = 0;

  for (const item of options.files) {
    if (options.signal.aborted) throw new Error('Staging cancelled.');
    options.onProgress({ loaded, total, current: item.name });

    const buffer = await item.file.arrayBuffer();
    if (options.signal.aborted) throw new Error('Staging cancelled.');

    const name = item.name.split('/').pop() || item.name;
    const parent = name.toLowerCase().endsWith('.dm_26') ? '/jka/base/demos' : '/jka/base';
    try {
      FS.createDataFile(parent, name, new Uint8Array(buffer), true, false, true);
    } catch (error) {
      console.error('stage write failed', parent, name, error);
      throw error;
    }

    loaded += item.file.size;
    options.onProgress({ loaded, total, current: item.name });
  }
}

export function stagingBytesLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
