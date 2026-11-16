# Browser MVP (M4)

> **Renderer note:** `master` replaces the `rd-vanilla` renderer with the
> statically linked `rd-rend2` renderer on a WebGL2/GLES3 context. The rd-rend2
> build uses Asyncify and a loading overlay so map checking and Play do not
> freeze the browser. The previous
> `rd-vanilla` version is preserved on branch `rd-vanilla`. See
> [rd-rend2-spike.md](./rd-rend2-spike.md) for the build and current
> limitations. The `rd-vanilla` evidence below is the M4 baseline.

**Status:** Complete for the offline base-demo target. A React + Vite + TypeScript shell runs a three-phase wizard (assets → demo → map), validates and stages the retail assets, boots the wasm engine, parses the demo's map name, requests a map `.pk3` when the map is absent, and provides play/pause/restart, fullscreen, status, logs and error handling.
**Date:** 2026-11-16
**Scope:** Local picker, three-phase wizard, demo map resolution, map PK3 injection, staging progress, engine host, player controls, static build. M5 adds follow/free camera, external HUD and settings; M6 adds seeking, a model-anchored follow camera, pointer-lock mouse look, event-backed scores/deaths and custom vitals. See [m5.md](./m5.md) and [m6.md](./m6.md).

---

## 1. Result

| Check | Result |
|---|---|
| React/Vite/TS production build | **Pass** — `app/dist` generated |
| FSA directory selection | Implemented; manual/browser test |
| File-input fallback | **Pass** — automated with CDP file injection |
| Asset validation (`assets0..3`, `productid.txt`) | **Pass** — 4/4, productid found |
| Demo discovery + `.dm_26` framing check | **Pass** — 1 demo, framing accepted |
| Demo map parsing (`JKA_ParseDemoMap`) | **Pass** — `mp/duel1` and `ffa_YavinPlaza` read from the first gamestate |
| Map present in assets (`JKA_HasMap`) | **Pass** — `mp/duel1` found in `assets0.pk3` |
| Missing-map prompt + map `.pk3` | **Pass** — `ffa_YavinPlaza` reported missing, PK3 added, `JKA_RestartFS()` reloaded |
| Staging with progress | **Pass** — 1.14 GB (assets0..3 + demo), 100% |
| Engine boot + cgame | **Pass** |
| Playback | **Pass** — `mp/duel1` and `ffa_YavinPlaza`; state `Playing`, demo time advancing |
| Pause/restart/stop | Wired to the M3 bridge; pause acknowledged in interactive use |
| Fullscreen | Wired to the stage element |
| Log download | Implemented |
| No upload / no external requests | **Pass** — all reads are local files |
| No proprietary assets committed | **Pass** — `app/public/engine` is gitignored |

---

## 2. Running it

### 2.1 rd-rend2 build (this branch)

```bash
BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
  WORK=/tmp/opencode/rend2/final-work \
  BUILD=/tmp/opencode/rend2/final-build \
  OUT=/tmp/opencode/rend2/final-out \
  engine/scripts/build-mp-wasm.sh

scripts/stage-engine.sh /tmp/opencode/rend2/final-out
cd app && npm run dev      # http://127.0.0.1:5173
```

Add `?quality=low` for software rasterisers (800×600, `r_picmip 3`, 10 fps).

### 2.2 GitHub Pages

`.github/workflows/deploy-pages.yml` builds the rd-rend2 engine and the app and
deploys `app/dist` on pushes to `master`. See
[github-pages.md](./github-pages.md) for the one-time Pages setup.

### 2.3 rd-vanilla baseline

```bash
# 1. Build the engine for the app (no preloaded fixture; the app stages PK3s).
cd /path/to/jka-demo-player
BUILD_RENDERER=1 BUILD_CGAME=1 NO_PRELOAD=1 \
  WORK=/tmp/opencode/m4/work-build BUILD=/tmp/opencode/m4/build \
  OUT=/tmp/opencode/m4/engine-web \
  engine/scripts/build-mp-wasm.sh

# 2. Copy the engine artifacts into the app.
scripts/stage-engine.sh /tmp/opencode/m4/engine-web

# 3. Run the app.
cd app
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # static output in app/dist
```

The engine build **must** use `NO_PRELOAD=1`. The app stages the user's assets
and relies on `mpdefault.cfg` inside the retail PK3s; a preloaded `.data` fixture
is not used.

---

## 3. Architecture

