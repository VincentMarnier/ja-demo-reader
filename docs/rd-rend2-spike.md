# rd-rend2 WebGL2 spike

**Status:** Branch created; build integration not started.
**Branch:** `spike/rd-rend2`
**Base:** `5e03758 fix(m4): make Stop tear down the demo and return to the map step`

## Goal

Replace the current `rd-vanilla` + `LEGACY_GL_EMULATION` path with `rd-rend2`
statically linked into the wasm engine, targeting a WebGL2/GLES3 context.
The aim is a modern GLSL renderer that maps much more directly to WebGL2 than
the fixed-function GL1 emulation, and to remove the unsupported
`GL_TEXTURE_RECTANGLE_ARB` warnings seen in the current build.

## Why this before Vulkan/WebGPU

- `rd-rend2` is already in the pinned OpenJK tree and is a GL3/GLSL renderer.
- WebGL2 exposes GLES3 features (32-bit indices, VAOs, FBOs, instancing) that
  the current WebGL1 + legacy emulation path cannot use cleanly.
- A native Vulkan renderer cannot run in the browser; porting it means a full
  WebGPU rewrite. `rd-rend2` is the smaller, reversible experiment.

## Work plan

1. **Build wiring**
   - Add `BUILD_REND2=1` to `engine/scripts/build-mp-wasm.sh`; set
     `BuildMPRend2=ON`, `BuildMPRdVanilla=OFF`, `BuildMPCGame=ON`.
   - Build `rd-rend2` as a **STATIC** library under Emscripten and link it into
     `MPEngine`, mirroring the existing `rd-vanilla`/cgame patches.
   - Remove duplicated common sources (`q_shared.cpp`, `matcomp.cpp`,
     shared/qcommon) from the static renderer target.
2. **Renderer selection**
   - Make `CL_InitRef` use the statically linked `GetRefAPI` from `rd-rend2`
     (new define, e.g. `OPENJK_WASM_REND2`), with the existing stub fallback.
   - Default `cl_renderer` to `rd-rend2` in the app engine arguments.
3. **Host shader tool**
   - `compact_glsl` is a host build tool; under `emcmake` it becomes a wasm
     executable and the CMake custom command cannot run it.
   - Build it natively (host compiler) or pre-generate
     `glsl_shaders.cpp`/`glsl_shaders.h` before the wasm build.
4. **WebGL2/GLES3**
   - Require WebGL2: `-sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2`
     (optionally `-sFULL_ES3=1`).
   - Audit GL calls and extensions: VAOs, FBOs, texture formats, 32-bit
     indices, shader/program paths, and unsupported desktop-only targets.
5. **Shaders**
   - Port the shader set to GLSL ES 3.00 (`#version 300 es`, precision,
     `in`/`out`, `texture()`), or add an ES-compatible shader generation path.
   - Keep a fallback for shader compile failures with a visible log message.
6. **Validation**
   - `mp/duel1` and `ffa_YavinPlaza` render with textures, HUD and characters.
   - Play/pause/restart/stop still work; no new console GL errors.
   - Compare against the native screenshots and record frame time.

## Known first blockers

- **Emscripten shared libraries.** `rd-rend2/CMakeLists.txt` uses
  `add_library(${MPRend2} SHARED ...)`. CMake 4.2.3 + Emscripten rejects shared
  libraries (`does not support emscripten shared libraries`); the target must
  be `STATIC` under `EMSCRIPTEN`, as already done for `rd-vanilla` and cgame.
- **Shader generator.** The `compact_glsl` custom command
  (`${CMAKE_BINARY_DIR}/compact_glsl`) assumes a runnable host executable; a
  wasm build tool cannot be invoked that way.
- **GLSL dialect.** The GLSL files carry no `#version`; they need an explicit
  GLSL ES 3.00 pass and a shader audit before WebGL2 will accept them.
- **Context.** The current app build allows WebGL1 (`MIN_WEBGL_VERSION=1`);
  `rd-rend2` needs a WebGL2 context to expose the required GLES3 features.

## Acceptance

A build from this branch that boots, loads `mp/duel1`, reaches `CA_ACTIVE`,
renders a correct frame, and passes the same demo playback checks as master.
