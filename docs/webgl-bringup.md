# WebGL bring-up (M2)

**Status:** Complete for the base demo/map target. `rd-vanilla`, cgame, retail assets and a `.dm_26` demo run in Chrome; `mp/duel1` renders with textures, geometry and HUD, and the native and browser frames are compared below.
**Date:** 2026-11-16
**Scope:** Static renderer and cgame, WebGL1 fixes, MEMFS asset staging, browser demo playback, native-vs-browser screenshot comparison.

---

## 1. Result

| Check | Result |
|---|---|
| `rd-vanilla` linked into the wasm engine (static) | **Pass** |
| cgame linked (static) and loaded by `VM_Create` | **Pass** — `VM_Create: cgamex86.wasm succeeded` |
| WebGL context | **Pass** — `WebKit WebGL` / WebGL 1.0, SwiftShader |
| Retail `assets0..3.pk3` staged (1.2 GB) | **Pass** — 23,744 files |
| Demo gamestate parsed | **Pass** — `mp/duel1`, protocol 26 |
| Map BSP loaded | **Pass** — `...loaded 550 faces, 66 meshes, 46 trisurfs, 2 flares` |
| `CA_ACTIVE` and cgame HUD | **Pass** |
| Playback advances in the browser | **Pass** — chat/kill events over multiple minutes |
| Textured world + characters + HUD | **Pass** — see §4 |
| Native vs browser comparison | **Pass** — same map, textures, HUD, player names; different playback instant |

**M2 / G2: PASS** for the base `mp/duel1` demo on SwiftShader. The browser and native frames differ in camera instant and minor effects, not in map, texture or HUD content.

---

## 2. What was added

### 2.1 Static cgame

cgame is built as a **STATIC** library and linked into the engine. `Sys_LoadGameDll` returns its `GetModuleAPI` directly for `"cgame"` and `Sys_UnloadDll` is a no-op.

Static linking surfaced symbol collisions that do not exist with separate modules:

| Conflict | Fix |
|---|---|
| `Com_Printf` / `Com_Error` are function pointers in cgame but functions in the engine | `game_Com_Printf` / `game_Com_Error` under `__EMSCRIPTEN__` + `_CGAME` |
| cgame cvar globals collide with engine/renderer (`broadsword`, `cl_paused`, `com_buildScript`, `com_cameraMode`, `com_optvehtrace`, `r_autoMap`) | private `cg_*` symbols via macros; registered cvar names unchanged |
| shared/qcommon sources compiled into both | use the engine's copies; keep cgame's C `q_shared.c` for C-linkage parse/`va` symbols |
| `window` / `se_language` renderer globals | renamed `tr_window` / `tr_se_language` |

### 2.2 Full asset staging

The M2 harness fetches the four retail PK3s and the native baseline demo from a local HTTP server and writes them into MEMFS **before** `Com_Init`:

```text
/jka/base/assets0.pk3   561,806,019 B
/jka/base/assets1.pk3   652,804,510 B
/jka/base/assets2.pk3     1,116,384 B
/jka/base/assets3.pk3     9,282,026 B
/jka/base/demos/demo.dm_26
```

`FS.createDataFile(..., canOwn=true)` avoids a second copy of each PK3. The files are served locally and are never committed or uploaded.

---

## 3. Renderer fixes that mattered

