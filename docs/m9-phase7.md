# M9 Phase 7: release hardening

**Status:** In progress. Tree audit, sanitized docs, clean full build, standalone
boot smoke, Chromium seek soak and deployment checks are done. Brave Task
Manager numbers and the deployed-site smoke are still needed from the user.

## Scope

Prepare the M9 build for release without changing gameplay. No multi-map demo
exists in the test set (`MULTI COUNT 0` across the local demos), so cross-map
seek is documented as an untested edge case rather than optimized.

## Audit results

| Check | Result |
|---|---|
| Working tree | clean before the audit; only the intended docs/workflow edits below |
| Tracked retail assets/demos (`*.pk3`, `*.dm_26`, `*.bsp`, screenshots) | none |
| Tracked wasm/built engine (`app/public/engine`, `app/dist`) | none |
| Tracked logs, browser profiles, secrets | none |
| Absolute personal paths in tracked text | none |
| Personal demo names in shared docs | replaced with `demo.dm_26` / `added-map.pk3` |
| Pinned OpenJK commit | `260c59c2907187af555a676fe0cc798893bf7757`, unmodified |
| Package version | `0.1.0` (version/tag decision pending) |

## Clean build

From the pinned OpenJK commit with `0001`–`0009`, Emscripten 6.0.1:

```bash
rm -rf /tmp/jka-demo-player/{work,build,out}
EMSDK=$HOME/emsdk \
BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
WORK=/tmp/jka-demo-player/work \
BUILD=/tmp/jka-demo-player/build \
OUT=/tmp/jka-demo-player/out \
engine/scripts/build-mp-wasm.sh
scripts/stage-engine.sh /tmp/jka-demo-player/out
npm --prefix app run typecheck
npm --prefix app run build
```

Result: engine and app build cleanly. The only linker warning is the
pre-existing `C_MP3Stream_Decode` signature mismatch in the disabled audio
path. The bridge's redundant little-endian scan conversion was removed.

The standalone boot smoke needs the fixture-preload build (no
`NO_PRELOAD=1`), because the app build intentionally has no
`/jka/base/mpdefault.cfg`:

```bash
rm -rf /tmp/jka-demo-player/verify-*
EMSDK=$HOME/emsdk BUILD_REND2=1 BUILD_CGAME=1 \
WORK=/tmp/jka-demo-player/verify-work \
BUILD=/tmp/jka-demo-player/verify-build \
OUT=/tmp/jka-demo-player/verify-out \
engine/scripts/build-mp-wasm.sh

OUT=/tmp/jka-demo-player/verify-out WAIT=15 \
engine/scripts/verify-boot-node.sh
```

Result: **PASS** — OpenJK banner, FS startup, `/jka/base`, `/userdata/base`,
disabled networking, static boot renderer and `Common Initialization Complete`.
The app's `NO_PRELOAD=1` output is not a valid input to that smoke.

## Chromium soak

Worker host, retail demo:

- 20 alternating seeks between 10% and 90%.
- Seek UI times: **455–757 ms**, including the test's 150 ms input settle and
  status polling; the engine reports tens of milliseconds.
- `performance.memory.usedJSHeapSize`: **5.73 MB → 5.33 MB**.
- No page errors, no aborts, no ended overlay.
- Stop returned to the map step normally.

This is a JS-heap sanity check, not tab memory. Brave Task Manager should be
recorded at page load, after prepare, after Play, after the same 20 seeks, after
Stop and after Release.

## Deployment

- Fixed the Pages workflow branch from `master` to `main`; the repository is on
  `main`, so the previous trigger would not run on push.
- `docs/github-pages.md` now says `main`.
- The workflow still builds `BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1`, stages
  `app/public/engine`, builds `app/dist` and deploys it.
- Pages source must be **GitHub Actions**; no game assets are deployed.

## Docs

- `docs/m7.md` updated from the OPFS-era text to WORKERFS/no asset cache, the
  `0001`–`0009` patch set, and the current known limitations.
- Demo/map names in shared docs are generic.
- README limitations now cover same-map-only warm seek, added-map demos and the
  first-snapshot HUD transient.
- AGENTS documents the fixture-preload requirement for the node boot smoke.

## Remaining release checks

- Brave Task Manager: page load, engine ready, prepared, Play, after 20 seeks,
  Stop, Release.
- Confirm no memory growth across repeated seeks in Task Manager.
- Smoke the deployed Pages build from a clean browser profile with legal local
  assets; test worker and `?worker=0`.
- Decide whether to bump `app/package.json` from `0.1.0`, set the public git
  identity/remote, tag and push.
- Re-test Watch again, Release and Settings cache clearing in the deployed
  build.

## Known limitations

- Cross-map seek/Restart is a full map/cgame load and is not release-validated;
  no multi-map demo exists in the test set.
- Mods with extra cgame globals or unusual server commands are not broadly
  exercised beyond the added-map demo.
- Audio is disabled.
- The first-snapshot HUD can show that snapshot's gamestate values briefly.
- Keyframes are per engine/session; a reload rebuilds them with the parse-only
  scan.
