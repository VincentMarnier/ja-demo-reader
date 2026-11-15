# WebGL bring-up (M2)

**Status:** In progress. The statically linked `rd-vanilla` renderer initializes through WebGL and presents frames. A map/cgame render is not yet achieved.
**Date:** 2026-11-16
**Scope:** Static renderer link, WebGL1 compatibility fixes, browser frame loop. No cgame, UI, asset staging layer or demo playback yet.

---

## 1. Result so far

| Check | Result |
|---|---|
| `rd-vanilla` linked into the wasm engine (static) | **Pass** |
| `GetRefAPI` called without a shared object | **Pass** |
| SDL2 WebGL context created | **Pass** — `GL_RENDERER: WebKit WebGL` |
| Extensions enumerated | **Pass** — multitexture, anisotropic, edge clamp; no compiled vertex arrays, no texenv add |
| Shader files parsed | **Pass** — with a local asset fixture (68 base shaders) |
| Base fonts loaded | **Pass** — `ocr_a` from the fixture |
| `--- Common Initialization Complete ---` | **Pass** |
| RAF frame loop runs | **Pass** — `emscripten_set_main_loop` |
| WebGL frame reaches the canvas | **Pass** — screen probe renders green (`rgb(38,166,64)` at canvas centre) |
| Map geometry + textures | **Not yet** — needs cgame and a complete asset set |
| cgame loaded | **Not yet** |
| UI | **Not yet** (deliberately skipped) |

The current binary is a renderer bring-up, not a playable client.

---

## 2. Renderer strategy: static link

`rd-vanilla` is built as a **STATIC** library under Emscripten and linked into the engine target (`0002-emscripten-m2-renderer.patch`). `CL_InitRef` calls the real `GetRefAPI` unless `cl_renderer` is `stub`:

```c
#ifdef __EMSCRIPTEN__
    if ( !Q_stricmp( cl_renderer->string, "stub" ) ) {
        GetRefAPI = GetRefAPIStub;
    } else {
        GetRefAPI = ::GetRefAPI;   // rd-vanilla, linked into the wasm image
    }
#else
    // Sys_LoadDll path
#endif
```

The M1 boot smoke test keeps `cl_renderer stub`; `?renderer=rd-vanilla` in the harness exercises the real renderer.

### 2.1 Static-link conflicts resolved

The renderer and engine were separate modules upstream. Static linking required:

| Conflict | Fix |
|---|---|
| `window` data symbol vs mp3code `window` function | rename the renderer's window handle to `tr_window` |
| `se_language` defined in both engine and renderer | renderer uses `tr_se_language` (same cvar name) |
| shared/qcommon sources compiled into both | omit `MPVanillaRendererCommonFiles` from the static lib; engine supplies them |
| display-list / array-element GL entry points absent from emulation | `engine/platform/gl_stubs.cpp` (inert; `r_primitives=2` means they are not on the draw path) |

---

## 3. WebGL fixes applied

These are the classes predicted by [rendering-triage.md](./rendering-triage.md):

| Fix | File | Detail |
|---|---|---|
| 16-bit indices | `rd-vanilla/tr_local.h` | `glIndex_t` is `unsigned short` under `__EMSCRIPTEN__`; vertex budget is 1000 |
| Texture internal format | `rd-vanilla/tr_image.cpp` | force `*pformat = GL_RGBA` for uncompressed uploads (WebGL1 requires `internalformat == format`) |
| Draw primitives | `rd-vanilla/tr_init.cpp` | force `r_primitives = 2` (indexed `glDrawElements`; no `glArrayElement`) |
| Texture compression | `rd-vanilla/tr_init.cpp` | force `TC_NONE` after extension probing |
| Browser frame loop | `shared/sys/sys_main.cpp` | `emscripten_set_main_loop(Com_Frame, 0, 1)` instead of `while(1)` |
| Frame pacing | `codemp/qcommon/common.cpp` | skip the blocking `select()`/`NET_Sleep` loop; RAF owns timing |
| Sleep | `shared/sys/sys_unix.cpp` | `Sys_Sleep` returns immediately in the browser |
| GL headers | `rd-vanilla/qgl.h` | `__EMSCRIPTEN__` branch includes `<GL/gl.h>` (no GLX) |

