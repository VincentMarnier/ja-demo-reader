# AGENTS.md

## Start here

- `README.md` is the product/build overview; `docs/m7.md` is the release audit;
  `docs/m8.md` describes the demo summary, cache and seek internals;
  `docs/m9-phase0.md` is the diagnostics build and baseline checklist,
  `docs/m9-phase0-results.md` records the measured baseline,
  `docs/m9-phase1.md` describes the hybrid shader compile and texture profile,
  `docs/m9-phase3.md` describes the worker engine, WORKERFS and OPFS removal,
  `docs/m9-phase4.md` covers background prepare, keep-warm Stop and Release,
  `docs/m9-phase5.md` covers warm seek, Restart and the scan-only Check map,
  `docs/m9-phase6.md` covers seek state fidelity and added-map demos, and
  `docs/m9-phase7.md` is the release-hardening checklist.
- The app is a single Vite/React app in `app/`. `App.tsx` owns the wizard and
  player state, `engine/WorkerEngineHost.ts` and `engine/EngineHost.ts` are the
  two implementations of the shared `engine/host.ts` interface, and `src/fs/`
  owns file validation/staging (plus the legacy cache cleanup).
- The engine is upstream OpenJK `codemp/` plus `engine/platform/` and the
  patches in `engine/patches/`. `references/OpenJK` is a pinned read-only
  submodule at `260c59c2907187af555a676fe0cc798893bf7757`; never edit it or
  change its checkout.

## Commands

```bash
# First checkout / dependency install
npm --prefix app ci

# App typecheck + production build (the only automated check)
npm --prefix app run build
npm --prefix app run typecheck

# Dev server
npm --prefix app run dev

# Full engine: rend2 + statically linked cgame, no preloaded .data
EMSDK=$HOME/emsdk \
BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
WORK=/tmp/jka-demo-player/work \
BUILD=/tmp/jka-demo-player/build \
OUT=/tmp/jka-demo-player/out \
engine/scripts/build-mp-wasm.sh

# M9 diagnostics: same build with jka_profile defaulting to on
EMSDK=$HOME/emsdk PROFILE=1 \
BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
WORK=/tmp/jka-demo-player/work \
BUILD=/tmp/jka-demo-player/build \
OUT=/tmp/jka-demo-player/out \
engine/scripts/build-mp-wasm.sh

# Copy the built engine into the app. An explicit OUT is required.
scripts/stage-engine.sh /tmp/jka-demo-player/out

# Worker/OffscreenCanvas spike harness (gate for the worker host):
# (cd /tmp/jka-demo-player/out && python3 -m http.server 8123)
# http://localhost:8123/worker-smoke.html?assets=1&demo=<name>
```

- Node 22+ is required for the app. The engine build requires Emscripten 6.0.1,
  CMake 4.x, the OpenJK submodule and a host compiler. The script installs the Emscripten JPEG/PNG/SDL2 ports.
- `BUILD_RENDERER=1` is the rd-vanilla variant and is mutually exclusive with
  `BUILD_REND2=1`. The app expects the rend2 build.
- `app/public/engine/*` and `app/dist/` are gitignored build outputs. Never
  force-add them. `npm run build` does not build the engine; stage it first.
- The engine build removes/recreates its worktree under `/tmp`. If a previous
  worktree is missing but still registered, run
  `git -C references/OpenJK worktree prune` before retrying.
- For software WebGL or headless checks, use `?quality=low`.

## Engine edits

- `engine/platform/jka_bridge.cpp` is copied into `codemp/client/` by the build
  script; editing it needs no patch change.
- Changes to upstream/cgame/client source belong in a patch. The current patch
  set is `0001`–`0011`; `0004` contains the linked cgame/rend2 changes,
  `0005` keeps the last frame when a demo ends, `0006` adds M9 `jka_profile`
  diagnostics (timings, image counters, shader usage), `0007` adds the hybrid
  eager/lazy shader compile, `0008` selects the OffscreenCanvas window layer
  and skips DOM input in the worker, `0009` adds the cgame seek reset,
  scan-only gamestate path, target server-command application and EOF guard,
  `0010` swaps the SDL audio device for `client/em_audio.cpp` on Emscripten
  and fixes the `C_MP3Stream_Decode` signature that wasm-ld rejects once demo
  music starts, and `0011` adds the `cg_killMessage` cvar that turns off the
  cgame's obituary console/centerprint text (the app draws its own kill feed).
  Prefer a new patch over editing a large existing one.
  Verify every patch with a clean worktree: apply all patches from the pin and
  compare the affected files.
