# Architecture: `jka-demo-player`

**Status:** Proposed architecture. Nothing in this document is implemented yet.
**Related:** [research.md](./research.md) · [milestones.md](./milestones.md)

---

## 1. Goals and non-goals

### 1.1 Goals

- Open-source, browser-based player for Jedi Academy multiplayer demos (`.dm_26`).
- The user selects a local `GameData` directory and a local demo; neither is uploaded.
- The app runs entirely in the browser, with no backend for the initial version.
- The engine is upstream OpenJK multiplayer (`codemp`) compiled to WebAssembly with Emscripten.
- Rendering is WebGL through OpenJK's `rd-vanilla` id Tech 3 renderer, adapted to the browser.
- The reported `jka-web` rendering issues are treated as an input to the renderer design, not as something a different engine source automatically fixes.
- Playback can pause, restart, and eventually seek, change camera, and show match information.
- The project is GPLv2-compatible and distributes no proprietary game assets.

### 1.2 Non-goals (initially)

- Playing single-player campaigns.
- Connecting to live servers or hosting a server.
- Distributing PK3s, demos, or any Raven/Lucasfilm assets.
- Mobile support.
- A backend, accounts, cloud storage, or telemetry.
- A from-scratch demo parser/renderer.
- Instant random-access scrubbing in the first release.

### 1.3 Design principles

1. **Local-only by construction.** No upload path exists. The app should work with the network disabled after the page loads.
2. **Reuse the engine, not a reimplementation.** The demo format and game simulation are already implemented in `codemp`; our job is to host it.
3. **Vertical slices first.** Prove the MP engine and demo playback before building the product UI.
4. **Explicit compatibility.** A demo that needs a mod/map is rejected with a precise message, not a corrupted render.
5. **No hidden network.** Stub or disable engine networking in the demo build; use a restrictive CSP.
6. **GPLv2 throughout.** Engine, port, and browser shell share one license and one source repository.
7. **Measured, not assumed.** Performance and memory claims come from the harness, not the README.

---

## 2. System context

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Browser tab                                                          │
│                                                                      │
│  ┌─────────────────────────────┐      ┌───────────────────────────┐  │
│  │ React + Vite + TypeScript   │      │ Emscripten module         │  │
│  │                             │      │                           │  │
│  │  Launcher / file picker     │─────▶│  OpenJK MP engine (wasm)  │  │
│  │  Playback controls          │      │  + rd-vanilla renderer    │  │
│  │  Camera / inspector UI      │◀─────│  + cgame / optional UI    │  │
│  │  Error / progress           │      │                           │  │
│  └──────────────┬──────────────┘      └─────────────┬─────────────┘  │
│                 │                                   │                │
│                 │  FS staging before boot           │ sync reads     │
│                 ▼                                   ▼                │
│  ┌─────────────────────────────┐      ┌───────────────────────────┐  │
│  │ Local file access           │      │ Emscripten VFS            │  │
│  │  FSA directory handle       │      │  /jka/base  (MEMFS)       │  │
│  │  <input type=file> fallback │      │  /jka/base/demos (MEMFS)  │  │
│  │  IndexedDB asset cache      │      │  /userdata  (IDBFS)       │  │
│  └─────────────────────────────┘      └───────────────────────────┘  │
│                                                                      │
│  No backend. No asset upload. No game data in the repository.        │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Trust boundaries

| Boundary | Trust | Notes |
|---|---|---|
| Browser ↔ local files | User-granted | Read-only selection; the app must not write to `GameData` |
| Browser ↔ network | Untrusted / disabled | Static assets only; no analytics or uploads |
| JS ↔ wasm | Same origin | The engine is GPLv2 code shipped by the app |
| Demo ↔ engine | Untrusted input | A malformed demo must fail safely, not crash the tab |
| PK3 ↔ engine | Untrusted input | The engine's zip parser is old; validate size/name and isolate failures |

---

## 3. Repository layout

