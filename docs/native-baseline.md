# Native OpenJK MP baseline (M0.5)

**Status:** Complete for the native half of M0.5. Native MP playback verified on Linux.
**Date:** 2026-11-16
**Scope:** Native OpenJK multiplayer build, base-game `.dm_26` playback, module loading, offline verification. No Emscripten, no WebAssembly, no frontend, no source patches.
**Related:** [research.md](./research.md) · [architecture.md](./architecture.md) · [milestones.md](./milestones.md) · [rendering-triage.md](./rendering-triage.md)

---

## 1. Result

| Check | Result |
|---|---|
| Read-only source checkout at pinned commit | **Pass** — `260c59c2907187af555a676fe0cc798893bf7757`, tree clean before and after |
| Native MP-only configure with CMake 4.2.3 | **Pass** — no policy workaround needed |
| Native MP build (engine, rd-vanilla, cgame, ui) | **Pass** — exit 0, 62 warnings, no errors |
| Base-game `.dm_26` demo opens and parses gamestate | **Pass** — `CL_PlayDemo_f`, demo handle, configstrings |
| cgame loads and map renders | **Pass** — `VM_Create: cgamex86_64.so succeeded`, `...loaded 550 faces` |
| Client state reaches `CA_PRIMED` and `CA_ACTIVE` | **Pass** — observed `cls.state` 5 → 6 → 7 → 8 |
| Playback advances over time | **Pass** — `cl.serverTime` and `cl.snap.serverTime` advance monotonically |
| No server / network connection required | **Pass** — no remote socket traffic during playback |
| Retail assets only | **Pass** — staged with `assets0..3.pk3` only; no mod assets |

**Native baseline verdict: PASS.**

Evidence artefacts are under `/tmp/jka-demo-player/m0.5` (logs, screenshots, build trees). They are not part of the repository.

---

## 2. Source checkout

```text
$ git -C references/OpenJK rev-parse HEAD
260c59c2907187af555a676fe0cc798893bf7757

$ git -C references/OpenJK status --short
(no output)
```

The tree was **not modified**. All work used out-of-tree build directories. No patch was required, so `/tmp/jka-demo-player/m0.5/patches/` is empty. The checkout remained clean after the work (see §11).

---

## 3. Environment

| Item | Value |
|---|---|
| OS | Ubuntu 26.04 LTS (Resolute Raccoon) |
| Kernel | `7.0.0-43-generic` x86_64 |
| CPU | 16 logical cores (`nproc`) |
| Compiler | GCC/G++ 15.2.0 (`gcc (Ubuntu 15.2.0-16ubuntu1) 15.2.0`) |
| CMake | 4.2.3 |
| SDL2 | 2.32.10 (system; `UseInternalSDL2=OFF`) |
| OpenAL | 1.25.1 (system package; audio disabled for this test) |
| libjpeg-turbo | 2.1.5 (CMake reports JPEG API 80) |
| libpng | 1.6.57 |
| zlib | 1.3.1 |
| GPU | AMD Radeon RX 5700 XT (radeonsi, navi10) |
| GL driver | Mesa 26.0.8, OpenGL 4.6 Compatibility Profile |
| Display | Xwayland on `:0` (real display; no Xvfb) |

The engine log records the GL context:

```text
GL_VENDOR: AMD
GL_RENDERER: AMD Radeon RX 5700 XT (radeonsi, navi10, ACO, DRM 3.64, 7.0.0-43-generic)
GL_VERSION: 4.6 (Compatibility Profile) Mesa 26.0.8-1ubuntu0.3
```

---

## 4. Configure and build

### 4.1 Configure

```bash
cmake -S references/OpenJK -B /tmp/jka-demo-player/m0.5/build-openjk \
  -DCMAKE_BUILD_TYPE=Release \
  -DBuildMPEngine=ON -DBuildMPRdVanilla=ON -DBuildMPCGame=ON -DBuildMPUI=ON \
  -DBuildMPGame=OFF -DBuildMPDed=OFF -DBuildMPRend2=OFF \
  -DBuildSPEngine=OFF -DBuildSPGame=OFF -DBuildSPRdVanilla=OFF \
  -DBuildJK2SPEngine=OFF -DBuildJK2SPGame=OFF -DBuildJK2SPRdVanilla=OFF
```