| Fix | Effect |
|---|---|
| **`glGenTextures` for every image** | The final blocker. OpenJK assigns texture names manually (`1024 + n`); under Emscripten/WebGL that left textures unbound and the world black. Generated names fixed texture upload/sampling. |
| 16-bit `glIndex_t` | WebGL1 client-array indices are `GL_UNSIGNED_SHORT`. |
| Force `GL_RGBA` internal format | WebGL1 requires `internalformat == format` for uncompressed uploads. |
| Force indexed draws in **`R_DrawElements`** | The earlier `tr_init` change only affected the log; the actual draw still chose the `glArrayElement` path. |
| Disable TEXTURE1 client-array state after multitexture | A stale unit-1 texcoord array corrupted later single-texture draws. |
| Map `glActiveTextureARB` / `glClientActiveTextureARB` to core names | `SDL_GL_GetProcAddress` does not resolve the ARB aliases. |
| `emscripten_set_main_loop(Com_Frame, 0, 1)` | A wasm `while(1)` blocks RAF and devtools. |
| Remove blocking `select`/`Sys_Sleep` frame pacing | Emscripten's `poll` has no timeout; the loop starved the browser. |
| minizip `openjk_minizip_free` signature (`void`, not `int`) | Wasm traps on signature mismatch while reading PK3s. |
| 8 MB stack, `-fexceptions`, `-fno-strict-aliasing` | Deep BSP/cgame stacks and OpenJK's `Com_Error` exceptions. |
| RGBA screenshot readback | RGB readback is unreliable under the GL emulation; convert RGBA to the existing RGB layout. |

A test-only `r_m2_pause` cvar stops the RAF loop after the first active frame so the harness can read the canvas. It is not used by normal runs.

---

## 4. Evidence

Browser capture (engine paused on the first active frame):

- `/tmp/jka-demo-player/m2/shots/browser-final.png` (640x480)
- Native comparison: `/tmp/jka-demo-player/m2/shots/native-duel1-crop.png`
- Side-by-side: `/tmp/jka-demo-player/m2/shots/native-vs-browser-final.png`

The browser frame shows:

- `mp/duel1` floor slats, walls, ceiling and skybox textures;
- the recorded player and a second duellist;
- the sabers and saber glow;
- HUD bars, `other player / Dueling / 0/0`, `Lightsaber`, `Score: 0/0`, health/shield.

Console excerpt:

```text
VM_Create: cgamex86.wasm succeeded
...loaded 550 faces, 66 meshes, 46 trisurfs, 2 flares
CL_InitCGame:  1.35 seconds
...
<player> was sabered by <player>
```

The native frame was captured from the same demo at 640x480. It is a later playback instant (a jump/attack pose), while the browser frame is the first active frame; map, textures, HUD layout and player names match.

---

## 5. Limitations

- **SwiftShader only.** The headless shell has no GPU; frame times are not representative. A hardware-GPU run is still required for the M2 performance baseline.
- **Test harness, not a product shell.** The page serves assets from a local node/Python server and stages 1.2 GB into MEMFS. The product picker and error UI are M4 work.
- **640x480 / low quality for capture.** `r_mode 3`, `r_picmip 3`, `r_shadows 0`, no dynamic glow, 5 fps cap to keep the software rasterizer responsive.
- **First active frame comparison.** Exact-frame parity would need a deterministic pause at a chosen demo `serverTime`; current comparison is same-scene, different instant.
- **UI not loaded.** Menus/console remain disabled; cgame HUD is drawn without the UI VM.
- **Audio/input not exercised.** `s_initsound 0`; input is not wired to the browser.
- **G2/character animation** is visible at the captured frame; a long soak for Ghoul2/effects is not done.
- The `r_m2_pause` capture hook is test-only and should be removed or compiled out for a release build.

---

## 6. Next: M3

M2 has already demonstrated local `.dm_26` playback in the browser. M3 should productize the path:

1. Replace the test fetch loop with the filesystem/source layer (FSA + file input) and progress/cancel.
2. Keep `cl_allowDownload 0`, enforce no-network, and validate the demo/PK3 set before boot.
3. Add a headless browser test that asserts `CA_ACTIVE`, advancing `serverTime`, a non-blank frame, and clean demo end.
4. Record failure modes: wrong protocol, truncated demo, missing mod/map, missing `productid.txt`.
5. Optional: build UI or keep the UI-skip path; add the end-of-demo callback.
6. Measure hardware-GPU frame time and memory (M2 baseline is SwiftShader-only).
