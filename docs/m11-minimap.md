# M11 — Minimap

Status: implemented. UI: the top-right map panel in the player (toggle in the
action bar or **Settings → HUD → Show the top-down minimap**). Clicking the map
promotes it to the whole stage; clicking the small demo returns to the demo.

The player shows a static top-down image of the map with live player dots:
team colours where the game has teams, a small per-player tone so teammates stay
distinguishable, a field-of-view cone matching the displayed horizontal FOV
(97° at 4:3) for the direction the player is looking, and a dimmed dot for dead
players. The followed player has a pulsing
white/amber highlight. Airborne players get a glow whose size and intensity
grow with their height above the surface they jumped from. Void areas of the
map are transparent.

## The map image

`app/src/map/` builds the background once per map; it is not a live render.

- `zipReader.ts` reads the PK3 central directory from the page's `File`
  objects and inflates one entry (`DecompressionStream('deflate-raw')`). The
  app already has every PK3 from the selected `base` folder plus any added map
  PK3, so neither the engine filesystem nor a cache is involved.
- `bsp.ts` parses the RBSP (JKA's Quake 3 BSP layout: 148-byte `dsurface_t`,
  80-byte `drawVert_t`, 72-byte `dshader_t`) and rasterises every drawable
  surface from above. Pixels keep the highest surface, so bridges and upper
  floors occlude what is below. Void pixels keep alpha 0; the panel behind them
  shows through. The image is cropped to the drawn footprint and the world
  rectangle that the cropped image covers is returned with it.
- `world → image` mapping is 1:1 on X and mirrored on Y (`+Y` is up), matching
  the engine's yaw (`0` faces `+X`). Dot headings use `-yaw` in canvas space and
  the FOV wedge is centred on it.
- Surfaces flagged `SURF_SKY`/`SURF_NODRAW` and the common utility shaders
  (caulk, clip, trigger, hint, portal, …) are skipped. Down-facing surfaces are
  skipped so the top-down view shows floors rather than ceilings.
- Patches are tessellated with a fixed 8×8 Bézier grid; planar and triangle-soup
  surfaces use the BSP index list. Planar faces are not regular fans: the index
  list is required (a fan leaves holes on most maps).
- `mapImage.ts` decodes each drawable shader's texture once with
  `createImageBitmap` (resized to 16×16) and averages it. This gives the map its
  real palette (stone, sand, metal, water) without sampling per pixel. Shaders
  whose name does not match an image file are resolved from the `.shader`
  scripts (`scripts/*.shader` in the PK3s): the first stage `map` (or
  `qer_editorimage`) is used. Missing textures fall back to a shaded neutral.
- A directional light from the image's upper left, a height factor and a small
  per-shader jitter keep the flat average colours readable. A depth-step edge
  darkens silhouettes and height transitions; coplanar triangle seams are not
  outlined.
- The image is cached by map name plus a signature of the PK3 names/sizes; the
  last three maps stay in memory. Adding a PK3 restarts the search path and
  produces a new signature, so the image is regenerated.

The map image takes about 1.5 s for a typical community map (reading the archive
directories, decoding ~60 textures, rasterising 1000 px). It runs on the page;
the `?quality=low` build does not change it.

## Live positions

The engine exposes `JKA_RadarJson()` (`engine/platform/jka_bridge.cpp`), a
client-only read:

- remote players come from the current snapshot's entity ring
  (`cl.parseEntities[(cl.snap.parseEntitiesNum + i) & (MAX_PARSE_ENTITIES - 1)]`,
  `eType == ET_PLAYER`), with `pos.trBase` and `apos.trBase[YAW]`;
- the recorded POV's own entity is absent from demos, so its position and view
  yaw come from `cl.snap.ps.origin` / `viewangles`;
- `dead` is `EF_DEAD` for remote players and `STAT_HEALTH <= 0` for the POV;
  spectators/intermission are skipped;
- `z` is the feet height and `g` is 1 while `groundEntityNum` is not
  `ENTITYNUM_NONE`. The page keeps the last grounded `z` per player; while
  airborne, `z - baseZ` is the jump height. A position jump larger than 600
  units (respawn, teleport, seek) resets that baseline.

The poll is short and synchronous, like the scoreboard. It is skipped while a
long async call is in flight (map load, seek, scan). The worker host polls it
every 80 ms and pushes `{type:'radar'}`; the page polls the main-thread host
every 100 ms while the player is open. The canvas eases dots toward the latest
position (and snaps on a >600-unit jump) so 10–12 Hz data reads as live motion.

Teams come from the scoreboard. Red and blue each use eight fixed tone pairs
(hue offset and lightness), so teammates are distinguishable without leaving
the team colour; free-for-all and spectators use a palette. Click a dot to
follow that player.

The view cone has no outline: it is a radial gradient that stays readable at
the player and fades slowly to transparent at the cone's edge, with a light blur
so the wedge has no hard border and the map is not cut by a sharp line.

The camera subject is drawn last with a white ring and a pulsing amber ring.
That is the recorded POV while the demo camera is active and the followed
player after Follow; free cam has no subject and clears the highlight.
A jumping player gets a translucent team-coloured aura, a team ring and a white
lift ring whose radius, weight and opacity scale with the jump height (a normal
jump is ~45 units, Force Jump ~90+), plus a slow, faint outward pulse and a
small white core. The effect is deliberately soft so it reads as elevation
without pulling focus from the game. Everything is smoothed so the 10–12 Hz
radar data does not flicker.