- `engine/platform/win_emscripten.cpp` is copied into `codemp/client/` by the
  build script, like `jka_bridge.cpp`; editing it needs no patch change. It is
  selected only when `Module.canvas` is an OffscreenCanvas, so the SDL
  main-thread path stays intact. Keep the two paths' six `WIN_*` entry points
  in sync when the renderer interface changes.
- `jka_profile` is diagnostic only. The renderer creates it lazily, the
  `PROFILE=1` build defaults it on, and `?diagnostics=1` enables it on a normal
  build. Do not make rendering or cgame behaviour depend on it.
- `0007` compiles a small eager shader set (splash, textureColor, the measured
  generic/lightall/fog/refraction variants) and lazily compiles the rest from
  `GLSL_EnsureProgram`. Add new programs with a `jkaShaderGroup_t` identity and
  a per-index loader; keep `GLSL_EnsureProgram` calls in every uniform writer
  and bind path. Lazy compiles must not call `emscripten_sleep`.
- `engine/patches/0004-emscripten-rend2.patch` is regenerated from a worktree
  that already has `0001`–`0003`; do not regenerate it from a cumulative
  `git diff` against the unpatched pin.
- `JKA_StatusJson` must stay client-only. Calling a cgame function from it
  during engine boot caused an Asyncify reentrancy hang. Cgame calls belong in
  `JKA_ScoreboardJson`/the cgame bridge, used during playback.
- The renderer/cgame are statically linked. Build them with the script; do not
  add a shared-library/UI-VM path.

## Async bridge rules

- Every long wasm call (`play`, `pause`, `stop`, `seek`, `JKA_DemoInfo`,
  filesystem restart, map load) is serialized by the host's `runExclusive`:
  `MainThreadEngineHost` on the main thread and the worker's own queue inside
  `engine.worker.ts`. Keep both; overlapping `ccall(..., { async: true })` calls
  abort with “We cannot start an async operation when one is already in
  flight”.
- `playDemo` and `prepareDemo` are single-flight. Replay/Restart must not start
  a second map load; the Watch again/Restart UI handlers also share a guard.
  Check map awaits an in-flight background prepare before scanning, and Play
  joins that prepare instead of issuing a second `demo` command.
- Phase 4 keeps a loaded demo warm: `JKA_PrepareDemo` loads it with
  `r_m2_pause=1`, `JKA_ResumeDemo` resumes the same map, `JKA_Suspend` pauses
  the main loop for keep-warm Stop, and `JKA_Release` is the only full
  teardown. Do not call `CL_Disconnect` from Stop; it reintroduces the Phase 3
  teardown/Asyncify race. Play after `ended=1` must use `playDemo`, not
  `resumeDemo`.
- Release in the worker host terminates the worker after `JKA_Release` and
  increments the canvas key: the transferred OffscreenCanvas cannot be reused.
  The main-thread host reloads the page instead. Keep both paths in the app's
  Release handler.
- `JKA_DemoInfo` resumes the main loop when it finishes. After keep-warm Stop
  it therefore wakes the suspended frame loop while it disconnects/scans the
  demo; that is intentional for Check map, so do not leave the loop paused
  across a scan.
- Status polling skips while an async call is running. Do not add another poll
  or synchronous cgame call that can run during a map load.
- `JKA_DemoInfo` pauses the main loop, disconnects and scans the whole demo.
  Since Phase 5 the scan is parse-only (`jka_scanOnly`): it does **not** load a
  map/cgame. Do not run it during playback; it is part of the serialized setup
  path.
- `CL_DemoCompleted` in the Emscripten branch intentionally leaves the last
  frame in place and keeps `CA_ACTIVE`. Disconnecting there leaves
  renderer/map teardown in flight and breaks Replay. Keep the `jka_demoEnded`
  break in `CL_SetCGameTime`; without it a seek to the last snapshot loops on
  EOF forever. Stop suspends (Phase 4); Release is the full teardown.
