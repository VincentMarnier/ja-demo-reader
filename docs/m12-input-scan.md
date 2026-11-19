# M12 — Input-script (macro) detection in demos

The proxy's anti-macro guard watches the raw `usercmd_t` stream server-side: a
config macro flips a movement axis or a turn key faster and more regularly than
a hand can, and its hold lengths are frame-exact (`wait N`). The demo player
now applies the same idea to a demo file and shows the findings under the demo
summary on the map step.

The reference implementation is `macroguard.rs` in `jampgame-proxy-rs`
(`proxy_sv_antiMacro*`, decision `0021-anti-macro.md`). This document records
what carries over, what a demo cannot see, and how the thresholds were
re-derived.

## What a demo actually contains

`CL_WriteDemoMessage` writes the **server messages** the recorded client
received. Usercmds travel client → server and are never echoed back, so a demo
has no `forwardmove`/`rightmove`/`upmove`, no button mask and no `wait` timing.
The proxy's per-command tests cannot be replayed verbatim.

What a demo does carry is the **view angle** the server stored for each player
every snapshot:

| source | player | field | resolution |
|---|---|---|---|
| `cl.snap.ps.viewangles` | recorded POV (its entity is absent) | exact floats | `ANGLE2SHORT` |
| `entityState.apos.trBase` | remote players | `BG_PlayerStateToEntityState` copies `ps.viewangles` | snapped to whole degrees |

Snapshots arrive at the server frame rate — `sv_fps 40` in JKA MP, so 25 ms;
`sv_fps 20` is 50 ms. The scan samples both sources once per snapshot in
`JKA_TrackScriptInputs`.

Only the **view** channel is scanned. Movement input is not recoverable: the
velocity and the resolved `saberMove` are outputs, and inverting them into a
sign alternation would be a guess. The proxy itself keeps view detection
opt-in for the mirror-image reason (a hand can wiggle a mouse); in a demo the
shape test below is what separates the two.

## The detector

`JKA_ScriptObserve` is a line-by-line port of `ChannelState::observe` with
snapshot-rate thresholds. Runs, not windows:

* A reversal is a sign change between consecutive samples. Samples under the
  36-unit (`0.2°`) noise floor say nothing and leave the run alone (a partially
  held turn frame between two snapshots).
* Reversals chain into a run while the gap since the previous one is at most
  200 ms (proxy `RUN_MAX_GAP_MS`). A longer gap starts a new run, so a macro
  press is its burst and the pause before the next press is not part of it.
* A player's stream resets (`JKA_SCRIPT_STALE_MS`, 400 ms of no samples, a
  backwards time, a POV switch) forgets the baseline and every run. That covers
  pauses, PVS exit/re-entry, seeks and a spectator switching POV.

Verdicts inside a run of at least five reversals (four on a repeat of an
already-flagged bind):

| test | threshold | why it survives downsampling |
|---|---|---|
| rate | mean interval ≤ 100 ms | a `wait 10` burst at `sv_fps 40` shows a reversal every 1–3 snapshots (25–75 ms); a hand alternates at 5–8/s |
| shape | mean per-sample step ≥ 75 % of the peak | a held turn key is full speed every command (bang-bang); a mouse wiggle ramps (≈ 64 %) |
| swing | ≥ 2° peak to peak (364 units) | a sub-degree tremor is not the blade-wiggle payoff |

The proxy's **hold-spread** test is intentionally not used. It relies on a
`wait` being exact in milliseconds, and 25 ms sampling quantises that away: a
55 ms hold appears as two or three snapshots, so both a script and a human
produce a spread of one snapshot interval.

After a channel fires it stays **wary** for 3 s and the next burst needs four
reversals instead of five (`WARY_MIN_REVERSALS`). Runs for the same player and
channel that start within 1.5 s of the previous finding's last reversal merge
into it, so a bind pressed repeatedly reads as one finding; `bursts` counts the
presses and `reversals` stays the per-burst figure.

### Aliasing (the honest limit)

A burst faster than the sample rate is folded. A 55 ms macro at 25 ms sampling
is still a reversal per snapshot or two, but a script whose period matches the
snapshot interval exactly can look like a constant angle, and one much faster
than the rate can appear as slow drift. This is why the UI says "possible" and
the panel explains what was measured. The feature is evidence for review, not
an anti-cheat verdict, and it never blocks Play.

## Findings

`jkaScriptFlag_t` per game, capped at `JKA_SCRIPT_MAX_FLAGS` (128; overflow is
reported):

| field | meaning |
|---|---|
| `time` / `endTime` | first / last reversal of the merged burst (server time) |
| `num` | player slot |
| `channel` | `0` yaw, `1` pitch |
| `reversals` | reversals in one run (capped at 255) |
| `bursts` | separate presses merged into this finding (`1` for a single burst) |
| `meanMs` | mean interval between reversals |
| `swing` | peak-to-peak swing in **tenths of a degree** |
| `step` | mean/peak step percentage |
| `samples` | directional snapshots that fed the run |
| `confidence` | 1 "strong" (`≥ 6` reversals, `≤ 60 ms`, `≥ 85 %`, `≥ 3°`), else 0 |

They are serialised in the demo summary (`scripts`, `scriptOverflow`) and
cached with it — the summary cache key is `v12`. A flag's slot can be reused
after a player leaves, so the UI resolves the name from the record whose
`firstSeen`/`lastSeen` window contains the finding.

## UI

`ScriptFlagsPanel` sits under `DemoSummaryView` on the map step. It is a
warning-style toggle ("N possible input scripts detected · M players") that
expands into one entry per finding:

* player name (and a `recorded POV` tag when the demo's own client is the one
  flagged), map and game time;
* channel, reversals, burst length and mean interval;
* swing and step consistency over the snapshots;
* **Watch this moment →**, which starts the demo, seeks to two seconds before
  the first reversal and follows that player.

Following the recorded POV is not possible — its entity is never in a demo's
snapshots, so `CG_SetFollowClient` would clear the follow. The panel passes `-1`
for the POV instead, and the demo camera already is that player's first-person
view.

## Adding a channel later

If a future demo format (or a proxy-recorded trace) stores usercmds, the run
machinery is channel-agnostic: feed `JKA_ScriptObserve` the signed raw value,
set a per-channel kind (axis/view/attack) for the rate test, and add the
proxy's hold-spread test back. Do not infer movement or attack from the demo's
outputs.