```text
app/
├── src/
│   ├── App.tsx                    launcher/player state machine
│   ├── engine/EngineHost.ts       Emscripten module + JKA_* bridge
│   ├── fs/sources.ts              FSA directory + file-input fallback
│   ├── fs/validate.ts             assets, productid, demo framing
│   ├── fs/stage.ts                MEMFS staging + progress
│   ├── fs/handles.ts              IndexedDB directory handle
│   ├── components/                Launcher, Player, overlays, error
│   └── styles.css
├── public/engine/                 gitignored built .js/.wasm
└── dist/                          static build
```

### 3.1 Selection wizard

The launcher has three steps:

1. **Assets** — `showDirectoryPicker()` (primary) selects `GameData` or `base`;
   the app finds `base/` and enumerates `assets*.pk3` and `demos/*.dm_26`.
   The fallback `<input type=file multiple accept=".pk3,.dm_26">` supports
   browsers without FSA. The directory handle is persisted in IndexedDB and
   re-permissioned on demand.
2. **Demo** — pick one of the demos found in the folder or choose another
   `.dm_26` file directly.
3. **Map** — the chosen demo is parsed and checked; a map `.pk3` is requested
   only when the map is absent.

Selecting a folder does not stage every PK3 in it: only `assets0..3.pk3` are
staged, so custom maps and mods in the same folder do not inflate memory use.

### 3.2 Validation

- `assets0.pk3` … `assets3.pk3` must all be present.
- `productid.txt` is searched in `assets2.pk3` (central-directory bytes).
- A demo is optional during the assets step; the demo step requires one.
- Wrong protocol extensions produce a warning.
- The first demo record is checked for a plausible length and sequence.

### 3.3 Staging

- Runs inside the Emscripten `preRun` before `Com_Init`.
- Stages the four validated retail PK3s plus the chosen demo.
- Reads each `File` with `arrayBuffer()`, writes with
  `FS.createDataFile(..., canOwn=true)`.
- Writes PK3s to `/jka/base` and demos to `/jka/base/demos`.
- Reports bytes loaded/total; cancel aborts and offers a reload (the engine
  cannot unload).
- `/userdata` is a MEMFS directory in this build; IDBFS persistence is deferred
  until the engine writes config/saves.

### 3.4 Demo map resolution

After the engine boots (still on the map step), the app calls the bridge:

| Call | Purpose |
|---|---|
| `JKA_ParseDemoMap(name)` | Reads `demos/<name>.dm_26`, decodes the first gamestate with the engine's MSG/Huffman reader, returns `mapname` from `CS_SERVERINFO` |
| `JKA_HasMap(map)` | Opens `maps/<map>.bsp` through the pak search path (`FS_FOpenFileRead`), so PK3 contents are seen |
| `JKA_RestartFS()` | Re-scans `/jka/base` after a map `.pk3` is written into MEMFS |

If the map is present, the wizard shows **Map ready** and Play starts the demo.
If it is absent, the wizard asks for the map `.pk3`; the file is written to
`/jka/base` and the file system is restarted, then the map is re-checked before
Play is enabled. Nothing is written back to the user's folder.

### 3.5 Playback controls

| Control | Bridge |
|---|---|
| Play | `JKA_PlayDemo(name)` |
| Pause / Resume | `JKA_SetPaused(1/0)` + `JKA_Resume()` |
| Restart | `JKA_PlayDemo(name)` |
| Stop | `JKA_StopDemo()` |
| Status | `JKA_StatusJson()` every 250 ms |
| Seek | `JKA_DemoInfo(name)` once, then `JKA_SeekDemo(name, demoInfo.first + position)` |
| Fullscreen | browser Fullscreen API on the stage |

The UI shows map, state, demo time, paused/ended overlays, an engine log panel
and a downloadable log. Play and Seek use async `ccall` calls with a progress
overlay so the tab stays responsive.

### 3.5.1 M6 player additions

Beyond the M4 controls, the player has a seek timeline, a Follow camera anchored
to the followed player model (first-person for the POV client, 100 units behind
for other players), Pointer Lock mouse look in free cam, an event-backed
`kills/deaths` scoreboard, and a custom Health/Armor/saber vitals strip. The
score strip's clock is the map/game time (`cg.time - cgs.levelStartTime`), not
the demo clock. The in-game status HUD, HUD files, crosshair, scores, timer and
radar are disabled with `cg_drawStatus 0`, `cg_hudFiles 0`,
`cg_drawCrosshair 0`, `cg_drawScores 0`, `cg_drawTimer 0` and `cg_drawRadar 0`.
The map step shows a spinner while the demo timeline is scanned and caches the
result per file. See [m6.md](./m6.md) for the bridge calls and known limits.

