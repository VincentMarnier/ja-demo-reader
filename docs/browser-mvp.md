# Browser MVP (M4)

**Status:** Complete for the offline base-demo target. A React + Vite + TypeScript shell selects a local `GameData` folder (or files), validates and stages the retail assets, boots the wasm engine, and provides play/pause/restart, fullscreen, status, logs and error handling.
**Date:** 2026-11-16
**Scope:** Local picker, validation, staging progress, engine host, player controls, static build. No inspector, seek or camera controls (M5/M6).

---

## 1. Result

| Check | Result |
|---|---|
| React/Vite/TS production build | **Pass** — `app/dist` generated |
| FSA directory selection | Implemented; manual/browser test |
| File-input fallback | **Pass** — automated with CDP file injection |
| Asset validation (`assets0..3`, `productid.txt`) | **Pass** — 4/4, productid found |
| Demo discovery + `.dm_26` framing check | **Pass** — 1 demo, framing accepted |
| Staging with progress | **Pass** — 1.14 GB, 100% |
| Engine boot + cgame | **Pass** |
| Playback | **Pass** — map `mp/duel1`, state `Playing`, demo time advanced 0:15 → 0:25 |
| Pause/restart/stop | Wired to the M3 bridge; pause acknowledged in interactive use |
| Fullscreen | Wired to the stage element |
| Log download | Implemented |
| No upload / no external requests | **Pass** — all reads are local files |
| No proprietary assets committed | **Pass** — `app/public/engine` is gitignored |

---

## 2. Running it

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

### 3.1 Selection

- `showDirectoryPicker()` is the primary path. The user selects `GameData` or
  `base`; the app finds `base/` and enumerates `assets*.pk3` and `demos/*.dm_26`.
- The fallback `<input type=file multiple accept=".pk3,.dm_26">` supports
  browsers without FSA. The directory handle is persisted in IndexedDB and
  re-permissioned on demand.

### 3.2 Validation

- `assets0.pk3` … `assets3.pk3` must all be present.
- `productid.txt` is searched in `assets2.pk3` (central-directory bytes).
- At least one `.dm_26` is required; wrong protocol extensions produce a warning.
- The first demo record is checked for a plausible length and sequence.

### 3.3 Staging

- Runs inside the Emscripten `preRun` before `Com_Init`.
- Reads each `File` with `arrayBuffer()`, writes with
  `FS.createDataFile(..., canOwn=true)`.
- Writes PK3s to `/jka/base` and demos to `/jka/base/demos`.
- Reports bytes loaded/total; cancel aborts and offers a reload (the engine
  cannot unload).
- `/userdata` is a MEMFS directory in this build; IDBFS persistence is deferred
  until the engine writes config/saves.

### 3.4 Playback controls

| Control | Bridge |
|---|---|
| Play | `JKA_PlayDemo(name)` |
| Pause / Resume | `JKA_SetPaused(1/0)` + `JKA_Resume()` |
| Restart | `JKA_PlayDemo(name)` |
| Stop | `JKA_StopDemo()` |
| Status | `JKA_StatusJson()` every 250 ms |
| Fullscreen | browser Fullscreen API on the stage |

The UI shows map, state, demo time, paused/ended overlays, an engine log panel
and a downloadable log.

### 3.5 Error handling

Validation, picker, staging, engine boot, wasm abort and missing-demo errors
produce an in-app error panel with the last engine log lines and a reload path.
The taxonomy follows the architecture document (`ASSETS_*`, `DEMO_*`,
`ENGINE_BOOT_FAILED`, etc.).

---

## 4. Evidence

Automated flow (CDP, file-input fallback):

```text
validated: true
validation body: 4/4 PK3s, 1 demo, OK
Playing: map mp/duel1, state Playing
demo time: 0:15 → 0:25
```

- Launcher capture: `/tmp/opencode/m4-ui.png`.
- Player shell capture: `/tmp/opencode/m4-playing.png` (map, state, time and
  controls visible; captured under the test-only `?norefresh=1` mode, so the HUD
  texture atlas in that capture is not representative — the normal frame is the
  M3 capture below).
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
- **Memory:** the full retail set is staged into MEMFS (~1.2 GB JS heap).
- **No seek/camera/inspector:** M5/M6.
- The `r_m2_pause` bridge is still a test/capture hook; normal UI pause uses it.

---

## 6. Next: M5

1. Engine speed control and reliable pause/step (`cl_freezeDemo` or custom flag).
2. Replay-based seek with an index and progress UI.
3. Camera modes: recorded/first-person, third-person, freecam.
4. FOV, hide HUD/view model.
5. Hardware-GPU performance and memory baseline.
6. Audio unlock and engine sound path if kept in scope.
