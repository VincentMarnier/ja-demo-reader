# M9 Phase 0: first baseline results

**Status:** Baseline recorded; gate findings are actionable.
**Host:** Brave on Ubuntu, cold page load for each session, retail map
`mp/ffa2`, retail four-PK3 asset set, protocol-26 demo.
**Engine:** diagnostic `PROFILE=1` build (`jka_profile` on).

Three sessions were run:

- **Default, cached summary:** `http://localhost:5173/`
- **Fast, cached summary:** `http://localhost:5173/?profile=fast`
  (`r_picmip 2`, `r_textureMode GL_LINEAR`)
- **Default, clean cache:** same URL after **Clear cached game data**, so the
  demo was actually scanned and keyframes existed. This run supersedes the
  cached-summary Check map/seek rows; the earlier rows are kept to show the
  cached path.

The `JKA_PROFILE session ... diagnostics=0` line records the URL flag only.
The diagnostic build had `jka_profile` on by default; every run produced
`JKA_PROFILE` engine lines.

## Timings

Values are from the second renderer initialisation onward, because Play,
Restart, seek and Stop restart the renderer.

| Stage | Default | Fast |
|---|---:|---:|
| Boot: staging done to engine ready | 19.44 s | 19.29 s |
| `R_Init` total | 19.05 s | 18.86 s |
| Shader compile: 671 programs | 18.60 s | 18.46 s |
| Check map | 16.6 ms (cached summary) | 18.5 ms (cached summary) |
| Play: `JKA_PlayDemo` | 21.61 s | 21.55 s |
| Play: shader compile inside `JKA_PlayDemo` | 18.51 s | 18.47 s |
| Restart | 21.30 s | 21.06 s |
| Forward seek | 20.84 s (`replay`) | 21.80 s (`replay`) |
| Backward seek | 20.61 s (`replay`) | 21.28 s (`replay`) |
| Stop | aborted (see below) | aborted (see below) |
| `CL_InitCGame` | 2.30 s | 2.27 s |
| `CG_Init` total | 2.29 s | 2.27 s |
| `CG_Init` setup | 0.68 s | 0.65 s |
| `CM_LoadMap` | 34 ms | 32 ms |
| `RE_LoadWorldMap` BSP | 0.83 s | 0.83 s |
| `CG_RegisterGraphics` | 1.11 s | 1.12 s |
| `CG_RegisterClients` | 0.36 s | 0.36 s |
| HUD menu | 45 ms | 43 ms |
| `RE_EndRegistration` | 2 ms | 1 ms |

The map/cgame total is about **2.3 s**, not 39 s. The substantial Play cost is
the renderer restart and its 671-program shader compile: roughly 18.5 s. The
remaining ~0.8 s is the demo start/teardown around the cgame load.

### Clean-cache default run

| Stage | Measured |
|---|---:|
| Check map (includes the scan) | 22.09 s |
| `demo_scan` | `scanMs=21932`, `totalMs=22064` |
| Scan input | 18,688 messages, 18,687 snapshots, 7 full snapshots, 1 gamestate |
| Keyframes built | 75 |
| During the scan: `R_Init` | 19.04 s |
| During the scan: `CL_InitCGame` | 2.36 s |
| Play after the scan | 21.78 s |
| Play shader compile | 18.62 s |
| Forward seek | 4.8 ms total; `path=warm ms=2` |
| Backward seek | 21.46 s; `path=keyframe ms=21460` |
| Backward seek shader compile | 18.17 s |
| Backward seek `CL_InitCGame` | 2.26 s |

The scan is **21.9 s**, but it is not 21.9 s of message parsing. The first
gamestate parsed during the scan triggers a full renderer restart and cgame
load: `R_Init` 19.04 s plus `CL_InitCGame` 2.36 s. Subtracting those leaves
about **0.54 s** for reading 18,688 messages and building 75 keyframes. A fast
JS block index would save a fraction of that 0.54 s; avoiding the renderer/cgame
initialisation during the scan is the real win.