```text
jka-demo-player/
├── app/                          # React + Vite + TypeScript shell
│   ├── src/
│   │   ├── components/           # Launcher, Player, Timeline, Inspector
│   │   ├── engine/               # EngineHost, bridge, state machine
│   │   ├── fs/                   # Local file sources, staging, validation
│   │   ├── playback/             # Controller, clock, camera commands
│   │   └── lib/                  # errors, formatting, logging
│   └── vite.config.ts
├── engine/                       # OpenJK fork + Emscripten port (GPLv2)
│   ├── codemp/                   # OpenJK multiplayer engine, cgame, ui, rd-vanilla
│   ├── shared/                   # OpenJK shared platform/qcommon code
│   ├── platform/                 # New Emscripten platform layer + build scripts
│   └── README-PORT.md            # What changed, how to build
├── reference/                    # Read-only third-party checkouts (gitignored)
│   └── jka-web/                  # Platform-layer, FS, and renderer-fix reference
├── docs/
│   ├── research.md
│   ├── architecture.md
│   └── milestones.md
├── public/
│   └── engine/                   # Built .js/.wasm artifacts (gitignored)
├── scripts/                      # Build, verify, license checks
├── LICENSE                       # GPLv2
├── NOTICE.md                     # Engine/port attribution
└── THIRD-PARTY-LICENSES.md
```

### 3.1 Why `engine/` is separate

- The engine is a large C++ tree with its own build system and upstream history.
- It can be a git subtree or submodule; either way, keep the upstream remote and a documented patch set.
- The browser shell should not need to know how the engine is compiled, only the exported ABI.
- Build artifacts are generated, not committed. The release pipeline publishes them with the source offer.

### 3.2 Engine fork policy

- Start from `JACoders/OpenJK` at a pinned commit (`260c59c` for this research).
- Keep `codemp/` and `shared/` as a clean upstream import plus clearly separated port commits.
- Put new Emscripten platform code under `engine/platform/`, not scattered through upstream files. Keep upstream edits behind `__EMSCRIPTEN__` and minimal.
- Use `Virtastic/jka-web` only as a **reference** for platform-layer patterns, filesystem staging, GL flags, and the renderer-fix catalog. Do not copy its engine tree.
- Record every deviation from OpenJK in `engine/README-PORT.md`.
- Do not copy code from `openjk-emscripten` or `q3js` unless the license is clarified.
- Re-verify any renderer fix from `jka-web` against the reported rendering issues before adopting it.

---

## 4. Runtime components

### 4.1 React shell

Responsibilities:

- Present the launcher: select `GameData`, select a demo, show validation and progress.
- Host the canvas and input surface.
- Present playback controls, camera controls, and the inspector.
- Surface errors with actionable messages.
- Never touch the engine's memory directly; use the typed bridge.

Suggested state machine:

```text
Idle
  → SelectingAssets
  → ValidatingAssets
  → StagingAssets        (progress, cancellable)
  → BootingEngine
  → Ready
  → Playing ⇄ Paused
  → Ended
  → Error                 (recoverable: return to Idle)
```

### 4.2 Local file sources

Define a small interface so the UI is independent of the picker:

```ts
interface AssetSource {
  kind: 'directory' | 'files' | 'cache';
  listPk3s(): Promise<LocalFile[]>;
  listDemos(): Promise<LocalFile[]>;
  getFile(name: string): Promise<File>;
}

interface LocalFile {
  name: string;
  size: number;
  file: File;
}
```

Implementations:

| Source | API | Browser | Persistence |
|---|---|---|---|
| `DirectorySource` | `showDirectoryPicker()` | Chromium | Handle stored in IndexedDB; re-permission on next visit |
| `FileListSource` | `<input type="file" multiple>` / `webkitdirectory` | Broad | None; user re-selects |
| `CachedSource` | IndexedDB blob cache | Broad | Survives reload; quota-bound |

Recommended UX:

- Try `showDirectoryPicker()` first; if unavailable, show the file-input flow.
- Remember the directory handle (IndexedDB) and the last demo name.
- After a reload, request permission again; do not assume it is still granted.
- Never write to the selected `GameData` directory. Open it read-only. Saves/config go to browser storage.

### 4.3 Asset validator

Checks before staging:

| Check | Rule | Failure message |
|---|---|---|
| PK3 presence | `assets0.pk3` … `assets3.pk3` | "Select the `base` folder from a complete Jedi Academy install." |
| Product ID | `productid.txt` exists in one PK3 (JKA: `assets2.pk3`) | "This looks like an incomplete or demo-restricted install. Select all four `assets*.pk3` files." |
| Demo extension | `.dm_26` | "This is not a Jedi Academy multiplayer demo (`.dm_26`)." |
| Demo framing | First 8 bytes: length is plausible and not `-1` | "The demo file is empty or truncated." |
| Protocol | `.dm_26` / 26 | "This demo uses a different protocol and cannot be played by this build." |
| Size | Warn above a configurable threshold | "This install is large; the tab may need more memory." |

