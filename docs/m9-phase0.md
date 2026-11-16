# M9 Phase 0: diagnostics build and baseline

**Status:** Instrumentation implemented; baseline recorded in
`docs/m9-phase0-results.md`, including a clean-cache run with the real demo
scan and keyframe seeks. Stop and tab-memory readings remain for Phase 4 and a
Task Manager check.
**Scope:** Measure the current engine before changing shader compilation, map
loading, workers, assets or seek behaviour.

The Phase 0 build does not make playback faster. It answers five questions:

1. Which of the compiled shader programs are actually used.
2. How `CL_InitCGame` splits between the BSP, images, client models, HUD and
   the rest of `CG_Init`.
3. How long the whole demo scan really takes.
4. What the wasm heap, MEMFS, browser storage and JS heap look like at boot,
   after Check map and during Play.
5. Whether the browser has Worker, OffscreenCanvas, transferControlToOffscreen
   and WebGL2, to decide whether the Phase 3 GL-in-worker spike is viable.

## Instrumentation

### New patch

`engine/patches/0006-jka-profile.patch` (applies after `0005`) adds:

- `jka_profile` gating and `JKA_PROFILE` log lines in the renderer
  (`tr_init.cpp`, `tr_glsl.cpp`, `tr_bsp.cpp`, `tr_image.cpp`) and the client
  (`cl_cgame.cpp`).
- `compiled` / `used` flags on `shaderProgram_t`; `GLSL_BindProgram()` sets
  `used`, and `GLSL_ShutdownGPUShaders()` logs
  `used=<n> compiled=<n> total=<n> indices=<i,j,...>` for every shader group.
- `R_Init` stage timings, `RE_LoadWorldMap` (BSP + world total), image
  decode/upload counters, and `RE_EndRegistration` image totals.
- `CG_Init` stage marks around `CM_LoadMap`, graphics, clients, asset cache,
  HUD and shader state.
- `CL_InitCGame` marks around cgame init, `EndRegistration` and
  `Com_TouchMemory`.

`engine/platform/jka_bridge.cpp` adds scan timing and message/snapshot/keyframe
counts, time-based yields (8 ms) with a worker opt-out (`JKA_SetWorkerMode`),
`JKA_MemoryJson` (wasm heap, heap max, hunk free), and Play/Stop/Seek timings.

`app/src/engine/EngineHost.ts` logs browser capabilities, boot/stage/ready
marks and memory samples. `app/src/App.tsx` marks Check map, Play, Restart,
seek and Stop.

### Log lines

Filter the downloaded log for `JKA_PROFILE`. Useful lines:

| Line | Meaning |
|---|---|
| `JKA_PROFILE browser ...` | Worker/OffscreenCanvas/transfer/WebGL2 support, cores, JS heap availability |
| `JKA_PROFILE session ...` | default or fast texture profile; `diagnostics` is the URL flag only, not the engine cvar (a `PROFILE=1` build still logs with `diagnostics=0`) |
| `JKA_PROFILE stage=... sinceMs=...` | JS boot/Check map/Play/Restart/seek/Stop markers |
| `JKA_PROFILE memory stage=... heap=... memfs=...` | wasm heap, MEMFS bytes, staged bytes, `performance.memory`, storage estimate |
| `JKA_PROFILE r_init stage=... ms=...` | renderer boot sections; `r_init total` is the boot shader/GL cost |
| `JKA_PROFILE shaders stage=compile ...` | shader compile total and per-kind counts |
| `JKA_PROFILE shaders group=... used=...` | shader usage, emitted at renderer shutdown; `shaders usage frames=... used=...` is the headline total |
| `JKA_PROFILE images stage=... count=...` | image count/bytes, file decode time, texture upload time |
| `JKA_PROFILE world_load stage=bsp ...` | BSP load time and world total |
| `JKA_PROFILE cl_init stage=...` | `CL_InitCGame` split: cgame VM, cgame init, end registration, touch memory |
| `JKA_PROFILE cgame stage=...` | `CG_Init` split: CM_LoadMap, graphics, clients, asset cache, HUD, shader state |
| `JKA_PROFILE demo_scan ...` | `scanMs` (scan function) and `totalMs` (pause+disconnect+summary), message/snapshot/keyframe counts |
| `JKA_PROFILE play ...` | Play command to returned frame (shader compile + map + cgame) |
| `JKA_PROFILE seek ... path=warm/keyframe/replay` | seek path and time |
| `JKA_PROFILE stop ...` | full teardown time |

Engine `JKA_PROFILE` lines come from the wasm log; JS `stage` and `memory`
lines are added by `EngineHost`. Both are included in **Download log**.

