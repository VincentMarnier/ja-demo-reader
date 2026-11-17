# M9 Phase 3: worker engine, WORKERFS, remove OPFS

**Status:** Implementation complete and verified in both hosts. Emscripten
6.0.1 was installed, the engine built, the GL-in-worker spike passed, and the
full app booted, checked a retail demo and played it in Brave 157 and headful
Chromium 149. Brave Task Manager measured the worker at **130 MB idle** and
**290–298 MB after Check map/Play/Stop**, so the worker idle/map-memory targets
are met; the fallback is ~1.3–1.4 GB. Restart and backward seek still use full
reloads (Phase 4/5), and Stop still performs a full teardown instead of
keep-warm.

**Scope:** Run the same engine build in a dedicated Web Worker against an
OffscreenCanvas, mount retail PK3s read-only with WORKERFS, keep a degraded
main-thread host, and remove the OPFS asset cache.

### Target scorecard

| Target | Measured | State |
|---|---|---|
| Engine boot ≤ 5 s | **1.1–2.3 s** worker; 4.9 s fallback | met |
| Check map ≤ 2 s | **8.0–8.5 s** (demo scan includes a map/cgame load) | not met; Phase 4 prewarm |
| First Play ≤ 10 s | **8.0–8.3 s** | met, but WORKERFS adds ~5 s vs MEMFS |
| Restart ≤ 0.5 s | **7.8–10.8 s** | not met; Phase 4/5 |
| Forward seek | **1 ms warm** | met |
| Backward seek ≤ 0.6 s | **7.99 s** (`path=keyframe`) | not met; Phase 5 |
| Idle tab ≤ 400 MB | **130 MB** (Brave) | met |
| Map-loaded ≤ 800 MB | **290–298 MB** (Brave) | met |
| Browser asset storage | **57–80 KB**, no OPFS copy | met |
| UI responsiveness | worker path; not formally measured | expected |

## What changed

| Area | Change |
|---|---|
| Engine build | One module for `web,worker`; WORKERFS linked; `FS` and run-dependency hooks exported; GL proc lookup enabled. |
| Window/GL | New `engine/platform/win_emscripten.cpp` creates a WebGL2 context on the transferred OffscreenCanvas. Patch `0008` selects it at runtime and skips DOM input in the worker. |
| Worker host | New `app/src/engine/engine.worker.ts` and `WorkerEngineHost.ts`; the worker owns the wasm module, the RPC queue and the status/scoreboard polls. |
| Fallback | `EngineHost.ts` is now `MainThreadEngineHost`; the old MEMFS staging path is kept. Both hosts implement `EngineHostApi` in `app/src/engine/shared.ts`. |
| Assets | Retail PK3s are mounted with WORKERFS at `/jka/base`; demos and added map PK3s are written to the writable `/userdata/base`. |
| OPFS | The asset-cache write/read path and its UI are removed. A one-time cleanup deletes the old `jka-demo-player/assets` OPFS tree. |
| Docs | README, architecture and AGENTS updated for the worker path and the no-cache model. |

## Spike result (this checkout)

- Host: Chromium 149 for Testing, Linux, **headful** on the desktop display.
  The regular `--headless` build has no WebGL2 at all (main thread or worker),
  so it cannot run this gate; headful Chromium reports WebGL2 and worker
  OffscreenCanvas WebGL2.
- Engine: `PROFILE=1 BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1`, Emscripten
  6.0.1.
- Worker boot with the retail assets mounted:
  - `OffscreenCanvas WebGL2 context: 800x600` and
    `GL_RENDERER: WebKit WebGL` (WebGL 2.0 / GLES 3.0).
  - `R_Init` completed; **20 eager shaders in 0.46–1.05 s**.
  - `R_Init total` was **1.30 s** with the small asset subset and **2.04 s**
    with all retail assets plus an added map PK3.
  - The transferred canvas rendered the Jedi Academy splash screen (captured).
- App boot with four real `File` handles (file-input fallback):
  `worker engine-ready ms=2210–2247`; host stage `sinceMs=2276–2344`. The first
  `FS_Startup` was **84.9 s** before the central-directory cache below and
  **~2.2 s** after it.
