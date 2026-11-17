# M9 Phase 4: prewarm, keep-warm Stop, Release

**Status:** Implemented in both hosts and measured in headful Chromium 149 and
Brave 157. Check map still costs ~8 s, but the demo now loads in the background
while the map step is visible, so the first **Play is immediate**. **Stop**
suspends the loaded demo instead of tearing it down (0 s), and **Release
memory** performs the full teardown and returns the app to the Demo step. In
Brave the tab was **45 MB** after page load, **125 MB** after engine boot/Check
map (before the background prepare completes), **275 MB** playing, **280 MB**
after keep-warm Stop and **95 MB** after Release; the user reported no errors.

**Update:** Phase 5 added warm backward/forward seek, Restart and the
parse-only Check map; see `docs/m9-phase5.md`. The Stop/Play/Release behaviour
below is unchanged.

**Scope:** Remove the repeated map/cgame load from Play and Stop, without
changing the engine's Asyncify/single-flight rules. Backward seek and the
demo-scan pure-list issue were out of scope for this phase.

## Target scorecard

| Target | Phase 3 | Phase 4 | State |
|---|---:|---:|---|
| Check map ≤ 2 s | 8.0–8.5 s | 8.0 s (scan + map/cgame load) | not met; prepare moves the cost |
| First Play ≤ 10 s | 8.0–8.3 s | **0.0 s** UI, after the background prepare | met |
| Play after Stop ≤ 1 s | 8.0 s (full reload) | **0.0 s** | met |
| Stop ≤ 0.5 s | 1.5–1.7 s full teardown | **0.0 s** suspend | met |
| Release memory | n/a | **1.8–2.0 s** teardown, back to Demo step; **95 MB** after (Brave) | met |
| Restart ≤ 0.5 s | 7.8–10.8 s | still full reload | not met; later phase |
| Map-loaded ≤ 800 MB | 290–298 MB (Brave) | **275–280 MB** playing/keep-warm (Brave) | met |

The first Play number is a UI-level result: the ~8 s map/cgame load still
happens, but it overlaps the map step and the user's reading of the summary.
Play only waits for the prepare if the user clicks before it finishes.

## What changed

| Area | Change |
|---|---|
| Bridge | `JKA_PrepareDemo`, `JKA_ResumeDemo`, `JKA_Suspend` and `JKA_Release`; `JKA_StatusJson` reports `prepared`/`suspended`. |
| Host API | `prepareDemo`, `resumeDemo`, `suspendDemo`, `releaseEngine` on `EngineHostApi`, implemented by both hosts. |
| Worker RPC | `prepare`, `resume`, `suspend`, `release` requests go through the worker's serialized `runExclusive` queue. |
| App | After a successful Check map, the demo is prepared in the background; Play resumes it. Stop suspends it. Release tears it down and replaces the worker/canvas. |
| UI | A preparing indicator on the map step and a **Release memory** button while the engine is active. |

## How it works

### Background prepare

After `Check map` resolves `map`/`hasMap`, the app calls `prepareDemo(name)`
without blocking the wizard. `JKA_PrepareDemo` runs the normal `demo "<name>"`
command and sets `r_m2_pause=1`, so the client reaches `CA_ACTIVE`, loads the
map, BSP, models and cgame, and then stops advancing on the first frame.

- The wizard stays visible while the load runs; a spinner explains the wait.
- `Play` calls `ensurePrepared`; if the background load is still running it
  joins the same promise instead of starting a second map load. If prepare
  failed, Play falls back to `playDemo` (the Phase 3 path).
- Check map awaits any in-flight prepare before scanning, so a scan and a
  background load cannot overlap in the engine.
- Switching demos while playing suspends the current demo first; the next
  Check map disconnects it through `JKA_DemoInfo` and scans the new demo.

`JKA_PrepareDemo` is idempotent for the same demo: when it is already
`CA_ACTIVE` and playing that demo it logs `already-warm` and returns. Play then
just resumes.

### prepared Play

`JKA_ResumeDemo` sets `r_m2_pause=0` and resumes the main loop. The map,
cgame, renderer textures and shaders are already resident, so the UI reaches
`playing` without a map load. `Play` still performs the normal UI reset
(scoreboard, follow, free-cam) before resuming.