Shader usage is logged when the renderer shuts down. Press **Stop** after
playback (it performs the full disconnect) before downloading the log. The
usage line from the boot renderer is not the interesting one; the one after a
complete Play is. If the demo ended and was replayed without Stop, the next
Play's renderer restart also logs the previous session's usage.

Image counters are base-level estimates. `decodeMs` covers `R_FindImageFile`
image files; lightmap upload is counted in `R_CreateImage` but lightmap file
decode is not.

## Build the diagnostic engine

The diagnostic build sets `JKA_PROFILE_BUILD=1`, so `jka_profile` defaults to
on. A normal build still supports `?diagnostics=1`.

```bash
# Wipe an old build directory if it was configured without PROFILE=1;
# CMake keeps the old compiler flags.
rm -rf /tmp/jka-demo-player/build /tmp/jka-demo-player/out

EMSDK=$HOME/emsdk \
PROFILE=1 BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
WORK=/tmp/jka-demo-player/work \
BUILD=/tmp/jka-demo-player/build \
OUT=/tmp/jka-demo-player/out \
engine/scripts/build-mp-wasm.sh

# Stage the engine and build the app.
scripts/stage-engine.sh /tmp/jka-demo-player/out
npm --prefix app ci
npm --prefix app run build
npm --prefix app run dev
```

Requirements are the same as the normal build: Emscripten 6.0.1, CMake 4.x,
the pinned OpenJK submodule and a host compiler. If a stale worktree is
registered but missing, run `git -C references/OpenJK worktree prune` first.

The build script still applies every patch from the pin, now `0001`–`0006`. Do
not regenerate `0004` from a cumulative diff; `0006` is based on a worktree
with `0001`–`0005` applied.

## Sessions to run

Use one browser profile and one demo/map pair for both sessions. Run each
session from a fresh page load. Keep DevTools closed for the timing run except
for the tab-memory hover; DevTools changes the numbers.

Record tab memory by hovering the browser tab at the three points below. The
app also logs `JKA_PROFILE memory` at every stage; use the tab hover as the
cross-check.

### Session A: default quality

1. Open the dev server URL (no query parameters), select the four retail
   `assets*.pk3` files and a demo.
2. Wait until the engine is ready. Hover the tab and note memory.
3. Press **Check map** and wait for the resume/timeline. Note memory.
4. Press **Play** and wait for active playback. Note memory and the wall time
   from Play to the first active frame.
5. Press **Restart**, wait for playback, note the time.
6. Seek forward by about two minutes; note the seek line and the UI time.
7. Seek backward to about one minute; note the seek line and the UI time.
8. Press **Stop**, wait for the launcher, note memory.
9. Press **Download log** and keep the file as
   `m9-phase0-default.log`.

### Session B: fast texture profile

Repeat the exact steps on a fresh page with `?profile=fast` appended:

```text
http://localhost:5173/?profile=fast
```

That session adds `r_picmip 2` and `r_textureMode GL_LINEAR` at boot. Keep it
as `m9-phase0-fast.log`. If you are running a normal engine build instead of
the `PROFILE=1` build, use `?diagnostics=1` in both session URLs.

Do **not** run both sessions at once; two wasm heaps plus the asset copy can
exhaust the host.

## Send back

- `m9-phase0-default.log` and `m9-phase0-fast.log`.
- A short table per session: engine boot, Check map, Play, Restart, forward
  seek, backward seek, Stop, and tab memory after boot/Check map/Play.
- Browser and OS version, and whether the page load was cold or warm.
- The demo name/map and whether the map came from a retail PK3 or an added
  map PK3. Do not send the demo/asset files.
- Every `JKA_PROFILE shaders group=...` line from after Stop.
- Any error, missing-map or fallback path that appeared.

The gate is decided from these numbers:

1. The used shader indices per group define the Phase 1 eager set.
2. The `cl_init`/`cgame`/`images`/`world_load` split decides Phase 2 work.
3. `demo_scan ms` and its counts decide whether a fast block index is needed.
4. The `browser` line plus the Phase 3 spike decide worker viability.
5. `memory` high-water marks set the Phase 3/4 targets.

## Rules kept

- No game assets, demos, logs, screenshots or browser profiles are committed.
- The `jka_profile` path is diagnostic only: it does not change rendering,
  shader compilation or cgame behaviour.
- `CL_InitCGame` stage marks use existing client calls; no new cgame call was
  added to `JKA_StatusJson`.
- The scan still uses the serialized `JKA_DemoInfo` path and pauses the main
  loop.
