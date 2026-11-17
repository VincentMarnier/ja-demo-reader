# M9 Phase 5: warm seek, Restart and scan-only Check map

**Status:** Implemented in both hosts and measured in headful Chromium 149.
Backward seeks, forward seeks and Restart now reinitialize the cgame in place
instead of reloading the renderer/map. Check map no longer starts the renderer
or cgame, so the scan behind it dropped from ~8 s to **0.25–0.5 s** in the
worker (1.4–1.7 s in the fallback). The demo-scan failure on added
map PK3s is also fixed.

**Update:** Phase 6 applies the keyframe→target server commands during the
reset, so scores/level-start/clientinfo are current on the first frame; see
`docs/m9-phase6.md`.

**Scope:** Remove the repeated map/cgame load from backward seek and Restart,
make Check map cheap, and keep the full-reload path for map/game changes and
failure cases.

## Target scorecard

| Target | Phase 4 | Phase 5 | State |
|---|---:|---:|---|
| Check map ≤ 2 s | 8.0–8.5 s | **0.25–0.51 s** worker; **1.41–1.66 s** fallback | met |
| Backward seek ≤ 0.6 s | 7.99 s (`path=keyframe`) | **56–66 ms** engine; **0.26–0.66 s** UI to start | met |
| Forward seek | 1 ms warm | **151–160 ms** engine; **0.16–0.76 s** UI | met |
| Restart ≤ 0.5 s | 7.8–10.8 s | **0.30–0.31 s**; **0.20 s** after the demo ended | met |
| First Play ≤ 10 s | 0.0 s prepared | unchanged | met |
| Map-loaded memory | 275–280 MB Brave | unchanged | met |

Restart is warm only within the same map. A map change still takes the full
load; that is the honest fallback, not a hidden timer.

## What changed

| Area | Change |
|---|---|
| Engine patch | New `0009-cgame-warm-seek.patch`: a `CG_SeekReset` cgame export, an in-place seek reset, the scan-only gamestate path, and an EOF guard. |
| Keyframes | `JKA_SeekKeyframeWarm` restores the nearest keyframe, replays to the target and resets the cgame without `CL_Disconnect` or a map load. |
| Keyframe selection | Keyframes are selected within the target game, not merely the nearest earlier keyframe across a game boundary. |
| Cgame | `CG_SeekReset` clears entity/snapshot/per-demo state while keeping the map, renderer, registered media, world item visuals, client ghoul2 models, custom saber hilt instances and the default `g2WeaponInstances`. |
| Scan | `JKA_ScanDemo` sets `jka_scanOnly`; `CL_ParseGamestate` rebuilds configstrings/snapshots but skips `CL_InitDownloads`, the map load and cgame init. |
| Keyframe gameState | The scan executes `cs`/`bcs` server commands while scanning, so a keyframe's configstrings match live playback. |
| App | Check map scans when this engine has no keyframes for the demo; Restart and Watch again use a warm seek to the first snapshot. |
| Robustness | Replay loops stop when the demo file stops advancing, and `CL_SetCGameTime` stops reading at `jka_demoEnded` so a seek to the last snapshot cannot loop forever. |

## How the warm seek works

1. `JKA_SeekDemo` pauses the main loop and finds the nearest keyframe at or
   before the target **in the same game**. A different map returns 0 and uses
   the old full-reload path.
2. The keyframe restores `cl.gameState`, baselines, the full snapshot, parse
   entities and `clc` sequence/client state, then seeks the open demo file to
   the keyframe's resume offset.
3. `CL_ReadDemoMessage` replays from the keyframe to the target. The replay
   stops if the file position stops advancing (EOF, because
   `CL_DemoCompleted` leaves the file open in this build).
