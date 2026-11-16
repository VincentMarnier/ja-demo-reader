# AGENTS.md

## Start here

- `README.md` is the product/build overview; `docs/m7.md` is the release audit;
  `docs/m8.md` describes the demo summary, cache and seek internals;
  `docs/m9-phase0.md` is the diagnostics build and baseline checklist,
  `docs/m9-phase0-results.md` records the measured baseline, and
  `docs/m9-phase1.md` describes the hybrid shader compile and texture profile.
- The app is a single Vite/React app in `app/`. `App.tsx` owns the wizard and
  player state, `engine/EngineHost.ts` owns the wasm bridge, and `src/fs/` owns
  file validation/staging/caching.
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
  set is `0001`–`0007`; `0004` contains the linked cgame/rend2 changes,
  `0005` keeps the last frame when a demo ends, `0006` adds M9 `jka_profile`
  diagnostics (timings, image counters, shader usage), and `0007` adds the
  hybrid eager/lazy shader compile. Prefer a new patch over editing a large
  existing one. Verify every patch with a clean worktree: apply all patches
  from the pin and compare the affected files.
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
  filesystem restart, map load) is serialized by `EngineHost.runExclusive`.
  Keep it that way; overlapping `ccall(..., { async: true })` calls abort with
  “We cannot start an async operation when one is already in flight”.
- `playDemo` is single-flight. Replay/Restart must not start a second map load;
  the Watch again/Restart UI handlers also share a guard.
- Status polling skips while an async call is running. Do not add another poll
  or synchronous cgame call that can run during a map load.
- `JKA_DemoInfo` pauses the main loop, disconnects and scans the whole demo. Do
  not run it during playback; it is part of the serialized setup path.
- `CL_DemoCompleted` in the Emscripten branch intentionally leaves the last
  frame in place. Disconnecting there leaves renderer/map teardown in flight and
  breaks Replay. Stop still does a full disconnect.

## Demo model

- `JKA_DemoInfo` builds the per-game summary and in-memory keyframes;
  `JKA_DemoSummaryJson` returns it. `JKA_SeekDemo` uses warm keyframes while
  playing and restarts from the nearest keyframe for backward/cold seeks.
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

- Summary cache keys are versioned (`v3:name:size:lastModified`). Bump the
  version when the summary shape or game-boundary logic changes; otherwise old
  one-game summaries are reused. The IndexedDB cache self-heals a missing store.
- OPFS caches the four retail PK3s (about 1.14 GB); IndexedDB caches summaries.
  Settings can clear both. Do not preload OPFS assets at page load; the engine
  starts staging after the user chooses assets to avoid a 1.14 GB memory spike.
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
  checks a standalone engine build.
- Use one headless browser/profile at a time. Multiple Chromium instances with
  1.14 GB OPFS assets and wasm heaps can exhaust the host; clean temporary
  profiles and kill the process group when finished.
- Never commit `*.pk3`, `*.dm_26`, maps, models, sounds, screenshots, logs,
  wasm artifacts or local browser profiles. Check with `git ls-files` before
  release.
- License is GPL-2.0-only. If dependencies or assets change, update
  `THIRD_PARTY_NOTICES.md` and keep the OpenJK source offer accurate. Do not
  add personal paths, demo/player names or demo hashes to shared docs.