Do not fully parse the demo in the main thread. A cheap header/framing check is enough for the launcher; deep validation happens in the engine.

### 4.4 Staging layer

The staging layer is the bridge between asynchronous browser file APIs and the engine's synchronous VFS.

```text
select → read File/Blob → exactly-sized Uint8Array → FS.createDataFile(..., canOwn=true)
```

Rules:

- Create `/jka`, `/jka/base`, `/jka/base/demos`, `/userdata`, `/userdata/base` before boot.
- Stage PK3s into `/jka/base`.
- Stage the demo into `/jka/base/demos/<safe-name>.dm_26`.
- Mount IDBFS at `/userdata` only. OpenJK's `fs_homepath` writes config and saves under `/userdata/base`; the base path stays read-only.
- Never mount IDBFS over `/jka/base` (it would try to persist the PK3s).
- Do not use `FS.createLazyFile` on the main thread.
- Track progress across all files, not per file, so the bar does not jump backwards.
- Use `canOwn=true` to avoid a second copy of each PK3.
- Release the original `ArrayBuffer` after staging where possible.
- On cancellation, unmount/delete staged files and return to `Idle`.

### 4.5 Engine host

`EngineHost` owns the Emscripten module lifecycle:

```ts
class EngineHost {
  async load(options: EngineLoadOptions): Promise<void>;
  async startDemo(name: string): Promise<void>;
  pause(): void;
  resume(): void;
  restart(): void;
  setSpeed(rate: number): void;
  getStatus(): DemoStatus;
  destroy(): void;
}
```

It should:

- Load the engine `.js`/`.wasm` with a fixed `locateFile`.
- Register `preRun` for FS setup and `onRuntimeInitialized` for readiness.
- Capture `print`/`printErr` into a ring buffer for diagnostics.
- Expose engine errors as typed `EngineError`s.
- Avoid blocking the React render loop; the engine has its own `emscripten_set_main_loop`.
- Use a single engine instance per tab. Reload the page to reset completely.

### 4.6 Engine ABI

Add a small, stable C ABI in the port. Use `EMSCRIPTEN_KEEPALIVE` and export the functions explicitly.

```c
typedef struct {
    int state;            /* CA_* */
    int demo_playing;
    int paused;
    int server_time_ms;
    int duration_ms;      /* -1 until known */
    int protocol;
    int client_num;
    char mapname[64];
    char demoname[128];
} JkaDemoStatus;

/* Command and lifecycle */
void  JKA_ExecuteCommand(const char *cmd);
int   JKA_PlayDemo(const char *name);       /* validates + issues "demo <name>" */
void  JKA_StopDemo(void);
void  JKA_SetPaused(int paused);
void  JKA_SetSpeed(float rate);             /* 0.25 .. 4.0 */
int   JKA_SeekDemo(int time_ms);            /* optional; replay-based */

/* State and inspection */
void  JKA_GetStatus(JkaDemoStatus *out);
const char *JKA_GetConfigstring(int index);
int   JKA_GetPlayerCount(void);
int   JKA_GetPlayerInfo(int index, char *out, int out_size);

/* Camera */
void  JKA_SetFreecam(int enabled);
void  JKA_SetFreecamPose(float x, float y, float z,
                         float pitch, float yaw, float roll);
```

Notes:

- `JKA_PlayDemo` must sanitize the name: no path separators, no `..`, ASCII only, length limit. The engine prepends `demos/` and appends `.dm_26`.
- `JKA_GetStatus` is called once per animation frame or every ~100 ms; it must not allocate.
- `JKA_GetConfigstring` returns a pointer into engine memory; copy it into a JS string immediately.
- `JKA_SetSpeed` and `JKA_SeekDemo` are engine patches, not existing cvars. They are optional for MVP.
- Prefer `ccall`/`cwrap` with a small number of functions over exposing raw pointers.

### 4.7 Engine modifications

The port needs these changes on top of upstream OpenJK:

| Change | File(s) | Purpose | Risk |
|---|---|---|---|
| Emscripten platform layer | `engine/platform/` (new) | Implement OpenJK `Sys_*`, FS helpers, timers, input, module loading | High |
| Build integration | `CMakeLists.txt`, `engine/platform/build-*.sh` | Build OpenJK with Emscripten ports or bundled deps | High |
| Renderer static/side module | `codemp/rd-vanilla/`, `codemp/client/cl_main.cpp` | `CL_InitRef` must load a WebGL-capable renderer | High |
| Renderer WebGL fixes | `codemp/rd-vanilla/*` | 16-bit indices, GL limits, endian, image paths, texenv | High |
| cgame/UI side modules | `codemp/cgame/`, `codemp/ui/`, `engine/platform/vm*` | `GetModuleAPI`, `vmMain`, vararg shim | Medium |
| FS layout | `codemp/qcommon/files.cpp`, `engine/platform/sys*` | `fs_basepath=/jka`, `fs_homepath=/userdata`; demo under `/jka/base/demos` | Medium |
| Demo safeguards | `codemp/client/cl_main.cpp`, `cl_parse.cpp` | `cl_allowDownload 0`; clear errors for mod/pure mismatches | Low |
| Demo end callback | `codemp/client/cl_main.cpp` | Notify JS instead of UI menu | Low |
| UI skip (optional) | `codemp/client/cl_ui.cpp` | No engine menu for a custom shell | Low |
| Status exports | `engine/platform/jka_bridge.c` (new) | JS ↔ engine ABI | Low |
| Speed/seek | `codemp/client/cl_cgame.cpp` | Playback controls | Medium |
| Freecam | `codemp/cgame/cg_view.c` | Camera control | Medium |
| Network stub | `engine/platform/sys*` | No accidental network | Low |

The key structural difference from the Raven SP drop is that OpenJK MP loads the **renderer, cgame, and UI** dynamically. For each module, choose static linking or an Emscripten side module:

| Module | Preferred first attempt | Fallback |
|---|---|---|
| `rd-vanilla` | Static link into the engine; call `GetRefAPI` directly | Side module loaded via `Sys_LoadDll` |
| `cgame` | Side module loaded via `Sys_LoadGameDll` | Static link with an explicit init path |
| `ui` | Side module or skip for a custom shell | Static link |

Keep changes behind `__EMSCRIPTEN__` where possible. Keep a patch log and re-test each module independently.

### 4.8 Playback controller

The controller translates UI actions into engine calls and polls status.

```text
User clicks Play
  → EngineHost.startDemo(name)
  → JKA_PlayDemo(name)
  → engine: CL_PlayDemo_f → CA_PRIMED → CA_ACTIVE
  → controller polls JKA_GetStatus()
  → UI updates timeline, map name, player count
```

Controls:

| Control | Implementation | MVP? |
|---|---|---|
| Play | Start demo / resume | Yes |
| Pause | `cl_freezeDemo 1` or `JKA_SetPaused(1)` | Yes |
| Resume | `cl_freezeDemo 0` | Yes |
| Restart | `JKA_StopDemo()` then `JKA_PlayDemo(name)` | Yes |
| Speed | `JKA_SetSpeed(rate)` (engine patch) | Later |
| Seek | `JKA_SeekDemo(ms)` (replay-based) | Later |
| Volume | engine cvar / SDL audio | Later |
| Fullscreen | browser Fullscreen API | Yes |
| Camera mode | `JKA_SetFreecam` / cgame cvar | Later |
| Hide HUD | cgame cvar | Later |

Pause implementation detail: `cl_freezeDemo` is an existing cvar used by the engine for frame stepping. It freezes `cl.serverTime` while leaving the render loop alive. It is the least invasive pause. If it behaves poorly with cgame effects, fall back to a `JKA_SetPaused` flag checked in `CL_SetCGameTime`.

### 4.9 Timeline and seek

The demo has no index and no duration header. The architecture should not pretend otherwise.

**MVP:** show elapsed time only. No scrubber.

**Later:** build a `DemoIndex` during a fast-forward pass:

```ts
interface DemoIndex {
  durationMs: number;
  entries: Array<{ timeMs: number; messageIndex: number; fileOffset: number }>;
}
```

Options:

1. **Engine-driven fast-forward:** restart the demo and read messages without rendering until the target time. Simple, correct, CPU-heavy.
2. **Precomputed index:** run the fast-forward once at load, record `(time, messageIndex, offset)`, then seek by restart + fast-forward to the nearest entry.
3. **Custom keyframes:** not planned.

The UI should display a progress indicator during a seek and allow cancellation. Long demos may take seconds to seek.

### 4.10 Camera

Default playback camera is the recorded player's view, driven by cgame. For a demo player, users will want:

- First-person (recorded player).
- Third-person (orbit the recorded player).
- Free camera (fly).
- Follow another player.

The clean place to implement this is cgame, not the React shell:

- Add cvars: `jka_cam_mode`, `jka_cam_origin`, `jka_cam_angles`, `jka_cam_fov`.
- In `CG_DrawActiveFrame`, after the normal view calculation, override `cg.refdef.vieworg` / `viewangles` when a non-default mode is active.
- Disable weapon/view-model drawing in freecam.
- Keep the recorded player's entity available for third-person/follow.
- Feed input from the browser to the cgame via engine cvars or a small command interface.

Do not try to move the engine camera from React by writing raw memory. Use a typed command ABI.

### 4.11 Match inspector

Data sources, in order of preference:

1. **Configstrings** from the gamestate:
   - `CS_SERVERINFO`: map name, hostname, gametype, timelimit, fraglimit.
   - `CS_SYSTEMINFO`: protocol, system settings.
   - `CS_PLAYERS`: player names, scores, ping (varies by protocol).
2. **cgame exports**: current scores, team, chat, kills, objectives.
3. **Demo parser (TypeScript)**: optional offline analysis for a timeline of events.

MVP inspector:

- Map name, server name, gametype.
- Player list with score.
- Elapsed time.
- Demo filename and protocol.

Later:

- Chat log.
- Kill feed.
- Scoreboard over time.
- Event markers on the timeline.
- Export to JSON/CSV (local download only).

### 4.12 Persistence

| Data | Storage | Size | Notes |
|---|---|---|---|
| Directory handle | IndexedDB | tiny | Re-permission on load |
| Cached PK3 blobs | IndexedDB | up to ~1.2 GB | Optional; quota-checked; clearable |
| Last demo name | `localStorage` | tiny | Convenience only |
| Engine config | IDBFS `/userdata/base` | KB | `jampconfig.cfg` / `mpdefault.cfg` |
| Savegames | IDBFS `/userdata/base/saves` | MB | Separate from PK3s |
| Logs | memory ring | bounded | Downloadable on error |

Do not cache PK3s by default without asking. A 1.2 GB cache can evict other site data and may fail quota. Offer "Remember these files on this device" as an explicit opt-in.

### 4.13 Error taxonomy

| Code | Meaning | User action |
|---|---|---|
| `ASSETS_MISSING` | Not all `assets*.pk3` | Select the complete `base` folder |
| `ASSETS_INCOMPLETE` | No `productid.txt` | Select all four retail PK3s |
| `DEMO_INVALID_EXT` | Not `.dm_26` | Select a JKA MP demo |
| `DEMO_TRUNCATED` | Framing invalid | Re-download/re-record the demo |
| `DEMO_PROTOCOL` | Not protocol 26 | Unsupported demo |
| `DEMO_MOD_MISMATCH` | Missing mod/map PK3 | Supply the mod assets or use a base demo |
| `ENGINE_BOOT_FAILED` | Wasm/module load error | Check browser/WebGL; download logs |
| `WEBGL_UNAVAILABLE` | No WebGL2/1 | Use a supported desktop browser |
| `OUT_OF_MEMORY` | Tab allocation failure | Close tabs; use a desktop with more RAM |
| `AUDIO_BLOCKED` | Autoplay policy | Click Play (user gesture) |
| `ENGINE_CRASH` | Wasm trap | Reload; report with logs |

Errors should include a technical detail panel, not just a toast. The engine's log ring is the most useful diagnostic.

### 4.14 Performance and memory

