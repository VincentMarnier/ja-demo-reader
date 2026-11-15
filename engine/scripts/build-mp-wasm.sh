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
BUILD_RENDERER="${BUILD_RENDERER:-0}"

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

echo "==> applying port patches"
for patch in "$ROOT"/engine/patches/*.patch; do
  echo "    $(basename "$patch")"
  git -C "$WORK" apply "$patch"
done

echo "==> adding platform sources"
cp "$ROOT/engine/platform/ref_stub.cpp" "$WORK/codemp/client/ref_stub.cpp"
cp "$ROOT/engine/platform/gl_stubs.cpp" "$WORK/codemp/client/gl_stubs.cpp"

# shellcheck disable=SC1090
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

if [ -n "${PRELOAD_DIR:-}" ]; then
  PRELOAD_ARGS="--preload-file=$PRELOAD_DIR@/jka/base"
else
  PRELOAD_ARGS="--preload-file=$ROOT/engine/platform/fixtures/base/mpdefault.cfg@/jka/base/mpdefault.cfg"
fi

RENDERER=OFF
GL_FLAGS=""
if [ "$BUILD_RENDERER" = "1" ]; then
  RENDERER=ON
  GL_FLAGS="-sMIN_WEBGL_VERSION=1 -sMAX_WEBGL_VERSION=2 -sLEGACY_GL_EMULATION=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sMAXIMUM_MEMORY=2147483648 -sASSERTIONS=1"
fi

echo "==> configuring (renderer=$RENDERER)"
emcmake cmake -S "$WORK" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_EXE_LINKER_FLAGS="$PRELOAD_ARGS -lidbfs.js $GL_FLAGS" \
  -DBuildMPEngine=ON -DBuildMPRdVanilla=$RENDERER -DBuildMPCGame=OFF -DBuildMPUI=OFF \
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
printf 'Open the page for M1 boot; append ?renderer=rd-vanilla for the M2 renderer test.\n'
