# Emscripten boot (M1)

**Status:** Engine boot verified. Renderer, cgame, UI, assets and demo playback are not part of this result.
**Date:** 2026-11-16
**Scope:** OpenJK MP engine compiled to WebAssembly with Emscripten 6.0.1, booting in Chrome headless with a static renderer stub. No WebGL renderer, no product frontend.

---

## 1. Result

| Check | Result |
|---|---|
| Emscripten toolchain | **6.0.1** (25e4e8d6550d392ba9e0c2936bce7cf41ee47cc0) |
| CMake cross-compile | **Pass** — see the shared-library warning in §6 |
| Engine wasm links | **Pass** — 1.59 MB `openjk.x86.wasm` (engine only) |
| `Com_Init` / `FS_Startup` complete | **Pass** |
| MP version banner | **Pass** — `OpenJK-MP: latest emscripten-x86` |
| Default `/jka` and `/userdata` paths | **Pass** — compiled defaults, no CLI overrides |
| IDBFS mounted at `/userdata` | **Pass** — `IDBFS mounted at /userdata` in Chrome |
| `--- Common Initialization Complete ---` | **Pass** |
| No wasm trap during a 25 s run | **Pass** |
| No network initialisation | **Pass** — `NET_Init` returns before opening sockets |
| Boots in Chrome | **Pass** (headless shell 156.0.8078.4) |
| Boots under Node | **Pass** (smoke script) |
| Renderer / cgame / UI / map / demo | **Not in M1 scope** — stub only |

**M1 boot: PASS.** G1 remains open until the milestone's remaining deliverables (reproducible script, documented platform changes) are reviewed; both are in this change.

---

## 2. Toolchain

| Item | Value |
|---|---|
| OS | Ubuntu 26.04 LTS, kernel 7.0.0-43-generic |
| Emscripten | 6.0.1, installed with `emsdk` under `/tmp/jka-demo-player/emsdk` |
| CMake | 4.2.3 |
| Node (smoke test) | v24.20.0 |
| Chrome (boot test) | Chrome for Testing 156.0.8078.4, `chrome-headless-shell` |
| Emscripten ports | SDL2, libjpeg, libpng, zlib (built on demand) |
| Upstream | OpenJK `260c59c2907187af555a676fe0cc798893bf7757` |

---

## 3. Build

The build script creates a detached git worktree from the read-only reference
checkout, applies the port patch, copies the platform stub, configures with
`emcmake`, and assembles the browser output:

```bash
engine/scripts/build-mp-wasm.sh
```

Equivalent configure (engine only):

```bash
emcmake cmake -S /tmp/jka-demo-player/m1/OpenJK-work -B /tmp/jka-demo-player/m1/build-wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_EXE_LINKER_FLAGS="--preload-file=<repo>/engine/platform/fixtures/base/mpdefault.cfg@/jka/base/mpdefault.cfg -lidbfs.js" \
  -DBuildMPEngine=ON -DBuildMPRdVanilla=OFF -DBuildMPCGame=OFF -DBuildMPUI=OFF \
  -DBuildMPGame=OFF -DBuildMPDed=OFF -DBuildMPRend2=OFF \
  -DBuildSPEngine=OFF -DBuildSPGame=OFF -DBuildSPRdVanilla=OFF \
  -DBuildJK2SPEngine=OFF -DBuildJK2SPGame=OFF -DBuildJK2SPRdVanilla=OFF

emmake cmake --build /tmp/jka-demo-player/m1/build-wasm -j"$(nproc)"
```

The worktree keeps `.git`, so `git describe` produces the real tag (`latest`)
instead of `vUNKNOWN`. `references/OpenJK` is not modified; `git status` stays
clean.

### 3.1 Port patch

`engine/patches/0001-emscripten-m1-boot.patch` (65 insertions, 3 deletions):

| File | Purpose |
|---|---|
| `shared/qcommon/q_platform.h` | Emscripten OS string, `QINLINE`, `PATH_SEP`, little-endian, `DLL_EXT ".wasm"` |
| `shared/sys/sys_main.cpp` | default install path `/jka` |
| `shared/sys/sys_unix.cpp` | `Sys_DefaultHomePath` returns `/userdata` |
| `codemp/CMakeLists.txt` | include `ref_stub.cpp` in the engine target |
| `codemp/client/cl_main.cpp` | `CL_InitRef` uses the static stub; UI initialisation skipped |
| `codemp/qcommon/net_ip.cpp` | `NET_Init` disabled (no sockets) |
| `shared/sys/con_tty.cpp` | `CON_Input` returns NULL (no `window.prompt` blocking the loop) |

New code: `engine/platform/ref_stub.cpp`. It implements only the boot entry points
(begin registration, shader/font registration, frame begin/end, 2D no-ops) and
leaves scene/G2/cinematic pointers NULL so any premature call fails loudly.