4. `CG_SeekReset` clears `cg`, `cg_entities`, local entities, marks and the
   FX/ROFF state. It keeps the map, collision map, registered media, world
   item visuals, each client's ghoul2 body model and custom saber hilt
   instances, and the default `g2WeaponInstances` resident. It rebuilds
   `cgs.gameState`, serverinfo, config values, clientinfo and permanent
   entities, clears each client's cached saber trail (segment base/tip,
   timestamps and mark history), applies the retained server commands through
   the target sequence (Phase 6), and starts the cgame at the oldest snapshot
   still in the client ring.
   The saber blade is placed with a bolt matrix on the **hilt model** copied
   into the player ghoul2. Freeing the clientinfo body/hilt instances or
   `g2WeaponInstances` and then rebuilding clientinfo does not recreate an
   unchanged custom hilt, so the hilt index/bolt is missing and the blade
   appears at the wrong place. The trail is separate world-space cached state;
   without clearing it a seek can leave a saber "laser" at the pre-seek
   position.
5. `cl.serverTime` is set to the target snapshot and the main loop resumes.
   The cgame requests snapshots from the ring edge to the target, executes the
   retained server commands and draws normally.

`JKA_SeekKeyframeWarm` clears `jka_demoEnded`; without that, Watch again after
the demo ended would seek the engine back to the start but the status poll
would immediately put the UI back into the ended overlay.

The full keyframe reload (`demo` + `CL_Disconnect` + map/cgame load) remains
for a different map, a failed keyframe restore, a closed demo file or a demo
without keyframes. It also remains the safety net if a keyframe's game does
not match the target.

## Check map is now a parse-only scan

`JKA_DemoInfo` still pauses the loop, disconnects and scans the whole demo, but
the scan now sets `jka_scanOnly`. During that flag:

- `CL_ParseGamestate` parses configstrings and baselines and **returns before
  `CL_InitDownloads`**, so no map, renderer or cgame load is triggered.
- `clc.demoplaying` is set during the scan so the gamestate path treats it as
  demo state.
- The scan executes `cs`/`bcs` server commands as it parses. That is what makes
  each keyframe's `gameState` match the state at that snapshot; without it a
  keyframe could restore scores and level-start values from the initial
  gamestate (observed as 4–1 and 1:02 at the demo start instead of 0–0 and
  0:01).
- Map presence is still checked from the filesystem (`maps/<map>.bsp`), so the
  map step is accurate even though no BSP was loaded.

The app keeps a `keyframesReady` flag per engine/demo. On the first Check map,
or after Release/switching demos, it scans even if the summary came from
IndexedDB. Later Check maps (`Stop` → map step) reuse the cached summary and
the existing keyframes, so that path stays fast.

The old custom-map demo scan failure (`messages=0`) was caused by the scan's
map/cgame load. With parse-only scanning the same `asms.pk3` demo scans
`messages=24359, snapshots=24352, keyframes=20, gamestates=2` and shows its two
games in the summary.

## Measurements

Headful Chromium 149 for Testing, Linux desktop, retail assets and
`blacksun_vs_cerberus_r1.dm_26`, worker host:

| Step | Measured |
|---|---:|
| Check map (parse-only scan) | **0.25–0.51 s** |
| Backward seek to 0 | **56–66 ms** engine; **0.26–0.66 s** UI |
| Forward seek to 60% | **151–160 ms** engine; **0.16–0.76 s** UI |
| Seek near the end | **340–415 ms** engine; **0.76 s** UI |
| Restart (warm, first snapshot) | **45–63 ms** engine; **0.30–0.31 s** UI |
| Watch again after the demo ended | **33–35 ms** engine; **0.20 s** UI |
| Page errors | none |
| `way out of range` warnings | none |

The UI values include React state updates and the status poll; the engine
values are the `JKA_PROFILE seek ... path=warm-inplace` times. Backward seek is
faster than the old 7.99 s keyframe reload because there is no `CL_InitCGame`,
no BSP reload and no image registration.

The main-thread fallback (`?worker=0`), same demo:

| Step | Measured |
|---|---:|
| Check map (scan 647–719 ms) | **1.41–1.66 s** |
| Backward seek | **7 ms** engine; **0.37–0.38 s** UI |
| Forward seek | **66 ms** engine; **0.23 s** UI |
| Restart | **6 ms** engine; **0.21 s** UI |