The backward keyframe seek has the same shape: 21.46 s, of which 18.17 s is
shader compilation and 2.26 s is cgame/map load. The keyframe restore itself is
not the cost. The warm forward seek is **2 ms**, but the log also reports
`CG_ReadNextSnapshot: way out of range` on the next frame, so Phase 5 must
validate that the warm snapshot state is correct before claiming the seek
target.

## Images

`world_load` (BSP + lightmaps + initial images):

| Metric | Default | Fast |
|---|---:|---:|
| Images | 61 | 61 |
| Estimated bytes | 112.5 MB | 112.5 MB |
| Decode | 577 ms | 587 ms |
| Upload | 100 ms | 105 ms |

`end_registration` (map + cgame registration):

| Metric | Default | Fast |
|---|---:|---:|
| Images | 323 | 323 |
| Estimated bytes | 159.7 MB | 159.7 MB |
| Decode | 791 ms | 806 ms |
| Upload | 140 ms | 135 ms |

The fast profile printed `texturemode: GL_LINEAR` and `picmip: 2` in the
engine header, but did not change these image totals or the cgame load. Either
these images are not affected by `r_picmip` (lightmaps, compressed sources) or
the byte estimate reflects source dimensions rather than uploaded dimensions.
The time is the reliable measurement here; the texture profile did not buy a
measurable load win on this run.

## Shader usage

The useful sample is the shutdown taken after a full Play (the `restart:start`
or `seek:start` renderer shutdown), not the boot renderer. In the clean-cache
run, the shutdown after Play reported `frames=1352 used=18`: generic 6
(`0,4,16,24,36,48`), lightall 8 (`0,1,3,4,5,16,18,32`), fog 2 (`0,2`),
refraction 1 (`2`) and textureColor 1 (`0`). The union below includes the
additional generic variants seen in the cached-summary runs.

| Group | Default used | Fast used | Indices (union of both) |
|---|---:|---:|---|
| generic | 7 | 8 | 0, 4, 16, 20, 24, 36, 38, 48 |
| lightall | 8 | 8 | 0, 1, 3, 4, 5, 16, 18, 32 |
| fog | 2 | 2 | 0, 2 |
| refraction | 1 | 1 | 2 |
| textureColor | 1 | 1 | 0 |
| splash | boot only | boot only | 0 |
| everything else | 0 | 0 | — |

Compiled at boot: 671 programs, 998 compile slots
(128 generic, 256 lightall, 287 other). After a full Play, **19–20 programs
were used**. All post-process groups (`tonemap`, `calclevels4x`, `ssao`,
`depthblur`, `gaussianblur`, `bokeh`, `downscale4x`, `glowComposite`,
`dglowDownsample`, `dglowUpsample`, `pshadow`, `vshadow`, `prefilterEnvMap`,
`testcube`, `weather*`) were compiled and unused. `sprite` compiled 192 of
256 and none were used.

This is the Phase 1 eager-set evidence: the renderer can start with the splash,
the used generic/lightall variants, fog 0/2 and textureColor, then compile the
rest on first use. A small margin should cover map-specific or UI-only variants
before the measured set is trusted for release.

## Memory

| Marker | Default | Fast |
|---|---:|---:|
| wasm heap | 768 MB | 768 MB |
| MEMFS after staging | 1.225 GB | 1.225 GB |
| Browser storage estimate | 1.225 GB | 1.225 GB |
| JS heap at engine ready | 1.245 GB | 1.249 GB |
| JS heap after Play | 1.254 GB | 1.248 GB |
| JS heap after Restart | 1.275 GB | 1.259 GB |
| JS heap after seek | 1.274 GB | 1.286 GB |
| Hunk free after boot | 30.1 MB | 30.1 MB |
| Hunk free after Play | 13.8 MB | 13.8 MB |

