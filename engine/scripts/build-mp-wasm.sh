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
BUILD_REND2="${BUILD_REND2:-0}"
BUILD_CGAME="${BUILD_CGAME:-0}"
NODE_RAWF="${NODE_RAWF:-0}"
DEBUG_WASM="${DEBUG_WASM:-0}"

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
cp "$ROOT/engine/platform/jka_bridge.cpp" "$WORK/codemp/client/jka_bridge.cpp"

# shellcheck disable=SC1090
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

if [ "$NODE_RAWF" = "1" ] || [ "${NO_PRELOAD:-0}" = "1" ]; then
  PRELOAD_ARGS=""
elif [ -n "${PRELOAD_DIR:-}" ]; then
  PRELOAD_ARGS="--preload-file=$PRELOAD_DIR@/jka/base"
else
  PRELOAD_ARGS="--preload-file=$ROOT/engine/platform/fixtures/base/mpdefault.cfg@/jka/base/mpdefault.cfg"
fi

RENDERER=OFF
REND2=OFF
CGAME=OFF
GL_FLAGS="-sALLOW_MEMORY_GROWTH=1 -sASSERTIONS=1 -sSTACK_SIZE=8388608 -sSTACK_OVERFLOW_CHECK=1 -sDISABLE_EXCEPTION_CATCHING=0 -sEXPORTED_RUNTIME_METHODS=ccall,cwrap"
if [ "$BUILD_RENDERER" = "1" ]; then
  RENDERER=ON
  GL_FLAGS="$GL_FLAGS -sMIN_WEBGL_VERSION=1 -sMAX_WEBGL_VERSION=2 -sLEGACY_GL_EMULATION=1 -sGL_UNSAFE_OPTS=0"
fi
if [ "$BUILD_REND2" = "1" ]; then
  if [ "$RENDERER" = "ON" ]; then
    echo "error: BUILD_RENDERER and BUILD_REND2 are mutually exclusive (both export GetRefAPI)" >&2
    exit 1
  fi
  REND2=ON
  # rd-rend2 uses modern GL; WebGL2/GLES3 is required and the legacy GL
  # emulation must not be linked.
  GL_FLAGS="$GL_FLAGS -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sFULL_ES3=1 -sGL_UNSAFE_OPTS=0"
fi
if [ "$NODE_RAWF" = "1" ]; then
  GL_FLAGS="$GL_FLAGS -sNODERAWFS=1"
fi
if [ "$DEBUG_WASM" = "1" ]; then
  GL_FLAGS="$GL_FLAGS -g -sASSERTIONS=2"
fi
if [ "$BUILD_CGAME" = "1" ]; then
  CGAME=ON
  GL_FLAGS="$GL_FLAGS -sINITIAL_MEMORY=805306368 -sMAXIMUM_MEMORY=4294967296"
else
  GL_FLAGS="$GL_FLAGS -sINITIAL_MEMORY=268435456 -sMAXIMUM_MEMORY=2147483648"
fi

if [ "$REND2" = "ON" ]; then
  echo "==> generating rd-rend2 shader tables (host tool)"
  HOST_CXX="${HOST_CXX:-g++}"
  if ! command -v "$HOST_CXX" >/dev/null 2>&1; then
    echo "error: a host C++ compiler is required to build compact_glsl (set HOST_CXX)" >&2
    exit 1
  fi
  mkdir -p "$BUILD/codemp/rd-rend2"
  "$HOST_CXX" -std=c++17 -O2 -DGLSL_BUILDTOOL -DNOMINMAX \
    -DARCH_STRING="\"$(uname -m)\"" \
    -I"$WORK/codemp" -I"$WORK/shared" -I"$WORK/lib" \
    -I"$WORK/lib/gsl-lite/include" -I"$WORK/codemp/rd-rend2" \
    "$WORK/codemp/rd-rend2/glsl/compact.cpp" \
    "$WORK/codemp/rd-rend2/tr_allocator.cpp" \
    "$WORK/codemp/rd-rend2/tr_glsl_parse.cpp" \
    -o "$BUILD/compact_glsl_host"
  "$BUILD/compact_glsl_host" \
    "$BUILD/codemp/rd-rend2/glsl_shaders.cpp" \
    "$BUILD/codemp/rd-rend2/glsl_shaders.h" \
    "$WORK"/codemp/rd-rend2/glsl/*.glsl
fi

echo "==> configuring (renderer=$RENDERER, rend2=$REND2, cgame=$CGAME)"
emcmake cmake -S "$WORK" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=${BUILD_TYPE:-Release} \
  -DCMAKE_C_FLAGS="-fno-strict-aliasing" \
  -DCMAKE_CXX_FLAGS="-fexceptions -fno-strict-aliasing" \
  -DCMAKE_EXE_LINKER_FLAGS="$PRELOAD_ARGS -lidbfs.js $GL_FLAGS" \
  -DBuildMPEngine=ON -DBuildMPRdVanilla=$RENDERER -DBuildMPCGame=$CGAME -DBuildMPUI=OFF \
  -DBuildMPGame=OFF -DBuildMPDed=OFF -DBuildMPRend2=$REND2 \
  -DBuildSPEngine=OFF -DBuildSPGame=OFF -DBuildSPRdVanilla=OFF \
  -DBuildJK2SPEngine=OFF -DBuildJK2SPGame=OFF -DBuildJK2SPRdVanilla=OFF

echo "==> building"
emmake cmake --build "$BUILD" -j"$(nproc)"

echo "==> assembling browser output: $OUT"
mkdir -p "$OUT"
cp "$BUILD"/openjk.x86.js "$BUILD"/openjk.x86.wasm "$OUT"/
if [ -f "$BUILD/openjk.x86.data" ]; then
  cp "$BUILD"/openjk.x86.data "$OUT"/
fi
cp "$ROOT"/engine/platform/web/*.html "$OUT"/

printf '\nBuilt:\n'
ls -l "$OUT/openjk.x86.js" "$OUT/openjk.x86.wasm"
[ -f "$OUT/openjk.x86.data" ] && ls -l "$OUT/openjk.x86.data" || true
printf '\nServe it, e.g.:\n  (cd %q && python3 -m http.server 8123)\n' "$OUT"
printf 'Open the page for M1 boot; use BUILD_REND2=1 for the rd-rend2 WebGL2 build.\n'