- A custom `asms.pk3` added to `/userdata/base` and a 1.3 MB protocol-26 demo
  played in the worker: Check map (including the demo scan) **3.9 s**,
  `JKA_PlayDemo` **6.375 s** (`CL_InitCGame` 4.99 s, BSP 0.508 s, images
  1.41 s decode, cgame setup 1.996 s, graphics 1.579 s, clients 1.170 s).
  The canvas showed live gameplay and the scoreboard; the renderer reported
  144 frames and 9 used shader programs after the map. Lazy first-use compiles
  were 10–18 ms in this run.
- The custom map and demo are local test files and are not committed.

The initial full-asset smoke was slow partly because the harness fetches 1.1 GB
into Blobs on the page before handing them to the worker, and `WORKERFS` reads
them synchronously. Real app picks hand the worker disk-backed `File` objects
instead, so the harness number is not an app timing.

### Measured app baseline (four real `File` handles)

| Metric | Measured |
|---|---:|
| Worker boot message received | 33 ms after boot start |
| `importScripts` returned | 23 ms |
| WORKERFS mount | 3 ms |
| Runtime initialized | 61 ms |
| **Engine ready (worker timer)** | **2.21–2.29 s** |
| **Engine ready (host stage)** | **2.28–2.34 s** |
| `R_Init` total | 1.48–1.59 s |
| Eager shaders | 20 in 0.46–0.57 s |
| Writable MEMFS (`/userdata`) | **8,104 bytes** |
| Mounted PK3s | **1,225,008,939 bytes / 4 files** |
| `performance.memory.usedJSHeapSize` | **5.0–5.5 MB** |
| Browser storage estimate | **73,728 bytes** (no OPFS asset copy) |
| Check map (includes the demo scan) | **3.7 s** custom asms; **8.0–8.5 s** retail |
| `JKA_PlayDemo` | **5.86–6.38 s** custom asms; **8.0–8.3 s** retail |
| `CL_InitCGame` | **4.54–4.99 s** custom asms; **6.5–6.9 s** retail (high-detail map) |
| Restart (current full reload path) | **7.8–10.8 s** |
| Forward seek | **path=warm ms=1** |
| Backward seek | **path=keyframe ms=7994** (Phase 5) |
| Stop | **1.5–1.7 s** full teardown; no abort in the latest worker runs, fallback aborts |
| Map/cgame split | BSP 0.503–2.06 s; decode 1.25–2.55 s; cgame setup 1.89–2.00 s; graphics 1.30–3.00 s; clients 0.98–1.23 s |
| Renderer after the map | 144–226 frames, 9–19 used programs |

The `performance.memory` value is Chrome's JS-heap estimate and does not count
the whole wasm memory reservation; it is reported only as a comparison with
the old ~1.25 GB JS/MEMFS readings. **Brave/Chrome Task Manager tab memory was
not measured.** The writable MEMFS and browser storage numbers are the direct
evidence that the retail PK3 copy is gone.

The close-out run (clean rebuild from the pin, then headful Chromium) also
showed:

- **Restart is still the full reload path** (`playDemo` again): 10.3–10.8 s.
  Phase 4's keep-warm/seek-to-start is required for the 0.5 s target.
- **Stop did not abort on Brave 157**, but it still performed the full
  `CL_Disconnect`/`RE_Shutdown`/`R_Init` teardown: **1.54 s**, then the map
  step. The same Stop aborted with
  `Assertion failed: We cannot start an async operation when one is already in
  flight` in headful Chromium 149 and on the `?worker=0` fallback. It is a
  timing-sensitive teardown path; Phase 4's keep-warm Stop must not rely on
  it. The abort is not a Phase 3 regression.
- **The custom `asms.pk3` demo produced no timeline.** The demo scan returned
  `messages=0` (`gamestates=1`), so `demoInfo` had no duration and the seek bar
  was absent; playback itself still worked. The retail demo scanned normally
  (18,688 messages), so this is specific to the added map PK3/pure-list path.
  Phase 4/5 should make the scan safe with added map PK3s.
- The Play and Restart runs were stable; no page errors other than Stop.

### Worker vs main-thread fallback

Same engine build, same four retail assets, file-input handles:

| Metric | Worker | `?worker=0` fallback |
|---|---:|---:|
| Boot to engine ready | **2.2–2.3 s** | **4.0 s** |
| Staging/mount | mount 3 ms | stage 731 ms |
| `R_Init` | 1.49–1.59 s | ~1.9 s |
| Writable MEMFS | **8,104 B** | **1,225,008,939 B** |
| `performance.memory.usedJSHeapSize` | **5.0 MB** | **1,231.6 MB** |
| Browser storage estimate | 73,728 B | 73,728 B |
| Engine thread | dedicated worker | main thread + SDL |

The fallback's 1.23 GB JS heap is the MEMFS copy; the worker's 5 MB JS heap
does not contain the mounted PK3s. Both reserve the same 805 MB wasm heap
(`heap=805306368`).

### Brave Task Manager (user run)

Host: Brave 157 on the user’s desktop, retail-map demo
`blacksun_vs_cerberus_r1.dm_26`, texture settings **picmip 0 / trilinear**
(the high-quality setting, not the fast default):

| Point | Worker | `?worker=0` fallback |
|---|---:|---:|
| Page load | 38 MB | 38 MB |
| Engine ready | **130 MB** | **1.3 GB** |
| After Check map | **297 MB** | **1.39 GB** |
| After Play | **290 MB** | **1.4 GB** |
| After Stop | **298 MB** | **1.4 GB** |

This meets the worker idle (≤400 MB) and map-loaded (≤800 MB) targets on the
user’s machine. The fallback is the expected ~1.2 GB MEMFS copy.

The same Brave run:
- Worker boot **2.12 s**; Check map **8.24 s** including the scan (the scan’s
  map/cgame load was 6.50 s); `JKA_PlayDemo` **8.13 s** (`CL_InitCGame` 6.86 s);
  Stop **1.54 s** with **no Asyncify abort** in the worker.
- Fallback boot **4.9 s**; Check map **3.6 s**; Play **3.21 s**
  (`CL_InitCGame` 2.26 s); Stop still aborted Asyncify.
- The retail demo scanned normally: 18,688 messages, 18,687 snapshots,
  75 keyframes. This confirms the earlier `messages=0` scan failure was
  specific to the custom map PK3/pure-list case, not the worker path.
- The worker Play is slower than the fallback (8.13 s vs 3.21 s) because
  WORKERFS file-data reads add maps/textures/models work. The fast texture
  profile (default) should reduce that; this run used the high-quality
  setting.

A second headful Chromium close-out run on the same retail demo (default fast
profile) measured:

- Boot 1.1–1.6 s; Check map **8.5 s**; Play **8.0–8.3 s**; Restart
  **7.8–8.1 s** (still the full reload path).
- **Forward seek path=warm ms=1**; the UI returned immediately.
- **Backward seek path=keyframe ms=7994** (about 8 s), the remaining
  map/cgame reload cost that Phase 5 must remove.
- Stop **1.68 s**, no worker abort and no page error in this run; it still does
  the full `RE_Shutdown`/`R_Init` teardown.
- The custom `asms.pk3` demo still has no timeline; the retail demo has one.

### WORKERFS central-directory cache

Without a cache, the first `FS_Startup` took **84.9 s**: OpenJK's minizip walks
each PK3 central directory twice, one entry at a time, and every WORKERFS read
is a synchronous `FileReaderSync`. The worker now wraps
`FS.filesystems.WORKERFS.stream_ops.read` and caches each PK3's central
directory (EOCD + central-directory range) on its WORKERFS node. Reads inside
that range are served from memory; file data (BSP, textures, models) still uses
the lazy WORKERFS read path. This cut boot to **2.2 s** and makes the
`JKA_RestartFS` after adding a map fast as well.

Keep this wrapper. It is app-side and does not change the engine; it assumes
non-ZIP64 PK3s (the retail assets are non-ZIP64) and falls back to the normal
WORKERFS read for any range it cannot cache.

## The spike gate

The spike is a standalone harness in the engine build output:

```text
worker-smoke.html      page: transfers a canvas to the worker
engine-worker.js       classic worker: mounts WORKERFS, boots, optionally plays
```

It is intentionally independent of the React app, so a failure points at the
engine/window layer rather than at the UI.

### Build and run locally

Requirements are unchanged: Emscripten 6.0.1, CMake 4.x, the pinned OpenJK
submodule and a host compiler.