Observed dependency detection:

```text
-- Found JPEG: /usr/lib/x86_64-linux-gnu/libjpeg.so (found version "80")
-- Found ZLIB: /usr/lib/x86_64-linux-gnu/libz.so (found version "1.3.1")
-- Found PNG:  /usr/lib/x86_64-linux-gnu/libpng.so (found version "1.6.57")
-- Found OpenGL: /usr/lib/x86_64-linux-gnu/libOpenGL.so
-- Configuring done (0.7s)
```

**CMake policy workaround:** none was needed. OpenJK declares `cmake_minimum_required(VERSION 3.1...3.31)` (`CMakeLists.txt:21`); CMake 4.2.3 configured it without a compatibility error. `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` was **not** passed. If a different CMake 4.x release rejects this range, retry with that flag; it would be a configure-only change.

### 4.2 Build

```bash
cmake --build /tmp/jka-demo-player/m0.5/build-openjk -j"$(nproc)"
```

Result: exit code 0. Logs:

- `/tmp/jka-demo-player/m0.5/logs/configure.log` (Release configure)
- `/tmp/jka-demo-player/m0.5/logs/build.log` (full build)
- `/tmp/jka-demo-player/m0.5/logs/configure-dbg.log` (debug build configure)

### 4.3 Warnings

62 compiler warnings, no errors. Classes:

| Warning | Count |
|---|---|
| `-Wparentheses` | 25 |
| `-Wstringop-truncation` | 24 |
| `-Wstringop-overflow=` | 3 |
| `-Wclass-memaccess` | 3 |
| `-Wmaybe-uninitialized` | 2 |
| `-Wdiscarded-qualifiers` | 2 |
| `-Warray-bounds=` | 2 |
| `-Wdangling-pointer=` | 1 |

They are upstream code-quality warnings, not build failures. No warning was treated as an error.

### 4.4 Instrumentation build

For state introspection only, a second build with symbols was produced from the same source and options:

```bash
cmake -S references/OpenJK -B /tmp/jka-demo-player/m0.5/build-openjk-dbg \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DBuildMPEngine=ON -DBuildMPRdVanilla=ON -DBuildMPCGame=ON -DBuildMPUI=ON \
  -DBuildMPGame=OFF -DBuildMPDed=OFF -DBuildMPRend2=OFF \
  -DBuildSPEngine=OFF -DBuildSPGame=OFF -DBuildSPRdVanilla=OFF \
  -DBuildJK2SPEngine=OFF -DBuildJK2SPGame=OFF -DBuildJK2SPRdVanilla=OFF
cmake --build /tmp/jka-demo-player/m0.5/build-openjk-dbg -j"$(nproc)"
```

The shipped baseline binary is the `Release` build. `RelWithDebInfo` only adds debug info; no source or optimisation-relevant setting changed.

---

## 5. Artifacts

Built artifacts (Release):

| Module | Path | Size |
|---|---|---|
| MP client | `/tmp/jka-demo-player/m0.5/build-openjk/openjk.x86_64` | 2,002,432 B |
| Renderer | `/tmp/jka-demo-player/m0.5/build-openjk/codemp/rd-vanilla/rd-vanilla_x86_64.so` | 815,200 B |
| Client game | `/tmp/jka-demo-player/m0.5/build-openjk/codemp/cgame/cgamex86_64.so` | 1,250,616 B |
| UI | `/tmp/jka-demo-player/m0.5/build-openjk/codemp/ui/uix86_64.so` | 689,256 B |

No `jampgame` was built (`BuildMPGame=OFF`); demo playback does not need it.

Run layout used for the test (all under `/tmp`):

```text
/tmp/jka-demo-player/m0.5/
├── bin/                      # openjk.x86_64 + the three .so modules (Release)
├── bin-dbg/                  # same, RelWithDebInfo (gdb introspection only)
├── home/                     # fs_homepath
│   └── base/
│       ├── cgamex86_64.so
│       ├── uix86_64.so
│       ├── rd-vanilla_x86_64.so
│       ├── qconsole.log
│       └── demos/demo.dm_26
├── retail-base/              # test-only fs_basepath
│   └── base/
│       ├── assets0.pk3 -> user install (symlink)
│       ├── assets1.pk3 -> user install (symlink)
│       ├── assets2.pk3 -> user install (symlink)
│       ├── assets3.pk3 -> user install (symlink)
│       └── demos/demo.dm_26
├── logs/
└── shots/
```

