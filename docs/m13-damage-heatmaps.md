# M13 — Damage heatmaps

Status: implemented. The generated top-down map can show four damage layers:

- **Team · damage given** — where each team stood when it dealt damage,
- **Team · damage received** — where each team stood when it took damage,
- **Player · damage given** — where the selected player dealt damage,
- **Player · damage received** — where the selected player took damage.

The layers appear on the minimap during playback. In the demo summary, the
team pair sits under **Damage over time** (where the cumulative damage chart is)
and the player pair sits in **Player detail** for the selected player. All
views use the same grids and colour ramps.

## Positions at scan time

The scan already records every observed damage instance (`DemoDamageEvent`).
It now also stores the world position of both ends when the loss is recorded:

- `ax`/`ay` — the attacker's position (`given`),
- `tx`/`ty` — the victim's position (`received`).

`JKA_ClientWorldOrigin` reads the recorded POV from `cl.snap.ps.origin` (its
entity is absent from demos) and every remote player from the snapshot's parse
ring. Damage between different players therefore carries exact positions
without replaying the trajectory buffer, and a cached summary keeps them.

A player outside the recorded POV's PVS has no entity state. The matching
`haveAttacker`/`haveTarget` flag stays 0 and the JSON omits that end, so the
layer skips the event instead of inventing a position. The legend reports how
much of the damage was placed. This is a property of the demo, not a scanner
error; the same limit applies to live radar dots and trails.

The bridge emits the optional fields only when present:

```json
{"time":6011120,"target":1,"attacker":7,"damage":2,"source":4,
 "friendly":0,"ax":1234,"ay":-560,"tx":1190,"ty":-510}
```

Coordinates are rounded to whole world units. `jka_bridge.cpp` is copied into
`codemp/client/` by the build script, so this needs no patch change. The
summary cache key is `v12`; older `v11` entries have no positions and the
player detail asks for a rescan.

## Grids

`app/src/map/damageHeatmap.ts` joins the damage events with the map image's
world rectangle (`MinimapImage.bounds`) and rasterises them:

- The grid is square-celled and spans the same rectangle as the map raster. Its
  long edge is 160 cells, so the buffer stays small even at 8× map zoom.
- Row 0 is the top edge (`maxY`) and column 0 the left edge (`minX`), matching
  the raster and canvas orientation.
- Each event adds `damage` to a Gaussian splat (radius 2 cells, σ 1.1), so a
  hit glows over the area around the player instead of a single hard pixel.
- Events outside the drawable bounds are dropped; the map image is cropped to
  the drawn footprint, so an off-map position cannot be shown meaningfully.
- Team layers aggregate the team of the relevant end (attacker for given,
  victim for received). Only teams 1 and 2 are used; free-for-all and
  spectators have no team layer, and the panel says so.
- Player layers aggregate `attacker === num` or `target === num`.
- The legend totals are raw event damage, including friendly fire; the placed
  count is the part that had a position.

## Rendering

`app/src/map/heatmapCanvas.ts` turns a grid into an RGBA canvas at grid
resolution. The intensity is `(weight / max)^0.55`, so low-traffic areas stay
visible without flattening the hot cells. The ramp runs from transparent team
colour through a saturated mid-tone to a warm, near-white core. Team 1 uses
red and team 2 blue; a player layer uses the same per-client tone as the
minimap dots and trails.

The minimap draws the heat above the map raster and below the FOV cones,
trails and dots, with `globalCompositeOperation = 'screen'` and alpha 0.92.
The two team layers therefore add up where both teams traded damage. Layers
are built once per game/mode/player and cached in a ref; the animation loop
only draws the cached canvases.

`DamageHeatmapPanel.tsx` loads the map image from the same PK3 list as the
minimap, dims the raster to 60 %, and draws the requested layers at the image's
own resolution. It is generated on demand and does not touch the engine. The
panel takes a `modes` prop so the team pair and the player pair can live in
different summary views.

## UI

- **Settings → Damage heatmaps → Overlay** selects off / team given / team
  received / player given / player received. The value persists in
  `AppSettings.heatmap`.
- The enlarged map has a compact heatmap panel in its lower-left corner: the
  mode selector, a player selector for the player layers, a colour legend and
  the placed-damage coverage. The panel stops pointer events so it does not pan
  the map or follow a player.
- The player layers default to the camera subject (followed player, else the
  recorded POV). Picking a player in the panel pins that client until the game
  changes or the slot disappears.
- **Demo summary → Damage over time** shows the team given/received pair under
  each game's cumulative chart. Team heat is a team view, not a player view, so
  it lives with the global damage chart rather than in player detail.
- **Demo summary → Player detail → Player damage heatmaps** shows only the
  player given/received pair for the selected game and player, placed below the
  **By saber & stance** table, with totals and the same coverage wording. When
  the player has no swing rows the pair follows the empty-swing note.

## Limits

- Positions are snapshot positions, not trace start/end points: the heat shows
  where the players stood, not the path of a projectile or a saber arc.
- Damage observed only through a delayed vitals source (team overlay, duel
  health) is placed at the snapshot where the loss became visible; the offset
  is one snapshot in normal playback.
- Out-of-PVS damage has no position. The player detail requires a rescan of a
  `v11` summary; the live map shows a partial layer and its coverage instead.
- A team layer needs red/blue teams. Free-for-all demos only get the player
  layers.