- Target: desktop Chrome/Edge/Brave, 2020+ hardware, 16 GB RAM.
- Initial wasm heap: 768 MB (matches `jka-web`'s SP measurement). Measure MP separately; adjust.
- Maximum wasm memory: 4 GB.
- PK3s: MEMFS, JS heap, ~1.22 GB for retail.
- Frame budget: 16.6 ms. The renderer is the likely bottleneck; profile before optimizing.
- Startup: staging 1.22 GB can take seconds; show progress and keep the UI responsive.
- Do not enable threads/SharedArrayBuffer for MVP; it adds COOP/COEP deployment requirements.
- If memory is a problem, the upgrade path is worker + WORKERFS (see research §4.5).

### 4.15 Security and privacy

- No backend, no upload, no analytics by default.
- CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'`.
  - `wasm-unsafe-eval` is required for WebAssembly compilation.
  - `connect-src 'self'` is needed because the engine `.wasm` is fetched from the app's own origin. There is no external endpoint and no upload code; keep it same-origin only. Do not set `connect-src 'none'` unless the wasm is embedded differently, or the engine will fail to load.
- Do not log file contents, player names, or chat by default.
- Sanitize demo filenames before passing them to the engine.
- Treat PK3/demo parsing as untrusted input; catch wasm traps and reload.
- No service worker caching of PK3s unless the user opts in.

### 4.16 Browser support

| Browser | MVP | Notes |
|---|---|---|
| Chrome / Edge / Brave (desktop) | Yes | FSA, WebGL2, best performance |
| Firefox (desktop) | Fallback | File input; WebGL; performance unverified |
| Safari (desktop) | Fallback | File input; WebGL; memory/perf unverified |
| Mobile | No | Memory, input, and FSA limitations |

### 4.17 Deployment

- Static site: GitHub Pages, Netlify, Cloudflare Pages, or any static host.
- No special headers for the single-threaded MVP.
- If threads are enabled later: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- `application/wasm` MIME type.
- Cache the engine wasm with a content hash; do not cache user assets.
- Provide a source archive/tag matching each deployed binary (GPLv2).

---

## 5. Key flows

### 5.1 First load

```text
1. App loads; no engine wasm fetched yet (or prefetch in idle).
2. Launcher explains: "Select your GameData folder. Nothing is uploaded."
3. User clicks "Select GameData".
4. showDirectoryPicker() → handle → enumerate base/*.pk3 and base/demos/*.dm_26.
5. Validate assets; show file count and total size.
6. User selects a demo (or drags one in).
7. Validate demo extension/framing.
8. User clicks "Play".
9. Stage PK3s + demo into MEMFS with progress.
10. Boot engine; wait for onRuntimeInitialized.
11. JKA_PlayDemo(name).
12. Engine loads map/cgame; canvas shows the first frame.
13. UI switches to Playing; controls enabled.
```

### 5.2 Returning user

```text
1. Read directory handle from IndexedDB.
2. Request permission (user gesture).
3. If granted, re-enumerate and validate.
4. If denied, fall back to file input.
5. Restore last demo name if still present; do not auto-play.
```

### 5.3 Demo playback

```text
JKA_PlayDemo(name)
  → sanitize name
  → set cl_allowDownload 0   (no server exists to download from)
  → Cbuf_AddText("demo <name>\n"); Cbuf_Execute()
  → CL_PlayDemo_f
      → FS_FOpenFileRead("demos/<name>.dm_26")   (searches fs_basepath/fs_homepath)
      → CL_ReadDemoMessage() until CA_PRIMED
      → CL_InitCGame() loads cgame
  → engine frame loop
      → renderer already loaded by CL_InitRef at boot
      → CL_SetCGameTime()
      → CL_ReadDemoMessage()
      → CGVM_DrawActiveFrame(..., demoPlayback=true)
  → JKA_GetStatus() polled by UI
  → on demo end: JKA_OnDemoEnd() callback → UI state Ended
```

### 5.4 Pause / resume

```text
Pause:
  JKA_SetPaused(1)
  → cl_freezeDemo 1
  → CL_SetCGameTime skips time advance
  → render loop continues (last frame remains)

Resume:
  JKA_SetPaused(0)
  → cl_freezeDemo 0
  → time resumes from the current snapshot
```

### 5.5 Seek (later)

```text
Seek(targetMs):
  if no index: build index once (fast-forward)
  stop demo
  start demo
  fast-forward: read messages without presenting until time >= targetMs
  resume normal playback
```

---

## 6. Build and release architecture

### 6.1 Toolchain

- Emscripten **6.0.1** as the starting pin (matches the known-good JKA port); upgrade only with a measured reason.
- OpenJK's CMake build either driven by an Emscripten toolchain file or replaced with a source-list build script.
- Single-threaded by default.
- No `-flto` (documented miscompile in the JKA boot path).
- `-fexceptions`, `-O3`, `-fno-strict-aliasing`, `-fPIC`, `-fgnu89-inline`.
- `-sALLOW_MEMORY_GROWTH=1`, `-sINITIAL_MEMORY=805306368`, `-sMAXIMUM_MEMORY=4294967296` (measure OpenJK's actual peak).
- `-sFORCE_FILESYSTEM=1`, `-lidbfs.js`.
- `-sMAX_WEBGL_VERSION=2`, `-sMIN_WEBGL_VERSION=1`, `-sLEGACY_GL_EMULATION=1`.
- Emscripten ports for SDL2/JPEG/PNG/zlib, or the bundled OpenJK libraries.
- OpenAL either ported, stubbed, or replaced with SDL audio.
- Export `FS`, `ccall`, `cwrap`, `callMain`, `addRunDependency`, `removeRunDependency`.

### 6.2 Targets

| Target | Source | Output | Required |
|---|---|---|---|
| Engine | OpenJK `codemp` + `shared` | `openjk-mp.js`, `openjk-mp.wasm` | Yes |
| Renderer | OpenJK `codemp/rd-vanilla` | `rd-vanilla.wasm` or static link | Yes |
| cgame | OpenJK `codemp/cgame` | `cgame.wasm` | Yes |
| UI | OpenJK `codemp/ui` | `ui.wasm` | Optional |
| Server game | OpenJK `codemp/game` | `jampgame.wasm` | No |

### 6.3 Side modules

- Build cgame/ui with `-sSIDE_MODULE=2`.
- Export `_GetModuleAPI`, `_vmMain`, `_dllEntry`, and the vararg shim symbol.
- Patch `Sys_LoadGameDll` to resolve `cgame.wasm` / `ui.wasm` through the fresh-`dlopen` shim.
- For the renderer, prefer a **static link** first: call `GetRefAPI` directly from `CL_InitRef`. If that creates symbol conflicts, build `rd-vanilla` as a side module and load it through `Sys_LoadDll`.
- Verify each module size is plausible (a few hundred bytes means the objects did not link).
- Reload semantics: id Tech 3 expects fresh statics per module load; use `idt3_dlopen_fresh` to avoid Emscripten's cached instance behavior.

### 6.4 CI

- Build the engine from a clean checkout in a pinned Emscripten container.
- Run a headless Chrome smoke test that boots the engine with a synthetic/minimal data fixture.
- Run the demo playback test with a **licensed or synthetic** demo fixture; never commit a real player's demo.
- Check that no `.pk3`, `.dm_26`, or build artifact is committed.
- Check license headers and third-party notices.
- Publish the source archive alongside each release.

### 6.5 Release checklist

- [ ] GPLv2 `LICENSE` and `NOTICE.md` included.
- [ ] Third-party notices updated.
- [ ] Source tag/archive matches the deployed wasm.
- [ ] No PK3/demo/assets in the repo or image.
- [ ] No analytics/network calls.
- [ ] CSP verified.
- [ ] Browser matrix tested.
- [ ] Error paths tested (missing assets, bad demo, OOM, WebGL failure).
- [ ] Demo compatibility documented (base vs mod).

---

## 7. Architecture decisions (ADRs)

### ADR-001: Use multiplayer, not single-player

**Decision:** Build a multiplayer-only engine.
**Rationale:** Demo playback exists only in the MP tree; `.dm_26` is protocol 26; cgame's demo path is MP.
**Consequences:** Larger port, cgame/UI modules, network code present but stubbed. No SP campaign.

### ADR-002: Use upstream OpenJK `codemp`, not a ready-made browser port

**Decision:** Start from `JACoders/OpenJK` at `260c59c` and build a new Emscripten platform layer. Use `jka-web` only as a reference.
**Rationale:** OpenJK is the maintained MP engine with demo playback; it avoids inheriting the user-reported, unresolved rendering defect in jka-web; GPLv2.
**Consequences:** Must build the platform layer, WebGL renderer, and module loading. Larger schedule than reusing jka-web. The native baseline comes before the browser port.

### ADR-003: Native MP baseline before the browser port

**Decision:** Prove `demo <name>` on a native Linux OpenJK MP build with user-supplied assets before porting to Emscripten.
**Rationale:** Separates engine/demo defects from WebGL defects; gives a known-good reference for the browser.
**Consequences:** Requires a native build environment and a legal demo/asset set for local testing. Not part of the shipped product.

### ADR-004: Renderer static-link first

**Decision:** Try linking `rd-vanilla` into the engine and calling `GetRefAPI` directly. Fall back to an Emscripten side module only if static linking causes symbol conflicts.
**Rationale:** Fewer moving parts; avoids a second dynamic module during bring-up; keeps the first render target simple.
**Consequences:** If static linking conflicts with the engine, the renderer becomes another side module and another failure point.

### ADR-005: MEMFS staging for MVP

**Decision:** Stage PK3s and the demo into MEMFS before boot.
**Rationale:** Synchronous reads; proven by `jka-web`; simple; no COOP/COEP; no worker rewrite.
**Consequences:** ~1.22 GB in JS heap; desktop-only; startup copy cost. Worker + WORKERFS is the later scaling path.

### ADR-006: No backend

**Decision:** Static hosting only.
**Rationale:** Privacy and legal safety; no asset upload; simplest deployment.
**Consequences:** No cloud saves, no shared demos, no server-side analysis. All state is local.

### ADR-007: File System Access API + fallback

**Decision:** Use FSA for directory selection where available; `<input>` elsewhere.
**Rationale:** Best UX in Chromium; broad fallback; engine reads are decoupled from the picker.
**Consequences:** Two code paths; Safari/Firefox need testing; handle permissions must be re-requested.

### ADR-008: Do not implement a demo parser/renderer from scratch

**Decision:** Use the engine's existing playback.
**Rationale:** The demo format is tied to the game protocol and cgame; reimplementation would be a second engine.
**Consequences:** Depend on MP engine port; limited control over seeking/camera until we patch the engine.

### ADR-009: GPLv2 for the whole project

**Decision:** License the project GPLv2.
**Rationale:** Engine is GPLv2; simplest compliance; matches OpenJK.
**Consequences:** Publish source; no proprietary integration; trademark disclaimer.

---

## 8. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenJK browser port fails or takes too long | High | High | Native baseline; G0/G1 spikes; stop before UI |
| jka-web rendering defect is systemic to GL emulation | Medium | High | G0 triage; reproduce on OpenJK/WebGL spike; fix at platform layer or stop |
| Renderer/WebGL bring-up fails | Medium | High | Static-link first; side-module fallback; small render target before full map |
| Renderer/cgame/UI module loading fails | Medium | High | Side-module shim; static-link fallback; test each module separately |
| Demo/cgame/mod mismatch | High | Medium | Base-only MVP; `cl_allowDownload 0`; explicit compatibility errors; test mod demos later |
| Memory exhaustion | Medium | High | Desktop target; memory warnings; worker/WORKERFS later |
| No seek | High | Medium | Elapsed-time MVP; replay-based seek later |
| OpenAL audio port | Medium | Medium | SDL audio or a stub; audio is not on the demo-critical path |
| Browser support gaps | High | Low | Chromium-first; file-input fallback |
| Legal/licensing mistake | Low | High | GPLv2, source offer, no assets, counsel review |
| Malformed demo crashes tab | Medium | Medium | Validate framing; catch wasm traps; reload |
| Audio autoplay blocked | High | Low | Start on user gesture; show unmute UI |

---

## 9. Testing strategy

### 9.1 Unit tests (TypeScript)

- Filename sanitization and `.dm_26` validation.
- Asset completeness checks.
- Demo framing parser (length, terminator, bounds).
- State machine transitions.
- Error mapping.

### 9.2 Engine smoke tests (headless Chrome)

- Engine loads; `onRuntimeInitialized` fires.
- FS mounts; `/jka/base` exists; staged files are visible.
- `version`/MP banner appears in the log ring.
- No network requests (CDP network domain).
- No wasm trap during boot.

### 9.3 Demo playback tests

- Stage a synthetic/consented demo fixture.
- `JKA_PlayDemo` → `CA_PRIMED` → `CA_ACTIVE`.
- `serverTime` advances.
- A screenshot is non-blank.
- Pause stops time; resume continues.
- Restart returns to the beginning.
- Demo end triggers the JS callback.

### 9.4 Manual test matrix

- Chrome/Edge/Brave, Windows/macOS/Linux.
- FSA path and file-input path.
- Complete retail assets; incomplete assets; demo-restricted assets.
- Base demo; mod demo; truncated demo; empty file; wrong protocol.
- Low-memory machine; integrated GPU; discrete GPU.
- Network disabled after load.

### 9.5 Non-goals for tests

- We cannot commit real PK3s or real demos.
- We cannot rely on a public demo server.
- We should not test against proprietary assets in CI.

---

## 10. Open technical questions

1. Does a native OpenJK MP build play a base `.dm_26` demo with user-supplied assets?
2. Can OpenJK's `Sys_*` platform layer compile under Emscripten with a bounded set of fixes?
3. Can `rd-vanilla` be statically linked and render a map through WebGL?
4. Can cgame/UI be built as side modules and resolve `GetModuleAPI` under Emscripten?
5. Does a base `.dm_26` demo reach `CA_ACTIVE` in the browser without a server module?
6. What is the MP memory high-water mark with retail assets?
7. Does `cl_freezeDemo` pause cleanly, or do we need a custom pause flag?
8. Can we boot without UI, and what breaks?
9. What is the smallest legal demo fixture for CI?

Questions 1–3 are the G0/G1 gate. See [milestones.md](./milestones.md).