The 16-bit index, internalformat and primitive fixes match the defects fixed by `jka-web` in its SP tree. They are now in the MP tree.

---

## 4. Evidence

### 4.1 Chrome console (renderer path)

```text
OpenJK-MP: latest emscripten-x86 Nov 16 2026
----- FS_Startup -----
/jka/base
...
GL_RENDERER: WebKit WebGL
Initializing OpenGL extensions
...using GL_ARB_multitexture
...GL_EXT_compiled_vertex_array not found
compiled vertex arrays: disabled
texenv add: disabled
compressed textures: disabled
texture compression method: None
...
Shader console has a stage with no image      (fixture lacks gfx/interface/stars)
Shader cursor has a stage with no image       (fixture lacks gfx/menus/cursor1)
...
--- Common Initialization Complete ---
SDL Version Compiled: 2.32.10
SDL Version Linked: 2.32.10
```

### 4.2 Frame presentation

With `+set r_m2_clear 1` (test-only probe in `RE_EndFrame`), the canvas centre samples `srgb(38,166,64)`, proving that the WebGL back buffer is presented. Screenshot: `/tmp/opencode/m2/shots/m2-green.png`.

Screenshot capture uses CDP:

```bash
CHROME=~/.cache/ms-playwright/.../chrome-headless-shell
"$CHROME" --headless --no-sandbox --use-gl=angle --use-angle=swiftshader \
  --enable-unsafe-swiftshader --remote-debugging-port=9228 \
  --window-size=800,600 "http://127.0.0.1:8140/?renderer=rd-vanilla"
node /tmp/opencode/m2/shot2.mjs /tmp/opencode/m2/shots/m2-green.png 6000
```

SwiftShader is used because the headless shell has no GPU; this is a correctness path, not a performance measurement.

### 4.3 Local asset fixture

A 7.5 MB fixture was extracted from the user's `assets1.pk3` into `/tmp` (not committed):

```text
shaders/*.shader
fonts/ocr_a.fontdat, fonts/ocr_a.tga
gfx/2d/*
mpdefault.cfg
```

It is enough for renderer/shaders/fonts init, not for a map. `--preload-file=<dir>@/jka/base` stages it.

---

## 5. Remaining blockers

1. **cgame.** `VM_Create` needs `cgame.wasm`. CMake 4.2.3 cannot build Emscripten shared libraries; the options are a newer CMake (> 4.3.3), a source-list side-module build, or a static cgame link with the same conflict work as the renderer.
2. **Complete assets.** A map needs retail `assets0..3.pk3` staged into MEMFS (MEMFS/IDBFS staging layer is M3/M4 work). Fetching 1.2 GB into the wasm VFS is feasible but must be measured.
3. **UI.** Still skipped. `SCR_DrawScreenField` now allows cgame rendering without UI when `CA_ACTIVE`; the main menu path remains disabled.
4. **Texture path defects.** Observed but not fixed:
   - `GL_TEXTURE_RECTANGLE_ARB` is not available in WebGL1; rectangle-texture paths must fall back to `GL_TEXTURE_2D`.
   - `glTexEnvf` receives pnames the emulation does not handle.
   - `texImage2D: no texture bound to target` during init (bind ordering; resolve before map rendering).
   - `glShadeModel` is a TODO in the emulation.
5. **Map/cgame test.** No visual comparison with the native baseline yet.

---

## 6. Next actions

1. Build cgame as a side module (resolve the CMake limitation) or static-link it.
2. Stage the full retail PK3 set into MEMFS and load `mp/duel1` or the native baseline demo.
3. Fix rectangle-texture fallback and the texture-binding/texenv issues found in §5.4.
4. Capture a browser screenshot of the same scene as `native-baseline.md` and compare.
5. Measure frame time and memory before any optimization.
