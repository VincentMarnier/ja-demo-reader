# engine/ — OpenJK MP Emscripten port

**Status:** M1 boot and M2 renderer/cgame bring-up are verified. `rd-vanilla` and
cgame are statically linked; a retail base demo on `mp/duel1` renders with
textures, geometry and HUD in Chrome. No UI, input or audio yet.

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
│   ├── 0001-emscripten-m1-boot.patch   # boot platform layer
│   └── 0002-emscripten-m2-renderer.patch # static rd-vanilla + WebGL fixes
├── platform/
│   ├── ref_stub.cpp                    # M1 boot renderer stub
│   ├── gl_stubs.cpp                    # display-list/array-element shims
│   ├── fixtures/base/mpdefault.cfg     # boot fixture, no game data
│   └── web/index.html                  # boot harness (not a product UI)
└── scripts/
    ├── build-mp-wasm.sh                # worktree + patch + emcmake build
    └── verify-boot-node.sh             # headless boot smoke test
```

## Patch scope

`0001-emscripten-m1-boot.patch` changes the boot platform layer:

| File | Change |
|---|---|
| `shared/qcommon/q_platform.h` | add `__EMSCRIPTEN__` OS/arch/endianness/path/`DLL_EXT` branch |
| `shared/sys/sys_main.cpp` | default install path `/jka` |
| `shared/sys/sys_unix.cpp` | default home path `/userdata` |
| `codemp/CMakeLists.txt` | add `ref_stub.cpp` to the engine target under `EMSCRIPTEN` |
| `codemp/client/cl_main.cpp` | use the static stub instead of `Sys_LoadDll`; skip UI VM init |
| `codemp/qcommon/net_ip.cpp` | disable socket setup (demo playback is local) |
| `shared/sys/con_tty.cpp` | disable stdin console input (it would call `window.prompt`) |

`0002-emscripten-m2-renderer.patch` adds the static renderer link and WebGL fixes:

| File | Change |
|---|---|
| `codemp/rd-vanilla/CMakeLists.txt` | build STATIC under Emscripten; drop duplicated common sources |
| `codemp/CMakeLists.txt` | link `rd-vanilla` into the engine |
| `codemp/client/cl_main.cpp` | call static `GetRefAPI`; keep `cl_renderer=stub` fallback |
| `codemp/rd-vanilla/tr_local.h` | 16-bit `glIndex_t`; rename renderer `window` |
| `codemp/rd-vanilla/tr_image.cpp` | force RGBA internal format |
| `codemp/rd-vanilla/tr_init.cpp` | force `r_primitives=2`, disable S3TC |
| `codemp/rd-vanilla/tr_cmds.cpp` | test-only frame clear probe (`r_m2_clear`) |
| `codemp/rd-vanilla/qgl.h` | Emscripten GL include |
| `shared/sys/sys_main.cpp` | RAF main loop |
| `shared/sys/sys_unix.cpp` | non-blocking `Sys_Sleep` |
| `codemp/qcommon/common.cpp` | no blocking select/NET_Sleep in Com_Frame |
| `codemp/client/cl_scrn.cpp` | render cgame without UI; present frames |
| `codemp/rd-common/tr_font.cpp` | rename renderer-owned `se_language` |

New code lives in `engine/platform/` and is copied into the worktree by the build
script. No edit touches `references/OpenJK`.

## Build

```bash
# Emscripten 6.0.1, e.g. /tmp/opencode/emsdk
engine/scripts/build-mp-wasm.sh                 # M1 boot (no renderer)
engine/scripts/verify-boot-node.sh

# M2 renderer (static rd-vanilla + WebGL)
BUILD_RENDERER=1 engine/scripts/build-mp-wasm.sh

# M2 renderer + cgame (demo playback; assets served at runtime)
BUILD_RENDERER=1 BUILD_CGAME=1 engine/scripts/build-mp-wasm.sh

# M2 with a small asset fixture (extracted from user PK3s; not committed)
BUILD_RENDERER=1 PRELOAD_DIR=/tmp/opencode/m2/testassets/base \
  engine/scripts/build-mp-wasm.sh
```

For the full-asset run, serve `assets0..3.pk3` and `demos/m05_base.dm_26`
alongside the built page, then open:

```text
/?renderer=rd-vanilla&assets=full&pause=1
```

`pause=1` stops the RAF loop after the first active frame so the harness can
read the canvas; it is test-only.

Open the page normally for the M1 stub, or `?renderer=rd-vanilla` for the
statically linked renderer.

Defaults: worktree `/tmp/opencode/m1/OpenJK-work`, build
`/tmp/opencode/m1/build-wasm`, output `/tmp/opencode/m1/web`.

`EMSDK`, `WORK`, `BUILD` and `OUT` can be overridden. The script verifies that
`references/OpenJK` is at the pinned commit before doing anything.

## What works

- Engine-only wasm build and a renderer-enabled build.
- `Com_Init`, `FS_Startup`, `NET_Init` stub, `CL_InitRef`,
  `--- Common Initialization Complete ---`.
- `/jka` and `/userdata` are compiled defaults; IDBFS is mounted at `/userdata`.
- Stub renderer boots without assets; `rd-vanilla` + cgame render a retail
  `mp/duel1` demo with textures, characters and HUD.
- Full retail assets are staged into MEMFS at runtime; a 1.2 GB run boots and
  plays in Chrome under SwiftShader.
- Chrome and Node runs, no wasm trap.

## Known limitations

- `CMAKE` 4.2.3 warns that Emscripten shared-library support is unavailable.
  That does not affect this engine-only build, but side modules (`cgame.wasm`,
  `ui.wasm`, `rd-vanilla.wasm`) will need a CMake upgrade (> 4.3.3) or a
  source-list/side-module build path.
- The default `cl_renderer=stub` keeps the boot test asset-free; `rd-vanilla`
  needs at least a shader/font fixture to initialize.
- No UI, input, audio or product file picker. Assets are staged by the test HTML.
- SwiftShader only: no hardware-GPU performance baseline yet.
- The `r_m2_pause` capture hook is test-only.
- No cgame, no map, no demo, no assets, no audio, no input.
- Emscripten's POSIX layer compiles `sys_unix.cpp` today. A dedicated
  `sys_emscripten.cpp` is deferred until browser-specific behaviour (paths,
  dialogs, timers, module loading) requires it.
- The boot fixture (`mpdefault.cfg`) is a preload; real user assets are staged
  by the M3/M4 filesystem layer.
