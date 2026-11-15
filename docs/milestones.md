# Milestones: `jka-demo-player`

**Status:** Planning. No implementation started.
**Related:** [research.md](./research.md) · [architecture.md](./architecture.md)
**Foundation:** upstream `JACoders/OpenJK` `codemp`, with a new Emscripten platform layer.

---

## 0. How to read this plan

This plan is **baseline-first and spike-first**. The project's largest uncertainties are:

1. Does a native OpenJK MP build play a base `.dm_26` demo correctly?
2. What caused the rendering issues the user saw in `jka-web`, and will an OpenJK/WebGL port inherit them?
3. Can OpenJK's platform layer and `rd-vanilla` renderer be ported to Emscripten/WebGL in a bounded amount of work?

The milestones answer those before building a product UI. Estimates are **indicative**, assume one experienced engine/graphics engineer plus part-time frontend help, and include no proprietary assets. Add 30–50% contingency for id Tech 3/Emscripten surprises.

### 0.1 Milestone map

| ID | Milestone | Outcome | Estimate |
|---|---|---|---|
| M0 | Research | Evidence, architecture, GO/NO-GO | Done |
| M0.5 | Native baseline + rendering triage | OpenJK MP plays a demo natively; jka-web issue classified | 1–2 weeks |
| M1 | Emscripten platform layer + engine boot | OpenJK MP boots in Chrome | 3–5 weeks |
| M2 | Renderer + cgame/UI bring-up | A map renders through WebGL | 2–4 weeks |
| M3 | Browser demo playback | A `.dm_26` demo plays headlessly | 2–3 weeks |
| M4 | Browser MVP | Select assets/demo, play, pause, restart | 2–3 weeks |
| M5 | Playback controls and camera | Seek, speed, freecam, HUD | 2–3 weeks |
| M6 | Match inspector | Players, scoreboard, events | 2–3 weeks |
| M7 | Hardening and release | Performance, compatibility, compliance | 2–4 weeks |

**Total:** roughly **16–26 weeks** after M0. A public MVP is realistic after M4 (10–17 weeks), assuming M0.5–M3 succeed. M1/M2 are the critical path.

### 0.2 Decision gates

| Gate | When | Question | If no |
|---|---|---|---|
| **G0** | End of M0.5 | Does native OpenJK MP play a base demo, and is the jka-web issue engine-specific or systemic? | Fix the native baseline; if the issue is systemic, re-scope the renderer work or stop |
| **G1** | End of M1 | Does OpenJK MP boot under Emscripten with a stub/static renderer? | Reduce scope; fix platform layer; stop before UI |
| **G2** | End of M2 | Does `rd-vanilla` render a map through WebGL with cgame? | Isolate renderer vs cgame; consider side-module/static alternatives |
| **G3** | End of M3 | Does a base `.dm_26` demo reach `CA_ACTIVE` and render in the browser? | Diagnose demo/cgame/mod; scope down or stop |
| **G4** | End of M4 | Is playback usable on target hardware? | Optimize renderer/memory before M5 |
| **G5** | End of M5 | Are seek/camera good enough? | Ship without seek; document limits |
| **G6** | End of M7 | Is the release legally and technically safe? | Delay release; fix compliance/perf |

Do not start M4 until G3 passes. A polished shell around a non-playing engine is wasted work.

---

## 1. M0 — Research (complete)

### Goal

Establish the factual basis for the project and choose a foundation.

### Deliverables

- `docs/research.md`
- `docs/architecture.md`
- `docs/milestones.md`

### Acceptance criteria

- [x] Each candidate has an identified source repository, upstream, MP status, source availability, license, and verdict.
- [x] The `jk.q3js.com` / `q3js` / `openjk-emscripten` distinction is documented with artifact evidence.
- [x] Demo playback is traced through named functions and files.
- [x] Browser filesystem options are compared with synchronous-I/O constraints.
- [x] Licensing evidence is recorded without definitive legal conclusions.
- [x] A clear GO/NO-GO is given for each candidate.
- [x] No code, build, frontend, or proprietary asset was produced.

### Result

- Primary foundation: **upstream OpenJK `codemp`** plus a new Emscripten platform layer.
- Reference: **`jka-web`** platform layer, FS staging, test harnesses, renderer-fix catalog.
- Reference only: `jk.q3js.com` MP artifact.
- No-go: `openjk-emscripten` as a base, `q3js` integration code.
- User-reported `jka-web` rendering issues remain unresolved; G0 exists to classify them.

