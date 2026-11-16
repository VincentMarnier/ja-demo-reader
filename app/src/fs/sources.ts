import type { AssetSelection, LocalFile } from '../types';
import { baseName } from './validate';

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  }
  interface HTMLInputElement {
    webkitdirectory: boolean;
  }
}

export interface FolderSelection {
  directory: FileSystemDirectoryHandle;
  selection: AssetSelection;
}

async function hasFile(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function listDirectory(dir: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = [];
  const values = (dir as unknown as { values(): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle> }).values();
  for await (const handle of values) {
    if (handle.kind === 'file') {
      out.push(await (handle as FileSystemFileHandle).getFile());
    }
  }
  return out;
}

export async function selectionFromDirectory(picked: FileSystemDirectoryHandle): Promise<AssetSelection> {
  let base = picked;
  if (!(await hasFile(picked, 'assets0.pk3'))) {
    try {
      base = await picked.getDirectoryHandle('base');
    } catch {
      throw new Error('Select the GameData folder (it must contain base/assets0.pk3) or the base folder itself.');
    }
  }

  const baseFiles = await listDirectory(base);
  const demos: File[] = [];
  try {
    const demoDir = await base.getDirectoryHandle('demos');
    demos.push(...(await listDirectory(demoDir)));
  } catch {
    // no demos directory
  }
  for (const file of baseFiles) {
    if (baseName(file.name).endsWith('.dm_26')) demos.push(file);
  }

  const local: LocalFile[] = baseFiles
    .filter(f => baseName(f.name).endsWith('.pk3') || baseName(f.name).endsWith('.dm_26'))
    .map(f => ({ name: f.name, file: f, path: f.name }));
  const localDemos: LocalFile[] = demos.map(f => ({ name: f.name, file: f, path: `demos/${f.name}` }));

  return { files: [...local, ...localDemos], demos: localDemos, label: picked.name };
}

export async function pickGameData(): Promise<FolderSelection | null> {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser does not support directory selection. Use the file input fallback.');
  }
  const directory = await window.showDirectoryPicker({ mode: 'read' });
  const selection = await selectionFromDirectory(directory);
  return { directory, selection };
}

export async function requestHandlePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const current = await handle.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

function normalizePath(file: File): string {
  return (file.webkitRelativePath || file.name).replace(/\\/g, '/');
}

/** Strip everything up to and including the last "base/" segment. */
function pathInBase(file: File): string {
  const full = normalizePath(file);
  const marker = '/base/';
  const index = full.toLowerCase().lastIndexOf(marker);
  if (index >= 0) return full.slice(index + marker.length);
  if (full.toLowerCase().startsWith('base/')) return full.slice(5);
  return full;
}

export function selectionFromFileList(input: FileList | File[]): AssetSelection {
  const files = Array.from(input);
  const local: LocalFile[] = [];
  const demos: LocalFile[] = [];

  for (const file of files) {
    const path = pathInBase(file);
    const name = baseName(file.name);
    if (name.endsWith('.pk3')) {
      local.push({ name: file.name, file, path });
    } else if (name.endsWith('.dm_26')) {
      const demo = { name: file.name, file, path: path.startsWith('demos/') ? path : `demos/${file.name}` };
      local.push(demo);
      demos.push(demo);
    }
  }

  return { files: local, demos, label: files[0]?.webkitRelativePath?.split('/')[0] || 'Selected files' };
}