```bash
# Clean build directory if it was configured before this phase.
rm -rf /tmp/jka-demo-player/work /tmp/jka-demo-player/build /tmp/jka-demo-player/out

EMSDK=$HOME/emsdk \
BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
WORK=/tmp/jka-demo-player/work \
BUILD=/tmp/jka-demo-player/build \
OUT=/tmp/jka-demo-player/out \
engine/scripts/build-mp-wasm.sh
```

The build applies patches `0001`–`0008` and copies
`engine/platform/win_emscripten.cpp` into the worktree (like `jka_bridge.cpp`).

Serve the output and open the smoke page:

```bash
cd /tmp/jka-demo-player/out
python3 -m http.server 8123
```

```text
# Boot + WORKERFS fixture only (no game files needed)
http://localhost:8123/worker-smoke.html

# Retail PK3s mounted with WORKERFS; put copies beside this page:
#   assets0.pk3 … assets3.pk3        (never committed)
http://localhost:8123/worker-smoke.html?assets=1

# Also play a demo: put demos/<name>.dm_26 beside the page.
http://localhost:8123/worker-smoke.html?assets=1&demo=<name>

# Focused probes: mount only the listed PK3s (e.g. one asset or a map PK3).
http://localhost:8123/worker-smoke.html?assets=1&paks=assets2.pk3
```

Expected evidence in the page log and console:

- `WORKERFS mounted ... at /jka/base`, then either
  `WORKERFS read mpdefault.cfg bytes=...` (no assets) or
  `WORKERFS stat assets0.pk3 bytes=...`.
- `Using Emscripten OffscreenCanvas window layer`.
- `OffscreenCanvas WebGL2 context: 800x600` (or the canvas size).
- `GL_RENDERER: ...` from the renderer.
- `engine ready — ready=1 ...` status after the module finishes booting.
- With `?demo=...`, status reaches `state=8` (active) and the canvas shows the
  demo rather than the splash.

The gate passes only when the page renders in the worker. If the log shows an
SDL/DOM error, the window layer was not selected; if it shows a WebGL2 context
failure, the spike failed and the worker path should not replace the
main-thread fallback. The fallback remains available in either case.

### Build flags

`engine/scripts/build-mp-wasm.sh` adds:

```text
-sENVIRONMENT=web,worker,node   # node keeps verify-boot-node.sh working
-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,addRunDependency,removeRunDependency
-sDISABLE_DEPRECATED_FIND_EVENT_TARGET_BEHAVIOR=0
-lworkerfs.js
-sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sFULL_ES3=1
-sASYNCIFY=1 -sGL_UNSAFE_OPTS=0 -sGL_ENABLE_GET_PROC_ADDRESS=1
```

`DISABLE_DEPRECATED_FIND_EVENT_TARGET_BEHAVIOR=0` is required. Emscripten
6.0.1 enables the newer target lookup by default, and that lookup resolves only
DOM selectors; in a worker there is no DOM. The older `findCanvasEventTarget`
maps target 0 to `Module.canvas`, which is how the window layer addresses the
transferred OffscreenCanvas.

`-lidbfs.js` was removed; nothing mounts IDBFS and the OPFS cache is gone.

`-sOFFSCREENCANVAS_SUPPORT=1` from the plan is **not** set. In Emscripten that
setting is the pthread canvas-transfer and explicit-swap-control path. Here the
whole module already runs in a dedicated worker, so the HTML5 WebGL API creates
the context on `Module.canvas` directly with implicit swap. The flag would not
change this path and would pull in pthread-specific wiring.

## Worker architecture

```text
main thread                              dedicated worker
-----------                              ----------------
WorkerEngineHost                         engine.worker.ts
  boot: preflight ping  ───────────────▶  OffscreenCanvas WebGL2 probe
        transferControlToOffscreen ───▶  Module.canvas
        PK3 File objects (no copy)  ───▶  preRun: WORKERFS @ /jka/base
  RPC queue (worker side)  ◀───────────▶  JKA_* ccall via Asyncify
  cached status/scoreboard  ◀───────────  status 250 ms, scoreboard 500 ms
  log buffer                ◀───────────  batched print/printErr
```

Rules kept from the earlier phases:

- The worker serializes every long/async wasm call with the same
  `runExclusive` queue. `play` is single-flight on both sides. Short
  synchronous calls (status/scoreboard polls, cvar, follow, free-cam) run only
  while no async call is in flight; scoreboard reads require `demo=1` and
  `state=CA_ACTIVE`.