**Why modules were staged in `home/base`:** OpenJK MP resolves cgame and UI through `Sys_LoadGameDll`, which searches `fs_homepath/<gamedir>` and `fs_basepath/<gamedir>`, not the directory containing the executable. Staging the modules in the writable homepath is a test-layout convenience and does not alter the engine or the user's install. The renderer loaded successfully with copies in both `bin/` and `home/base/`; its exact search order was not isolated (the `VM_Create` log lines only name cgame and UI).

---

## 6. Test data

### 6.1 Assets (user-supplied, never copied into the repo)

`JKA_ROOT=/path/to/JediAcademy`, containing a complete retail `base/`:

| File | Size |
|---|---|
| `assets0.pk3` | 561,806,019 B |
| `assets1.pk3` | 652,804,510 B |
| `assets2.pk3` | 1,116,384 B |
| `assets3.pk3` | 9,282,026 B |

To prove the demo does not depend on the user's downloaded maps or any mod, the test `fs_basepath` was a separate directory containing **symlinks to the four retail PK3s only** (`/tmp/jka-demo-player/m0.5/retail-base/base`). The user's `GameData` was not written to and no file in it changed (verified with `find ... -newermt`).

### 6.2 Demo used for the baseline

| Item | Value |
|---|---|
| Source | User's local demo collection (outside the repo) |
| Staged name | `demo.dm_26` |
| Original name | redacted |
| Size / hash | redacted |
| Server gamename | `basejka` (no mod) |
| Gametype | `3` (duel) |
| Map | `mp/duel1` (stock retail map, `maps/mp/ffa2` and `maps/mp/duel1` confirmed inside `assets0.pk3`) |
| Protocol | `26` (`PROTOCOL_VERSION`) |
| Client game | `vm_cgame 0` (base cgame) |

A second demo from the user's collection was also played first (`community-map.dm_26`, staged as `community.dm_26`). It is `basejka` on the community map `ffa_YavinPlaza`, and it renders correctly when the user's `base` folder is used as `fs_basepath`. It is retained as corroborating evidence but is not the primary baseline because its map is not a stock asset.

A metadata scan of 49 demos from the user's collection (engine-parsed gamestate only) found 38 pure `basejka`, 10 `basejka: vinR-Competitive Patch`, and 1 `japro`. The chosen demo is one of the pure `basejka` set on a stock map.

**Selection note:** the user did not name a demo path for this run. This file was selected from the local install because it is a pure `basejka` recording on a stock map. If a different demo is the intended baseline, it can be staged and replayed with the same procedure; the result above does not depend on this particular recording beyond the metadata in the table.

No demo or PK3 is in the repository.

---

## 7. Playback procedure

```bash
export JKA_ROOT=/path/to/JediAcademy
export M05=/tmp/jka-demo-player/m0.5

# One-time staging (test only):
#   - copy the four .so modules into $M05/home/base
#   - copy the demo to $M05/home/base/demos/<name>.dm_26

cd $M05/bin
./openjk.x86_64 \
  +set fs_basepath "$JKA_ROOT" \
  +set fs_homepath "$M05/home" \
  +set cl_allowDownload 0 \
  +set logfile 2 \
  +set r_fullscreen 0 \
  +set s_initsound 0 \
  +demo demo
```

The primary evidence run used the retail-only staging:

```bash
./openjk.x86_64 \
  +set fs_basepath $M05/retail-base \
  +set fs_homepath $M05/home \
  +set cl_allowDownload 0 +set logfile 2 \
  +set r_fullscreen 0 +set s_initsound 0 +set com_maxfps 60 \
  +demo demo
```

**Display workaround (documented, not Xvfb):** the machine has a real GNOME/Wayland session with Xwayland on `:0`, but the inherited `XAUTHORITY` variable pointed at a stale authorisation file, so SDL/GL initially failed with `Authorization required`. The working values were:

```bash
export DISPLAY=:0
export XAUTHORITY=/run/user/<uid>/.mutter-Xwaylandauth.<id>   # your cookie file
export SDL_VIDEODRIVER=x11                                      # force X11 for capture
```