---

## 2. M0.5 — Native baseline and rendering triage

### Goal

Prove that OpenJK MP can play a base `.dm_26` demo natively with user-supplied assets, and determine whether the `jka-web` rendering issue is specific to that port or systemic to the Emscripten/WebGL approach.

This milestone is deliberately **not** browser work. It gives us a known-good reference before touching WebGL.

### Scope

In:

- Native Linux OpenJK MP build.
- User-supplied retail `base` assets and one base demo (not committed).
- Native demo playback verification.
- Reproduction/triage of the jka-web rendering issue.

Out:

- Emscripten build.
- Frontend.
- Camera/inspector.
- Network play.

### Tasks

1. **Build OpenJK MP natively.**
   - CMake options: `BuildMPEngine=ON`, `BuildMPRdVanilla=ON`, `BuildMPCGame=ON`, `BuildMPUI=ON`, `BuildMPGame=OFF` (or ON if needed), `BuildSPEngine=OFF`, `BuildJK2SPEngine=OFF`, `BuildMPRend2=OFF`.
   - Install the native dependencies (SDL2, JPEG, PNG, zlib, OpenAL) or use OpenJK's bundled libraries.
   - Record the exact CMake command and versions.

2. **Run a base demo natively.**
   - Set `fs_basepath` to the user's game root, `fs_homepath` to a temporary writable directory.
   - Place/stage the demo at `base/demos/<name>.dm_26`.
   - Start `openjk +set fs_basepath ... +set fs_homepath ... +demo <name>`.
   - Set `cl_allowDownload 0` before playback.
   - Verify `clc.demoplaying`, `CA_ACTIVE`, map load, cgame, and rendered frames.
   - Verify no server/network is needed.

3. **Reproduce the jka-web rendering issue.**
   - Use the same machine/browser/GPU where the user saw it.
   - Capture: browser version, OS, GPU/driver, WebGL renderer string, console log, screenshot/video.
   - Try the same scene/map in the native OpenJK baseline.
   - Classify: jka-web-specific renderer bug, asset/data issue, driver/browser issue, or systemic GL-emulation issue.

4. **Write the G0 report.**
   - Native build recipe and demo result.
   - jka-web issue reproduction (or inability to reproduce).
   - Risk assessment for the OpenJK/WebGL port.
   - Recommendation: proceed, change renderer strategy, or stop.

### Deliverables

- `docs/native-baseline.md`
- `docs/rendering-triage.md`
- Native build commands and logs.
- A G0 decision.

### Acceptance criteria

- [ ] Native OpenJK MP builds from a clean checkout.
- [ ] A base `.dm_26` demo reaches `CA_ACTIVE` and renders natively.
- [ ] `cl_allowDownload 0` and offline playback are verified.
- [ ] The jka-web rendering issue is reproduced or its absence is documented with the test environment.
- [ ] The issue is classified as engine-specific or systemic.
- [ ] No proprietary assets or demos are committed.

### Risks

| Risk | Mitigation |
|---|---|
| Native OpenJK MP build fails on the dev machine | Use a known Linux distro/container; install deps; consult OpenJK build docs |
| User's demo requires a mod/map | Start with a base demo; document mod requirements |
| jka-web issue cannot be reproduced | Capture the user's environment; try multiple GPUs/browsers; treat as unresolved risk |
| Native renderer also fails | Separate asset/driver issues from engine issues; try another machine |

### Gate G0

**Pass:** native demo playback works and the jka-web issue is understood well enough to plan the renderer.
**Fail:** if native playback cannot work, stop and fix that. If the rendering issue is systemic and unfixable within scope, stop before the browser port.

---

## 3. M1 — Emscripten platform layer and engine boot

### Goal

Compile OpenJK MP with Emscripten, implement the platform layer, and boot the engine in Chrome with a stub or static renderer.

### Scope

In:

- New Emscripten platform layer for OpenJK `Sys_*`.
- OpenJK CMake integration or a source-list build script.
- Engine boot and console.
- Filesystem mapping (`fs_basepath`/`fs_homepath`).
- Stub or minimal renderer.
- No cgame/UI yet if they block boot.

