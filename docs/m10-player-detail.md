# M10 — Per-player saber analysis

Status: implemented. UI entry: demo summary → **Player detail**.

The demo summary already answers "who killed whom" and "how much damage was
attributed". This milestone adds the data needed to look at one player's
sabering in depth:

- swings per saber and stance,
- hits per swing (hit events, not just health losses),
- damage per swing, so the app can show the mean and the median,
- the swing type (the resolved `saberMove`, i.e. the direction or special),
- the damage that player gave to and received from every other player,
- saber blocks won and lost against every other player (a win breaks the
  opponent's guard and leaves them exposed),
- saber hits that player dealt and received while airborne, on the ground and
  just after landing.

## What the demo actually carries

`entityState_t` (the only player state a demo sends for remote players)
includes the fields this feature needs:

| field | meaning | wire size |
| --- | --- | --- |
| `saberMove` | the `LS_*` move currently playing, set from `playerState.saberMove` | 8 bits |
| `torsoFlip` | toggles when the same animation restarts | 1 bit |
| `fireflag` | `playerState.fd.saberAnimLevel`, mirrored for every player | 2 bits |
| `saberInFlight` | thrown saber (saber throw, not a swing) | 1 bit |
| `groundEntityNum` | the entity the player stands on; `ENTITYNUM_NONE` is airborne | `GENTITYNUM_BITS` |

The **recorded client's own player entity is not in the demo snapshots**. The
scan therefore reads the POV's stance and swing from its playerState
(`fd.saberAnimLevel`, `saberMove`, `torsoFlip`, `saberInFlight`,
`stats[STAT_HEALTH]`), which is exact. Remote players use `fireflag` plus the
clientinfo saber name.

`CS_PLAYERS` carries the clientinfo saber names (`st`, `st2`). Their base
prefixes (`single_`, `dual_`, `staff_`) identify the saber type, which also
recovers the stance that `fireflag` truncates to two bits (dual and staff
arrive as 2 and 3). In a mod that decouples the hilt model from the style, a
remote dual/staff player can therefore be labelled from the hilt; the POV's
stance is always exact.

The demo does **not** carry input keys. The server resolves the player's
forward/right/attack input into a `saberMove` and that is what the wire
mirrors, so the swing type is reported by its resolved direction or special
move. For the seven basic attacks the direction is exactly the input that
produced it:

| move | swing |
| --- | --- |
| `LS_A_T2B` | forward |
| `LS_A_TL2BR` | forward + right |
| `LS_A_TR2BL` | forward + left |
| `LS_A_L2R` | right |
| `LS_A_R2L` | left |
| `LS_A_BL2TR` | backward + right |
| `LS_A_BR2TL` | backward + left |

Back attacks, lunges, DFA, flip attacks, spins, kicks, stab-down and katas
have their own names.

## Scan rules

- A swing starts when `saberMove` enters the `BG_SaberInAttack` set after a
  non-attack move, switches to a different attack move (combo), or the same
  attack move restarts (`torsoFlip` toggles). That last rule is what counts
  repeated identical swings.
- Bounces, parries, deflects and knockaways are defensive reactions, not
  swings. They are excluded so the swing count and hit rate stay meaningful.
- A hit event is one `EV_SABER_HIT` event. It is attached to the attacker's
  current swing, and that swing's `hits` counter is incremented. The event also
  fires when the target blocks the blade, so a hit event means "the blade
  connected", not "damage was dealt". The UI labels the count **Hit events**;
  **Hit rate** is the share of swings with at least one.
- A damage instance recorded from the target's health update is attached to
  the pending hit that caused it, so it lands on the swing that produced it.
  Damage the demo cannot see (a target whose health never appears in the
  snapshot stream) leaves the swing with hit events but no damage sample; the
  app reports how many swings carry a damage sample.
- Saber throws have no swing. Their hits are not counted as swings.
- A **block win** is a broken guard. The loser enters a broken-parry move
  (`LS_H1_*`, or `LS_V1_*` when their own strike is knocked away) within 300 ms
  of a saber contact with another player; that player is the winner. Wall
  bounces and saber-lock losses without a saber contact are ignored, and the
  `kind` field says which of the two outcomes it was.
- **Movement state** comes from `groundEntityNum`: airborne while it is
  `ENTITYNUM_NONE`, otherwise on the ground. The transition back to a ground
  entity starts a 400 ms "just landed" window. The POV uses
  `cl.snap.ps.groundEntityNum`; remote players use their entity state.
- Every `EV_SABER_HIT` is also stored on its own (`saberHits`) with the
  attacker, the target and both movement states, so dealt/received hits can be
  split by movement independently of the swing records.

## Summary shape

Per game, in addition to the existing arrays:

```jsonc
{
  "pov": 2,                       // recorded client, for the "recorded POV" tag
  "sabers": [{ "id": 0, "name": "single_1" }],
  "swings": [
    { "time": 123456, "num": 2, "move": 10, "stance": 3,
      "saber": 0, "hits": 1, "damage": 60 }
  ],
  "saberHits": [
    { "time": 123456, "attacker": 2, "target": 5,
      "attackerState": 0, "targetState": 1 }  // 0 ground, 1 air, 2 just landed
  ],
  "blocks": [
    { "time": 123900, "winner": 2, "loser": 5, "kind": 1 } // 1 H1, 2 V1
  ],
  "swingsOverflow": false,
  "saberHitOverflow": false,
  "blockOverflow": false
}
```
`move` is the numeric `LS_*` value; the app owns the label table. `stance`
is corrected (`6` dual, `7` staff). `hits` is the number of `EV_SABER_HIT`
events on that swing; the UI labels that count **Hit events**. `damage` is the
attributed damage for that swing, which can be `0` even for a hit event the
demo did not expose.

The summary cache key moved to `v9` because the shape changed.

## Global counters vs pairings

The scoreboard, the demo summary score and the trend charts use **global**
counters:

- kills = kills of opponents − kills of allies,
- damage given = damage to opponents − damage to allies.

Only teams 1 and 2 count as a team; team 0 (free-for-all) and spectators never
create allies. Every damage and kill record carries `friendly` (1 when attacker
and target shared team 1/2), captured at scan time from the active player
records, so a team switch mid-game is classified correctly. Kills and damage are
scoped to the player record's time window when a slot is reused.

Every **per-player pairing** stays raw and positive: damage given/received
against a specific player, the opponent table's net, blocks and movement. The
player detail shows both global `Damage given` (allies subtracted) and
`Swing damage` (the raw sum of the saber table below).

The summary cache key moved to `v10` because the event/damage shape changed.

## The view

`app/src/saber.ts` owns the move labels, the stance/saber labels and the
aggregation (per saber+stance, per swing type, buckets, opponent pairs, blocks,
movement). `app/src/components/PlayerDetailView.tsx` is the UI, opened from the
demo summary's view selector:

- game and player pickers, defaulting to the longest game and the recorded POV;
- totals: swings, swings that hit, hit rate, hit events, global damage given
  (allies subtracted), raw swing damage, mean and median damage per swing that
  carried a damage sample;
- a saber × stance table with the same numbers per combination;
- a hit-rate-over-time chart with one series per combination (plus all swings);
  the legend shows each combination's overall rate, and the hover value is the
  bucket under the pointer;
- a swing-type table grouped by saber × stance, with swings, successful swings,
  hit rate, hit events and damage for every move;
- a block table with wins and losses against every other player, plus totals
  and win rate;
- a movement table with saber hits dealt and received while airborne, on the
  ground and just after landing;
- an opponent table with damage given, received and net for every other player,
  plus a cumulative given/received chart for the selected opponent.

A slot can be reused after a player leaves; the view scopes the stats to the
selected player record's `firstSeen..lastSeen` window.