With `SDL_VIDEODRIVER` unset, SDL preferred Wayland, which renders correctly but is not capturable by `import`/`xwininfo`. Xvfb was **not** installed and not needed; Mesa hardware rendering was used. A software-rasteriser fallback was therefore not exercised.

For `cls.state`/`serverTime` introspection, the same run was repeated under `gdb` with the `RelWithDebInfo` binary using a watchpoint on `cls.state` and a breakpoint on `CL_SetCGameTime` (script: `/tmp/jka-demo-player/m0.5/gdb-base.cmds`). This is read-only instrumentation; no code was patched.

---

## 8. Results

### 8.1 Demo command and gamestate

The client log shows the demo file being opened by the filesystem and the map/cgame loading:

```text
handle 3: demos/demo.dm_26
VM_Create: cgamex86_64.so succeeded
...loaded 550 faces, 66 meshes, 46 trisurfs, 2 flares
CL_InitCGame:  4.99 seconds
```

`CL_PlayDemo_f` was hit (gdb breakpoint), and `clc.demoplaying` was `1` at `CA_ACTIVE`.

### 8.2 Client state machine

`connstate_t` values from `codemp/qcommon/q_shared.h:1731`: 5 = `CA_CONNECTED`, 6 = `CA_LOADING`, 7 = `CA_PRIMED`, 8 = `CA_ACTIVE`.

```text
M05|cls.state=1                     # CA_DISCONNECTED
M05|CL_PlayDemo_f|state_before=1
M05|cls.state=5                     # CA_CONNECTED
M05|cls.state=6                     # CA_LOADING
M05|CL_InitCGame|state=6
M05|cls.state=7                     # CA_PRIMED
M05|cls.state=8                     # CA_ACTIVE
M05|CA_ACTIVE|cl.serverTime=1032552507|snap.serverTime=1032552540|demoplaying=1|cl_allowDownload=0
```

### 8.3 Gamestate contents

Trimmed `CS_SERVERINFO` from the demo (player names are not present; server hostname omitted):

```text
... \protocol\26 \mapname\mp/duel1 \gamename\basejka \g_gametype\3
\sv_allowDownload\0 \g_privateDuel\1 \version\JAmp: v1.0.1.1 linux-i386 Nov 10 2003 ...
```

Trimmed `CS_SYSTEMINFO`:

```text
... \sv_pure\1 \vm_ui\0 \vm_game\0 \vm_cgame\0 \sv_referencedPakNames\...
```

This confirms a base game (`basejka`), base cgame (`vm_cgame 0`), protocol 26, and a stock map. The demo's pure-pak list includes a community map pak the server had (`t3home2`); it was intentionally absent from the retail-only staging and did **not** block playback of `mp/duel1`.

### 8.4 Playback advances

`cl.serverTime` and the snapshot server time increase monotonically while the demo plays:

```text
M05|tick=300 |cl.serverTime=1032557243|snap.serverTime=1032557263
M05|tick=600 |cl.serverTime=1032562043|snap.serverTime=1032562048
M05|tick=900 |cl.serverTime=1032566843|snap.serverTime=1032566866
M05|tick=1200|cl.serverTime=1032571643|snap.serverTime=1032571651
...
M05|tick=2700|cl.serverTime=1032595643|snap.serverTime=1032595675
```

The delta is ~4,800 ms per 300 `CL_SetCGameTime` ticks, consistent with the recorded 16 ms frames. The normal (non-gdb) run also logged a live gameplay event ~44 s in:

```text
2026-11-15 23:56:40 ^4^^0<player>^4~^7<player>^7 was sabered by <player>^7
```

### 8.5 Rendering

Screenshots (local evidence, not committed):

| File | Content |
|---|---|
| `/tmp/jka-demo-player/m0.5/shots/base_01.png` | Duel on `mp/duel1`, world geometry, textured floor, both lightsabers, HUD, duel scoreboard, third-person camera |
| `/tmp/jka-demo-player/m0.5/shots/base_02.png` | Same demo later: different camera position and scene, HUD/health/shield values changed |
| `/tmp/jka-demo-player/m0.5/shots/native_01.png`, `native_02.png` | Second demo (`ffa_YavinPlaza`): HUD, chat overlay, multiple characters, map textures |