The clean-cache run reported tab-hover values of **40 MB after engine ready,
52 MB after Check map, and 1.4 GB after Play**. The 40/52 MB readings do not
agree with the in-page `performance.memory`/MEMFS readings at the same points
(~1.25 GB), so they are probably not counting the wasm/MEMFS allocation. Use
Brave's **Shift+Esc Task Manager** and read the tab's Memory footprint to
confirm. The 1.4 GB after Play is consistent with the in-page numbers.

The in-page numbers show the ~1.25 GB JS/wasm footprint plus the 1.225 GB
MEMFS copy and a second 1.225 GB browser storage copy after the background
asset cache writes. The idle-tab target still needs a trustworthy Task Manager
reading.

## Gate findings

1. **Shader compilation is the dominant cost.** It runs on boot, Play,
   Restart, backward seek, Check map during a scan, and Stop. The 671 programs
   are compiled several times in a session; only about 20 are used. This
   changes the priority order: Phase 1 is the main win, and any
   renderer-preservation work is worth more than map trimming.
2. **The map/cgame load is ~2.3 s.** `CG_Init` setup 0.65–0.68 s, graphics
   1.1 s, clients 0.36 s, BSP 0.83 s, decode 0.8 s, upload 0.1 s, HUD 0.04 s.
   Phase 2 has little room; target only clear wins after Phase 1.
3. **The fast texture profile did not change the load or image totals.**
   Verify visually and on a texture-heavy map before making it the default.
4. **The demo scan is 21.9 s, but only ~0.5 s is scanning.** The first
   gamestate parsed by `JKA_ScanDemo` triggers `R_Init` (19.04 s) and
   `CL_InitCGame` (2.36 s); the remaining 18,688 messages and 75 keyframes cost
   about 0.54 s. A fast block index is not the fix. The scan should not
   initialise the renderer/cgame, or Check map should reuse that warm state
   instead of making Play repeat it. The cached-summary path is the fast path:
   Check map was 16–18 ms with no scan, but it had no keyframes and both seeks
   fell back to `path=replay`.
5. **Forward keyframe seek is 2 ms; backward is 21.5 s.** The warm path works
   and is effectively instant, but logs `CG_ReadNextSnapshot: way out of
   range` on the following frame, so its visual/state correctness is still
   unproven. The backward keyframe path is dominated by the 18.17 s shader
   compile and 2.26 s cgame load.
6. **Stop is not usable yet.** It performs `RE_Shutdown` and a full `R_Init`
   (another 18–19 s of shader compilation), then the earlier sessions aborted
   with `Assertion failed: We cannot start an async operation when one is
   already in flight`. The shader-usage lines were logged before the abort. The
   clean-cache run did not press Stop. Phase 4's keep-warm Stop must not take
   this renderer-restart path; the abort needs to be reproduced and fixed
   there.
7. **Worker APIs are present.** Brave reports Worker, OffscreenCanvas,
   `transferControlToOffscreen` and WebGL2 all available, with 15 cores and
   16 GB device memory. The Phase 3 GL-in-worker spike is viable from the API
   side; it still needs the actual spike.
8. **The 1.14 GB double copy is confirmed.** MEMFS 1.225 GB, browser storage
   1.225 GB, JS heap ~1.25 GB. WORKERFS plus removing OPFS remains the memory
   target.

## Remaining measurements

The gate data needed for Phase 1/2/3/5 is in place. Two items are still
untrustworthy:

- **Idle/map-loaded memory:** take a Brave `Shift+Esc` Task Manager reading for
  the tab after engine ready, after Check map, and after Play. The 40/52 MB
  tab-hover readings conflict with the in-page ~1.25 GB at those points.
- **Stop:** do not use it for the gate. The current path restarts the renderer
  and has aborted in Asyncify. Phase 4 replaces it with keep-warm/pause; the
  abort should be reproduced as part of that work.

The fast profile should only be rerun if the image byte discrepancy is being
investigated; it showed no load win on this map.
