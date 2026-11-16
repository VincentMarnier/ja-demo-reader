# Third-party notices

This project is distributed under the GNU General Public License, version 2.0
only. It includes or links against the following components.

## Engine

| Component | License | Source |
|---|---|---|
| OpenJK multiplayer engine | GPL-2.0 | <https://github.com/JACoders/OpenJK>, pinned at `260c59c2907187af555a676fe0cc798893bf7757` |
| id Tech 3 / Raven-derived engine code | GPL-2.0 | Included in OpenJK and the patches in `engine/patches/` |
| `rd-rend2` renderer | GPL-2.0 | Included in OpenJK |
| Emscripten runtime | MIT / University of Illinois | <https://emscripten.org/> |
| SDL2 (Emscripten port) | Zlib | <https://www.libsdl.org/> |
| libjpeg (Emscripten port) | IJG / BSD-style | <https://www.ijg.org/> |
| libpng (Emscripten port) | libpng license | <http://www.libpng.org/> |
| zlib | Zlib | <https://zlib.net/> |

The OpenJK source is not vendored in this repository; `references/OpenJK` is a
git submodule pointing at the pinned upstream commit. The Emscripten ports are
fetched by the SDK/build script and are not redistributed here.

## Application

| Component | License | Source |
|---|---|---|
| React | MIT | <https://react.dev/> |
| React DOM | MIT | <https://react.dev/> |
| Vite | MIT | <https://vite.dev/> |
| TypeScript | Apache-2.0 | <https://www.typescriptlang.org/> |
| `@vitejs/plugin-react` | MIT | <https://github.com/vitejs/vite-plugin-react> |
| `@types/node`, `@types/react`, `@types/react-dom` | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |

Transitive development dependencies and their licenses are listed in
`app/package-lock.json`. The browser build only ships the compiled application
and engine artifacts; it does not ship game assets.

## Game assets and demos

No Star Wars: Jedi Knight: Jedi Academy assets, maps, textures, sounds, models
or `.dm_26` demos are included in this repository. Users supply their own
legally obtained game data at runtime. Jedi Academy and Star Wars are
trademarks of their respective owners.

## jaMME

The indexed-seek design was informed by [jaMME](https://github.com/entdark/jaMME).
No jaMME source code is included; this project uses a separate implementation
against the stock OpenJK client.
