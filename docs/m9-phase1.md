# M9 Phase 1: hybrid shader compilation and fast texture profile

**Status:** Implemented and smoke-tested in the browser.
**Scope:** Compile only a small eager shader set at renderer init, compile the
rest on first use, and make the fast texture profile the default with a
reload-time quality setting.

## Eager set

Phase 0 measured 671 compiled programs and only 19–20 used after a full Play.
`engine/patches/0007-rend2-shader-cache.patch` compiles this eager set:

| Group | Eager indices |
|---|---|
| generic | `0, 4, 16, 20, 24, 36, 38, 48` |
| lightall | `0, 1, 3, 4, 5, 16, 18, 32` |
| fog | `0, 2` |
| refraction | `2` |
| textureColor | singleton |
| splash | singleton, created by `R_Splash` |

Everything else is compiled by `GLSL_EnsureProgram` when first referenced.
Invalid permutations are skipped.

## How lazy compilation works

- `shaderProgram_t` now carries `compiled`, `used`, `group` and `index`.
  `GLSL_InitProgramIdentities` assigns the group/index for every program before
  the eager set is compiled.
- The generic, fog, refraction, lightall and surface-sprite loaders were split
  into a per-index compile function plus a small group loop. The other groups
  use their existing single-program loaders.
- `GLSL_EnsureProgram` dispatches on `group`, compiles one program (or the two
  variants of a pair), initialises its uniforms and texture units, then clears
  `glState.currentProgram` so the next bind resynchronises.
- `GLSL_EnsureProgram` is called from:
  - `GLSL_BindProgram`;
  - every `GLSL_SetUniform*` entry point and `GLSL_SetUniforms`;
  - `UniformDataWriter::Start` in `tr_backend.cpp`, which reads
    `program->uniforms` while collecting a draw item, before the bind.
- Lazy compiles run inside a draw and must not Asyncify-yield. The
  `ShaderProgramBuilder::Build` sleep is gated by `jka_glslCompileCanYield`,
  which `GLSL_EnsureProgram` clears for the duration of a lazy compile.
  Eager compilation still yields between programs.

`GLSL_ShutdownGPUShaders` keeps logging per-group usage; uncompiled programs
show `compiled=0`. `GLSL_DeleteGPUShader` preserves group/index so a later
renderer restart can rebuild the same program.

## Fast texture profile

The app now boots with `r_picmip 2` and `r_textureMode GL_LINEAR` by default.
Settings → View offers two direct controls:

| Control | Values | Boot arg |
|---|---|---|
| Texture picmip | 0–6 slider; default **2** | `r_picmip <n>` |
| Texture mipmaps | Off / Bilinear / Trilinear; default **Off** | `r_textureMode GL_LINEAR`, `GL_LINEAR_MIPMAP_NEAREST` or `GL_LINEAR_MIPMAP_LINEAR` |

These cvars are latched by the renderer, so a change applies after the next
engine boot/reload; the settings panel says so. `?profile=fast` still forces
picmip 2 with mipmaps off for a diagnostic URL, and `?quality=low` overrides
picmip to 3.

## Verification

- `npm --prefix app run typecheck` and `npm --prefix app run build` pass.
- All patches `0001`–`0007` apply from the pinned OpenJK commit.
- A full `PROFILE=1 BUILD_REND2=1 BUILD_CGAME=1` build succeeds.
- Headless smoke test on a retail map and demo:
  - Boot shader compile: **20 eager programs in 116–157 ms** (previously 671
    in about 18.5 s).
  - Play from the UI: **3.2–4.2 s** in the engine log (previously about
    21.6 s); cgame/map load is still about 2.15 s.
  - Lazy first-use compiles: lightall index 2 in 26–50 ms, generic index 32 in
    5–129 ms.
  - The rendered frame and scoreboard were visually correct in the screenshot.
- The per-group loaders were split into per-index compile functions; the eager
  set and lazy path call the same compile function for a given program.

## Known limits

- First use of a variant not in the eager set still compiles synchronously and
  can hitch. The smoke test hit two variants; the largest observed hitch was
  129 ms. Phase 1 can add a map-dependent precompile pass at
  `RE_EndRegistration` if the measured hitch matters.
- The eager set was measured on one retail map. Other maps, mods and weather
  effects may use additional variants; they compile lazily.
- The fast texture profile did not change the measured map image bytes or load
  time in Phase 0. Verify it visually on texture-heavy maps before treating it
  as a quality decision rather than a memory/bandwidth decision.