- `JKA_SetWorkerMode(1)` is set after runtime init, so the scan/seek loops do
  not `emscripten_sleep` in the worker. Map loads still Asyncify-yield through
  the renderer's eager shader compile.
- The `JKA_DemoInfo`, play, stop and seek calls remain the serialized setup
  path; no new cgame call was added to `JKA_StatusJson`.
- The engine main loop in the worker is Emscripten's `setTimeout`-backed loop.
  `WIN_Present` does not swap: an OffscreenCanvas WebGL frame is presented when
  the worker task yields.

### Filesystem layout

| Path | Backing | Contents |
|---|---|---|
| `/jka/base` | WORKERFS, read-only | retail and mod `.pk3` files |
| `/jka/base/demos` | WORKERFS, read-only | not used by the app (demos are writable) |
| `/userdata/base` | MEMFS, writable | `fs_homepath` config and added map PK3s |
| `/userdata/base/demos` | MEMFS, writable | the selected demo |

`WORKERFS` reads through `FileReaderSync` in the worker, so the PK3 bytes stay
in the browser's File objects instead of a second wasm-heap copy. The engine
still reads the PK3s synchronously through the Emscripten VFS.

Two WORKERFS details matter:

- The `files` mount option takes **File/Blob objects** (it reads `.size` and
  `.slice` directly). `{ name, data }` wrappers belong to the `blobs` option;
  passing wrappers in `files` creates nodes with an undefined size and breaks
  seeks (symptom: `Cannot convert undefined to a BigInt`).
- Do **not** create an empty `mpdefault.cfg` in `/userdata/base`. The homepath
  directory is searched before the PK3s, so a zero-length file shadows the real
  `mpdefault.cfg` inside `assets2.pk3` and `FS_InitFilesystem` aborts with
  `Couldn't load mpdefault.cfg`. Retail assets supply it.

## Host selection and fallback

`createEngineHost()` picks the worker host when all of these hold:

- `Worker` and `OffscreenCanvas` exist;
- `HTMLCanvasElement.prototype.transferControlToOffscreen` exists;
- a main-thread WebGL2 probe succeeds;
- `?worker=0` is not set.

`WorkerEngineHost.boot()` then sends a `ping`. The worker answers only after
creating a WebGL2 context on a throwaway `OffscreenCanvas`. If that fails, the
host throws `WorkerUnsupportedError` **before** the canvas is transferred, so
the app can retry with `MainThreadEngineHost` in the same page. A failure after
the transfer cannot fall back without a reload; the UI shows the error and the
log.

The main-thread path still copies PK3s into MEMFS and shows a compatibility
notice in the launcher. Before transferring the canvas, `WorkerEngineHost`
fetches the staged `openjk.x86.js` and checks for the `WORKERFS` filesystem
name in the glue. A pre-Phase-3 engine has only IDBFS, so it is rejected before
the irreversible transfer and the app falls back to the main-thread host
instead of hanging. The smoke page performs the same check. Both paths use the
same engine build, boot arguments, shader profile, seek code and
`EngineHostApi`; the UI has no host-specific branches.

## OPFS removal

- `app/src/fs/assetCache.ts` no longer writes or reads assets. It exports only
  `clearLegacyAssetCache()`, which removes `jka-demo-player/assets` from OPFS
  without creating anything.
- The app calls the cleanup once on startup and again from Settings → Local
  data. Parsed summaries remain in IndexedDB and can still be cleared there.
- The launcher no longer shows **Use cached assets**; **Use last folder** and
  the file-input fallback remain.
- `assetCacheKey` became `assetSetKey` in `app/src/fs/signature.ts`; it is only
  used to compare the asset set a running engine was mounted with.

## Verification status

Done in this checkout:

1. Patches `0001`–`0008` apply from the pinned worktree; `win_emscripten.cpp`
   is copied and compiled.
2. `npm --prefix app run typecheck` and `npm --prefix app run build` pass.
3. `worker-smoke.html` rendered the splash to the OffscreenCanvas in headful
   Chromium. The full app booted and played both a custom-map demo and a
   retail-map demo. The custom map PK3 (not on the pure list) produced no
   timeline; the retail demo scanned normally (18,688 messages, 75 keyframes).