- Phase 5 warm seek: `JKA_SeekKeyframeWarm` restores a keyframe and replays to
  the target **without** `CL_Disconnect` or a map load, then calls
  `CGVM_SeekReset` (patch `0009`). It is only valid for the same map; return 0
  for a different map and let the full keyframe path run. Keyframes are chosen
  within the target game, not across a game boundary.
- `CG_SeekReset` must keep map-level media (renderer, BSP/collision map,
  registered graphics, world item visuals, `g2WeaponInstances`, client
  `ghoul2Model`/`ghoul2Weapons`) and clear only per-demo cgame state. Do not
  replace it with `CG_Init` (reloads the map) or `CG_Shutdown`-only (stale
  snapshots/entities).
- Do not call `CG_KillCEntityG2` for client entities in `CG_SeekReset` and do
  not call `CG_ShutDownG2Weapons`. Both free map-level client/saber media that
  `CG_NewClientInfo` will not recreate when the saber name is unchanged. The
  blade's bolt matrix then has no hilt model and renders in the wrong place.
  Saber trail caches in `clientInfo_t` must be cleared explicitly.
- The scan executes `cs`/`bcs` commands while parsing so keyframe
  `cl.gameState` matches live playback (scores, level start, clientinfo).
  Keep that; a keyframe with only the initial gamestate restores wrong HUD
  values. The replay loops in `JKA_SeekDemo` also stop when the demo file
  position stops advancing; keep that EOF guard.
- `CG_SeekReset` receives the target command sequence (client's latest after
  replaying to the target) and calls `CG_ExecuteNewServerCommands` after
  rebuilding clientinfo. This applies the keyframe→target `cs`/`scores`/server
  commands immediately, so scores, level start, clientinfo and saber data match
  the target on the first frame; `cgs.serverCommandSequence` then prevents the
  snapshot transitions from executing them again.
- Worker host (`app/src/engine/engine.worker.ts`): every long/async wasm call
  goes through the worker's own `runExclusive` queue, and `play` stays
  single-flight on both sides. Short synchronous calls (status/scoreboard
  polls, cvar, follow, free-cam) are only made while no async call is in
  flight. Do not add a call path that can enter wasm during an Asyncify
  suspension.
- `JKA_DemoInfo` pauses the loop, disconnects and scans; since Phase 5 it does
  not load a map, but it must still be an **async** ccall in both hosts. The
  worker uses `ccallAsyncString`; a synchronous call aborts with Emscripten's
  “The call to JKA_DemoInfo is running asynchronously” assertion.
- `WORKERFS` mount details: the `files` option takes File/Blob objects (it
  reads `.size`/`.slice`); `{ name, data }` wrappers belong to `blobs`. Do not
  create `mpdefault.cfg` in `/userdata/base`: the homepath is searched before
  the PK3s, so an empty file shadows the real one in `assets2.pk3` and
  `FS_InitFilesystem` aborts.
- Keep the central-directory cache in `engine.worker.ts`. WORKERFS reads use
  `FileReaderSync`; minizip's per-entry central-directory walk otherwise took
  ~85 s to boot four retail PK3s. The cache brings boot to ~2.2 s. File data
  remains lazy.
- The main thread must not call into wasm while the worker host is active. The
  app reads a cached status/scoreboard from `WorkerEngineHost`; free-cam, cvar
  and follow calls are fire-and-forget messages that the worker drops while a
  long call is running.
- The OffscreenCanvas transfer is irreversible. `WorkerEngineHost.boot` only
  preflights a worker/WebGL2 probe before transferring; keep any new fallback
  check before `transferControlToOffscreen`.
- Worker mode must stay DOM-free: SDL video/input is not initialised, `IN_Frame`
  and the SDL quit path are skipped, and `JKA_SetWorkerMode(1)` disables
  `emscripten_sleep` in the scan/seek loops. Do not add `document`/`window`
  access to `win_emscripten.cpp` or the worker.
- `engine.worker.ts` keeps `CA_ACTIVE` inline (equal to `app/src/types.ts`).
  Vite dev serves a classic worker unbundled, so a runtime import would become
  an ESM `import` and the worker would fail to parse. Keep worker imports
  type-only; verify with the dev-server `?worker_file&type=classic` output or
  `grep '^import '` on the built worker chunk.
