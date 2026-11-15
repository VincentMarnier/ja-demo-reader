#!/usr/bin/env bash
#
# Headless M1 smoke test: boot the built engine under Node and assert that the
# MP banner, FS startup and the end of Com_Init are reached without a trap.
#
# The engine's main loop never returns, so the process is killed by `timeout`
# after the assertions have had time to run.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${OUT:-/tmp/opencode/m1/web}"
WAIT="${WAIT:-12}"

if [ ! -f "$OUT/openjk.x86.js" ]; then
  echo "error: $OUT/openjk.x86.js not found; run engine/scripts/build-mp-wasm.sh" >&2
  exit 1
fi

LOG="$(mktemp -t m1-node-boot.XXXXXX.log)"
trap 'rm -f "$LOG"' EXIT

echo "==> booting $OUT/openjk.x86.js for ${WAIT}s"
set +e
(
  cd "$OUT"
  timeout -s KILL "$WAIT" node openjk.x86.js \
    +set cl_allowDownload 0 \
    +set logfile 2 \
    +set r_fullscreen 0 \
    +set s_initsound 0 \
    +set com_bootlogo 0
) >"$LOG" 2>&1
set -e

fail=0
check() {
  if grep -qF -- "$1" "$LOG"; then
    echo "  ok: $1"
  else
    echo "  MISSING: $1" >&2
    fail=1
  fi
}

check "OpenJK-MP:"
check "----- FS_Startup -----"
check "/jka/base"
check "/userdata/base"
check "NET_Init: networking disabled in Emscripten build"
check "Using static boot renderer stub"
check "--- Common Initialization Complete ---"

if grep -qE "ABORT|wasm trap|RuntimeError|Unhandled" "$LOG"; then
  echo "  FAIL: abort/trap detected" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "--- boot log ---" >&2
  cat "$LOG" >&2
  exit 1
fi

echo "M1 boot smoke test: PASS"
