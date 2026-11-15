# engine/ — OpenJK MP Emscripten port

**Status:** M1 in progress — the engine boots in Chrome/Node with a static renderer stub.
No WebGL renderer, cgame, UI, assets, audio, input or demo playback yet.

This directory is the project-owned port layer around upstream OpenJK. Upstream
source is not vendored here yet: `references/OpenJK` is the pinned, read-only
checkout and the build script creates a throwaway worktree under `/tmp` from it.

## Pin

| Item | Value |
|---|---|
| Upstream | `JACoders/OpenJK` |
| Commit | `260c59c2907187af555a676fe0cc798893bf7757` |
| Tree | `codemp/` (multiplayer), `shared/` |
| License | GPLv2 |

## Layout

```text
engine/
├── patches/
│   └── 0001-emscripten-m1-boot.patch   # edits to upstream files
├── platform/
│   ├── ref_stub.cpp                    # M1-only static renderer stub
│   ├── fixtures/base/mpdefault.cfg     # boot fixture, no game data
│   └── web/index.html                  # boot harness (not a product UI)
└── scripts/
    ├── build-mp-wasm.sh                # worktree + patch + emcmake build
    └── verify-boot-node.sh             # headless boot smoke test
```

## Patch scope (M1)

`0001-emscripten-m1-boot.patch` changes five upstream files:

| File | Change |
|---|---|
| `shared/qcommon/q_platform.h` | add `__EMSCRIPTEN__` OS/arch/endianness/path/`DLL_EXT` branch |
| `shared/sys/sys_main.cpp` | default install path `/jka` |
| `shared/sys/sys_unix.cpp` | default home path `/userdata` |
| `codemp/CMakeLists.txt` | add `ref_stub.cpp` to the engine target under `EMSCRIPTEN` |
| `codemp/client/cl_main.cpp` | use the static stub instead of `Sys_LoadDll`; skip UI VM init |
| `codemp/qcommon/net_ip.cpp` | disable socket setup (demo playback is local) |
| `shared/sys/con_tty.cpp` | disable stdin console input (it would call `window.prompt`) |

New code lives in `engine/platform/` and is copied into the worktree by the build
script. No edit touches `references/OpenJK`.

## Build

```bash
# Emscripten 6.0.1, e.g. /tmp/opencode/emsdk
engine/scripts/build-mp-wasm.sh

# then
engine/scripts/verify-boot-node.sh
```

Defaults: worktree `/tmp/opencode/m1/OpenJK-work`, build
`/tmp/opencode/m1/build-wasm`, output `/tmp/opencode/m1/web`.

`EMSDK`, `WORK`, `BUILD` and `OUT` can be overridden. The script verifies that
`references/OpenJK` is at the pinned commit before doing anything.

## What works

- Engine-only wasm build (no renderer/cgame/UI modules).
- `Com_Init`, `FS_Startup`, `NET_Init` stub, `CL_InitRef` stub,
  `--- Common Initialization Complete ---`.
- `/jka` and `/userdata` are the compiled defaults; `/jka/base` and `/userdata/base` are visible in the VFS.
- The browser harness mounts IDBFS at `/userdata` and waits for the initial sync.
- Boots in Chrome headless and under Node without a wasm trap.

## Known limitations

- `CMAKE` 4.2.3 warns that Emscripten shared-library support is unavailable.
  That does not affect this engine-only build, but side modules (`cgame.wasm`,
  `ui.wasm`, `rd-vanilla.wasm`) will need a CMake upgrade (> 4.3.3) or a
  source-list/side-module build path.
- The renderer is a no-op stub: the canvas stays blank by design.
- UI is not loaded; `uiStarted` stays false.
- No cgame, no map, no demo, no assets, no audio, no input.
- Emscripten's POSIX layer compiles `sys_unix.cpp` today. A dedicated
  `sys_emscripten.cpp` is deferred until browser-specific behaviour (paths,
  dialogs, timers, module loading) requires it.
- The boot fixture (`mpdefault.cfg`) is a preload; real user assets are staged
  by the M3/M4 filesystem layer.