Out:

- Full renderer.
- Demo playback.
- React frontend.
- Match inspector.

### Tasks

1. **Create `engine/platform/`.**
   - Implement:
     - `Sys_DefaultInstallPath` → `/jka`.
     - `Sys_DefaultHomePath` → `/userdata`.
     - `Sys_ListFiles`, `Sys_Mkdir`, `Sys_FileTime`, `Sys_Cwd`, `Sys_PathCmp`.
     - `Sys_LoadDll`, `Sys_LoadFunction`, `Sys_LoadGameDll`, `Sys_UnloadDll`.
     - timers, input, clipboard, message box, GL context, audio stubs.
   - Keep changes behind `__EMSCRIPTEN__` where possible.

2. **Integrate the build.**
   - Try OpenJK CMake with an Emscripten toolchain file.
   - If CMake dependency discovery fights the Emscripten ports, use a source-list build script for the MP engine.
   - Configure SDL2/JPEG/PNG/zlib via ports or bundled libraries.
   - Stub or replace OpenAL for the first boot.
   - Use `-fexceptions -O3 -fno-strict-aliasing -fPIC -fgnu89-inline`.
   - Use `-sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -lidbfs.js`.
   - Use `-sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=1 -sLEGACY_GL_EMULATION=1`.

3. **Boot with a minimal renderer.**
   - Stub `CL_InitRef` or link a minimal `rd-vanilla` that clears the screen.
   - Get to `Com_Init`, `FS_Startup`, and the console.
   - Verify the MP version banner.

4. **Filesystem mapping.**
   - Set `fs_basepath=/jka`, `fs_homepath=/userdata`.
   - Create `/jka/base`, `/jka/base/demos`, `/userdata`.
   - Mount IDBFS at `/userdata` only.
   - Verify `FS_Startup` sees the paths.

5. **Headless smoke test.**
   - Load in Chrome via CDP.
   - Assert no wasm trap and no network requests.
   - Capture logs.

### Deliverables

- `engine/platform/` with the Emscripten layer.
- Build script/CMake integration.
- A bootable `openjk-mp.js`/`.wasm`.
- `docs/emscripten-boot.md`.
- A headless smoke test.

### Acceptance criteria

- [ ] OpenJK MP engine wasm links and loads.
- [ ] `Com_Init` and `FS_Startup` complete.
- [ ] MP version banner appears.
- [ ] `/jka` and `/userdata` are visible to the engine.
- [ ] No wasm trap; no network requests.
- [ ] Build is reproducible.
- [ ] Platform changes are documented.

### Risks

| Risk | Mitigation |
|---|---|
| CMake dependency discovery fails | Source-list build script; Emscripten ports; bundled libs |
| `Sys_*` surface is larger than expected | Implement in batches; stub non-critical functions; use jka-web as a reference |
| OpenAL blocks the build | Stub audio for boot; add SDL audio later |
| Renderer cannot be stubbed | Link a minimal renderer; defer full map rendering |

### Gate G1

**Pass:** engine boots in Chrome.
**Fail:** if not passing after ~5 weeks, reassess scope or stop. Do not start the React shell.

---

## 4. M2 — Renderer, cgame, and UI bring-up

### Goal

Get OpenJK's `rd-vanilla` renderer and cgame working through WebGL, and render a map.

### Scope

In:

- `rd-vanilla` static link or side module.
- WebGL/GLES fixes.
- cgame side module.
- Optional UI.
- Map load with user-supplied assets.
- Visual comparison with the native baseline.

Out:

- Demo playback (M3).
- Frontend.
- Camera/inspector.

### Tasks

1. **Renderer strategy.**
   - Try static linking `rd-vanilla` and calling `GetRefAPI` directly from `CL_InitRef`.
   - If symbol conflicts, build `rd-vanilla` as a side module and load through `Sys_LoadDll`.
   - Keep the native renderer as the reference.

2. **WebGL fixes.**
   - 16-bit indices under WebGL1 (or force WebGL2 where safe).
   - GL limits and unsupported formats.
   - Endian assumptions.
   - Image loading paths (JPEG/PNG/TGA).
   - Texenv/shader emulation behavior.
   - Compare each fix with the jka-web renderer-fix catalog, but validate against G0 findings.