The fallback stays under the 2 s Check map target and gets the same warm seek.

## Verification status

Done in this checkout:

1. Patch `0009` applies cleanly after `0001`–`0008` from the pinned OpenJK
   commit; the engine builds with Emscripten 6.0.1.
2. `npm --prefix app run typecheck` and `npm --prefix app run build` pass.
3. Worker run: Check map 0.25–0.51 s, backward 56–66 ms, forward 151–160 ms,
   near-end 340–415 ms, Restart 0.30–0.31 s, Watch again 0.20 s, no page
   errors.
4. Fallback run: Check map 1.41–1.66 s, backward 7 ms, forward 66 ms,
   Restart 6 ms, no page errors.
5. A seek to the last snapshot ends the demo and shows the **Demo finished**
   overlay within ~3 s instead of wedging in `CL_SetCGameTime`.
6. The added-map-PK3 demo now scans 24,359 messages and 20 keyframes; its
   summary shows two games.
7. No `CG_ReadNextSnapshot: way out of range` warning after warm seeks.
8. Clientinfo ghoul2 body/saber-hilt instances survive the reset and
   `CG_CopyG2WeaponInstance` can copy the hilt into the player model again;
   saber trail caches are cleared, so the blade and trail use the target
   position.

Outstanding:

- Cross-map seeks still use the full load; a future phase could carry a
  second map or keep a map cache.
- The cgame soft reset keeps map media but rebuilds per-demo state; unusual
  mods that keep extra global cgame state across map loads need testing.
- The HUD score/timer can show the target's initial gamestate values for a
  few seconds after a seek to the very first snapshot until the later
  configstring commands are replayed. The demo/score summary is correct at the
  same time.
- Brave Task Manager was not re-measured; the loaded footprint is unchanged
  from Phase 4 (the same map/cgame/renderer stay resident).

## Known risks

- **`CG_SeekReset` is a soft reset.** It must keep item visuals and cge media
  that are map-level while clearing entity/snapshot state. Do not replace it
  with `CG_Init` (map load) or `CG_Shutdown`-only (stale snapshots) without
  re-testing new games, duels and view weapons.
- **Do not call `CG_KillCEntityG2` for client entities in the reset.** For a
  client it also frees `clientInfo_t.ghoul2Model` and the custom
  `ghoul2Weapons[]` hilt instances. `CG_NewClientInfo` keeps unchanged saber
  info, so it will not recreate them; the saber blade then has no hilt bolt
  and can render at the wrong position. Free only the client entity's
  `ghoul2`/`grip_arm`/`frame_hold`; keep `g2WeaponInstances` too.
- **Saber trails are cached in `clientInfo_t`** and copied by
  `CG_NewClientInfo`; clear them after rebuilding clientinfo or the trail can
  draw at the pre-seek position.
- **EOF is not a disconnect here.** `CL_DemoCompleted` leaves `CA_ACTIVE` and
  the demo file open. `CL_SetCGameTime` must keep the `jka_demoEnded` break;
  removing it reintroduces an infinite read loop when the seek target is the
  last snapshot.
- **Keyframes are in memory.** A fresh engine or a demo switch needs a scan.
  The app scans on the first Check map even with a cached summary; do not
  remove that or warm seek silently degrades to the full path.
- **Scan-only skips the map load.** Errors that only occur while loading a map
  now appear during the background prepare/Play instead of Check map. Map
  presence is still validated from the filesystem.
- **Cross-map seek is a full load.** The UI should not claim a warm seek when
  the keyframe's game has a different map; the bridge returns 0 and the old
  path runs.
- **Server-command replay is selective.** Warm seek applies configstring
  updates and retained commands, not every cgame event between keyframe and
  target; that is intentional for a seek and keeps the result close to the
  target frame.

## Files

- `engine/patches/0009-cgame-warm-seek.patch` (new)
- `engine/platform/jka_bridge.cpp`
- `app/src/App.tsx`
- `docs/m9-phase4.md` (pointer to this phase)