After the demo ends, Play must not resume the ended frame. The app checks the
cached status `ended` flag for that demo and uses `playDemo` (full reload)
instead of `resumeDemo`.

### Keep-warm Stop

`JKA_Suspend` sets `r_m2_pause=0`, records `suspended`, and calls
`emscripten_pause_main_loop()`. It does **not** call `CL_Disconnect`, shut down
the renderer or free the map. The last presented OffscreenCanvas frame stays on
screen behind the wizard, and the wizard returns to the map step immediately.

This deliberately replaces the Phase 3 Stop, which did a full
`SV_Shutdown`/`CL_Disconnect`/`RE_Shutdown`/`R_Init` teardown in 1.5–1.7 s and
could race Asyncify on the fallback. Stop is now synchronous and has no wasm
teardown to race.

Consequences:

- Memory stays at the loaded level after Stop; that is the price of instant
  replay. **Release memory** is the explicit way to get it back.
- Status polling after Stop is idle; the cached status still reports the demo,
  which is what lets Play resume it.
- A new Check map after Stop scans through `JKA_DemoInfo`, which disconnects
  the suspended demo and resumes the loop as part of the scan. The wizard then
  prepares the selected demo again.

### Release memory

`JKA_Release` performs the full `JKA_StopDemo` teardown (`SV_Shutdown`,
`CL_Disconnect`, `CL_FlushMemory`, pure-list reset), clears the prepared name
and resumes nothing else.

The app then:

1. destroys the worker host (terminating the worker and its wasm memory);
2. clears the boot/prepared refs and the cached status;
3. increments the canvas key so React creates a fresh `<canvas>` (a transferred
   canvas cannot be transferred again);
4. returns to the **Demo** step, because the new engine has no demo or map
   staged.

On the main-thread fallback, releasing in place cannot return the wasm/MEMFS
memory reliably, and the full teardown can stall while the keep-warm loop is
paused, so the app skips `JKA_Release` there and calls
`window.location.reload()` directly. The user's asset selection is local state
and must be selected again after a reload; the worker path keeps it and only
needs a new Check map.

## Measurements

Headful Chromium 149 for Testing, Linux desktop, retail assets and
`blacksun_vs_cerberus_r1.dm_26` (18,688 messages, 75 keyframes), worker host:

| Step | Measured |
|---|---:|
| Engine ready | 1.4–1.5 s |
| Check map (scan + map/cgame load) | **8.0 s** |
| Background prepare after Check map | **7.5–8.5 s** |
| **Play from prepared state** | **0.0 s** |
| **Stop (suspend)** | **0.0 s** |
| **Play again after keep-warm Stop** | **0.0 s** |
| **Release memory** | **1.8–2.0 s** |
| Check map again after keep-warm Stop (cached summary) | **0.5 s** |
| Play after that check | **0.0 s** |
| Post-release Check map (cached summary) | **2.5 s** |
| Post-release prepare | **7.0 s** |
| Post-release Play after prepare | **0.0 s** |
| Page errors | none |

The `0.0 s` values are the UI transition after the host call resolves; the
engine work behind them is a cvar write plus `emscripten_resume_main_loop` or
`emscripten_pause_main_loop`, not a map load. The log shows a single
`JKA_PROFILE resume-demo` and no `FS_Startup` between suspend and the next
Play.

Check map after keep-warm Stop (same demo, cached summary) completed in
**0.5 s** and Play resumed in **0.0 s**: with a cached summary the app skips
`JKA_DemoInfo`, so the suspended demo is not disconnected. `JKA_PrepareDemo`
sees the same demo is still active, reports `already-warm`, and Play only
resumes it. Without a cached summary the scan disconnects the suspended demo
and the normal prepare path runs.

Post-release re-check (fresh worker and canvas):

- Check map completed in **2.5 s** because the parsed summary was already in
  IndexedDB, so the demo was not scanned again; the engine still booted cold.
- The background prepare then took **7.0 s** and Play resumed in **0.0 s**.
- The demo rendered again with no page errors and no second-transfer failure.
- Worker boot was logged once in the new worker, confirming the old worker was
  terminated and the replacement canvas was accepted.

The main-thread fallback (`?worker=0`) on the same host and demo:

| Step | Measured |
|---|---:|
| Engine ready | **3.1 s** |
| Check map | **5.2 s** |
| Background prepare | **~3.0 s** |
| **Play from prepared state** | **0.0 s** |
| **Stop (suspend)** | **0.0 s** |
| **Play again after keep-warm Stop** | **0.0 s** |
| **Release memory** | reload; **1** navigation, back to Assets |
| Page errors | none |

The fallback Release reloads the page before attempting the in-place teardown;
asset and demo selection are cleared (the Assets step shows its file inputs
again). The reload is intentional, not an error path.

### Brave Task Manager (user run)

Host: Brave 157 on the user's desktop, retail assets and
`blacksun_vs_cerberus_r1.dm_26`, worker host, no page errors:

| Point | Tab memory |
|---|---:|
| Page loaded | **45 MB** |
| Engine ready (assets mounted) | **125 MB** |
| After Check map, before the background prepare completes | **125 MB** |
| Playing | **275 MB** |
| Stopped (keep-warm) | **280 MB** |
| After Release memory | **95 MB** |

The 125 MB after Check map was read on the map step while the background
prepare was still running, so it is the engine-boot footprint, not the loaded
map. The map/cgame load appears in the playing figure. Stop keeps that loaded
footprint (275 → 280 MB, within run-to-run noise), and Release returns the tab
to 95 MB, close to the 45 MB page baseline plus browser allocations.

Phase 3 measured 130 MB idle and 290–298 MB loaded in Brave; Phase 4 changes
when that loaded state is released, not its size.

## Verification status

Done in this checkout:

1. Engine rebuilt from the pinned worktree with patches `0001`–`0008` and the
   updated `jka_bridge.cpp`; staged into `app/public/engine`.
2. `npm --prefix app run typecheck` and `npm --prefix app run build` pass.
3. Headful Chromium worker run: Check map 8.0–8.5 s, background prepare
   7.5–8.5 s, prepared Play 0.0 s, keep-warm Stop 0.0 s, warm Play 0.0 s,
   Check map after Stop 0.5 s, Release 1.8–2.0 s, post-release
   Check map/prepare/Play works, no page errors.
4. Headful Chromium fallback run (`?worker=0`): boot 3.1 s, Check map 5.2 s,
   prepare ~3.0 s, prepared Play 0.0 s, Stop 0.0 s, warm Play 0.0 s, Release
   reloads once to the Assets step, no page errors.
5. No `FS_Startup` between suspend and the next Play.
6. Brave 157: prepared Play, Stop, warm Play and Release; Task Manager
   **45 / 125 / 275 / 280 / 95 MB**; no errors.

Outstanding:

- Mod demo with an added map PK3; the Phase 3 scan/pure-list issue still needs
  the next phase.
- Restart is still the full-reload path (7.8–10.8 s).

## Known risks

- **Keep-warm memory is resident.** Stop no longer frees the map/cgame or
  textures. The loaded worker footprint (**275–280 MB in Brave**) stays until
  Release or a page reload. The UI shows **Release memory** whenever the engine
  is active and disables it while a background prepare is running.
- **Prepare uses the only engine.** Background prepare and Check map are
  serialized by the app; a second demo cannot be scanned while the first is
  loading. If prepare fails, Play falls back to a normal load.
- **Released worker needs a new canvas.** The transferred canvas is
  irreversibly bound to the old worker. Release remounts the `<canvas>`; any
  future boot must use the new element.
- **Main-thread Release reloads the page.** It cannot unload a wasm module in
  place, and the in-place teardown can stall while the keep-warm loop is paused,
  so the fallback reloads immediately; asset/demo selection is not preserved on
  that host.
- **Ended demos are not resumable.** Play after the end uses `playDemo`; only a
  demo that is still active can resume.
- **No explicit `FS_Startup` after suspend** relies on the engine keeping the
  filesystem and map loaded. Any future teardown in `JKA_Suspend` would
  reintroduce the Phase 3 Stop cost.

## Files

- `engine/platform/jka_bridge.cpp` (copied into the build; no patch change)
- `app/src/engine/shared.ts`, `protocol.ts`, `EngineHost.ts`,
  `WorkerEngineHost.ts`, `engine.worker.ts`
- `app/src/App.tsx`, `app/src/components/Launcher.tsx`, `app/src/types.ts`