3. **cgame side module.**
   - Build with `-sSIDE_MODULE=2`.
   - Export `GetModuleAPI`, `vmMain`, `dllEntry`, vararg shim.
   - Patch `Sys_LoadGameDll` to load `cgame.wasm`.
   - Verify `VM_Create` success.

4. **UI (optional).**
   - Build `ui.wasm` or patch `CL_InitUI` to skip.
   - For the first map, skipping UI is acceptable.

5. **Map load.**
   - Stage a complete user-supplied `base` asset set.
   - Load a map with `+map` or through the demo path later.
   - Verify BSP, models, Ghoul2 characters, HUD.
   - Capture screenshots; compare with native.

6. **Performance baseline.**
   - Measure frame time and memory.
   - Record a baseline before optimization.

### Deliverables

- `rd-vanilla.wasm` or static renderer integration.
- `cgame.wasm`.
- Optional `ui.wasm`.
- `docs/webgl-bringup.md`.
- Screenshots and performance numbers.

### Acceptance criteria

- [ ] Renderer initializes in Chrome.
- [ ] A map renders with textures and geometry.
- [ ] cgame loads and draws the HUD.
- [ ] Ghoul2 characters render correctly (or known issues are documented).
- [ ] No wasm trap during a short map session.
- [ ] Native vs browser screenshots are compared.
- [ ] Frame time/memory baseline is recorded.

### Risks

| Risk | Mitigation |
|---|---|
| Static renderer link conflicts | Side-module fallback |
| WebGL translation issues | Fix one class at a time; compare with native |
| cgame side module fails | Static-link fallback; verify `GetModuleAPI` |
| UI blocks boot | Skip UI for the first map; add later |
| Memory high-water | Measure; adjust `INITIAL_MEMORY`; worker FS later |

### Gate G2

**Pass:** a map renders through WebGL with cgame.
**Fail:** isolate renderer vs cgame vs assets; if the renderer cannot be made to work, stop or re-scope.

---

## 5. M3 — Browser demo playback

### Goal

Play a base `.dm_26` demo in the browser, headlessly, with no network.

### Scope

In:

- MEMFS staging of PK3s + demo.
- `demo <name>` command.
- Demo state verification.
- No frontend.

Out:

- React UI.
- Seek/camera.
- Inspector.

### Tasks

1. **Stage assets and demo.**
   - `/jka/base/*.pk3`.
   - `/jka/base/demos/<name>.dm_26`.
   - `/userdata` for config/saves.
   - Validate `productid.txt`.

2. **Set demo safeguards.**
   - `cl_allowDownload 0`.
   - `fs_forcegame base` or validate `fs_game`.
   - Set `fs_basepath=/jka`, `fs_homepath=/userdata`.

3. **Issue the demo command.**
   - `Cbuf_AddText("demo <name>\n"); Cbuf_Execute();`
   - Or a small exported wrapper.

4. **Verify.**
   - `clc.demoplaying == true`.
   - `CA_PRIMED` → `CA_ACTIVE`.
   - `cl.snap.serverTime` advances.
   - Map renders; screenshot is non-blank.
   - No network requests.
   - Demo end is handled.

5. **Record failure modes.**
   - Wrong protocol.
   - Truncated demo.
   - Mod demo with missing PK3.
   - Missing `productid.txt`.
   - UI absent.

### Deliverables

- `scripts/verify-demo.mjs` (headless Chrome + CDP).
- A tiny HTML harness (no React).
- Logs/screenshots from a successful base demo.
- Compatibility notes.

### Acceptance criteria

- [ ] A base `.dm_26` demo reaches `CA_ACTIVE` in the browser.
- [ ] The first frame renders.
- [ ] Playback runs 30+ seconds without a trap.
- [ ] `serverTime` advances monotonically.
- [ ] No network requests during playback.
- [ ] Demo end is handled cleanly.
- [ ] Failure modes produce actionable errors.
- [ ] No proprietary assets/demos committed.

### Risks

| Risk | Mitigation |
|---|---|
| Demo requires a mod/cgame | Base-only MVP; document compatibility |
| Checksum/`fs_game` restart | Stage all PK3s; `fs_forcegame base`; log `FS_ConditionalRestart` |
| cgame crashes on a snapshot | Compare with native; isolate the message |
| No UI causes a crash | Build UI or patch `CL_InitUI`/`CL_DemoCompleted` |
| Audio issues | Disable audio for the spike; add later |

