#!/usr/bin/env bash
#
# Build the OpenJK MP client for Emscripten (M1 boot target).
#
# The upstream checkout in references/OpenJK is read-only. This script creates a
# detached git worktree at the pinned commit under /tmp, applies the M1 port
# patch, adds the platform files, and builds the engine-only target.
#
# Requirements:
#   - Emscripten 6.0.1 (EMSDK, default /tmp/opencode/emsdk)
#   - CMake 4.2.x
#   - The pinned OpenJK submodule checkout
#
# Usage:
#   engine/scripts/build-mp-wasm.sh
#   EMSDK=/path/to/emsdk WORK=/tmp/... BUILD=/tmp/... OUT=/tmp/... engine/scripts/build-mp-wasm.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIN="260c59c2907187af555a676fe0cc798893bf7757"

EMSDK="${EMSDK:-/tmp/opencode/emsdk}"
WORK="${WORK:-/tmp/opencode/m1/OpenJK-work}"
BUILD="${BUILD:-/tmp/opencode/m1/build-wasm}"
OUT="${OUT:-/tmp/opencode/m1/web}"

PATCH="$ROOT/engine/patches/0001-emscripten-m1-boot.patch"
REF="$ROOT/references/OpenJK"

if [ ! -d "$REF/.git" ] && [ ! -f "$REF/.git" ]; then
  echo "error: references/OpenJK is not a git checkout" >&2
  exit 1
fi

HEAD="$(git -C "$REF" rev-parse HEAD)"
if [ "$HEAD" != "$PIN" ]; then
  echo "error: references/OpenJK is at $HEAD, expected $PIN" >&2
  exit 1
fi

if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
  echo "error: Emscripten SDK not found at $EMSDK (set EMSDK)" >&2
  exit 1
fi

echo "==> staged worktree: $WORK"
if git -C "$REF" worktree list --porcelain | grep -qx "worktree $WORK"; then
  git -C "$REF" worktree remove --force "$WORK"
fi
rm -rf "$WORK"
mkdir -p "$(dirname "$WORK")"
git -C "$REF" worktree add --detach "$WORK" "$PIN"

echo "==> applying M1 platform patch"
git -C "$WORK" apply "$PATCH"

echo "==> adding platform sources"
cp "$ROOT/engine/platform/ref_stub.cpp" "$WORK/codemp/client/ref_stub.cpp"

# shellcheck disable=SC1090
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

echo "==> configuring (engine only, boot stub)"
emcmake cmake -S "$WORK" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_EXE_LINKER_FLAGS="--preload-file=$ROOT/engine/platform/fixtures/base/mpdefault.cfg@/jka/base/mpdefault.cfg -lidbfs.js" \
  -DBuildMPEngine=ON -DBuildMPRdVanilla=OFF -DBuildMPCGame=OFF -DBuildMPUI=OFF \
  -DBuildMPGame=OFF -DBuildMPDed=OFF -DBuildMPRend2=OFF \
  -DBuildSPEngine=OFF -DBuildSPGame=OFF -DBuildSPRdVanilla=OFF \
  -DBuildJK2SPEngine=OFF -DBuildJK2SPGame=OFF -DBuildJK2SPRdVanilla=OFF

echo "==> building"
emmake cmake --build "$BUILD" -j"$(nproc)"

echo "==> assembling browser output: $OUT"
mkdir -p "$OUT"
cp "$BUILD"/openjk.x86.js "$BUILD"/openjk.x86.wasm "$BUILD"/openjk.x86.data "$OUT"/
cp "$ROOT/engine/platform/web/index.html" "$OUT"/

printf '\nBuilt:\n'
ls -l "$OUT/openjk.x86.js" "$OUT/openjk.x86.wasm" "$OUT/openjk.x86.data"
printf '\nServe it, e.g.:\n  (cd %q && python3 -m http.server 8123)\n' "$OUT"
printf 'The M1 page logs engine boot to the DOM and the browser console.\n'
