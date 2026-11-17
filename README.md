# JKA Demo Player

A local, offline-friendly browser player for **Star Wars Jedi Knight: Jedi
Academy** multiplayer demos (`.dm_26`). It runs the OpenJK multiplayer engine
in WebAssembly, plays the demo through the real game renderer and cgame, and
adds a browser UI for analysis, seeking, cameras and a custom HUD.

This project does **not** include or download game assets. You must own Jedi
Academy and select your own `assets0..3.pk3` and demo files. Nothing is uploaded.

## Features

- Three-step local setup: assets → demo → map check.
- Real demo playback through OpenJK MP and the `rd-rend2` renderer in WebGL2.
- Timeline seeking with a 10-second keyframe cache; backward seeks and Restart
  reset the cgame in place instead of reloading the map.
- Check map parses the demo without starting the renderer or cgame (~0.5 s in
  the worker), and the demo then loads in the background while the map step is
  visible.
- Per-game resume: map, time played, match clock, scores and deaths. Map
  restarts and level changes start new games with reset stats.
- Exact kills/deaths at the current playback or seek position, replayed from the
  demo's obituary events.
- Per-game health/armor on the scoreboard: exact values where the demo transmits
  them (team overlay, duels, the recorded client), damage-event health samples for
  everyone else, and 100 HP / 25 armor spawn defaults.
- The TypeScript HUD shows the followed player's HP/AP from the parsed
  timeline and their saber stance (dual/staff corrected from clientinfo), so
  following anyone keeps real values instead of `—`.
- Attributed damage dealt/received totals on the scoreboard, with the full
  attacker→target matrix parsed and kept for later analysis. Base demos only
  identify attackers for saber/missile hits, the recorded client and killing
  blows; other damage stays in the unknown bucket.
- Follow camera for any player, a free-fly camera with mouse look, and the
  original recorded demo camera.
- Custom Health/Armor/saber HUD, score strip, timer and scoreboard.
- Demo sound through the engine's software mixer: effects, music and voice
  volumes are adjustable from the player's Sound button; `?sound=0` boots
  silently.
- Playback speed (`0.25×`–`2.5×`) and gamma controls.
- The engine runs in a dedicated Web Worker and renders to an OffscreenCanvas.
  Retail PK3s are mounted read-only with WORKERFS instead of being copied into
  memory; only parsed demo summaries are cached (IndexedDB).
- The demo loads in the background on the map step, so Play resumes instantly;
  Stop keeps the scene warm and the next Play is immediate. **Release memory**
  performs the full teardown when the memory is needed back.
- A degraded main-thread fallback keeps browsers without worker/OffscreenCanvas
  support working (with the older memory cost and a visible notice).
- No account, no upload endpoint, no analytics.

## Requirements

- A desktop browser with WebGL2 (Chrome/Edge/Brave recommended).
- The **Select GameData folder** picker uses the File System Access API in
  Chromium browsers and needs HTTPS or `localhost`. Brave builds that disable
  that API, and Firefox/Safari, use the directory-upload fallback or
  **Choose assets instead**; both stay on the device.
- Node.js 22+.
- A legally owned Jedi Academy install with `base/assets0..3.pk3`.
- One or more `.dm_26` demos (retail or mod; mod demos may need the mod's assets).

To build the engine:

- CMake 4.x.
- Emscripten 6.0.1 in `$HOME/emsdk` or pointed to by `EMSDK`.
- A host C++ compiler and OpenGL headers (`libgl1-mesa-dev` on Debian/Ubuntu).
- The pinned OpenJK submodule (`git submodule update --init --recursive`).

The build script installs the Emscripten JPEG, PNG and SDL2 ports into the SDK
sysroot on first use.

## Quick start

```bash
git clone --recursive <repository-url> jka-demo-player
cd jka-demo-player
npm --prefix app ci

EMSDK=$HOME/emsdk \
BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
WORK=/tmp/jka-demo-player/work \
BUILD=/tmp/jka-demo-player/build \
OUT=/tmp/jka-demo-player/out \
engine/scripts/build-mp-wasm.sh

scripts/stage-engine.sh /tmp/jka-demo-player/out
npm --prefix app run dev
```

Open <http://127.0.0.1:5173>, select your `GameData` folder (or its `base`
folder), choose a demo, check the map, and press **Play demo**.

After you choose the retail assets, they are mounted read-only for the session
and the renderer starts in the background. Nothing is copied into browser
storage; on later visits, **Use last folder** (or the file picker) re-selects
the same files. If an older build left an OPFS asset copy, it is removed
automatically once.

### GitHub Pages

`.github/workflows/deploy-pages.yml` builds the engine and app and deploys
`app/dist`. In the repository's Pages settings, choose **GitHub Actions** as the
source. Game assets are never part of the deployment; visitors select their
own. See [docs/github-pages.md](docs/github-pages.md).

## Controls and UI