### Gate G3

**Pass:** a base demo plays and renders in the browser.
**Fail:** diagnose demo/cgame/mod; scope down or stop before the UI.

---

## 6. M4 — Browser MVP

### Goal

Ship a usable local demo player: select `GameData`, select a demo, play, pause, restart, with clear errors and no uploads.

### Scope

In:

- React + Vite + TypeScript.
- Directory picker (FSA) + file-input fallback.
- Asset and demo validation.
- Staging with progress.
- Canvas, input, audio unlock.
- Play/pause/restart.
- Error UI and log download.
- Static deployment.

Out:

- Seek/timeline scrubber.
- Free camera.
- Match inspector.
- Mobile.

### Tasks

1. Scaffold the app (Vite + React + TS, strict TS, lint, formatting).
2. Implement `DirectorySource` (FSA) and `FileListSource`.
3. Persist the directory handle in IndexedDB; re-request permission.
4. Validate `assets0..3`, `productid.txt`, `.dm_26`, framing.
5. Stage into MEMFS with `FS.createDataFile(..., canOwn=true)`; aggregate progress.
6. Mount IDBFS at `/userdata` only.
7. Implement `EngineHost` with typed `JKA_*` calls.
8. Implement the player UI: canvas, play/pause/restart, fullscreen, status, audio unlock.
9. Implement error taxonomy, diagnostics, log download.
10. Deploy statically with CSP and `application/wasm`.

### Deliverables

- `app/` React application.
- `app/src/engine/` bridge.
- `app/src/fs/` sources and validation.
- Playwright/CDP end-to-end test.
- Deployed preview URL (optional).

### Acceptance criteria

- [ ] User can select a complete `GameData/base` and a `.dm_26` demo.
- [ ] Validation rejects missing/incomplete assets and non-demos with clear messages.
- [ ] Staging shows progress and can be cancelled.
- [ ] Playback starts, pauses, resumes, and restarts.
- [ ] Canvas renders at a usable frame rate on target hardware.
- [ ] Audio starts after a user gesture.
- [ ] No network requests after load; no uploads.
- [ ] Errors are actionable and logs are downloadable.
- [ ] Works in Chrome/Edge/Brave; file-input fallback works in Firefox.
- [ ] No proprietary assets in the repo or build.

### Risks

| Risk | Mitigation |
|---|---|
| Staging 1.22 GB is slow | Progress, cancellation, memory warning; caching later |
| FSA permission friction | Remember handle; instructions; file-input fallback |
| Audio autoplay | Unlock on Play; show muted state |
| Memory OOM | Desktop target; catch allocation errors; reduce resolution |
| UI blocks the engine loop | Keep React off the hot path; low-frequency status polling |

### Gate G4

**Pass:** a user can load assets and a demo and watch it.
**Fail:** if performance/memory is unacceptable, fix before M5.

---

## 7. M5 — Playback controls and camera

### Goal

Make the player useful for analysis: pause, speed, seek, camera modes, HUD control.

### Scope

In:

- Pause/resume (simple version already in M4).
- Speed control (0.25×–4×).
- Seek via replay/fast-forward.
- Timeline with elapsed/duration.
- Camera: recorded/first-person, third-person, freecam.
- FOV, hide HUD, hide view model.
- Keyboard/mouse bindings.

Out:

- Nonlinear editing.
- Multi-demo playlists.
- Network.

### Tasks

1. Engine speed hook (`JKA_SetSpeed`).
2. Pause/step via `cl_freezeDemo` or a custom flag.
3. Demo index / replay-based seek.
4. cgame camera cvars/commands.
5. HUD/view-model controls.
6. Timeline UI.
7. Tests for pause/speed/seek/camera.

### Acceptance criteria

- [ ] Pause/resume is reliable across demo lengths.
- [ ] Speed changes take effect without desync.
- [ ] Seek reaches the target time within a documented tolerance.
- [ ] Freecam and third-person work without breaking playback.
- [ ] HUD can be hidden.
- [ ] Keyboard shortcuts are documented.
- [ ] No regression in M4 playback.

### Risks

