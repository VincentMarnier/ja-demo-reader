# Browser demo playback (M3)

**Status:** Complete for a base-game `.dm_26` demo. The engine reaches `CA_ACTIVE`, advances the demo clock, renders a non-blank frame, makes no network requests after staging, and reports demo end cleanly.
**Date:** 2026-11-16
**Scope:** MEMFS staging, `demo <name>` playback, headless CDP verification, failure modes. No React/frontend.

---

## 1. Result

| Check | Result |
|---|---|
| PK3 + demo staged into MEMFS | **Pass** — 4 retail PK3s + demo |
| `productid.txt` present in `assets2.pk3` | **Pass** |
| `clc.demoplaying` | **Pass** (`demo: 1` in status) |
| `CA_PRIMED` → `CA_ACTIVE` | **Pass** (`state: 7` → `8`) |
| cgame loaded | **Pass** — `VM_Create: cgamex86.wasm succeeded` |
| `serverTime` advances | **Pass** — 9/9 samples with `r_norefresh`; 1 advance in 60 s with full SwiftShader rendering |
| First frame renders | **Pass** — `/tmp/jka-demo-player/m3/artifacts-shot/browser-demo.png` (325 KB) |
| No network requests after staging | **Pass** — none |
| Demo end | **Pass** — `ended: 1`, state 1 (`CA_DISCONNECTED`) |
| No wasm trap | **Pass** |

**M3: PASS.**

---

## 2. Harness and verifier

### 2.1 `engine/platform/web/demo.html`

A minimal page (no framework) that:

- stages `/assets0..3.pk3` and `/demos/<name>.dm_26` into `/jka/base` before `Com_Init`;
- boots with `cl_renderer=rd-vanilla`, `fs_basepath=/jka`, `fs_homepath=/userdata`, `cl_allowDownload 0`;
- issues `+demo <name>`;
- polls `JKA_StatusJson()` and exposes `window.__m3.status`;
- logs `M3STATUS {...}` for CDP/console observers;
- preserves the WebGL drawing buffer for evidence capture.

Query parameters:

| Parameter | Meaning |
|---|---|
| `demo` | demo name, default `demo` |
| `timescale` | `com_timescale`, default `1` |
| `fps` | `com_maxfps`, default `10` |
| `norefresh=1` | sets `r_norefresh 1` for a rendering-free clock test |
| `pause=1` | sets `r_m2_pause 1` to stop after the first active frame (test capture) |

### 2.2 `engine/platform/jka_bridge.cpp`

A narrow wasm ABI, compiled into the engine:

```c
const char *JKA_StatusJson(void);  /* state, demo, serverTime, snapTime,
                                      clientNum, map, ended */
void JKA_PlayDemo(const char *name);
void JKA_StopDemo(void);
void JKA_SetPaused(int paused);
```

`JKA_StatusJson` is read-only and returns a static buffer. `JKA_PlayDemo` sanitizes nothing beyond an empty check; the harness constrains the name. `JKA_SetPaused` drives the test-only `r_m2_pause` cvar.

### 2.3 `scripts/verify-demo.mjs`

A dependency-free Node 24 script that:

- serves the build and the user's assets on loopback;
- launches Chrome headless (SwiftShader) with CDP;
- navigates the harness, waits for staging and `CA_ACTIVE`;
- samples `serverTime`;
- asserts no requests after staging;
- captures a frame in `PAUSE_FIRST` mode;
- optionally waits for `ended`.

Usage:

```bash
# Playback clock, no rendering (fast, reliable):
WEB_DIR=/tmp/jka-demo-player/m3/web \
ASSETS_DIR=/path/to/JediAcademy/base \
DEMO_FILE=/path/to/demos/demo.dm_26 \
NOREFRESH=1 node scripts/verify-demo.mjs

# First active frame capture:
WEB_DIR=/tmp/jka-demo-player/m3/web \
ASSETS_DIR=/path/to/JediAcademy/base \
DEMO_FILE=/path/to/demos/demo.dm_26 \
PAUSE_FIRST=1 node scripts/verify-demo.mjs

# Demo-end path:
WEB_DIR=/tmp/jka-demo-player/m3/web \
ASSETS_DIR=/path/to/JediAcademy/base \
DEMO_FILE=/path/to/demos/demo.dm_26 \
NOREFRESH=1 WAIT_END=1 TIMESCALE=20 node scripts/verify-demo.mjs
```

