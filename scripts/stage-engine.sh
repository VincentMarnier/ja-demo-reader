#!/usr/bin/env bash
#
# Copy a built Emscripten engine into the React app's public directory.
#
# Usage:
#   scripts/stage-engine.sh [engine-build-dir]
#
# The app stages the user's PK3s itself, so this build must be produced with
# NO_PRELOAD=1 (no .data file). A .data file is intentionally not copied.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$#" -lt 1 ]; then
  echo "usage: scripts/stage-engine.sh <engine-build-dir>" >&2
  exit 2
fi
SRC="$1"
DEST="$ROOT/app/public/engine"

if [ ! -f "$SRC/openjk.x86.js" ] || [ ! -f "$SRC/openjk.x86.wasm" ]; then
  echo "error: engine build not found in $SRC (expected openjk.x86.js/.wasm)" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC/openjk.x86.js" "$SRC/openjk.x86.wasm" "$DEST/"
rm -f "$DEST/openjk.x86.data"
touch "$DEST/.gitkeep"

echo "staged engine:"
ls -lh "$DEST/openjk.x86.js" "$DEST/openjk.x86.wasm"
echo
echo "Vite build output will copy app/public/engine into app/dist/engine."