| Risk | Mitigation |
|---|---|
| Seek is slow | Index + nearest-entry fast-forward; progress; desktop-only |
| Delta snapshots prevent random access | Replay from start; do not promise instant seek |
| cgame camera override conflicts | Gate behind a cvar; test all modes |
| Speed breaks audio/effects | Clamp; test; document |

### Gate G5

**Pass:** controls/camera stable enough for beta.
**Fail:** ship M4 without seek; document the limitation.

---

## 8. M6 — Match inspector

### Goal

Let users understand the match: players, scores, chat, kills, and events, without leaving the browser.

### Scope

In:

- Map/server info.
- Player list and scores.
- Chat log.
- Kill feed / event markers.
- Timeline markers.
- Export JSON/CSV (local download).

Out:

- Cross-demo statistics.
- Cloud sharing.
- Cheat detection.

### Tasks

1. `JKA_GetConfigstring` bridge; parse `CS_SERVERINFO`, `CS_SYSTEMINFO`, `CS_PLAYERS`.
2. cgame exports for current scores/teams/chat.
3. Event capture (server commands/cgame events) with timestamps.
4. Inspector UI: scoreboard, chat, event timeline, player detail.
5. Local export.

### Acceptance criteria

- [ ] Map, server, and player list are correct for a base demo.
- [ ] Scores update during playback.
- [ ] Chat and kills appear with timestamps.
- [ ] Timeline markers match events.
- [ ] Export works locally.
- [ ] No PII leaves the device.

### Risks

| Risk | Mitigation |
|---|---|
| Configstring formats vary by mod | Base-only first; feature-detect; document |
| Event parsing is protocol-heavy | Reuse engine data; avoid a second parser |
| Performance overhead | Ring buffers; batch UI updates; profile |

---

## 9. M7 — Hardening and release

### Goal

Make the project reliable, performant, legally compliant, and maintainable.

### Scope

In:

- Performance profiling and fixes.
- Memory optimization (worker/WORKERFS if needed).
- Browser compatibility.
- Error recovery.
- CI/CD.
- Documentation.
- License/source offer.
- Security review.

Out:

- New major features.

### Tasks

1. Profile renderer, staging, and playback; port remaining renderer fixes.
2. Measure memory high-water; add warnings; evaluate worker + WORKERFS.
3. Test base, mod, server-side, truncated demos; document compatibility.
4. Test Firefox/Safari fallback; Chromium matrix.
5. Catch wasm traps; reload path; diagnostics bundle.
6. Reproducible CI build; headless smoke tests; license/asset checks; source archive.
7. User/build/compatibility docs; FAQ.
8. GPLv2 LICENSE/NOTICE; third-party notices; source offer; trademark disclaimer; counsel review.

### Acceptance criteria

- [ ] 30-minute demo playback without leak/trap on target hardware.
- [ ] Memory high-water documented.
- [ ] Supported browser matrix passes.
- [ ] Error paths tested.
- [ ] No assets/demos in repo or release.
- [ ] Source archive matches binaries.
- [ ] License/notices complete.
- [ ] Security review complete.
- [ ] Docs complete.

### Risks

| Risk | Mitigation |
|---|---|
| Memory still too high | Worker + WORKERFS; lower resolution; desktop-only |
| Renderer performance | Profile; port fixes; quality settings |
| Legal review finds issues | Fix before launch; don't distribute assets |
| Browser regressions | CI matrix; pin known-good versions |

### Gate G6

**Pass:** release is safe and usable.
**Fail:** delay; fix compliance/performance.

---

## 10. Timeline and staffing

### 10.1 Indicative schedule

| Week | Milestone | Notes |
|---|---|---|
| 1 | M0 complete | Research docs |
| 2–3 | M0.5 | Native baseline + G0 triage |
| 3 | G0 | Go/no-go |
| 4–8 | M1 | Emscripten platform layer + boot; critical path |
| 8 | G1 | Go/no-go |
| 9–12 | M2 | Renderer + cgame/UI; critical path |
| 12 | G2 | Go/no-go |
| 13–15 | M3 | Browser demo playback |
| 15 | G3 | Go/no-go |
| 16–18 | M4 | Browser MVP |
| 18 | G4 | Usability check |
| 19–21 | M5 | Controls/camera |
| 21 | G5 | Beta gate |
| 22–24 | M6 | Inspector |
| 25–28 | M7 | Hardening/release |
| 28 | G6 | Release gate |