`CHROME`, `OUT_DIR`, `DEMO`, `TIMEOUT_MS` are optional environment overrides.

---

## 3. Evidence

### 3.1 Staging and state

```text
staging /assets0.pk3 … /demos/demo.dm_26
staging complete
M3STATUS {"state":7,"demo":1,...,"clientNum":2,"map":"maps/mp/duel1.bsp","ended":0}
M3STATUS {"state":8,"demo":1,"serverTime":1032552976,...}
```

### 3.2 Clock

Rendering-free run (`r_norefresh 1`):

```text
serverTime samples: 1032552507, 1032553530, 1032554530, 1032555512,
                    1032556530, 1032557530, 1032558530, 1032559530,
                    1032560545, 1032561546
serverTime advances: 9 of 9
```

Full-render run (SwiftShader): one 400–5000 ms advance per 60 s sampling window. This is a software-rasteriser frame-time limit, not a playback stall.

### 3.3 Frame

`PAUSE_FIRST=1` captures the first active frame:

```text
screenshot: …/artifacts-shot/browser-demo.png 325466 bytes
```

It shows `mp/duel1`, textured floor/walls, the recorded player, the second duellist, sabers, HUD bars, portrait and `Score: 0/0`. See also the M2 comparison in [webgl-bringup.md](./webgl-bringup.md).

### 3.4 No network

Every request is logged by the loopback server. After staging, the list is empty:

```text
requests after staging: (none)
```

The engine's `NET_Init` remains disabled, and `cl_allowDownload` is `0`. The only HTTP traffic is the asset/demo staging before boot.

### 3.5 Demo end

```text
waiting for demo end...
demo ended, state 1
```

`CL_DemoCompleted` under Emscripten sets `jka_demoEnded`, disconnects, stops sounds and returns, instead of calling `UIVM_SetActiveMenu` (there is no UI VM). `JKA_StatusJson` reports `ended: 1`.

---

## 4. Failure modes

| Input | Observed/expected behavior | Action |
|---|---|---|
| `demo missing` | `couldn't open demos/missing.dm_26`; engine stays disconnected | Show "demo file not found" |
| Truncated `.dm_26` | `Demo file was truncated.`; `CL_DemoCompleted`/disconnect | "re-download or re-record" |
| Wrong extension (`.dm_27`, `.dm_25`) | `FS_IsDemoExt` rejects it; not found on the demo path | "not a protocol-26 demo" |
| Demo on a mod map without mod PK3s | `FS_ConditionalRestart`/map load fails; `Couldn't load maps/...` | "supply the mod/map PK3s" |
| Missing `productid.txt` | Demo/restricted install behavior; the verifier warns | "select the complete retail assets" |
| Empty assets / no PK3s | `FS_Startup` lacks `mpdefault.cfg` and aborts | "select the `base` folder" |

Only the missing-demo and truncated cases are cheaply testable without touching the user's data; the table records source-derived expectations for the rest.

---

## 5. Compatibility notes

- **Target:** base-game (`gamename basejka`), protocol 26, stock map, base cgame.
- **Mod demos:** require the matching mod directory/PK3s and cgame. `cl_allowDownload 0` means missing pures are not fetched.
- **Map:** the test demo uses `mp/duel1`; any stock map present in `assets0.pk3` is equivalent.
- **Paths:** demo must be at `/jka/base/demos/<name>.dm_26`; the engine prepends `demos/` and appends `.dm_26`.
- **Name:** sanitize to `[A-Za-z0-9._-]+`; no path separators.
- **Pure paks:** the baseline demo references a community pak on the server; playback of `mp/duel1` succeeds without it.

---

## 6. Limitations

- SwiftShader only; full-render frame advance is slow. The clock test uses `r_norefresh 1` to isolate playback from rasterisation cost.
- Assets are served from a local test server and staged by the harness; the product picker is M4.
- UI, audio and input remain disabled/unwired.
- The screenshot is the first active frame, not a deterministic seek target.
- The verifier relies on Chrome's headless shell and CDP; a hardware-GPU run is still needed for performance.

---

## 7. Next: M4

1. Replace the harness fetch loop with `DirectorySource`/`FileListSource` and progress/cancel.
2. Persist the directory handle and last demo; re-request permission.
3. Validate the asset set and demo framing in the UI.
4. Add the canvas/player shell, play/pause/restart, fullscreen and audio unlock.
5. Keep the M3 verifier as the end-to-end regression test.
