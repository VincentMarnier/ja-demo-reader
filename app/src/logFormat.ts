// The log panel is a reading surface, not the diagnostic export.  The engine
// tags every timing line with "JKA_PROFILE" and the hosts tag wasm stderr with
// "ERR".  Neither is a severity: the build's non-Windows console backend
// (`shared/sys/con_tty.cpp`, CON_Print) writes ordinary Com_Printf output with
// fputs to stderr, so "ERR" only says "not stdout".  Only the engine's own
// "WARNING:"/"ERROR:" text, or a real JS/wasm failure, counts here.
// The raw text stays on EngineHostApi.logText and in the download.

export type LogKind = 'normal' | 'profile' | 'warning' | 'error';

export interface LogEntry {
  kind: LogKind;
  text: string;
}

const PROFILE_PREFIX = 'JKA_PROFILE ';
const STDERR_PREFIX = 'ERR ';
// Quake colour code ("^3"); names in log lines carry them too, so drop them
// all rather than just the leading run.
const COLOR_CODE = /\^[0-9]/g;
// stderr content that is not the engine console: an actual runtime failure.
const JS_FAILURE =
  /^(?:exception thrown|Assertion failed|abort\(|RuntimeError|Uncaught |Cannot enlarge memory|out of memory|memory access out of bounds|table index is out of bounds)/i;

function clean(text: string): string {
  return text.replace(COLOR_CODE, '');
}

export function formatLogLine(raw: string): LogEntry {
  if (raw.startsWith(PROFILE_PREFIX)) {
    return { kind: 'profile', text: clean(raw.slice(PROFILE_PREFIX.length)) };
  }
  const stderr = raw.startsWith(STDERR_PREFIX);
  const text = clean(stderr ? raw.slice(STDERR_PREFIX.length) : raw);
  if (text.startsWith('WARNING:')) return { kind: 'warning', text };
  if (text.startsWith('ERROR:')) return { kind: 'error', text };
  if (stderr && JS_FAILURE.test(text)) return { kind: 'error', text };
  return { kind: 'normal', text };
}