- **Player bar** — pause/resume, sound, seek bar, playback speed and fullscreen,
  in that order. It fades out a few seconds after the pointer stops moving over
  the video and returns on movement (it stays up while paused, while a popover
  is open and while the bar is hovered). The health/armor/saber HUD and the
  score strip stay on screen; hovering the seek bar previews the time under the
  pointer. **‹** at the top left stops the demo.
- **Demo selector** — when several demos are available it sits above the video
  and the scoreboard.
- **Seek bar** — jump through the demo. Forward seeks use a keyframe; backward
  seeks restart from the nearest keyframe. Each kill is marked above the track:
  red for a red-team killer, blue for a blue-team killer, and the accent colour
  when the demo has no teams.
- **Follow** — first-person model camera for the recorded POV player, third-person
  model camera for other players.
- **Free cam** — toggled from the scoreboard panel; WASD/Space/Ctrl movement,
  arrow keys or pointer-lock mouse look. Bindings can be changed in Settings.
- **Speed** — opens the playback-speed popover.
- **Kill feed** — the top-right corners shows the last few kills from the parsed
  obituaries for the seconds around the playhead: killer, weapon and victim,
  with team colours. The cgame's own obituary text is turned off
  (`cg_killMessage 0`, patch `0011`).
- **Settings** — FOV, gamma, texture quality, HUD toggles, free-cam bindings and
  local summary clearing.

## Privacy and game data

- Files are read through the browser file picker / File System Access API and
  mounted read-only for the session. They are never uploaded.
- There is no upload path, telemetry or external asset request.
- The engine's networking is disabled in the Emscripten build.
- No asset cache is written. A one-time cleanup removes the old
  `jka-demo-player/assets` OPFS tree (about 1.14 GB) left by earlier builds;
  **Settings → Local data** can run it again.
- The parsed demo summary is stored in IndexedDB on your device and can be
  cleared from **Settings → Local data**.

## Limitations

- Audio is disabled in the current engine build.
- Remote players do not transmit health, armor or current saber style in the
  base JKA protocol; those fields are shown only when the demo has reliable data
  (the recorded POV player and duel health).
- Objective scores sent by mod-specific server commands are not parsed; the
  displayed score is the obituary kill count.
- Keyframes are kept in memory for the current page session. After a reload,
  the parse-only scan rebuilds them; it does not reload the map.
- Backward/forward seek and Restart are warm only within the same map. A demo
  that changes maps takes the full map/cgame load. No multi-map demo is
  included in the local test set, so that path is not release-validated.
- Added-map PK3 demos are supported, but mods that keep extra cgame globals
  across maps are not broadly tested.
- A seek to the very first snapshot can briefly show that snapshot's gamestate
  score/timer until the next configstring updates arrive.
- The first engine shader initialization can take several seconds on software
  WebGL. Chrome's GPU shader cache helps on later runs.
- A very long demo with more than 96 keyframes or very large snapshots falls
  back to replay for the uncovered range.
- Browser memory limits apply. The worker path mounts the PK3s read-only and
  uses the least memory; the main-thread fallback still copies them into MEMFS.
- The worker path needs Worker, OffscreenCanvas, `transferControlToOffscreen`
  and WebGL2 (current Chrome, Edge and Brave). Other browsers get the fallback;
  `?worker=0` forces it for testing.

## License and credits

Copyright (C) 2026 JKA Demo Player contributors.

This project is free software under the **GNU General Public License v2.0
only**. See [LICENSE](LICENSE). The complete corresponding source is this
repository together with the pinned OpenJK submodule and the patches in
`engine/patches/`.

It is built on:

- [OpenJK](https://github.com/JACoders/OpenJK) (GPLv2), pinned at
  `260c59c2907187af555a676fe0cc798893bf7757`.
- The OpenJK `rd-rend2` renderer and id Tech 3-derived code.
- React, React DOM, Vite, TypeScript and related packages (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

Jedi Academy, Star Wars and related marks belong to their respective owners.
This is an unofficial fan tool, not affiliated with or endorsed by Raven
Software, Lucasfilm, Disney or the OpenJK maintainers. No game assets are
distributed.

Some demo-seek and movie-tool ideas were informed by
[jaMME](https://github.com/entdark/jaMME); no jaMME code is included.

## Documentation

- [docs/m8.md](docs/m8.md) — summaries, caches, indexed seek, speed/gamma.
- [docs/m7.md](docs/m7.md) — release audit and sharing notes.
- [docs/browser-mvp.md](docs/browser-mvp.md) — end-to-end browser flow.
- [docs/architecture.md](docs/architecture.md),
  [docs/milestones.md](docs/milestones.md) — design and milestones.
- [engine/README-PORT.md](engine/README-PORT.md) — engine patch/build details.

## Status

Shareable development release. The browser app, asset wizard, playback, seek,
summaries, cameras and HUD are implemented. See the issue tracker for open
compatibility and performance work.