- The engine build must keep `-sENVIRONMENT=web,worker,node` (node keeps
  `verify-boot-node.sh` working), `-lworkerfs.js`, exported
  `FS`/`addRunDependency`/`removeRunDependency`, and the runtime GL proc lookup.
  The boot smoke needs the fixture-preload build
  (`BUILD_REND2=1 BUILD_CGAME=1`, no `NO_PRELOAD=1`); the app's `NO_PRELOAD=1`
  build has no `/jka/base/mpdefault.cfg` for a standalone boot.
  `-sOFFSCREENCANVAS_SUPPORT=1` is pthread-scoped and is not used; the whole
  module runs in the worker. `-sDISABLE_DEPRECATED_FIND_EVENT_TARGET_BEHAVIOR=0`
  is required so target 0 resolves to `Module.canvas` (the newer selector-only
  lookup cannot find an OffscreenCanvas in a worker).

## Audio

- Sound is on: `buildEngineArgs` passes `s_initsound 1`. Both hosts use the
  engine's software mixer; `engine/platform/em_audio.cpp` (copied into
  `codemp/client/`, patch `0010` replaces `shared/sdl/sdl_sound.cpp` on
  Emscripten) is the DMA backend.
- `mp3code/towave.c`'s `C_MP3Stream_Decode` must keep the two-argument
  signature declared in `snd_mp3.h`. Native ABIs ignored the extra argument;
  wasm-ld inserts a signature-mismatch trap that aborts playback as soon as
  demo music reaches the decoder (patch `0010`).
- The wasm module never opens SDL audio. It calls `Module.jkaAudio`
  (`open/submit/playFrame/clear/close`), which the main-thread host implements
  directly with `app/src/engine/audio.ts` and the worker implements by
  forwarding PCM to the page. `AudioContext` does not exist in a dedicated
  worker; keep audio code on the page.
- `SNDDMA_GetDMAPos` must track audible playback: the page reports the frame
  currently audible from its scheduling frontier (`nextFrame` minus the queued
  audio), and the worker extrapolates from `audio-clock` messages. The engine
  derives `s_soundtime` and its mix-ahead from it.
- `SNDDMA_Submit` sends the slice of the mix-ahead window that just became
  final (the paint start moved forward), not the far end of the 16384-frame
  stereo ring. The engine repaints the whole 200 ms window every frame and can
  still mix a new sound into the tail, so the tail is not final; sending it
  delayed every new sound by 150–200 ms. A zero delta is `S_ClearSoundBuffer`
  (drop queued audio); a backward paint start is a rebase after `snd_restart`.
- Page playback is a scheduling frontier (`nextFrame`/`nextTime`): final blocks
  are appended back-to-back, overlapping frames are trimmed and gaps re-anchor.
  Do not map absolute engine frames to one fixed AudioContext anchor: a
  missed ring wrap then becomes a permanent one-ring (371 ms) A/V delay. The
  frame clock starts on the first PCM block, not in `open()`, and the worker
  clock only extrapolates after the page reports `started` (otherwise a long
  boot task invents seconds of playback). Keep the 120 ms queue cap: a stalled
  frame can finalize a large range, and trimming its stale front re-aligns
  instead of carrying the lag for the rest of the demo.
- Freeze the page clock around long engine calls (`play`, `prepare`, `seek`,
  `demo-info`, `add-map`): a map load can block the engine loop for tens of
  seconds, and a `GetDMAPos` jump of several ring buffers breaks the mixer's
  wrap counter (observed as a wasm `unreachable` after the first demo frame).
  The worker also rebases both clocks when `GetDMAPos` is not called for more
  than 1.5 s (background tab).
- `HEAP16` is not exported on `Module`; copy PCM inside the `EM_ASM` snippet
  where the heap view is in scope, then hand the buffer to `jkaAudio.submit`.
- Stop suspends the page AudioContext (and drops queued sources); Play, Resume
  and Check map resume it. Release/destroy closes it. Demo Pause does not touch
  audio.
- The player's Sound popover writes `s_volume` (effects), `s_musicvolume` and
  `s_volumeVoice` through `setCvar`; the mixer reads them live, so no engine
  rebuild or special call is needed. Volumes persist in app settings.
  `?sound=0` keeps `s_initsound 0` for silent troubleshooting.

## Demo model

- `JKA_DemoInfo` builds the per-game summary and in-memory keyframes;
  `JKA_DemoSummaryJson` returns it. `JKA_SeekDemo` restores the nearest
  keyframe in the target game and replays to the target, resetting the cgame in
  place. `JKA_FindKeyframe` must prefer a keyframe from the target game; the
  nearest earlier keyframe may belong to a previous game and force a map/game
  reload.