### 3.6 Error handling

Validation, picker, staging, engine boot, wasm abort and missing-demo errors
produce an in-app error panel with the last engine log lines and a reload path.
The taxonomy follows the architecture document (`ASSETS_*`, `DEMO_*`,
`ENGINE_BOOT_FAILED`, etc.).

---

## 4. Evidence

Automated flows (CDP, file-input fallback, `?norefresh=1` for capture):

Base demo with a map inside the retail assets:

```text
assets 4/4 · step 2 · demo m05_base.dm_26
step 3: Map ready · mp/duel1 · FOUND
Play demo → state Playing · demo time advancing
```

Custom-map demo, map absent from assets:

```text
assets0..3 + "stryx vs myriad r2.dm_26"
step 3: Map missing · ffa_YavinPlaza · NOT IN SELECTED ASSETS
add ffa_YavinPlaza.pk3 → JKA_RestartFS() → Map ready · FOUND
Play demo → state Playing · demo time 0:03
```

Selecting all 36 PK3s in the base folder still staged only `assets0..3` and
reached Map ready, confirming the folder is not staged wholesale.

- Launcher capture: `/tmp/opencode/m4-ui.png`.
- Map-ready and playing captures: `/tmp/opencode/m4-wizard-final.png`,
  `/tmp/opencode/m4-map-final.png` (captured in `?norefresh=1` mode, so the
  HUD texture atlas is not representative — the normal frame is the M3 capture).
- Runtime canvas (same engine/demo, captured by the M3 verifier):
  `/tmp/opencode/m3/artifacts-shot/browser-demo.png`.
- Native comparison: `/tmp/opencode/m2/shots/native-vs-browser-final.png`.

The headless test machine renders through SwiftShader, so full-motion capture
and screenshots of the player surface are slow; the runtime frame is captured
by the M3 harness, and the React shell is verified through its DOM state and
launcher capture.

---

## 5. Limitations

- **Audio:** the M4 engine is built with `s_initsound 0`. The player has no audio
  yet; audio unlock/engine mixing is deferred. This is the main M4 gap.
- **Input:** SDL receives canvas/window events, but WASD/mouse behavior has not
  been validated in the React shell. Controls currently focus on playback.
- **FSA automation:** the directory picker cannot be driven headlessly; the
  fallback file input was used for the automated run.
- **Persistence:** directory handles persist; engine config/saves are MEMFS-only
  until IDBFS is enabled.
- **Rendering:** SwiftShader on the test host; no hardware-GPU frame-time
  baseline yet.
- **Memory:** `assets0..3` plus the demo are staged into MEMFS (~1.2 GB JS heap).
- **Map resolution:** the map name comes from the demo's first gamestate; a
  truncated demo shows an explicit map-read error instead of a guess.
- **Map PK3:** the added PK3 must contain `maps/<map>.bsp` for the map to be
  accepted; the wizard stays on the map step otherwise.
- **Seek:** timeline scrubbing replays the demo to the requested time.
- **No inspector:** the event inspector is later work; follow/free camera,
  seeking and external HUD are in [m5.md](./m5.md) and [m6.md](./m6.md).
- The `r_m2_pause` bridge is still a test/capture hook; normal UI pause uses it.

---

## 6. M5: playback controls and HUD

Implemented:

- Follow-player first-person model camera and free-fly camera with rebindable
  keys and Pointer Lock mouse look.
- Persistent settings for `cg_fov` (default 97), scoreboard/scores/timer toggles
  and free-camera bindings.
- External scoreboard panel, top-center score strip and timer.
- In-game scoreboard, scores, timer, radar, status HUD, HUD files and crosshair
  disabled.

See [m5.md](./m5.md) for the controls, bridge calls and evidence. M6 adds
seeking, event-backed kills/deaths and custom vitals; see [m6.md](./m6.md).

Remaining M5+ work:

1. Engine speed control and reliable pause/step (`cl_freezeDemo` or custom flag).
2. Seeking beyond replay-from-start (keyframe/index) on long demos.
3. Hardware-GPU performance and memory baseline.
4. Audio unlock and engine sound path if kept in scope.