### 10.2 Staffing assumptions

- **Engine/graphics engineer:** M0.5–M3, M5 engine patches, M7 performance. This is the critical skill.
- **Frontend engineer:** M4 UI, M5 controls UI, M6 inspector, M7 docs.
- **Reviewer/legal:** license and release review.
- **QA:** manual browser matrix; can be part-time.

A single generalist can do it, but M1/M2 will take longer. Do not parallelize the frontend ahead of G3.

### 10.3 Contingency

- Add 30–50% to M1 and M2; platform/renderer ports routinely surprise.
- If M0.5 fails, stop; do not port a broken demo path.
- If M1 exceeds 5 weeks, gate G1 triggers a scope review.
- If M2 exceeds 4 weeks, consider stopping or narrowing the renderer scope.
- If M4 memory is unacceptable, pull worker/WORKERFS work forward from M7.

---

## 11. Risk register

| ID | Risk | Prob. | Impact | Owner | Mitigation | Trigger |
|---|---|---|---|---|---|---|
| R1 | Native OpenJK MP demo playback fails | Low | High | Engine | Fix native path first | M0.5 fails |
| R2 | jka-web rendering issue is systemic | Medium | High | Engine | G0 triage; OpenJK/WebGL spike | Same artifact in OpenJK |
| R3 | Emscripten platform layer too large | High | High | Engine | Batch `Sys_*`; reference jka-web | M1 > 5 weeks |
| R4 | Renderer/WebGL bring-up fails | Medium | High | Graphics | Static first; side module fallback | M2 > 4 weeks |
| R5 | cgame/UI module loading fails | Medium | High | Engine | Side-module shim; static fallback | `VM_Create` fails |
| R6 | Demo/cgame/mod mismatch | High | Medium | Engine/Product | Base-only MVP; clear errors | Demo fails to render |
| R7 | Memory OOM | Medium | High | Engine | Desktop target; worker FS later | Tab crash |
| R8 | No seek | High | Medium | Product | Elapsed-time MVP; replay seek | User feedback |
| R9 | Audio/OpenAL port | Medium | Medium | Engine | SDL audio or stub | Audio blocks build |
| R10 | Browser support | High | Low | Frontend | Chromium-first; fallback | Firefox/Safari failure |
| R11 | Licensing | Low | High | Legal | GPLv2; source offer; no assets | Review finding |
| R12 | Malformed demo | Medium | Medium | Engine | Validate; catch traps | Crash |
| R13 | Scope creep (SP, network, mobile) | High | Medium | Product | Explicit non-goals | New feature request |

---

## 12. Definition of done

A milestone is done when:

- The acceptance criteria are met.
- The change is documented.
- Tests exist and pass.
- No proprietary assets or demos are committed.
- The build is reproducible.
- The license/notices are updated if needed.
- A demo or screenshot is attached to the milestone record.
- Known limitations are written down.

A release is done when:

- G0–G6 have passed.
- The source archive matches the deployed wasm.
- The user guide and compatibility guide are published.
- The security/privacy checklist is complete.
- The legal checklist is complete.
- No assets/demos are in the repo or release.
- The app works with the network disabled after load.

---

## 13. Out of scope (for this plan)

- Single-player campaign playback.
- Live multiplayer / server browser / relay.
- Mobile support.
- Cloud storage, accounts, sharing.
- A custom demo parser/renderer.
- Video export/GIF rendering.
- Cheat detection or anti-cheat.
- Distributing game assets or demos.
- Instant random-access scrubbing.

These can be revisited after the MVP, but they are not part of the critical path.

---

## 14. First actions after approval

1. Create `docs/native-baseline.md` and `docs/rendering-triage.md`.
2. Build OpenJK MP natively on Linux with the MP targets.
3. Obtain a legal, user-supplied base asset set and demo for local testing.
4. Run `demo <name>` natively; verify `CA_ACTIVE`, map, cgame, and offline playback.
5. Reproduce the jka-web rendering issue; capture browser/GPU/console/screenshot.
6. Write the G0 decision.
7. Only if G0 passes, create `engine/platform/` and start the Emscripten port.
8. Do not scaffold the React app until G3 passes.

The native baseline is the project's first real test. Everything else follows from it.