4. `JKA_PROFILE memory` with the worker: `memfs=8,104`, `mounted=1,225,008,939`,
   `storageUsage=73,728`. The Phase 0 1.225 GB MEMFS and ~1.14 GB OPFS copies
   are gone.
5. Boot, Check map, Play, Restart, forward seek, backward seek and Stop were
   measured. Worker Play is **5.9–8.3 s** depending on the map;
   `CL_InitCGame` 4.54–6.86 s. Restart is **7.8–10.8 s** on the full-reload
   path. Forward seek is **1 ms**; backward seek is **~8 s**. Stop is
   **1.5–1.7 s**, full teardown; no worker abort in the latest runs, fallback
   abort.
6. The clean engine build was rerun end-to-end from the pinned worktree with
   the final `0001`–`0008` patch set and staged successfully.
7. Brave Task Manager: worker **130 MB idle / 290–298 MB loaded**; fallback
   **1.3–1.4 GB**.

Remaining, for the next phases:

- **Phase 4:** prewarm/prepare, keep-warm Stop and Release. Current Play after
  Check map repeats the map/cgame load (8 s); Stop performs a 1.5 s full
  teardown; Restart is 7.8–10.8 s.
- **Phase 5:** backward seek is 7.99 s (`path=keyframe`); forward is 1 ms.
- **Phase 3 edge cases:** fallback seek/Stop, old OPFS cleanup on a dirty
  profile, mod demos, second map/demo switch. The custom-map pure-list scan
  issue is documented.

Do not read the worker Play number as a Phase 4 result; prewarm/keep-warm is not
implemented yet.

## Known risks

- **SDL in the worker.** The window layer avoids SDL video/input entirely, but
  SDL is still linked for the main-thread fallback. The worker skips `IN_Frame`,
  `IN_Shutdown` and `SDL_Quit`; any new SDL call in the worker path would break
  the DOM-free assumption.
- **WORKERFS read performance.** Reads go through `FileReaderSync`. The
  central-directory cache removes the worst case (85 s → 2.2 s boot), but file
  data still pays per-read overhead: worker Play is 6.4 s vs about 3.2 s for
  the MEMFS main-thread path. Mods with many small files may be slower.
- **Headless Chromium on this host has no WebGL2** (main thread or worker).
  The gate and measurements use headful Chromium; a real desktop Brave/Chrome
  is the target.
- **Custom map PK3s can break the demo scan.** An added `asms.pk3` was “not on
  the pure list”; the first gamestate's map/cgame load left the scan with
  `messages=0`, so no summary/duration/timeline. Playback worked. Phase 4/5
  must either keep the scan's demo handle valid across the warm map load or
  bypass the pure-list restart for local demos.
- **Stop is still the full teardown path.** Brave completed it in 1.54 s with
  no abort, but headful Chromium 149 and the fallback aborted Asyncify in the
  same code. Phase 4's keep-warm Stop/Release must replace it rather than rely
  on the race.
- **OffscreenCanvas presentation.** The worker relies on task-boundary
  presentation with `preserveDrawingBuffer=0`; no explicit commit is used.
- **Gamma.** OffscreenCanvas has no window gamma ramp. `deviceSupportsGamma` is
  false, so the renderer bakes `r_gamma` into lightmaps at load; runtime changes
  remain the app's canvas CSS filter.
- **Canvas transfer is irreversible.** The preflight only catches missing
  worker/WebGL2 APIs. A later engine boot failure needs a page reload.
- **Worker debugger visibility.** Worker logs are forwarded and batched; a
  crash before the log flush can lose the last few lines.

## Files

- `engine/scripts/build-mp-wasm.sh`
- `engine/platform/win_emscripten.cpp` (new)
- `engine/platform/web/worker-smoke.html`, `engine/platform/web/engine-worker.js` (new)
- `engine/patches/0008-emscripten-worker-window.patch` (new)
- `app/src/engine/engine.worker.ts`, `WorkerEngineHost.ts`, `host.ts`,
  `shared.ts`, `protocol.ts` (new/refactored)
- `app/src/engine/EngineHost.ts`
- `app/src/fs/assetCache.ts`, `app/src/fs/signature.ts`
- `app/src/App.tsx`, `app/src/components/Launcher.tsx`,
  `app/src/components/SettingsPanel.tsx`, `app/src/styles.css`