---

## 4. Boot evidence (Chrome)

Harness: `engine/platform/web/index.html`, served over local HTTP; the engine
logs to the page and to the browser console. Command:

```bash
(cd /tmp/jka-demo-player/m1/web && python3 -m http.server 8124)
CHROME=~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
timeout -s KILL 25 "$CHROME" --headless --no-sandbox --disable-gpu \
  http://127.0.0.1:8124/ 2> /tmp/jka-demo-player/m1/logs/chrome-err-5.log
```

Captured console (order preserved):

```text
IDBFS mounted at /userdata
OpenJK-MP: latest emscripten-x86 Nov 16 2026
NET_Init: networking disabled in Emscripten build
----- FS_Startup -----
Current search path:
/userdata/base
/jka/base

----------------------
0 files in pk3 files
execing mpdefault.cfg
couldn't exec openjk.cfg
couldn't exec autoexec.cfg
...
----- Initializing Renderer ----
Using static boot renderer stub (rd-vanilla_x86.wasm)
QKEY building random string
QKEY generated
...
------- sound initialization -------
not initializing.
------------------------------------
Sound memory manager started
CL_StartHunkUsers: UI disabled in Emscripten boot build
--- Common Initialization Complete ---
SDL Version Compiled: 2.32.10
SDL Version Linked: 2.32.10
```

The process stayed alive until the 25 s timeout with no trap, abort or alert.
The page's canvas is intentionally blank: the stub does not draw.

### 4.1 Node smoke test

```bash
engine/scripts/verify-boot-node.sh
```

It boots the same output for 12 s and asserts the banner, FS paths, stubbed
network, stub renderer, and `Common Initialization Complete`, then fails on
`ABORT`, `wasm trap`, `RuntimeError` or an unhandled rejection.

Result on the committed script: all checks `ok`, `M1 boot smoke test: PASS`.

---

## 5. Filesystem and network

- Default `fs_basepath=/jka` and `fs_homepath=/userdata` are compiled in (`Sys_DefaultInstallPath` / `Sys_DefaultHomePath`); the harness passes no path arguments.
- The browser harness mounts **IDBFS at `/userdata`** (never at `/jka`) and waits for the initial `syncfs`; the console reports `IDBFS mounted at /userdata`.
- `FS_Startup` lists `/userdata/base` first, then `/jka/base` (homepath first).
- The boot fixture stages only `mpdefault.cfg`; real `assets*.pk3` and demos are
  not present in M1.
- `NET_Init` returns before `NET_Config`, so no sockets are created and no
  Emscripten WebSocket/UDP shim is involved. This is the M3 no-network baseline.
- No external requests are made by the harness; the page fetches only its own
  `.js`, `.wasm` and `.data`. The HTTP access log for the verification run shows
  exactly four requests: `/`, `/openjk.x86.js`, `/openjk.x86.wasm`,
  `/openjk.x86.data`.

---

## 6. Limitations and open work

1. **No renderer.** `ref_stub.cpp` is a boot shim; M2 must link `rd-vanilla`
   (static first) and implement WebGL. The §4.1–4.3 defects from
   [rendering-triage.md](./rendering-triage.md) still apply.
2. **No cgame or UI.** `CL_StartHunkUsers` skips UI; `VM_Create` for cgame is
   only reached when a map/demo starts. Side-module loading is unproven.
3. **CMake shared-library warning.** CMake 4.2.3 with the Emscripten toolchain
   reports that it does not support Emscripten shared libraries. Engine-only is
   unaffected, but side modules need CMake > 4.3.3 or a source-list/side-module
   build. This is the first M2 blocker to resolve.
4. **`sys_unix.cpp` is still the platform layer.** Emscripten's POSIX emulation
   compiles it; browser-specific paths/dialogs/timers/module loading have not
   been separated into `sys_emscripten.cpp`.
5. **No audio, input, game data or demo playback.** `s_initsound 0`, no asset
   staging, no demo command.
6. **Boot fixture only.** `mpdefault.cfg` is staged via `--preload-file`; the
   real staging layer is M3/M4 work.
7. **Headless only.** No visible-browser or performance test yet.

---

## 7. Next actions (M2/M1 remainder)

1. Resolve side-module tooling (CMake upgrade or a side-module build script).
2. Link `rd-vanilla` statically and call `GetRefAPI` directly; keep the stub as a
   fallback for CI boot tests.
3. Apply the renderer triage fixes (16-bit indices, `internalformat`, `primitive`
   path) and render a test map.
4. Build `cgame` as a side module and verify `VM_Create`.
5. Replace the preload fixture with the MEMFS staging layer and replay the
   native baseline demo.