- Keyframes store the full snapshot and `cl.gameState` after the scan has
  executed the message's `cs`/`bcs` commands. The scan is parse-only
  (`jka_scanOnly`) and must not trigger `CL_InitDownloads`; that is also what
  fixed the added-map-PK3 scan (`added-map.pk3`: 24,359 messages, 20 keyframes, two
  games).
- Game boundaries come from `svc_gamestate`, map changes, `map_restart` server
  commands and `CS_LEVEL_START_TIME` changes. A command restart opens the next
  game; the delayed level-start update is merged, not treated as another game.
  Do not start a game on every level-start change; zero-stat restart gaps are
  filtered in `JKA_BuildSummary`.
- Obituary events are freestanding event entities: the event is
  `eType - ET_EVENTS`, not `state->event`, and a temp entity repeats for several
  snapshots. The scan mirrors cgame's per-entity previous-event dedupe. Removing
  either rule overcounts kills/deaths.
- `jka_demoGamestates` is incremented in `CL_ParseGamestate`; the bridge uses it
  for game segments.
- The app overrides the cgame's incomplete K/D with the parsed event summary in
  `app/src/summary.ts`/`mergeScoreboard`. Keep that merge; cgame-only counters
  are wrong after seeks and map restarts.

## App/caching gotchas

- Summary cache keys are versioned (`v4:name:size:lastModified`). Bump the
  version when the summary shape or game-boundary logic changes; otherwise old
  one-game summaries are reused. The IndexedDB cache self-heals a missing store.
- A cached summary does not contain the in-memory seek keyframes. The app's
  `keyframesReady` flag forces one scan per engine/demo (including after
  Release or a demo switch); with keyframes present, Check map can use the
  cached summary. Do not remove that condition or warm seek silently falls
  back to the full keyframe reload.
- Check map now uses the parse-only scan, so it does not load a map/cgame. Map
  presence is still checked with `JKA_HasMap`; map/asset errors surface during
  the background prepare or Play instead of at Check map.
- There is no asset cache. The worker host mounts the retail/mod PK3s read-only
  with WORKERFS and writes only demos and added map PK3s to `/userdata/base`.
  The main-thread fallback still copies PK3s into MEMFS. `app/src/fs/assetCache.ts`
  exists only for `clearLegacyAssetCache()`, which removes the old
  `jka-demo-player/assets` OPFS tree once on startup and from Settings; do not
  add a write path back. The asset-set comparison uses `assetSetKey` in
  `app/src/fs/signature.ts`, not a cache key.
- `r_gamma` is applied to the engine at boot only; runtime changes use the
  canvas gamma filter. Setting `r_gamma` live does not re-upload textures.
- Remote follow cameras use the entity's yaw and pitch; the recorded POV client
  stays first-person. Dead players use a level pitch.

## Verification and sharing

- There is no committed unit/e2e/lint suite. `npm run build` is the required
  check; browser playback needs a real Jedi Academy asset set and demo supplied
  locally (never commit them).
- `scripts/verify-demo.mjs` requires `ASSETS_DIR` and `DEMO`/`DEMO_FILE` and the
  engine web harness, not the React app. `engine/scripts/verify-boot-node.sh`
  checks a standalone engine build; use the fixture-preload build described
  above, not the app's `NO_PRELOAD=1` output.
- Use one headless browser/profile at a time. Multiple Chromium instances with
  large wasm heaps (and the fallback MEMFS copy) can exhaust the host; clean
  temporary profiles and kill the process group when finished.
- `engine/platform/web/worker-smoke.html` and `engine-worker.js` are the Phase 3
  GL-in-worker gate. Run the smoke page before claiming the worker path works;
  `?assets=1&demo=<name>` needs local game files beside the page (never
  committed). The React app's fallback is `?worker=0`.
- Never commit `*.pk3`, `*.dm_26`, maps, models, sounds, screenshots, logs,
  wasm artifacts or local browser profiles. Check with `git ls-files` before
  release.
- License is GPL-2.0-only. If dependencies or assets change, update
  `THIRD_PARTY_NOTICES.md` and keep the OpenJK source offer accurate. Do not
  add personal paths, demo/player names or demo hashes to shared docs.