## Movement trails

A demo is a recording, so both sides of the live position come from the scan:

- `JKA_TrackTrajectory` runs from `JKA_ProcessSnapshot` only while the
  parse-only scan is active (`jka_scanOnly`). It samples the recorded POV from
  `cl.snap.ps` and every `ET_PLAYER` in the snapshot's parse ring about every
  150 ms (~7 Hz) into a 262,144-entry static buffer (4 MB). Playback and seek
  replays never append, so a seek cannot duplicate samples.
- `JKA_TrajectoryJson(from, to)` returns
  `{"overflow":false,"samples":[[num,serverTime,x,y],…]}` on the radar clock
  (the same `serverTime` as `JKA_RadarJson`). The page asks for ±7 s around the
  live time and refreshes when the live time comes within 2 s of a window edge;
  a seek outside the cached window refetches immediately. The JSON buffer is
  256 KB and stops early instead of truncating the document.
- The minimap draws the past five seconds as a solid line in the player's tone,
  fading from nearly transparent at the oldest sample into the current dot. The
  next five seconds are dashed and dimmer, fading away from the dot, so the same
  player's two directions read apart. A sample gap over 800 ms (PVS exit, seek)
  or a >600-unit step (respawn, teleport) breaks the line instead of drawing
  across the map, and dead players get no trail. Trails are drawn above the view
  cones and below the dots; the smoothed radar position is the hand-over point.
- `AppSettings.trailsPast` is on by default, `trailsFuture` and
  `trailsFollowOnly` are off (so every player gets trails). With
  `trailsFollowOnly` only `highlightClient` is drawn. Settings → **Minimap
  trails** exposes the three toggles.

The samples live in engine memory, not in the summary cache (its key stays
`v11`). Like the seek keyframes, a cached summary alone is not enough: the app
scans once per engine session and demo, and Release drops the data.

## Map view and the corner demo

The map and the demo exchange places by clicking the smaller one; there is no
separate toggle button. The state is `AppSettings.mapExpanded` / the stage's
`data-swapped`, and the action-bar map button still shows/hides the map.

- **Map view**: the minimap fills the stage and behaves like a map viewer. The
  wheel or a two-finger pinch zooms from 1× to 8× around the pointer, a drag
  pans, a double-click zooms in and a second double-click resets the fitted
  view. `Minimap.tsx` keeps `{zoom, panX, panY}` in a ref and clamps the pan so
  the image never leaves a gap; the fitted image is centred at 1×. The corner
  map always draws the fitted overview, and the view survives collapsing and
  re-opening but resets when the map changes. A click without movement still
  follows a player dot.
- **Corner demo**: the demo canvas becomes a window at the stage aspect,
  bottom-right by default and 33% of the stage width (15–55% allowed). Drag it
  to snap to any corner, or drag the inner grip to resize; both keep the aspect
  so the stretched world picture is not distorted. The bottom corners sit above
  the seek/action bar (`--pip-bottom-gap`), and a top-right window pushes the
  fullscreen scoreboard left. `AppSettings.pipCorner`/`pipWidth` persist, and
  the live gesture state stays in `App.tsx`/`CornerDemo.tsx` so pointer moves do
  not rewrite localStorage.
- A click (no drag) on the corner demo returns to the demo view; a click on the
  corner map promotes the map. The big map drops to z-index 3, the corner demo
  sits at 6 and the player chrome at 7; the kill feed moves to the left in map
  view.

## Files and UI

- `app/src/components/Minimap.tsx` draws the cached image, cones, trails and
  dots, owns the pan/zoom/pinch view, handles click-to-follow and promotes
  itself on a click while in the corner, and fetches the trajectory window. It
  draws in `requestAnimationFrame` with a device pixel ratio capped at 2.
- `app/src/components/CornerDemo.tsx` is the interaction layer over the corner
  demo: click to enlarge, drag to a corner, inner grip to resize.
- `app/src/App.tsx` owns the radar poll, the PK3 list (every PK3 in the selected
  base folder plus the PK3s added this session), the `pipCorners`/`pipWidth`
  live state and the stage attributes. The stage gets `data-minimap="1"` while
  the panel is shown (which moves the kill feed below it), `data-swapped="1"`
  in map view and `data-pip-corner` for the corner window.
- `AppSettings.showMinimap` defaults to true and persists; `pipCorner` defaults
  to bottom-right and `pipWidth` to 33%.
- The corner map panel is 208 px on desktop, 118 px on narrow layouts; the kill
  feed is offset in both.

## Limitations

- It is a stylised top-down image: texture *averages* and lighting are derived
  from the BSP, not a screenshot of the rendered map.
- Demos only carry entities in the recorded POV's PVS, so a player who is not in
  the snapshot stream has no dot or trail sample for those moments; the trail
  breaks at the gap rather than drawing through it.
- Trails need the demo scan. A demo played from a summary by an engine session
  that never scanned it has no recorded positions, and the sample buffer keeps
  the oldest ~40 minutes at the full player count (then `overflow` is set and the
  newest positions are missing).
- Patch tessellation is fixed at 8 steps. Very large terrain patches are
  simplified; the footprint and colour are correct, fine detail is not.
- Maps without a readable BSP, or whose map PK3 was not added, show the dots
  without a background ("Map image unavailable").