`import -window` captured real, non-blank content (41k–72k unique colours per frame); two frames from different times show camera movement and HUD changes, not a frozen image.

### 8.6 Offline / no-server evidence

`strace -f -e trace=network` over a 30 s playback run:

- one `socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)` and `bind(... 0.0.0.0:29070)`;
- **no** `connect()`, `sendto()`, or `recvfrom()` to any non-loopback INET address;
- all other socket activity is X11 (`/tmp/.X11-unix/X0`), D-Bus, nscd, and netlink.

The engine's normal startup line `Opening IP socket: localhost:29070` therefore does not imply network use. The demo is read entirely from `demos/demo.dm_26` (handle 3). `cl_allowDownload` was verified as `0` at `CA_ACTIVE`.

Logs: `/tmp/jka-demo-player/m0.5/logs/run-base-gdb.log`, `run-base.stdout`, `run-base.qconsole.log`, `strace-network.log`.

---

## 9. Limitations

- **One machine, one GPU/driver.** Results are for AMD RX 5700 XT + Mesa 26.0.8 on Ubuntu 26.04. No NVIDIA/Intel or software-rasteriser run.
- **One demo family.** The primary demo is a base duel recording on `mp/duel1`. Other gametypes (CTF/FFA/siege), mod demos, server-side demos, and truncated demos were not played to completion.
- **No demo-end test.** The run was stopped after ~30–55 s; `CL_DemoCompleted` → UI menu / `nextdemo` was not exercised.
- **Audio disabled.** `s_initsound 0` and `SDL_AUDIODRIVER=dummy`; audio is not on the demo-critical path and was not verified.
- **`cls.state`/`serverTime` evidence comes from a `RelWithDebInfo` build.** The Release build produced the screenshots and logs and ran the same demo; the state trace used the symbol build because the Release binary has no type info for `cls`.
- **Renderer module location.** The test staged `rd-vanilla_x86_64.so`, `cgamex86_64.so`, and `uix86_64.so` in `fs_homepath/base`; a packaged layout should place them where OpenJK normally looks (next to `base/`, in `base/`, or in the install directory). This is packaging, not an engine defect.
- **UI is required as built.** A missing `uix86_64.so` causes `VM_CreateLegacy on ui failed` and aborts startup; M3's "skip UI" plan still applies for the browser.
- **No source patch was applied.** If a future fix is needed, it must be made in a worktree/copy under `/tmp/jka-demo-player/m0.5` and recorded there, never in `references/OpenJK`.

---

## 10. Reproduction recipe

1. Verify `git -C references/OpenJK rev-parse HEAD` is `260c59c...` and the tree is clean.
2. Configure/build with the commands in §4.1–4.2.
3. Create `$M05/home/base`, copy the four `.so` modules there, and create `$M05/home/base/demos`.
4. Put the demo at `$M05/home/base/demos/<safe-name>.dm_26` (no spaces; `CL_PlayDemo_f` takes one token).
5. Run from `$M05/bin` with `+set fs_basepath "$JKA_ROOT" +set fs_homepath "$M05/home" +set cl_allowDownload 0 +set logfile 2 +demo <safe-name>`.
6. Confirm `handle ... demos/<name>.dm_26`, `VM_Create: cgamex86_64.so succeeded`, `...loaded N faces`, and `CL_InitCGame` in `qconsole.log`.
7. Confirm `cls.state` reaches 8 (`CA_ACTIVE`) and `cl.serverTime` advances (gdb script or debug build).
8. Capture a frame with `import -window` (X11) or the engine's own screenshot path.

---

## 11. Final source-tree check

```text
$ git -C references/OpenJK status --short
(no output)
```

The reference tree is clean. No file under `references/OpenJK` was created, modified, or deleted. No PK3, `.dm_26`, or other proprietary asset was copied into the repository or committed.

---

## 12. G0 contribution

The native half of gate G0 is **PASS**: upstream OpenJK MP builds natively, loads a base-game protocol-26 demo from local assets, reaches `CA_PRIMED` → `CA_ACTIVE`, loads the base cgame, loads a stock map, advances recorded time, and renders correct frames without a server or network. The remaining half of G0 — classifying the user's `jka-web` rendering issue — is covered in [rendering-triage.md](./rendering-triage.md).
