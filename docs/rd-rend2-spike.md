# rd-rend2 WebGL2 bring-up

**Status:** Working. `master` boots the statically linked `rd-rend2` renderer on
a WebGL2/GLES3 context, loads a map, and plays demos.
**Branch:** `master` (rd-rend2). The previous rd-vanilla path is preserved on
branch `rd-vanilla`.
**Base:** `5e03758 fix(m4): make Stop tear down the demo and return to the map step`

## Result

| Check | Result |
|---|---|
| Static `rd-rend2` in the wasm engine | **Pass** — linked into `MPEngine` |
| WebGL2 / GLES3 context | **Pass** — `OpenGL ES 3.0 (WebGL 2.0)` |
| GLSL ES 3.00 shader set | **Pass** — 671 shaders compile and link |
| Boot + `R_Init` | **Pass** — no FBO attachment errors |
| Base demo `mp/duel1` | **Pass** — playing, 0:14 capture |
| Custom map `ffa_YavinPlaza` | **Pass** — map added at the map step, renders |
| Play / pause / restart / stop | **Pass** |
| Map parsing + map PK3 restart path | **Pass** |
| Texture/portrait correctness | **Pass** — JPG/RGBA upload path fixed |
| UI responsiveness during map check/play | **Pass** — Asyncify yields; probes stayed under 0.6 s |
| Production app build | **Pass** |

Evidence:

- `/tmp/opencode/rend2/final-visual.png` — `mp/duel1`, normal WebGL2 frame.
- `/tmp/opencode/rend2/final-map.png` — `ffa_YavinPlaza` after adding the map PK3.
- `/tmp/opencode/rend2/final-play.log`, `/tmp/opencode/rend2/final-map.log` — CDP runs.
- `/tmp/opencode/rend2/responsive-final.png` — normal frame from the responsive build.
- `/tmp/opencode/rend2/responsive-probe.log` — map-check and Play responsiveness probes.
- `/tmp/opencode/rend2/final-build.log` — clean build from the patch set.

## Build

```bash
BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1 \
  WORK=/tmp/opencode/rend2/final-work \
  BUILD=/tmp/opencode/rend2/final-build \
  OUT=/tmp/opencode/rend2/final-out \
  engine/scripts/build-mp-wasm.sh

scripts/stage-engine.sh /tmp/opencode/rend2/final-out

cd app
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # static output in app/dist
```

Requirements:

- Emscripten 6.0.1 (`EMSDK`, default `/tmp/opencode/emsdk`).
- A host C++ compiler (`HOST_CXX`, default `g++`) to build the
  `compact_glsl` shader-table generator.
- `BUILD_REND2=1` and `BUILD_RENDERER=1` are mutually exclusive: both export
  `GetRefAPI`.
- The engine is built with `NO_PRELOAD=1`; the app stages the user's PK3s.

The web renderer requires WebGL2. `?quality=low` selects 800×600, `r_picmip 3`,
`com_maxfps 10` and no vsync for software rasterisers such as SwiftShader.
Without it the app uses 800×600 at picmip 0 and 60 fps.

## Implementation

- **Build integration** (`0004-emscripten-rend2.patch`):
  - `rd-rend2` is built `STATIC` under Emscripten, with the common
    `q_shared`/`matcomp`/shared-qcommon sources removed so the engine and
    renderer do not define them twice.
  - The engine links `${MPRend2}` and defines `OPENJK_WASM_RENDERER`;
    `CL_InitRef` uses the linked `GetRefAPI`.
  - `compact_glsl` is built as a host tool once, then its generated
    `glsl_shaders.cpp`/`.h` are used by the wasm build.
- **Context** (`rd-rend2/tr_init.cpp`): Emscripten's SDL/EGL creates the
  WebGL2 context from the linker settings; desktop GL 3.2 core attributes are
  skipped.
- **Responsiveness**:
  - The rd-rend2 build uses Emscripten **Asyncify** and yields after each shader
    program. Map checking and Play therefore keep the browser UI responsive
    while shaders compile and the map loads.
  - `Sys_Init` publishes a `ready` flag only after the engine has finished
    initialising and the main loop is installed; the app waits for it instead
    of guessing from `cls.state`.
  - `JKA_PlayDemo` is invoked with the async `ccall` result and awaited. While
    that call is in flight, status polling and pause/stop calls are suspended
    to avoid re-entering the Asyncify runtime.
  - The app shows a "Loading demo / Preparing the map" overlay during this
    phase instead of freezing on the map screen.
  - Stop/pause teardown also uses async bridge calls and a "Stopping demo"
    overlay, so it cannot re-enter the Asyncify runtime.
- **Shaders**:
  - Header changed to `#version 300 es` with default precision declarations,
    including shadow sampler types.
  - Fragment outputs get explicit `layout(location = N)` because WebGL2 has no
    `glBindFragDataLocation`.
  - GLSL ES 3.00 rejects implicit integer→float arithmetic; the few offending
    expressions were corrected.
  - Geometry-shader programs (shadow volumes, weather, environment prefilter)
    are not loaded; their features are disabled in the app arguments.
- **Draw paths**:
  - WebGL2 has no `glDrawElements*BaseVertex`; base vertices are applied by
    offsetting the vertex attribute pointers, and the draw uses
    `glDrawElementsInstanced`.
  - Multi-draw is emulated with a loop.
  - Unsupported desktop GL query/base-vertex/framebuffer-1D/3D entry points
    are skipped; the query-object path uses `glGetQueryObjectuiv`.
- **Dynamic buffers**:
  - WebGL2/Emscripten does not support the renderer's mapped-buffer access
    flags. Dynamic VBO/IBO/UBO updates use `glBufferSubData` instead.
  - Desktop GPU fences are skipped; per-frame reset/readback still runs.
- **Textures**:
  - RGB images are uploaded as `GL_RGBA8` because the image loaders always
    produce RGBA pixel rows; this fixed wrong-stride JPG icons/portraits.
  - Depth/stencil 2D and 2D-array textures use the WebGL2
    `(internalformat, format, type)` combinations.
  - Cubemap uploads use `GL_RGBA` rather than `GL_BGRA`.
- **Symbols**: renderer globals `window`, `r_stereo` and `se_language` are
  renamed (`tr_window`, `tr_r_stereo`, `tr_se_language`) to avoid collisions
  with the engine and `mp3code`.

## Limitations

- **Geometry-shader effects are off.** Shadow volumes, weather and the
  environment prefilter are not loaded; the app runs with `cg_shadows 0`,
  `r_hdr 0`, `r_cubeMapping 0` and `r_ssao 0`.
- **Optional GL entry points.** `glGetBufferSubData`, `glGetVertexAttribdv`
  and `glGetCompressedTexImage` are not exposed; the renderer paths that use
  them are not exercised by this demo player.
- **Performance.** The headless verification runs on SwiftShader; hardware GPU
  frame times are not yet measured. Asyncify increases the wasm from ~3.4 MB to
  ~4.9 MB and adds some runtime overhead, in exchange for a responsive UI during
  shader compilation, map loading and teardown. Stop can take a few seconds on
  SwiftShader; the stopping overlay makes that explicit.
- **Audio/input** remain as in the M4 baseline.

## Why not Vulkan/WebGPU

The native JKA Vulkan renderer is a desktop Vulkan module. Browsers expose
WebGL/WebGPU, not Vulkan; using it in the browser would require a WebGPU port
or a Vulkan→WebGPU translation layer. `rd-rend2` was the smaller path to a
modern GLSL renderer and now works in the app.
