import type { AssetSelection, LocalFile, ValidationResult } from '../types';

const ASSET_NAMES = ['assets0.pk3', 'assets1.pk3', 'assets2.pk3', 'assets3.pk3'];

function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return (slash >= 0 ? name.slice(slash + 1) : name).toLowerCase();
}

function findByName(files: LocalFile[], name: string): LocalFile | undefined {
  return files.find(f => baseName(f.name) === name);
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const pattern = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return true;
  }
  return false;
}

async function checkDemoFraming(file: File): Promise<string | null> {
  if (file.size < 8) return 'The demo file is empty or truncated.';
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const sequence = view.getInt32(0, true);
  const length = view.getInt32(4, true);
  if (length === -1) return 'The demo file contains no demo messages.';
  if (length <= 0 || length > 2 * 1024 * 1024) {
    return `The demo has an invalid first message length (${length}).`;
  }
  if (sequence < 0) {
    return 'The demo has an invalid message sequence.';
  }
  return null;
}

export async function validateSelection(selection: AssetSelection, requireDemo = true): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const assets: LocalFile[] = [];
  const demos: LocalFile[] = [];

  for (const name of ASSET_NAMES) {
    const file = findByName(selection.files, name);
    if (!file) {
      errors.push(`Missing ${name}. Select the complete base folder from a retail Jedi Academy install.`);
    } else {
      assets.push(file);
    }
  }

  if (assets.length === 4) {
    const assets2 = assets.find(f => baseName(f.name) === 'assets2.pk3');
    if (assets2) {
      try {
        const bytes = new Uint8Array(await assets2.file.arrayBuffer());
        if (!containsAscii(bytes, 'productid.txt')) {
          errors.push('assets2.pk3 does not contain productid.txt. The install looks incomplete or demo-restricted.');
        }
      } catch {
        warnings.push('Could not inspect assets2.pk3 for productid.txt.');
      }
    }
  }

  for (const file of selection.files) {
    const name = baseName(file.name);
    if (name.endsWith('.dm_26')) {
      demos.push(file);
    } else if (name.endsWith('.dm_25') || name.endsWith('.dm_27') || name.endsWith('.dm_68')) {
      warnings.push(`${file.name} is not a protocol-26 demo. Only .dm_26 is supported.`);
    }
  }

  if (requireDemo && demos.length === 0) {
    errors.push('No .dm_26 demo found. Select a Jedi Academy multiplayer demo.');
  }

  for (const demo of demos) {
    const problem = await checkDemoFraming(demo.file);
    if (problem) {
      warnings.push(`${demo.name}: ${problem}`);
    }
  }

  return { assets, demos, warnings, errors };
}

export async function validateDemoFile(file: File): Promise<string | null> {
  if (!file.name.toLowerCase().endsWith('.dm_26')) {
    return 'This is not a protocol-26 demo (.dm_26).';
  }
  return checkDemoFraming(file);
}

export { ASSET_NAMES, baseName };
