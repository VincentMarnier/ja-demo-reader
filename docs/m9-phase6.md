# M9 Phase 6: seek state fidelity and mod demos

**Status:** Implemented and verified in the worker host. A warm seek now
applies the retained server commands from the keyframe to the target while
`CG_SeekReset` rebuilds the cgame, so scores, level-start time, client info and
saber data are at the target on the first drawn frame. The added-map PK3 demo
now checks, prepares, plays and seeks normally.

**Scope:** Close the remaining state mismatch after a warm seek and exercise a
mod demo with an added map. Cross-map seeks still use the full map load; this
phase does not add a second map cache.

## What changed

| Area | Change |
|---|---|
| Cgame reset | `CG_SeekReset` now receives the target server-command sequence and calls `CG_ExecuteNewServerCommands` after rebuilding clientinfo. |
| Command order | `cgs.serverCommandSequence` advances to the target, so the snapshot transitions do not execute the same commands a second time. |
| Telemetry | `jka_profile` logs the reason when a warm seek falls back (`no-keyframe`, `not-active`, `bad-game`, `map`, `replay-error`, `replay-eof`). |
| Compatibility | The added-map PK3 demo (`asms.pk3`) is used as a real app flow: Check map, add the map, prepare, Play, backward/mid seek. |

## Why apply commands early

A keyframe only captures the client state at the keyframe. The live client
executes server commands (`cs`, `scores`, `map_restart`, …) as snapshots
transition between that keyframe and the target. A warm seek used to leave
those commands for the first few cgame frames, so the HUD could show the
keyframe's scores/level-start values until the next commands arrived, and
clientinfo/saber data could lag the target.

`CG_SeekReset` now:

1. rebuilds `cgs.gameState` and clientinfo from the keyframe,
2. keeps the clientinfo ghoul2 body models and custom saber hilts,
3. calls `CG_ExecuteNewServerCommands(targetCommandSequence)` with the client's
   latest command sequence after replaying to the target,
4. clears saber trail state,
5. starts the cgame at the oldest client snapshot still in the ring.

`CL_GetServerCommand` applies configstring updates to `cl.gameState` before the
cgame sees them, so scores/level time/clientinfo are coherent when the first
frame is drawn. Commands older than the reliable-command buffer are skipped in
demo playback by the client itself, as during normal playback.

## Verification

Worker, retail demo:

- Check map 0.25–0.51 s; warm seek/restart unchanged from Phase 5.
- Backward/forward seeks and Watch again produce no page errors and no
  `CG_ReadNextSnapshot: way out of range` warning.

Worker, added-map PK3 demo (`asms.pk3` + `asmsdemo.dm_26`, two games):

| Step | Measured |
|---|---:|
| Check map (parse-only scan, 24,359 messages) | **0.25 s** |
| Map missing → add `asms.pk3` → Play enabled | immediate |
| Background prepare | ~6 s |
| Play | active |
| Backward seek to the demo start | **1 ms** engine (`path=warm-inplace`) |
| Seek to 50% | **16 ms** engine (`path=warm-inplace`) |
| Page errors | none |

The same demo previously failed the scan with `messages=0`; the parse-only
scan (Phase 5) fixed that, and this phase confirms the full app flow with an
added map and two games.

## Remaining

- **Cross-map seek is still a full map load.** A demo that changes maps cannot
  reuse the current renderer world; the bridge returns 0 from the warm path for
  a different keyframe map and the full keyframe path runs.
- **A seek issued while the target state is still settling** (for example
  immediately as the player UI appears) may still take the full keyframe path;
  the skip-reason log records it. Normal playback seeks are warm.
- **Mods with custom cgame behavior** that keep additional globals across map
  loads may need their own reset handling.

## Files

- `engine/patches/0009-cgame-warm-seek.patch`
- `engine/platform/jka_bridge.cpp`
- `docs/m9-phase5.md` (pointer)
