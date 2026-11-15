# Research: a browser-based Jedi Academy multiplayer demo player

**Project:** `jka-demo-player`
**Status:** Research complete. No implementation, no WebAssembly build, no frontend, and no game assets were produced or committed.
**Date:** 2026-11-13
**Scope:** Existing OpenJK/JKA web ports, JKA multiplayer demo playback, browser filesystems, licensing, and a foundation recommendation.

---

## 0. Executive summary

### 0.1 The short version

1. **Demo playback is a multiplayer-engine feature.** OpenJK's single-player tree (`code/`) has no demo playback commands. The demo code lives in the multiplayer tree (`codemp/`), and the file extension `.dm_26` is tied to multiplayer protocol version 26. A single-player WebAssembly build cannot play a `.dm_26` demo without porting the multiplayer client.
2. **`jk.q3js.com` is not the public `openjk-emscripten` repository, and it is not the public `q3js` repository.**
   - `jk.q3js.com` is a JKA site with **two separate WebAssembly builds**: `/JediAcademy/sp/openjk-sp-wasm.js` and `/JediAcademy/mp/openjk-mp-wasm.js`.
   - `lklacar/openjk-emscripten` is the same author's older, **single-player-only** port. Its README says so and its CMake defines `SP_GAME`.
   - `lklacar/q3js` is a **Quake III Arena** project built on ioquake3, not Jedi Academy. Its non-engine code is explicitly proprietary.
3. **`Virtastic/jka-web` is the most complete public JKA-specific browser port**, but it currently builds **single-player only**, and the user reported **rendering issues** while testing it. The root cause of those issues has not been established here: they may be specific to jka-web's SP renderer, or they may be systemic to the Emscripten/WebGL emulation. jka-web also ships the Raven multiplayer source under `games/jka/codemp`, but that tree has **zero `__EMSCRIPTEN__` adaptations**, so it is not a drop-in MP port either.
4. **The recommended foundation is now upstream `JACoders/OpenJK` `codemp` plus a new Emscripten platform layer.** OpenJK is the maintained MP engine and already contains demo playback, but it has **no browser port**; the platform layer, renderer adaptation, and module loading must be built. This is a **larger port than reusing jka-web**, but it starts from the maintained engine and avoids inheriting an unresolved rendering defect. `jka-web` remains the reference for the platform layer, filesystem staging, and test harnesses.
5. **The simplest usable prototype is still not a custom renderer or demo parser.** It is: prove demo playback with a **native OpenJK MP build** first, then port the same MP engine to Emscripten, stage the user's PK3s and one `.dm_26` in MEMFS, issue the engine's existing `demo <name>` command, and let `CL_PlayDemo_f` / `CL_ReadDemoMessage` do the playback. The native baseline separates engine/demo problems from WebGL problems.

### 0.2 Candidate verdicts

| Candidate | Public source | MP engine | Demo playback | Suitable foundation | Verdict |
|---|---|---|---|---|---|
| `jk.q3js.com` | No (JKA MP build not published) | Yes (artifact evidence) | Code present in MP wasm | No, not reusable | **NO-GO** as a foundation; **GO** as a black-box reference |
| `lklacar/openjk-emscripten` | Yes | No (SP only) | No | No | **NO-GO** as a foundation; **GO** as a minimal-port reference |
| `Virtastic/jka-web` | Yes, GPLv2 | Source present, not built | Not built | Reference only: user-reported rendering issues, root cause unresolved | **NO-GO as primary; GO as reference/platform-layer donor** |
| `JACoders/OpenJK` (`codemp`) | Yes, GPLv2 | Yes | Yes | Yes, with a new Emscripten platform layer | **GO (conditional) — primary** |
| `lklacar/q3js` | Mixed; non-engine proprietary | No (Quake 3) | Not JKA | No | **NO-GO** |
| Build from scratch | — | — | — | No | **NO-GO** |

> **Decision update (2026-11-15):** the user tested `jka-web` and observed rendering issues. The primary recommendation has moved from `jka-web` to upstream OpenJK `codemp`. The earlier jka-web-first analysis is retained below as evidence; see §9.4 for the decision log.

### 0.3 What "done" would require

A working demo player needs four things that are often conflated:

1. **A multiplayer engine build.** The single-player engine is not enough.
2. **The client game module (`cgame`).** Demo playback initializes cgame from the recorded gamestate and calls `CGVM_DrawActiveFrame(..., demoPlayback = true)`.
3. **A synchronous filesystem containing the user's PK3s and the demo.** The engine opens PK3s and reads demo packets synchronously.
4. **A browser shell that selects, validates, and stages local files.** No backend and no asset upload.

The first two are engine-port work. The third is a browser-filesystem design problem. The fourth is ordinary TypeScript/React work.

---

## 1. Method and evidence

### 1.1 What was inspected

Repositories were cloned to a temporary directory and inspected at these commits:

| Repository | Commit inspected | Date | Notes |
|---|---|---|---|
| `JACoders/OpenJK` | `260c59c2907187af555a676fe0cc798893bf7757` | 2026-09-29 | Canonical OpenJK, MP tree under `codemp/` |
| `Virtastic/jka-web` | `73b6006ae1e5b0269eca595e6daf89bcf1582e0c` | 2026-10-12 | Raven JKA drop + Emscripten port |
| `lklacar/openjk-emscripten` | `3a2255593bc4d95199f21c67bb092bb0c9bc6848` | 2026-05-18 | SP-only OpenJK port |
| `lklacar/q3js` | `efcb0fe1b76210db0232068a5d4187677c3d8c46` | 2026-10-13 | Quake III Arena, not JKA |

No upstream source was modified. No proprietary PK3 or demo was downloaded or committed. The public `jk.q3js.com` JavaScript and WebAssembly artifacts were inspected only as shipped public artifacts; no attempt was made to reverse-engineer proprietary source.

### 1.2 Evidence labels

- **Verified (source):** read directly in the cited source file and line range.
- **Verified (artifact):** observed in a public HTTP response, header, or binary string table.
- **Reported:** stated by an upstream README or project document, but not independently reproduced here.
- **Assumed:** a design inference, not yet tested.

### 1.3 What was not done

- No engine was compiled.
- No WebAssembly was generated.
- No frontend was created.
- No demo was played.
- No legal advice is given. Licensing statements are evidence-based observations, not conclusions of law.

---

## 2. A. Existing implementations

### 2.0 Consolidated candidate table

| Project | Actual source repository | Upstream engine | MP? | Public source? | License | Foundation verdict |
|---|---|---|---|---|---|---|
| `jk.q3js.com` | None published for the JKA MP build | OpenJK (artifact evidence) | Yes | No | Not published for the site; `q3js` is mixed | **NO-GO**; reference only |
| `openjk-emscripten` | <https://github.com/lklacar/openjk-emscripten> | OpenJK | No (SP only) | Yes | Not stated; derivative of GPLv2 OpenJK | **NO-GO**; reference only |
| `jka-web` | <https://github.com/Virtastic/jka-web> | Raven JKA 2003 GPL drop | Source present, not built | Yes | GPLv2 | **NO-GO as primary; GO as reference** (user-reported rendering issues) |
| `OpenJK` | <https://github.com/JACoders/OpenJK> | Itself (ioquake3/Raven lineage) | Yes | Yes | GPLv2 | **GO (conditional) — primary** |
| `q3js` | <https://github.com/lklacar/q3js> | ioquake3 (Quake III) | Quake III MP, not JKA | Yes (mixed) | GPL-2.0-only engine; proprietary non-engine | **NO-GO** |

### 2.1 The ambiguity around `jk.q3js.com`

This is the most important distinction in the research brief, so it is addressed first.

There are four different things that can be confused:

| Thing | What it actually is | Relationship to the JKA demo player |
|---|---|---|
| `https://jk.q3js.com/` | A Next.js site that loads two OpenJK WebAssembly clients | The closest existing product, but its JKA MP source is not published |
| `https://github.com/lklacar/openjk-emscripten` | An early OpenJK **single-player** Emscripten port | Same author, different and older implementation |
| `https://github.com/lklacar/q3js` | A **Quake III Arena** browser project (ioquake3) | Different game; non-engine code is proprietary |
| `https://github.com/Virtastic/jka-web` | A Raven JKA **single-player** Emscripten port | Independent project; MP source present but not built |

#### 2.1.1 What the site actually loads

The site's HTML is a Next.js app. Its client chunk defines (minified in the shipped chunk; normalized here for readability):

```js
OPENJK_WASM_CLIENTS = {
  "single-player": {
    baseUrl: "/JediAcademy/sp/",
    scriptUrl: "/JediAcademy/sp/openjk-sp-wasm.js"
  },
  multiplayer: {
    baseUrl: "/JediAcademy/mp/",
    scriptUrl: "/JediAcademy/mp/openjk-mp-wasm.js"
  }
}
```

Observed in the public chunk `/_next/static/chunks/2kcql1d3_ub-n.js` (downloaded 2026-11-13).

The multiplayer binary is public:

- `https://jk.q3js.com/JediAcademy/mp/openjk-mp-wasm.js`
- `https://jk.q3js.com/JediAcademy/mp/openjk-mp-wasm.wasm`
- `Content-Length: 4658278` bytes (about 4.66 MB)
- `Last-Modified: Mon, 28 Sep 2026 21:32:51 GMT`
- `Content-Type: application/wasm`

The single-player binary is separate:

- `https://jk.q3js.com/JediAcademy/sp/openjk-sp-wasm.js`

The site's UI says:

> Single player and multiplayer use separate WebAssembly builds. Multiplayer can join our public FFA server at `jk-ffa.q3js.com`.

This is consistent with the artifacts. It also exposes an important architectural fact: **the project treats SP and MP as different engine builds**, not one build with a mode switch.

#### 2.1.2 Does the site's MP build contain demo playback?

The public MP WebAssembly binary contains these strings (extracted with `strings -n 5`):

```text
CL_PlayDemo_f()
demo <demoname>
demos/%s
demos/%s.dm_%d
Demo file was truncated.
record <demoname>
Record a demo
```

This is strong evidence that the shipped MP build **contains OpenJK's demo playback code path**, including `.dm_26` naming and the `demo` command. It does **not** prove that the site exposes a demo picker; the frontend inspected so far only selects `.pk3` files and offers single-player or multiplayer play. No `.dm_26` file input was found in the public frontend chunks inspected.

The MP build also imports Emscripten WebSocket functions and an application hook:

```text
BrowserNet_GetModuleRelayUrl
emscripten_websocket_new
emscripten_websocket_send_binary
emscripten_websocket_set_onmessage_callback_on_thread
```

That is for networked multiplayer (`wss://jk-ffa.q3js.com`), not a requirement for demo playback. Demo playback reads a local file and does not need the relay.

#### 2.1.3 How the site handles assets

The public frontend uses an ordinary file input:

```html
<input type="file" multiple accept=".pk3">
```

and caches the selected files in IndexedDB:

- Database: `openjk-asset-cache`
- Object store: `pk3-files`
- Records: `{ name, size, lastModified, cachedAt, blob }`

Observed in the public chunk. This is a useful pattern for our shell, but it is not the only possible one. The Emscripten loader includes both `MEMFS` and `IDBFS`; the exact staging path from the IndexedDB blob to the engine VFS was not located in the public chunks inspected.

#### 2.1.4 Is the site's JKA MP source available?

No public JKA MP source repository was found.

- `lklacar/openjk-emscripten` is public and **single-player only**.
- `lklacar/q3js` is public and is **Quake III Arena**, not JKA.
- No repository named for JKA multiplayer appears in the author's public repository list.
- The site build date (2026-09-28) is newer than the public `openjk-emscripten` commit (2026-05-18), which is consistent with an unpublished MP implementation or a newer private branch. This is an inference, not proof.

The upstream engine is **OpenJK** (the artifact contains OpenJK's `CL_PlayDemo_f` / `demos/%s.dm_%d` strings and the page describes an "OpenJK WebAssembly client"). The exact fork, branch, and patch set are not published, so the upstream relationship is verified at the level of code lineage, not at the level of a reproducible build.

Therefore the site is useful as **evidence that an OpenJK MP WebAssembly build is possible**, and as a behavioral benchmark. It is **not** a reusable foundation for an open-source project.

#### 2.1.5 Licensing of the site and `q3js`

The `q3js` repository's root `LICENSE` is a multi-license notice:

- `game/engine/`: **GPL-2.0-only** (ioquake3-derived).
- `game/client/`, `game/server/`, `master/`, `static/`, `website/`: **proprietary**, all rights reserved.
- `master/src/main/resources/` DB-IP data: CC BY 4.0.

The JKA site itself does not publish a source license. Its engine is presumably GPLv2-derived, but the site's integration code is not published, and the `q3js` repository's non-engine code is explicitly not reusable. **Do not copy code or assets from `q3js` or `jk.q3js.com`.**

**Verdict:** **NO-GO as a foundation.** **GO as a reference** for the fact that an MP build is feasible and for black-box behavior comparisons.

---

### 2.2 `lklacar/openjk-emscripten`

#### 2.2.1 What it is

- Repository: <https://github.com/lklacar/openjk-emscripten>
- Upstream: [OpenJK](https://github.com/JACoders/OpenJK), the community continuation of Raven's GPL JKA/JK2 engines.
- Commit inspected: `3a2255593bc4d95199f21c67bb092bb0c9bc6848` (2026-05-18), 18 commits total.
- Runtime demo: the README points to `https://jk.qubit.rs`, not `jk.q3js.com`.

The README is explicit:

> Currently, only JA single player engine is ported. Additional PRs porting multiplayer and Jedi Outcast versions are welcome.

#### 2.2.2 Source and build evidence

- `CMakeLists.txt:36` adds `SP_GAME`.
- `CMakeLists.txt:37` adds `_JK2EXE`.
- The only executable target is `jedi_academy` (`CMakeLists.txt:45`).
- There is no `codemp` directory and no `jamp` target.
- `src/code/client/cl_main.cpp` has recording/AVI code but **no** `CL_PlayDemo_f`, no `CL_ReadDemoMessage`, and no `.dm_` demo path. This matches the SP engine.
- The project builds with **Emscripten 2.0.11** (README), not a current toolchain.
- Rendering uses **Regal**, a GLES/OpenGL emulation layer: `-s USE_REGAL=1` in `CMakeLists.txt:527`.
- The README itself says performance is "far from perfect" because OpenGL calls are emulated to WebGL.

#### 2.2.3 How it loads game data

`scripts/preload.js` is the entire asset pipeline:

```js
function downloadAsset(pakName) {
  return fetch('http://localhost:8000/base/' + pakName)
    .then(resp => resp.blob())
    .then(blob => blob.arrayBuffer())
    .then(data => {
      FS.writeFile('/base/' + pakName, new Uint8Array(data));
    });
}

Module.noInitialRun = true;
Module.preInit = function () {
  setTimeout(() => {
    FS.mkdir('/base');
    Promise.all([
      downloadAsset("assets0.pk3"),
      downloadAsset("assets1.pk3"),
      downloadAsset("assets2.pk3"),
      downloadAsset("assets3.pk3"),
      downloadAsset("default.cfg"),
    ]).then(() => {
      Module.run();
    });
  }, 500);
};
```

Consequences:

- Hard-coded `http://localhost:8000/base/`.
- No user-selected directory or file input.
- No demo staging.
- No streaming, no validation, no progress beyond console logs.
- MEMFS only; every PK3 is copied into the Emscripten heap.
- It assumes all four retail PK3s and `default.cfg` already exist in `bin/base/`.

This is a demo harness, not an application filesystem layer.

#### 2.2.4 Licensing

- There is **no project `LICENSE` file** in the repository. A search finds only `src/lib/gsl-lite/LICENSE` and an icon license.
- The GitHub API reports no detected license.
- The README says the codebase is based on OpenJK, which is GPLv2. A derivative of OpenJK is therefore very likely subject to GPLv2, but the repository does not state the terms of its own modifications.
- This is a compliance and reuse risk. It is not safe to copy its modifications into a new project without clarification, even though the upstream engine is GPLv2.

**Verdict:** **NO-GO as a foundation.** It is a useful historical reference for a minimal Emscripten port, but it is SP-only, has no user filesystem, uses an obsolete toolchain, and has no explicit license.

---

### 2.3 `Virtastic/jka-web`

#### 2.3.1 What it is

- Repository: <https://github.com/Virtastic/jka-web>
- Public app: <https://jka.virtastic.app>
- Upstream: **Raven Software's original 2003 GPL source release**, not OpenJK. The repo says "No code is copied from OpenJK or iortcw."
- Commit inspected: `73b6006ae1e5b0269eca595e6daf89bcf1582e0c` (2026-10-12).
- License: GPLv2 (`LICENSE`, `NOTICE.md`).

The README states:

> Single-player only. The multiplayer sources are part of the drop but are not built.

This is the key sentence. The repository is not a multiplayer port today.

#### 2.3.2 Why it remains a valuable reference

It is a complete, JKA-specific, Emscripten 6.0.1 port with a working single-player engine:

- Engine source under `games/jka/code/`.
- A platform layer under `shared/wasm-build/sys_emscripten_jk/` (`sys_jk.cpp`, `sys_jk_gl.cpp`, `sys_jk_snd.cpp`, `sys_jka_stubs.cpp`).
- Build scripts: `shared/wasm-build/build-jka.sh` and `build-jka-modules.sh`.
- A browser shell: `play/jka/index.html` and `launcher.html`.
- A dev server with HTTP Range support: `shared/web/server.py`.
- CDP test harnesses that boot real Chrome and assert on rendered output: `verify-*.mjs`, `map-sweep.mjs`, `soak.mjs`.
- Documented renderer fixes, memory measurements, and known data constraints in `docs/WASM_ADAPTATIONS.md` and `docs/DATA.md`.

It has already solved the parts of the problem that are expensive to rediscover:

- Emscripten flags and C++ archaeology for Raven's 2003 code.
- WebGL 1/2 GL emulation for the id Tech 3 renderer.
- Ghoul2 skeletal rendering and 16-bit index handling.
- RoQ cinematics and MP3 audio.
- MEMFS staging of 1.22 GB of retail PK3s.
- IDBFS for saves and config.
- Headless Chrome verification.

#### 2.3.3 The multiplayer source is present

`games/jka/codemp/` is the complete Raven multiplayer tree:

- 19 MB.
- 416 `.c`/`.cpp` files.
- Engine project: `codemp/jk2mp.vcproj` with **197** C/C++ translation units. (Raven reused the `jk2mp` project name for the JKA MP client; this is not a JK2-only tree.)
- Client game: `codemp/x_jk2cgame/x_jk2cgame.vcproj` with **51** TUs.
- UI: `codemp/x_ui/x_ui.vcproj` with **13** TUs.
- Server game: `codemp/x_jk2game/x_jk2game.vcproj` with **88** TUs (not required for demo playback).

For comparison, the SP engine project has 190 TUs. The MP engine is therefore a comparable build size.

The MP tree also contains the demo code:

- `games/jka/codemp/client/cl_main.cpp` has `CL_Record_f`, `CL_WriteDemoMessage`, `CL_StopRecord_f`, `CL_DemoCompleted`, `CL_ReadDemoMessage`, and `CL_PlayDemo_f`.
- `games/jka/codemp/qcommon/qcommon.h` defines `PROTOCOL_VERSION 26`.
- `games/jka/codemp/qcommon/files.cpp` defines `DEMO_EXTENSION "dm_"` and `FS_IsDemoExt`.

#### 2.3.4 The multiplayer code has not been ported

A repository-wide search of `games/jka/codemp` for `__EMSCRIPTEN__` returns **zero** matches. The SP tree, by contrast, has many Emscripten guards.

This matters because the SP port's renderer fixes are in `games/jka/code/renderer/`, while the MP renderer is a separate copy in `games/jka/codemp/renderer/`. Example:

- SP: `games/jka/code/renderer/tr_local.h:22` uses `#if defined(_XBOX) || defined(__EMSCRIPTEN__)` for the 16-bit `glIndex_t`.
- MP: `games/jka/codemp/renderer/tr_local.h:22-28` only special-cases `_XBOX`; otherwise `glIndex_t` is `unsigned int`. That is exactly the kind of WebGL1 index-size issue the SP port already had to fix.

The MP renderer is not a copy of the SP renderer; a sample diff shows hundreds to thousands of changed lines per file (raw `diff` line counts, not a precise edit distance: `tr_local.h` ~772, `tr_ghoul2.cpp` ~2899, `tr_backend.cpp` ~661, `tr_shade.cpp` ~731, `tr_init.cpp` ~889). The port work is therefore **not** "flip a CMake option"; it is "apply the same class of Emscripten fixes to a second, divergent engine tree."

The project's own documentation contains a stale statement that "neither GPL drop ships an MP tree" (`docs/WASM_ADAPTATIONS.md:3269`). That is contradicted by the actual `codemp` tree and by the README's more accurate "multiplayer sources are part of the drop but are not built." This is a reminder to trust the tree, not the prose.

#### 2.3.5 How it handles the filesystem

The SP shell is a direct precedent for our design:

- `play/jka/index.html` creates `/jka/base`, `/jka/demo`, and `/userdata`.
- It mounts IDBFS at `/userdata` and at `/jka/base/saves` / `/jka/demo/saves` for persistence.
- It stages PK3s with `FS.createDataFile(..., canOwn=true)`.
- It streams the response body into an exactly sized `Uint8Array` to avoid holding each PK3 twice.
- `docs/DATA.md` records the retail sizes: **1.22 GB total** (`assets0` 562 MB, `assets1` 653 MB, `assets2` 1 MB, `assets3` 9 MB).
- MEMFS stores file contents as JavaScript-heap `Uint8Array`s, **not** inside the wasm linear memory, so the PK3s do not consume the wasm32 4 GB address space; they are bounded by the tab's overall memory.
- The engine heap was raised to **768 MB** for the SP campaign (`-sINITIAL_MEMORY=805306368`, `-sMAXIMUM_MEMORY=4294967296`).
- `FS.createLazyFile` is rejected because modern browsers block synchronous XHR on the main thread.
- The documented scaling path is "engine in a Web Worker + WORKERFS" for titles approaching ~3 GB. JKA SP does not need it; a demo player might not either.

This is the most credible public evidence for what a JKA WebAssembly filesystem costs.

Note a documentation inconsistency in the upstream repo: `shared/wasm-build/env.sh` contains a stale comment saying PK3s are "range-streamed (not materialized in MEMFS)", while the checked-in `index.html` at this commit stages the full files with `FS.createDataFile`. The `DATA.md` explanation and the shell code agree with each other; the `env.sh` comment is the outlier. Treat the code as authoritative.

#### 2.3.6 Licensing

- `LICENSE`: GPLv2.
- `NOTICE.md`: the engine drop and the port are GPLv2; GPLv2-only is asserted because Raven's grant lacks "or later".
- `package.json` says `"license": "GPL-2.0-or-later"`, which is **inconsistent** with `NOTICE.md`. For a fork, treat the combined work as GPLv2 and get the discrepancy clarified or corrected.
- `THIRD-PARTY-LICENSES.md` lists IJG JPEG, Xing/EMusic MP3, zlib/minizip, and other components compiled into the wasm build.

**User-reported rendering issues.** The user tested the public `jka-web` build and observed rendering problems. Those issues were not reproduced or root-caused in this research. Before reusing its renderer or GL-emulation approach, capture the browser/GPU, console output, and a screenshot, and determine whether the defect is in:

- jka-web's SP renderer / assets / driver path, or
- the shared Emscripten GL emulation and WebGL translation, which an OpenJK port would also face.

This distinction is the **G0 gate** in the revised plan. Switching engine source does not automatically fix a defect in the GL emulation layer.

**Verdict:** **NO-GO as the primary foundation; GO as a reference and platform-layer donor.** It is the best public JKA-specific browser port, but it is SP-only, its MP tree is unported, and the user-reported rendering issues are unresolved. Its platform layer, FS staging, and test harnesses are still valuable inputs.

---

### 2.4 `JACoders/OpenJK` (upstream)

#### 2.4.1 What it is

- Repository: <https://github.com/JACoders/OpenJK>
- Commit inspected: `260c59c2907187af555a676fe0cc798893bf7757` (2026-09-29).
- License: GPLv2 (`LICENSE.txt`, README).
- It is the canonical, maintained OpenJK codebase.

#### 2.4.2 Multiplayer and demo support

`CMakeLists.txt` exposes explicit MP targets:

- `BuildMPEngine` → `openjk` (MP client)
- `BuildMPRdVanilla`
- `BuildMPDed`
- `BuildMPGame` → `jampgame`
- `BuildMPCGame` → `cgame`
- `BuildMPUI` → `ui`
- `BuildMPRend2`

The MP tree is `codemp/`. It contains the demo code at `codemp/client/cl_main.cpp`:

- `CL_Record_f` at line 273
- `CL_WriteDemoMessage` at line 206
- `CL_StopRecord_f` at line 229
- `CL_DemoCompleted` at line 412
- `CL_ReadDemoMessage` at line 442
- `CL_PlayDemo_f` at line 514

`codemp/qcommon/qcommon.h:214` defines `PROTOCOL_VERSION 26`.
`codemp/qcommon/files.cpp:1207` defines `DEMO_EXTENSION "dm_"`.
`codemp/qcommon/vm.cpp:32-36` names the VM slots `jampgame`, `cgame`, `ui`.
`codemp/qcommon/vm.cpp:177` loads the modules via `Sys_LoadGameDll`.

OpenJK MP is not a single binary in the same sense as the Raven SP drop. At runtime the client has **four relevant code modules**:

| Module | OpenJK target | Loaded by | Needed for demo playback |
|---|---|---|---|
| Engine | `openjk` (`BuildMPEngine`) | executable | Yes |
| Renderer | `rd-vanilla` (`BuildMPRdVanilla`) | `CL_InitRef` → `Sys_LoadDll` (`codemp/client/cl_main.cpp:2417`) | Yes |
| Client game | `cgame` (`BuildMPCGame`) | `VM_Create` → `Sys_LoadGameDll` (`codemp/qcommon/vm.cpp:154-177`) | Yes |
| UI | `ui` (`BuildMPUI`) | `VM_Create` → `Sys_LoadGameDll` | Conditionally (patched out for a custom shell) |
| Server game | `jampgame` (`BuildMPGame`) | server only | No |

The renderer is a separate DLL (`rd-vanilla_<arch>.so`) loaded through `Sys_LoadDll`, not statically linked into the engine. A browser port must either statically link the renderer and patch `CL_InitRef`, or build it as an Emscripten side module. This is additional scope compared with the Raven SP tree, where the renderer is linked into the engine.

OpenJK also uses separate `fs_basepath` and `fs_homepath` search paths (`codemp/qcommon/files.cpp:3564`, `FS_Startup`). The Emscripten platform layer must implement `Sys_DefaultInstallPath` and `Sys_DefaultHomePath`; the natural mapping is `/jka` for read-only assets and `/userdata` for writable config/saves.

#### 2.4.3 Emscripten support

There is **no Emscripten support** in upstream OpenJK:

- No `__EMSCRIPTEN__` in `codemp/`, the root `CMakeLists.txt`, `cmake/`, or `shared/`.
- The platform layer is SDL2/Unix/Windows, not Emscripten.
- The renderer is desktop OpenGL, not WebGL.
- The CMake build expects system SDL2, JPEG, PNG, zlib, and OpenAL packages; the Emscripten build needs ports or bundled libraries.
- The engine dynamically loads the renderer, cgame, and UI; each needs an Emscripten strategy (static link or side module).

A browser port from upstream OpenJK would require the same platform-layer work that `openjk-emscripten` and `jka-web` each did separately, plus the renderer and module work. That is more work than starting from a port that already boots JKA, but it starts from the maintained MP engine.

**Verdict:** **GO (conditional) — primary foundation.** It is the best-maintained MP source and the correct engine for a demo player, but it is not a browser foundation by itself. The condition is a successful native MP baseline followed by an Emscripten/WebGL spike.

---

### 2.5 `lklacar/q3js`

#### 2.5.1 What it is

- Repository: <https://github.com/lklacar/q3js>
- Commit inspected: `efcb0fe1b76210db0232068a5d4187677c3d8c46` (2026-10-13).
- It is **Quake III Arena**, built on ioquake3, with a browser client, dedicated servers, a WebSocket-to-UDP gateway, and a master server.
- Its website links to `jk.q3js.com` as a sibling project, but the JKA code is not in this repository.

#### 2.5.2 Licensing

The root `LICENSE` is a multi-license notice:

- `game/engine/`: GPL-2.0-only.
- `game/client/`, `game/server/`, `master/`, `static/`, `website/`: proprietary, all rights reserved.

Even if the engine were reusable, the browser integration and tooling around it are not. The project is also for a different game with a different protocol, demo format, renderer features, and game modules.

**Verdict:** **NO-GO.**

---

## 3. B. Demo playback in OpenJK

### 3.1 The one-sentence model

A JKA multiplayer demo is a **recorded sequence of server-to-client network messages** stored in a local file. Playback is a local client that pretends those messages came from a server: it parses the recorded gamestate, loads the map and cgame, then feeds one recorded message at a time into the normal client message parser. No server and no network are required.

### 3.2 Where the code lives

All citations below are from `JACoders/OpenJK` at commit `260c59c...`, under `codemp/` (the multiplayer tree).

| Function | File:line | Role |
|---|---|---|
| `CL_Record_f` | `codemp/client/cl_main.cpp:273` | Starts a client-side demo; writes the initial gamestate |
| `CL_WriteDemoMessage` | `codemp/client/cl_main.cpp:206` | Writes one server message with sequence and length |
| `CL_StopRecord_f` | `codemp/client/cl_main.cpp:229` | Writes the `-1` terminator and closes the file |
| `CL_DemoCompleted` | `codemp/client/cl_main.cpp:412` | End-of-demo cleanup |
| `CL_ReadDemoMessage` | `codemp/client/cl_main.cpp:442` | Reads one framed message and parses it |
| `CL_PlayDemo_f` | `codemp/client/cl_main.cpp:514` | The `demo <name>` command |
| `CL_InitDownloads` | `codemp/client/cl_main.cpp:1515` | Called by the gamestate parser; in a demo it falls through to completion |
| `CL_DownloadsComplete` | `codemp/client/cl_main.cpp:1338` | Flushes memory and calls `CL_InitCGame` |
| `CL_InitCGame` | `codemp/client/cl_cgame.cpp:513` | Loads cgame and enters `CA_PRIMED` |
| `CL_SetCGameTime` | `codemp/client/cl_cgame.cpp:712` | Feeds demo messages until the next snapshot is needed |
| `CGVM_DrawActiveFrame` | `codemp/client/cl_cgame.cpp:600` | Calls cgame with `demoPlayback = clc.demoplaying` |
| `FS_IsDemoExt` | `codemp/qcommon/files.cpp:1208` | Validates `.dm_<protocol>` |
| `FS_ConditionalRestart` | `codemp/qcommon/files.cpp:4110` | Restarts the VFS if the demo's checksum feed/gamedir differs |
| `VM_Create` | `codemp/qcommon/vm.cpp:154` | Loads `jampgame`, `cgame`, or `ui` |
| `Sys_LoadGameDll` | `shared/sys/sys_main.cpp:602` | Platform module loader used by `VM_Create` |

### 3.3 The file format

The JKA MP demo format is deliberately simple. There is **no `DM_26` magic header** in this code path. The `.dm_26` suffix is a filename convention, validated by `FS_IsDemoExt` against `PROTOCOL_VERSION` 26. (This differs from Quake III's `DM_68` header convention; do not assume the Q3 format.)

The file is a sequence of framed messages:

```text
repeat:
  int32 little-endian  serverMessageSequence
  int32 little-endian  messageLength
  byte[messageLength]  server message body
until messageLength == -1
```

Evidence:

- `CL_WriteDemoMessage` writes `clc.serverMessageSequence`, then `msg->cursize - headerBytes`, then the body.
- `CL_StopRecord_f` writes `len = -1` as both the sequence and the length, terminating the stream.
- `CL_ReadDemoMessage` reads a 4-byte sequence, a 4-byte length, treats `-1` as completion, rejects lengths above `MAX_MSGLEN`, reads the body, and calls `CL_ParseServerMessage`.

The first recorded body is a complete gamestate:

- `svc_gamestate`
- all configstrings
- all entity baselines
- `svc_EOF`
- client number
- checksum feed
- a filler short for the old RMG system
- another `svc_EOF`

`CL_Record_f` writes this initial message at the start of recording, then `CL_WriteDemoMessage` appends the normal server messages as they arrive.

`PROTOCOL_VERSION` is 26 in `codemp/qcommon/qcommon.h:214`. `FS_IsDemoExt` accepts a file extension of `dm_` followed by the protocol number, so `.dm_26` is the only protocol accepted by this build.

### 3.4 The playback call graph

```text
console command: demo <name>
        │
        ▼
CL_PlayDemo_f                                  codemp/client/cl_main.cpp:514
  Cvar_Set("sv_killserver", "2")
  CL_Disconnect(qtrue)
  build "demos/<name>.dm_26"
  FS_FOpenFileRead(name, &clc.demofile, qtrue)
  cls.state = CA_CONNECTED
  clc.demoplaying = qtrue
  while (CA_CONNECTED <= state < CA_PRIMED)
      CL_ReadDemoMessage()
        │
        ▼
CL_ReadDemoMessage                             codemp/client/cl_main.cpp:442
  read sequence, length, body
  CL_ParseServerMessage(&buf)
        │
        ▼
CL_ParseGamestate                              codemp/client/cl_parse.cpp:501
  CL_ClearState()
  parse configstrings and baselines
  read clientNum, checksumFeed, RMG filler
  CL_SystemInfoChanged()
  FS_ConditionalRestart(checksumFeed)
  CL_InitDownloads()                           codemp/client/cl_main.cpp:1515
        │
        ▼
CL_DownloadsComplete                           codemp/client/cl_main.cpp:1338
  CL_FlushMemory()
  CL_InitCGame()                               codemp/client/cl_cgame.cpp:513
        │
        ▼
CL_InitCGame
  CL_BindCGame()            → loads cgame module
  cls.state = CA_LOADING
  CGVM_Init(...)
  cls.state = CA_PRIMED
        │
        ▼
per frame: CL_SetCGameTime                    codemp/client/cl_cgame.cpp:712
  if CA_PRIMED and demoplaying:
      skip first frame
      CL_ReadDemoMessage()
  once CA_ACTIVE:
      while (cl.serverTime >= cl.snap.serverTime)
          CL_ReadDemoMessage()
  CGVM_DrawActiveFrame(cl.serverTime, stereo, clc.demoplaying)
        │
        ▼
cgame                                          codemp/cgame/cg_view.c:2417
  CG_DrawActiveFrame(..., demoPlayback = true)
  cg.demoPlayback = true
  cg_predict / cg_snapshot / camera take the demo path
```

### 3.5 Does demo playback require a multiplayer engine build?

**Yes, in OpenJK as shipped.**

- The SP tree's `code/client/cl_main.cpp` has no `CL_PlayDemo_f`, no `CL_ReadDemoMessage`, and no `CL_DemoCompleted`. It has AVI recording (`cl_avidemo`) and cinematics, but not the demo command path.
- The MP tree's `codemp/client/cl_main.cpp` has all of them.
- The `.dm_26` extension is tied to the MP `PROTOCOL_VERSION` 26.
- The MP engine's cgame is the one that receives `demoPlayback = true` and knows how to skip prediction and follow the recorded player.

A single-player engine build cannot play a `.dm_26` demo without adding or porting this code. **Multiplayer support is a prerequisite, but it does not automatically imply demo playback support**: an MP build can be compiled without cgame, without the demo command, or with a modified protocol. In the `jk.q3js.com` MP build, the strings show that the code is present; in `jka-web`'s current build, the MP tree is not compiled at all.

### 3.6 Which modules are required?

For demo playback:

| Module | Required? | Why |
|---|---|---|
| MP engine (`codemp/client`, `codemp/qcommon`, `codemp/server`) | **Yes** | Owns the demo file, parser, client state, and frame loop |
| Renderer `rd-vanilla` (`codemp/rd-vanilla`) | **Yes** | Draws the world; in OpenJK MP it is a separate library loaded by `CL_InitRef` (`codemp/client/cl_main.cpp:2417`) |
| `cgame` (`codemp/cgame`) | **Yes** | Receives the gamestate/snapshots; draws the world, HUD, camera, effects; loaded by `VM_Create`/`Sys_LoadGameDll` |
| `ui` (`codemp/ui`) | **Conditionally** | `CL_StartHunkUsers` calls `CL_InitUI`; `CL_DemoCompleted` calls `UIVM_SetActiveMenu(UIMENU_MAIN)` |
| `jampgame` (`codemp/game`) | **No** | No listen server is started for playback; the server game module is not loaded |
| Dedicated server | **No** | Playback is local |
| Network relay / UDP | **No** | The demo supplies the messages |

`CL_StartHunkUsers` (`codemp/client/cl_main.cpp:2359`) initializes the renderer, sound, and UI at startup. `CL_InitCGame` loads cgame. `CL_DemoCompleted` calls into UI. If we want a custom React UI and no engine menu, we can either build UI (13 TUs) and hide it, or patch `CL_InitUI` / `CL_DemoCompleted` to skip it. Building UI is the lower-risk first step; patching it is a later cleanup.

OpenJK's module split matters for the port: the engine, renderer, cgame, and UI are four separate code images. A browser port must decide, for each, whether to link it statically or build an Emscripten side module. The renderer is the one that most directly affects the reported rendering issues.

The server game module is not needed for playback, but the **engine** still contains server code (`codemp/server`) for listen-server support. That is normal: `CL_PlayDemo_f` sets `sv_killserver` and disconnects, so no server is running.

### 3.7 Is demo playback different from connecting to a server?

Yes, in specific and testable ways:

| Aspect | Connect to server | Play demo |
|---|---|---|
| Transport | UDP/WebSocket relay | Local file reads |
| Handshake | `getchallenge` / `connect` / challenge | None |
| Messages | Arrive from network | Read sequentially from file |
| Server | Remote or local listen server | None |
| Downloads | `sv_allowDownload`, pure checksums | No server downloads; local files must already match |
| Time | Network snapshots + `cl_timeNudge` | File-driven; `cl_timedemo` / `cl_freezeDemo` special cases |
| cgame flag | `demoPlayback = false` | `demoPlayback = true` |
| Prediction | Enabled | Disabled by cgame |
| Camera | Local player / spectator | Recorded player's view |
| End | Disconnect | `CL_DemoCompleted` → UI main menu / `nextdemo` |

### 3.8 Can playback work without a network connection?

**By source inspection: yes, for the demo path.** The relevant calls short-circuit:

- `CL_CheckForResend` (`codemp/client/cl_main.cpp:1574`) begins with:

  ```c
  // don't send anything if playing back a demo
  if ( clc.demoplaying ) {
      return;
  }
  ```

- `CL_WritePacket` (`codemp/client/cl_main.cpp`, around line 866) returns early when `clc.demoplaying` is true.
- `CL_PlayDemo_f` opens a local file, sets `clc.demoplaying`, and reads it. It does not call `NET_*` or `Sys_SendPacket`.
- `CL_DownloadsComplete` calls `CL_SendPureChecksums` and `CL_WritePacket`; the latter is a no-op for demos. `CL_InitDownloads` only compares local paks; it does not contact a server.
- The network stack may still be initialized at engine startup, but the demo path does not require a packet to be sent or received.

**Not runtime-tested here.** For a local-only player, we should still stub or disable `Sys_SendPacket` / `Sys_GetPacket` in the Emscripten platform layer and enforce a no-network CSP, so a misconfigured build cannot phone home.

### 3.9 Demo playback caveats that affect the product

These are the issues most likely to surprise an implementer.

#### 3.9.1 Mods, `fs_game`, and pure checksums

`CL_ParseGamestate` calls `CL_SystemInfoChanged()`, which reads the recorded serverinfo and can set the game directory (`fs_game`). It then calls `FS_ConditionalRestart(clc.checksumFeed)`. If the demo was recorded on a modded server, or the checksum feed does not match the local files, the engine can restart the filesystem mid-playback and look for PK3s that are not present.

There is a second trap in `CL_InitDownloads` (`codemp/client/cl_main.cpp:1515`): if `cl_allowDownload` is enabled and `FS_ComparePaks` reports missing pure paks, the engine can enter its download path even though a demo has no server to download from. Set **`cl_allowDownload 0`** before issuing `demo`, and treat missing-pak warnings as a compatibility error. This is a cheap, high-value safeguard for the demo player.

Implications:

- A demo recorded on `base` with retail assets is the safe first target.
- A demo recorded on a mod (JA+, custom cgame, custom maps) may require the matching mod PK3s and cgame.
- The player must either ask the user for the mod assets or refuse the demo with a clear error.
- Pure-server checksum enforcement can reject an otherwise valid local install.

This is a **product requirement**, not just an engine detail: the error UI must explain "this demo needs the mod/map it was recorded with."

#### 3.9.2 cgame version mismatch

The demo stores server messages, not the cgame binary. Playback uses the local cgame. If the demo was recorded with a mod cgame that changes entity types, configstrings, or snapshot layout, the base cgame may misrender or error. The safe MVP target is base-game demos with the base cgame that ships with the same protocol.

#### 3.9.3 No built-in seek

`CL_PlayDemo_f` opens the file at the start. `CL_ReadDemoMessage` is sequential. There is no index, no keyframe table, and no `FS_Seek` in the demo path. Snapshots are delta-encoded, so a random seek cannot reconstruct state without replaying the preceding messages.

A timeline/scrubber therefore needs one of:

1. **Restart + fast-forward**: close and reopen the demo, then read/discard messages until the target time. Simple and correct; can be slow for long demos.
2. **A precomputed index**: record file offsets and `serverTime` values during a fast-forward pass; seeking still replays from the start or from a known full snapshot, but the UI can show a real duration.
3. **A custom snapshot keyframe cache**: much more complex; not an MVP feature.

Do not promise instant scrubbing in the first release.

#### 3.9.4 UI dependency at the end

`CL_DemoCompleted` calls `CL_Disconnect_f`, `S_StopAllSounds`, `UIVM_SetActiveMenu(UIMENU_MAIN)`, and `CL_NextDemo`. If UI is not built, this path must be patched to call a JS callback instead.

#### 3.9.5 Server-side demos

`codemp/server/sv_ccmds.cpp:1830` implements `SV_Record_f` (`svrecord`), a server-side demo recorder. It also writes `demos/<name>.dm_26` (`SV_WriteDemoMessage` at `sv_ccmds.cpp:1527`, `SV_StopRecord_f` at `1578`). These are recorded per client from the server's perspective. They may be playable through the client `demo` command, but that is **not verified**. Treat server-side demos as a separate compatibility class and test them explicitly.

#### 3.9.6 Filename and path

`CL_PlayDemo_f` always prepends `demos/`:

```c
Com_sprintf(name, sizeof(name), "demos/%s.dm_%d", arg, PROTOCOL_VERSION);
```

So the VFS must contain the demo at `<gamedir>/demos/<name>.dm_26`, and the command should be `demo <name>` (or a quoted name). Do not pass an absolute host path.

### 3.10 Demo playback: conclusion

- The engine-side playback mechanism is well understood and small.
- The hard parts are **building the MP engine + cgame for WebAssembly**, **supplying the right assets/mod**, and **designing a synchronous browser VFS**.
- Demo playback is not inherently networked; a local-only player is consistent with the engine's design.
- The playback feature is a good vertical slice because it exercises the engine, cgame, renderer, audio, filesystem, and map loading in one path.

---

## 4. C. Browser filesystem

### 4.1 What the engine expects

The engine's filesystem is a synchronous, POSIX-like VFS inherited from id Tech 3. It expects:

- Directory enumeration at startup (`FS_Startup`, `FS_AddGameDirectory`).
- `fopen` / `fread` / `fseek` / `fclose` semantics.
- PK3 archives opened as files and read through minizip (`unzOpen`, `unzOpenCurrentFile`, `unzReadCurrentFile`).
- Whole-file reads (`FS_ReadFile`) for configs, shaders, maps, and assets.
- Writes for configs and savegames.
- No `await`, no promises, no event loop in the middle of a read.

The demo path specifically uses:

- `FS_FOpenFileRead("demos/foo.dm_26", &clc.demofile, qtrue)`
- `FS_Read(&s, 4, clc.demofile)`
- `FS_Read(buf.data, buf.cursize, clc.demofile)`

All of these are synchronous C calls. The browser filesystem must therefore be **synchronous by the time native code runs**. Selection can be asynchronous; staging must complete before boot.

### 4.2 The options

| Option | Sync reads from native code? | Read/write | Where it runs | Cost / constraint | Fit for PK3s | Fit for demo | Fit for saves |
|---|---|---|---|---|---|---|---|
| **Emscripten MEMFS** | Yes | Read/write | Main thread | Copies data into JS heap; memory proportional to files | Good for MVP | Excellent | Good (lost on reload) |
| **Emscripten WORKERFS** | Yes | Read-only | **Worker only** | No copy; `FileReaderSync` per read; requires engine in a worker | Good later | Good | No |
| **Emscripten IDBFS** | Yes after hydration | Read/write | Main thread | Persists to IndexedDB; hydration copies into memory; async `syncfs` | Poor for 1.2 GB | Overkill | Excellent |
| **OPFS** | Sync only via `FileSystemSyncAccessHandle` in a dedicated worker | Read/write | Worker (sync) / main (async) | Quota-managed; not a local-file picker | Possible cache | Possible | Good alternative |
| **File System Access API** | No (async on main thread) | Read/write | Main thread | Chromium-only; user gesture; permission prompts | Selection only | Selection only | Possible via save handle |
| **`<input type=file>` / `webkitdirectory`** | No (gives `File` objects) | Read-only | Main thread | Broad support; no persistent handle | Selection only | Selection only | No |
| **Drag-and-drop entries** | No | Read-only | Main thread | Async traversal | Selection only | Selection only | No |

### 4.3 The critical constraints

#### 4.3.1 WORKERFS is worker-only

The Emscripten documentation says:

> This file system is only for use when running code inside a worker.

The implementation makes it explicit:

```js
mount(mount) {
  assert(ENVIRONMENT_IS_WORKER);
  WORKERFS.reader ??= new FileReaderSync();
  ...
}
```

Source: Emscripten `src/lib/libworkerfs.js` (MIT/NCSA).

So WORKERFS is **not** a way to avoid copying files while the engine runs on the main thread. It is only available if the entire engine runs in a Web Worker.

#### 4.3.2 OPFS sync access is worker-only and OPFS-only

MDN:

> This feature is only available in Dedicated Web Workers.

and:

> ... for files within the origin private file system.

`FileSystemSyncAccessHandle` is for OPFS files, not arbitrary user-selected files. It is a possible cache/storage backend, not a way to read the user's `GameData/base/assets1.pk3` synchronously.

#### 4.3.3 File System Access API is asynchronous and Chromium-only

`window.showDirectoryPicker()`:

- Requires a secure context and transient user activation.
- Returns a `Promise<FileSystemDirectoryHandle>`.
- Is marked **limited availability** / experimental by MDN; at the time of writing, Chromium desktop is the reliable target, and Firefox/Safari should be treated as unsupported for this API.
- Reading a file (`getFile()`) is asynchronous.
- The handle can be stored in IndexedDB and re-permissioned later, which is good UX.

It is excellent for **selecting** `GameData` and persisting the selection. It cannot be called from native synchronous code.

#### 4.3.4 `FS.createLazyFile` is not viable on the main thread

`FS.createLazyFile` uses synchronous XMLHttpRequest to fetch ranges on demand. Modern browsers block synchronous XHR on the main thread. `jka-web`'s `docs/DATA.md` records this explicitly and rejects the approach.

#### 4.3.5 MEMFS memory is real but not wasm32 address space

`jka-web` measured a 1.22 GB retail JKA install. MEMFS stores file contents as JavaScript-heap `Uint8Array`s, not in the wasm linear memory. The wasm heap still needs 768 MB for the SP campaign working set, but the PK3s do not count against the 4 GB wasm32 limit. The real limit is the browser tab's overall memory.

For a **demo player**, the user still needs the full base asset set to load the map and models. That is the same 1.22 GB for a retail install. There is no safe way to load only "the parts the demo needs" without parsing every referenced asset; not an MVP feature.

### 4.4 How to connect the browser picker to the engine

The proven pattern from `jka-web` and `jk.q3js.com` is:

1. **Select** files asynchronously:
   - Preferred: `showDirectoryPicker()` to select `GameData`, then enumerate `base/*.pk3` and `base/demos/*.dm_26`.
   - Fallback: `<input type="file" multiple accept=".pk3,.dm_26">` or `webkitdirectory`.
2. **Validate**:
   - `assets0.pk3` … `assets3.pk3` present for a retail install.
   - `productid.txt` exists inside one of the PK3s (JKA: `assets2.pk3`) to leave demo/restricted mode. `jka-web` does this by reading the zip central directory tail.
   - Demo filename ends in `.dm_26`; optionally inspect the first framed message.
3. **Stage into MEMFS before engine boot**:
   - Create `/jka/base` and `/jka/base/demos`.
   - For each PK3: read the `File`/`Blob` into an exactly sized `Uint8Array` and call `FS.createDataFile(dir, name, bytes, true, false, true)` with `canOwn=true`.
   - For the demo: write it to `/jka/base/demos/<name>.dm_26`.
   - Mount IDBFS at a **separate** directory for saves/config, not on `/jka/base` (otherwise IDBFS tries to persist 1.2 GB).
4. **Boot** the engine with the VFS already populated.
5. **Issue** `demo <name>` through an exported command hook.

This is the lowest-risk MVP. It is exactly what the existing JKA SP port does for PK3s, extended with a demo file.

### 4.5 The zero-copy alternative (for later)

If 1.22 GB of MEMFS plus the engine working set is too much for the target devices, the architectural upgrade is:

- Run the engine in a **Web Worker**.
- Mount **WORKERFS** with the user's `File` objects for `/jka/base` (read-only).
- Mount **IDBFS** or OPFS for saves in a separate directory.
- Render with **OffscreenCanvas** (WebGL) or use Emscripten's `PROXY_TO_PTHREAD` / worker rendering support.
- Forward input and audio between the main thread and the worker.
- Enable `SharedArrayBuffer`, which requires COOP/COEP cross-origin isolation.

This is a substantial platform change. It is the right long-term answer for very large assets, but it is **not** the simplest route to a prototype. The existing JKA SP port explicitly documents worker + WORKERFS as the scaling path for ~3 GB titles, not as its current architecture.

A third option is a **custom Emscripten FS backend** backed by a Worker and `SharedArrayBuffer` that performs synchronous reads via `Atomics.wait` on the main thread. `jka-web`'s `env.sh` mentions a "SharedArrayBuffer-backed streamfs pk3 reader" as future work. This is powerful but complex and requires the same cross-origin isolation. Do not start here.

### 4.6 What about OPFS?

OPFS is useful for:

- Caching extracted or transformed assets.
- Storing a copy of the user's PK3s after an explicit "cache for offline use" action.
- Persisting large save/config data.

It is not useful for directly reading the user's existing `GameData` folder synchronously. The user already has the files; copying 1.22 GB into OPFS is worse than staging into MEMFS for a single session. Skip it for MVP.

### 4.7 What about IDBFS?

Use IDBFS only for **small, persistent engine state**:

- `jampconfig.cfg` / `mpdefault.cfg`
- savegames
- key bindings
- window/settings

For OpenJK, mount IDBFS at `/userdata` and set `fs_homepath=/userdata`; the engine writes config and saves under `/userdata/base`. Do **not** mount IDBFS over the directory that holds the staged PK3s. `jka-web` discovered this the hard way: mounting IDBFS at `/jka/base` would try to push 1.2 GB into IndexedDB.

### 4.8 Filesystem conclusion

- **MVP: MEMFS staging.** It is synchronous, proven by `jka-web`, and simple.
- **Selection: File System Access API with a file-input fallback.** Do not depend on FSA for engine reads; use it to get `File` objects.
- **Persistence: IDBFS for saves/config only.**
- **Later: worker + WORKERFS** if memory or startup time demands it.
- **Do not** use `FS.createLazyFile` on the main thread; synchronous XHR is blocked.
- **Do not** assume WORKERFS/OPFS can serve main-thread synchronous reads.

---

## 5. D. Legal and licensing

> This section records evidence and obligations to investigate. It is not legal advice. Consult counsel before distributing binaries or operating a public service.

### 5.1 Component licenses

| Component | Version/source | License | Evidence | Notes |
|---|---|---|---|---|
| OpenJK engine | `JACoders/OpenJK` | **GPLv2** | `LICENSE.txt`; README says "GPLv2" | Copyleft; source distribution required for binaries |
| Raven JKA GPL drop | `Virtastic/jka-web/games/jka` | **GPLv2** | `games/jka/LICENSE.txt`; `NOTICE.md` | GPLv2-only asserted; no "or later" for Raven's code |
| `jka-web` port | `Virtastic/jka-web` | **GPLv2** | `LICENSE`, `NOTICE.md` | `package.json` says GPL-2.0-or-later; inconsistent |
| `openjk-emscripten` | `lklacar/openjk-emscripten` | **Not stated** | No project `LICENSE`; GitHub API has none | Derivative of GPLv2 OpenJK; do not assume permissive |
| `q3js` engine | `lklacar/q3js/game/engine` | **GPL-2.0-only** | `LICENSE` | ioquake3-derived |
| `q3js` non-engine | `lklacar/q3js` other dirs | **Proprietary** | `LICENSE` | All rights reserved; not reusable |
| Emscripten | `emscripten-core/emscripten` | **MIT / NCSA** | `LICENSE` | Permissive; wasm output has no extra license |
| SDL2 | `libsdl-org/SDL` | **zlib** | GitHub license metadata | Permissive |
| zlib / minizip | zlib, minizip | **zlib** | `jka-web/THIRD-PARTY-LICENSES.md` | Permissive; attribution |
| libjpeg (IJG) | Raven drop `jpeg-6/` | **IJG terms** | `jka-web/THIRD-PARTY-LICENSES.md` | Permissive; README missing in drop; attribution |
| libpng | Raven drop `png/` | **libpng** | Raven drop | Permissive |
| Xing/EMusic MP3 | Raven drop `mp3code/` | **GPLv2-or-later** | `jka-web/THIRD-PARTY-LICENSES.md` | Compatible with GPLv2 |
| OpenAL | OpenJK optional | **LGPL** (OpenAL Soft) | OpenJK CMake options | Only if linked; prefer SDL2 audio to avoid extra obligations |
| Regal | used by `openjk-emscripten` | **Unverified** | No license file in that repo; `-s USE_REGAL=1` | Check the Emscripten port before use |
| gsl-lite | `openjk-emscripten/src/lib/gsl-lite` | **MIT** | `LICENSE` | Permissive |
| React | `facebook/react` | **MIT** | GitHub metadata | Permissive |
| Vite | `vitejs/vite` | **MIT** | GitHub metadata | Permissive |
| TypeScript | Microsoft | **Apache-2.0** | Standard | Permissive |

### 5.2 GPL obligations when distributing modified binaries

If we distribute a WebAssembly build derived from OpenJK or Raven's GPL code, the GPL applies to the distributed work. At a high level:

- **Provide the complete corresponding source** for the binaries, including our modifications and the scripts needed to build them.
- **Include the license texts and copyright notices.**
- **Do not add restrictions** on the GPL rights (no proprietary EULA, no anti-reverse-engineering terms that conflict).
- **Mark modified files** and keep the notices.
- **Distribute the same rights** for the combined work.

The GPLv2 is a distribution license. Simply running the app on a server is not, by itself, the same as distributing binaries. But a web app serves the `.wasm`/`.js` to every visitor, which is a distribution of those binaries. The safe posture is: **publish the full source and build scripts, and offer the source from the site.**

The Emscripten-generated JavaScript glue is part of the built artifact; treat it as part of the corresponding source/binary set and publish its source (the engine + build scripts) anyway. Emscripten itself is permissive and imposes no additional terms.

Do not combine the GPL engine with proprietary code in a way that tries to keep the integration secret. The browser shell can be GPLv2 or a GPLv2-compatible license; the simplest and safest choice is to license the whole repository GPLv2.

### 5.3 Proprietary game assets

- The retail PK3s (`assets0.pk3` … `assets3.pk3`, ~1.22 GB) are commercial content and are **not** redistributable by this project.
- The project must not bundle, mirror, upload, or transmit them.
- The user selects them from their own device. The browser must not send them anywhere.
- The repository must `.gitignore` PK3s, demos, and build artifacts, and CI must check that none are committed.
- The free JKA demo? Raven released a JK2 demo; JKA's situation is different. Do not assume a "free demo pak" exists for JKA. `jka-web`'s README mentions a free demo for JK2, not JKA.
- If a user selects an incomplete asset set, the engine can silently fall back to demo/restricted mode and then fail with `Corrupted pk3`. Validate `productid.txt` before boot.

### 5.4 Demo files

- A `.dm_26` demo is a recording of a game session. It may contain player names, chat, and copyrighted game content.
- Do not distribute demo files without permission.
- Test fixtures in CI must be synthetic or explicitly licensed. Do not commit a real player's demo.
- The player should make clear that demos stay local.

### 5.5 Trademarks and affiliation

- *Star Wars*, *Jedi Knight*, *Jedi Academy*, Lucasfilm, Disney, Raven Software, Activision, and related marks belong to their owners.
- Use them only to identify the software (nominative use), not to imply endorsement.
- Include a non-affiliation disclaimer, as `jka-web` and `jk.q3js.com` do.
- Do not use official logos or box art without permission.

### 5.6 Specific licensing risks

| Risk | Detail | Mitigation |
|---|---|---|
| `openjk-emscripten` has no license | Copying its modifications may violate GPLv2 or leave terms unclear | Do not copy; if needed, ask the author; prefer `jka-web`/OpenJK |
| `q3js` non-engine code is proprietary | Copying the site/client integration is not allowed | Do not copy; use only as behavioral reference |
| `jka-web` license inconsistency | `NOTICE.md` says GPLv2; `package.json` says GPL-2.0-or-later | Treat as GPLv2; fix the metadata in the fork |
| Regal license unverified | `openjk-emscripten` uses `USE_REGAL` but has no Regal license file | Verify before shipping; prefer `jka-web`'s GL emulation |
| OpenAL LGPL | Linking OpenAL Soft adds LGPL obligations | Use SDL2 audio, as `jka-web` does, unless OpenAL is required |
| Asset redistribution | PK3s are commercial | Local-only, no upload, `.gitignore`, CI guard |
| Demo privacy | Demos can contain chat/player data | Local-only; no telemetry; warn users before sharing |

### 5.7 Legal conclusion (evidence-based, not legal advice)

- **GPLv2 is the governing license for the engine work.** A distributed wasm build must come with complete source and notices.
- **The safest project license is GPLv2**, matching the engine and `jka-web`.
- **No proprietary assets may be distributed.** The architecture is already local-only; keep it that way.
- **Do not reuse `jk.q3js.com` or `q3js` integration code** without a license.
- **Do not reuse `openjk-emscripten` modifications** without clarifying its license.
- **Get counsel** before a public launch, especially if the project is commercial or accepts donations.

---

## 6. E. Recommendation

### 6.1 Decision factors after the rendering report

The user tested `jka-web` and saw rendering problems. That changes the weighting: **a ready-made browser port is only an advantage if its rendering is trustworthy.** The defect has not been root-caused, so we cannot assume it is confined to jka-web's single-player renderer. It could be in the shared Emscripten/WebGL emulation, in which case OpenJK would inherit it too.

| Factor | `jka-web` | OpenJK `codemp` |
|---|---|---|
| Reported rendering evidence | User-reported issues; unresolved | Native renderer is mature; **no WebGL port yet** |
| MP engine | Source present, unported | Maintained MP engine, demo playback |
| Browser layer | Working Emscripten platform layer | **None; must be built** |
| Renderer loading | Single engine + game module (SP design) | Renderer, cgame, and UI are separate modules |
| License | GPLv2 | GPLv2 |
| Strategic fit | Inherit a port with a reported defect | Own the port, start from maintained source |

The decision is a risk trade, not a score:

- **jka-web** gives a head start on the browser layer but carries an unresolved rendering defect and an unported MP tree.
- **OpenJK** gives the maintained MP engine and demo playback but requires building the browser layer and WebGL renderer.

Because the reported blocker is rendering, the better engineering choice is to **start from the maintained engine and own the rendering path**, using jka-web's platform layer as a reference. This is more work, not less. The native baseline in M0.5 exists to separate engine/demo defects from WebGL defects before committing.

### 6.2 GO / NO-GO

| Candidate | Verdict | Reason |
|---|---|---|
| **`jk.q3js.com`** | **NO-GO as a foundation** | No public JKA MP source; no reuse license; integration code not published. **GO only as a reference/benchmark.** |
| **`lklacar/openjk-emscripten`** | **NO-GO as a foundation** | SP-only, no demo, hard-coded localhost asset fetch, obsolete toolchain, Regal, no project license. **GO as a historical reference.** |
| **`Virtastic/jka-web`** | **NO-GO as primary; GO as reference** | SP-only, MP tree unported, and user-reported rendering issues unresolved. Its platform layer, FS staging, and test harnesses remain valuable references. |
| **`JACoders/OpenJK` (`codemp`)** | **GO (conditional) — primary** | Maintained MP engine with demo playback, modern build, GPLv2. No Emscripten layer; the browser port is the project. Condition: native MP baseline + Emscripten/WebGL spike must succeed. |
| **`lklacar/q3js`** | **NO-GO** | Quake III, not JKA; non-engine code proprietary. |
| **Build from scratch** | **NO-GO** | Reimplementing id Tech 3 + Ghoul2 + JKA game code is far larger than porting the existing source. |

### 6.3 Recommended foundation

**Fork `JACoders/OpenJK` at `260c59c` and build a new Emscripten platform layer for the MP client, using `jka-web` as a reference for the platform layer, filesystem staging, and test harnesses.**

Why this one:

- It is the maintained MP engine, with `BuildMPEngine`, `BuildMPCGame`, `BuildMPUI`, and `BuildMPRdVanilla` targets already defined.
- It already contains the demo playback path and the correct protocol-26 semantics.
- It is GPLv2, matching the engine and keeping the licensing story simple.
- It does not inherit an unresolved rendering defect from another port.
- It gives us control over the renderer/WebGL path, which is the reported blocker.
- jka-web's platform layer, MEMFS staging, and CDP harness patterns are transferable as references, even though its engine tree is not the base.

What it costs:

- A new Emscripten platform layer for OpenJK's `Sys_*`, filesystem, input, timing, and module APIs.
- A WebGL adaptation of OpenJK's `rd-vanilla` renderer.
- Loading strategy for the renderer, cgame, and UI (static link or side modules).
- OpenJK's `fs_basepath`/`fs_homepath` layout and CMake/dependency integration.
- More schedule risk than reusing a port that already boots.

The native baseline is the first task. If a native OpenJK MP build can play a base `.dm_26` demo with user-supplied assets, then the remaining problem is "port known-good playback to the browser," not "make demo playback work at all." That is a much better position from which to debug WebGL.

### 6.4 What can be reused

From OpenJK (primary):

- The MP engine and demo code, including the protocol-26 `.dm_26` path.
- CMake targets for the MP engine, renderer, cgame, UI, and server game.
- The renderer/cgame/UI module structure and `Sys_LoadDll` / `Sys_LoadGameDll` semantics.
- The `fs_basepath` / `fs_homepath` filesystem model.
- The canonical `jampgame` / `cgame` / `ui` interfaces.

From `jka-web` (reference, not the engine base):

- Emscripten toolchain pin and build script patterns (`env.sh`, `build-jka.sh`, `build-jka-modules.sh`).
- Platform-layer patterns (`shared/wasm-build/sys_emscripten_jk/`): sys, GL, sound, stubs.
- `idt3_dlopen.c` fresh-module loading for side modules.
- `idt3_vm_shim.c` vararg-safe `vmMain` array wrapper.
- MEMFS staging and IDBFS persistence patterns from `play/jka/index.html`.
- GL emulation flags, memory sizing, and warning flags from `env.sh`.
- CDP harness patterns (`chrome.mjs`, `verify-*.mjs`, `map-sweep.mjs`).
- The documented renderer-fix catalog, to compare against OpenJK's renderer — but validate it against the reported rendering issues before copying.
- Documentation structure and the "no assets" policy.

From `openjk-emscripten` (reference only):

- The minimal `Module.preInit` / MEMFS boot pattern.
- A cautionary example of hard-coded asset fetching and an obsolete toolchain.
- Its modifications cannot be copied without clarifying its license.

From the site:

- The UX pattern: select `.pk3` files once, cache them in IndexedDB, reuse them.
- The "SP and MP are separate builds" architecture.
- The disclaimer and non-affiliation language (rewrite in our own words).

### 6.5 What must be modified

In the engine/port:

- Build a new Emscripten platform layer for OpenJK's `Sys_*` API:
  - `Sys_DefaultInstallPath` → `/jka` (read-only assets).
  - `Sys_DefaultHomePath` → `/userdata` (writable config/saves).
  - `Sys_ListFiles`, `Sys_Mkdir`, `Sys_FileTime`, `Sys_Cwd`, `Sys_PathCmp`.
  - `Sys_LoadDll`, `Sys_LoadFunction`, `Sys_LoadGameDll`, `Sys_UnloadDll`.
  - timers, input, clipboard, message box, GL context, audio.
- Integrate the OpenJK CMake build with Emscripten, or replace it with a source-list build script:
  - SDL2, JPEG, PNG, zlib via Emscripten ports or bundled libraries.
  - OpenAL either ported, stubbed, or replaced with SDL audio.
  - `-fexceptions`, `-O3`, `-fno-strict-aliasing`, `-fPIC`, `-fgnu89-inline`.
  - `-sALLOW_MEMORY_GROWTH=1`, `-sFORCE_FILESYSTEM=1`, `-lidbfs.js`.
  - `-sMAX_WEBGL_VERSION=2`, `-sMIN_WEBGL_VERSION=1`, `-sLEGACY_GL_EMULATION=1`.
- Renderer:
  - Build `rd-vanilla` as a static library linked into the engine, or as an Emscripten side module.
  - Patch `CL_InitRef` to call `GetRefAPI` directly for the static case, or load `rd-vanilla.wasm` through the Emscripten module loader.
  - Apply WebGL/GLES fixes: 16-bit indices, GL limits, endian assumptions, image paths, shader/texenv behavior.
  - Root-cause the jka-web rendering issues before copying its GL-emulation fixes.
- Modules:
  - Build `cgame` and `ui` as Emscripten side modules with `GetModuleAPI`, `vmMain`, `dllEntry`, and the vararg shim.
  - Patch `Sys_LoadGameDll` to resolve `cgame.wasm` and `ui.wasm`.
  - Verify fresh-module semantics with `idt3_dlopen_fresh`.
- Filesystem:
  - Set `fs_basepath=/jka`, `fs_homepath=/userdata`.
  - Stage PK3s at `/jka/base`; stage the demo at `/jka/base/demos/<name>.dm_26`.
  - Mount IDBFS at `/userdata`; keep PK3s in MEMFS.
  - Set `fs_forcegame base` or validate `fs_game` to avoid accidental mod directories.
  - Set `cl_allowDownload 0` before demo playback.
- Bridge:
  - Add exported C functions for JS: execute command, play demo, pause, speed, seek, status, configstrings, camera.
  - Patch `CL_DemoCompleted` to notify JS instead of opening the UI menu.
  - Optionally patch `CL_InitUI` to skip the engine menu.
  - Stub or disable `Sys_SendPacket` / `Sys_GetPacket` for a no-network build.
  - Ensure the engine can boot without `default.cfg` (or generate one).

In the browser shell:

- React + Vite + TypeScript.
- Directory/file picker with FSA + fallback.
- PK3 validation (`assets0..3`, `productid.txt`) and demo validation (`.dm_26`).
- Staging with progress and memory warnings.
- Canvas + input + audio unlock.
- Playback state machine and error UI.
- Local-only privacy guarantees and no telemetry.

### 6.6 What must be built from scratch

- The OpenJK browser port itself: platform layer, WebGL renderer adaptation, and module loading.
- The demo library/selection UX and metadata.
- The playback controller and timeline (seek is not built into the engine).
- The free-camera system (cgame patch).
- The match inspector (configstrings, players, chat, events).
- The React UI and design system.
- The TypeScript engine bridge and error taxonomy.
- The test fixtures and CI harness for demo playback.
- The packaging/licensing/source-offer process.

### 6.7 Biggest technical risks

Ranked by probability × impact:

1. **OpenJK has no browser port, and rendering is the reported blocker.** The platform layer, WebGL adaptation, and module loading are all new work. The jka-web rendering issues may be systemic to the GL emulation, in which case OpenJK inherits them. **Mitigation:** native baseline, G0 triage, and a small renderer spike before the full port.
2. **OpenJK MP has more runtime modules than the SP drop.** The renderer, cgame, and UI are loaded dynamically. Each needs a static-link or side-module strategy, and each can fail independently. **Mitigation:** renderer first, then cgame, then optional UI.
3. **Demo/cgame/mod compatibility.** A base demo should work; a modded demo may need the mod's PK3s and cgame. Pure checksums, `fs_game`, and `fs_basepath`/`fs_homepath` can restart the VFS mid-playback. The product needs a clear compatibility model.
4. **Memory.** 1.22 GB of PK3s in MEMFS plus the engine heap is near the practical limit for low-memory devices. Desktop Chrome is the target; mobile is out of scope.
5. **Renderer performance.** JKA's fixed-function OpenGL is emulated to WebGL. OpenJK's renderer has not been profiled in a browser. Expect optimization work.
6. **No seek.** A timeline scrubber is not a small feature; it requires replay-based seeking or an index. Do not put it in the MVP.
7. **Audio.** OpenJK's audio path is OpenAL-oriented; jka-web uses SDL audio. Porting or replacing OpenAL is additional work. Browser autoplay also requires a user gesture.
8. **Browser support.** FSA is Chromium-only; the file-input fallback must be first-class. Safari/Firefox may work with the fallback, but performance and memory are unverified.
9. **Legal/compliance.** GPL source offer, no assets, no proprietary code, trademark disclaimer. This is manageable but must be designed in, not bolted on.

### 6.8 Simplest route to a working prototype

A "thin vertical slice" that proves the risky parts before building UI:

1. **Native OpenJK MP baseline.** Build `openjk` (MP) natively on Linux with `BuildMPEngine`, `BuildMPCGame`, `BuildMPUI`, and `BuildMPRdVanilla`. Use user-supplied retail assets and one base `.dm_26`. Verify the demo plays, cgame loads, the map renders, and no network is required. This isolates engine/demo issues from WebGL.
2. **G0 rendering triage.** Reproduce the jka-web rendering issue and capture the browser/GPU/console/screenshot. Compare with the native OpenJK baseline. Decide whether the defect is in jka-web's SP renderer or in the shared Emscripten/WebGL layer.
3. **Emscripten platform layer + engine boot.** Port OpenJK's `Sys_*` API, filesystem, timers, input, and module loading. Get the engine to boot in Chrome with a stub or static renderer and report the MP version.
4. **WebGL renderer bring-up.** Build `rd-vanilla` as a static library or side module. Get a map frame on screen with cgame. Fix GL/WebGL issues one class at a time.
5. **Demo playback in the browser.** Stage a user-supplied `base` asset set and one base-game `.dm_26` in MEMFS at `/jka/base` and `/jka/base/demos`. Issue `demo <name>` from a tiny HTML harness. Verify:
   - `clc.demoplaying` is true.
   - The gamestate parses and cgame loads.
   - The map renders.
   - `cl.snap.serverTime` advances.
   - No network packets are sent.
6. **Only then** build the React shell, file picker, progress, and error handling.
7. **Then** add pause/restart, camera, and inspector.

This order avoids the common failure mode of building a polished UI around an engine that cannot play the file, and it separates a demo/engine failure from a rendering failure.

### 6.9 Recommendation summary

- **Primary foundation:** `JACoders/OpenJK` `codemp` (GPLv2), with a new Emscripten platform layer and WebGL renderer adaptation.
- **Reference:** `Virtastic/jka-web` platform layer, FS staging, test harnesses, and renderer-fix catalog; `jk.q3js.com` MP artifact as a behavioral benchmark.
- **Fallback:** if the OpenJK browser port fails, reassess `jka-web` **only after root-causing its rendering issues**; do not inherit an unexplained rendering defect.
- **Do not use:** `openjk-emscripten` as a base, `q3js` integration code, or any proprietary assets.
- **First milestone is a native baseline plus G0 rendering triage, not a product.** If native OpenJK MP cannot play a base demo, stop and fix that before writing any browser code.

---

## 7. Source index

### 7.1 Repositories

- OpenJK: <https://github.com/JACoders/OpenJK>
  - MP demo code: <https://github.com/JACoders/OpenJK/blob/260c59c2907187af555a676fe0cc798893bf7757/codemp/client/cl_main.cpp>
  - MP VM loading: <https://github.com/JACoders/OpenJK/blob/260c59c2907187af555a676fe0cc798893bf7757/codemp/qcommon/vm.cpp>
  - Renderer loading: <https://github.com/JACoders/OpenJK/blob/260c59c2907187af555a676fe0cc798893bf7757/codemp/client/cl_main.cpp>
  - Renderer sources: <https://github.com/JACoders/OpenJK/tree/260c59c2907187af555a676fe0cc798893bf7757/codemp/rd-vanilla>
  - Filesystem startup: <https://github.com/JACoders/OpenJK/blob/260c59c2907187af555a676fe0cc798893bf7757/codemp/qcommon/files.cpp>
  - Protocol: <https://github.com/JACoders/OpenJK/blob/260c59c2907187af555a676fe0cc798893bf7757/codemp/qcommon/qcommon.h>
- `jka-web`: <https://github.com/Virtastic/jka-web>
  - README: <https://github.com/Virtastic/jka-web/blob/73b6006ae1e5b0269eca595e6daf89bcf1582e0c/README.md>
  - MP tree: <https://github.com/Virtastic/jka-web/tree/73b6006ae1e5b0269eca595e6daf89bcf1582e0c/games/jka/codemp>
  - FS/memory notes: <https://github.com/Virtastic/jka-web/blob/73b6006ae1e5b0269eca595e6daf89bcf1582e0c/docs/DATA.md>
  - Port log: <https://github.com/Virtastic/jka-web/blob/73b6006ae1e5b0269eca595e6daf89bcf1582e0c/docs/WASM_ADAPTATIONS.md>
  - License: <https://github.com/Virtastic/jka-web/blob/73b6006ae1e5b0269eca595e6daf89bcf1582e0c/LICENSE>
  - Notice: <https://github.com/Virtastic/jka-web/blob/73b6006ae1e5b0269eca595e6daf89bcf1582e0c/NOTICE.md>
- `openjk-emscripten`: <https://github.com/lklacar/openjk-emscripten>
  - README: <https://github.com/lklacar/openjk-emscripten/blob/3a2255593bc4d95199f21c67bb092bb0c9bc6848/README.md>
  - Build: <https://github.com/lklacar/openjk-emscripten/blob/3a2255593bc4d95199f21c67bb092bb0c9bc6848/CMakeLists.txt>
  - Preload: <https://github.com/lklacar/openjk-emscripten/blob/3a2255593bc4d95199f21c67bb092bb0c9bc6848/scripts/preload.js>
- `q3js`: <https://github.com/lklacar/q3js>
  - License: <https://github.com/lklacar/q3js/blob/efcb0fe1b76210db0232068a5d4187677c3d8c46/LICENSE>
- `jk.q3js.com`:
  - Site: <https://jk.q3js.com/>
  - MP loader: <https://jk.q3js.com/JediAcademy/mp/openjk-mp-wasm.js>
  - MP wasm: <https://jk.q3js.com/JediAcademy/mp/openjk-mp-wasm.wasm>
  - SP loader: <https://jk.q3js.com/JediAcademy/sp/openjk-sp-wasm.js>

### 7.2 Standards and documentation

- Emscripten Filesystem API: <https://emscripten.org/docs/api_reference/Filesystem-API.html>
- Emscripten WORKERFS source: <https://github.com/emscripten-core/emscripten/blob/main/src/lib/libworkerfs.js>
- Emscripten license: <https://github.com/emscripten-core/emscripten/blob/main/LICENSE>
- MDN `showDirectoryPicker()`: <https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker>
- MDN `createSyncAccessHandle()`: <https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle>
- MDN File System API: <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API>
- GPLv2 text: <https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>

### 7.3 Key source line references

| Topic | Reference |
|---|---|
| MP protocol 26 | `OpenJK/codemp/qcommon/qcommon.h:214` |
| Demo extension | `OpenJK/codemp/qcommon/files.cpp:1207` |
| Demo filename validation | `OpenJK/codemp/qcommon/files.cpp:1208` |
| Demo file open | `OpenJK/codemp/client/cl_main.cpp:514` |
| Demo framing read | `OpenJK/codemp/client/cl_main.cpp:442` |
| Demo writing | `OpenJK/codemp/client/cl_main.cpp:206` |
| Demo recording | `OpenJK/codemp/client/cl_main.cpp:273` |
| Demo completion | `OpenJK/codemp/client/cl_main.cpp:412` |
| Downloads completion | `OpenJK/codemp/client/cl_main.cpp:1338` |
| cgame init | `OpenJK/codemp/client/cl_cgame.cpp:513` |
| demo time feed | `OpenJK/codemp/client/cl_cgame.cpp:712` |
| cgame draw call | `OpenJK/codemp/client/cl_cgame.cpp:600` |
| cgame demo flag | `OpenJK/codemp/cgame/cg_view.c:2417` |
| VM names | `OpenJK/codemp/qcommon/vm.cpp:32` |
| Module load | `OpenJK/codemp/qcommon/vm.cpp:177` |
| Platform module load | `OpenJK/shared/sys/sys_main.cpp:602` |
| Renderer load | `OpenJK/codemp/client/cl_main.cpp:2417` |
| Renderer sources | `OpenJK/codemp/rd-vanilla/CMakeLists.txt` |
| cgame/UI targets | `OpenJK/codemp/cgame/CMakeLists.txt`, `OpenJK/codemp/ui/CMakeLists.txt` |
| MP CMake options | `OpenJK/CMakeLists.txt:38-44` |
| FS startup (`fs_basepath`/`fs_homepath`) | `OpenJK/codemp/qcommon/files.cpp:3564` |
| Default install path | `OpenJK/shared/sys/sys_main.cpp:80` |
| Default home path | `OpenJK/shared/sys/sys_unix.cpp:480` |
| FS conditional restart | `OpenJK/codemp/qcommon/files.cpp:4110` |
| Server-side demo | `OpenJK/codemp/server/sv_ccmds.cpp:1830` |
| `jka-web` SP-only statement | `jka-web/README.md:37` |
| `jka-web` MP tree | `jka-web/games/jka/codemp/` |
| `jka-web` MEMFS staging | `jka-web/play/jka/index.html` (preRun / `__stage`) |
| `jka-web` memory notes | `jka-web/docs/DATA.md` |
| `openjk-emscripten` SP define | `openjk-emscripten/CMakeLists.txt:36` |
| `openjk-emscripten` preload | `openjk-emscripten/scripts/preload.js` |

---

## 8. Open questions and spikes

These are the questions that must be answered by a short implementation spike before committing to the full project:

1. **Does a native OpenJK MP build play a base `.dm_26` demo?**
   - Do `BuildMPEngine`, `BuildMPCGame`, `BuildMPUI`, and `BuildMPRdVanilla` build cleanly on Linux?
   - Does the demo reach `CA_ACTIVE`, load the map, and render?
   - Does it work with no network and `cl_allowDownload 0`?
2. **What exactly is the jka-web rendering issue?**
   - Can it be reproduced on a second machine/browser?
   - Is it specific to jka-web's SP renderer, or does it also affect an OpenJK/WebGL spike?
   - Does the native OpenJK baseline render the same scene correctly?
3. **Can OpenJK's platform layer be ported to Emscripten?**
   - How many `Sys_*` functions, GL calls, and CMake dependencies need work?
   - Does the engine boot with a stub or static renderer?
4. **Can the renderer, cgame, and UI be loaded as static libraries or side modules?**
   - Does `CL_InitRef` work with a static `GetRefAPI`?
   - Does `GetModuleAPI` resolve for cgame/UI?
   - Does the vararg `vmMain` shim work?
5. **Does a base `.dm_26` demo reach `CA_ACTIVE` and render in the browser?**
   - Which cgame/UI patches are required?
   - Does the demo's checksum feed cause an FS restart?
6. **What is the memory high-water mark for a real demo?**
   - 1.22 GB PK3s + engine heap + map.
   - Does a demo need the same map working set as SP?
7. **Can the engine boot with no `default.cfg` and no UI?**
   - What is the minimum config?
8. **Does playback work with the network layer stubbed?**
   - Any hidden `NET_*` or DNS call?
9. **What is the smallest reliable demo fixture we can generate or license for CI?**
   - A real demo is copyrighted/private; we need a synthetic or consented fixture.

Answering 1–2 is the **G0 gate**; answering 3–5 is the **G1/G2 gate** for the whole project.

---

## 9. Final recommendation

### 9.1 GO / NO-GO at a glance

| Candidate | Final verdict | What it may be used for |
|---|---|---|
| **`jk.q3js.com`** | **NO-GO as a foundation** | Black-box reference and feasibility evidence only. Do not copy its code or assets. |
| **`lklacar/openjk-emscripten`** | **NO-GO as a foundation** | Historical reference for a minimal Emscripten port. Do not copy its modifications without clarifying its license. |
| **`Virtastic/jka-web`** | **NO-GO as primary; GO as reference** | Do not inherit the unresolved rendering defect. Use its platform layer, FS staging, and test harnesses as references. |
| **`JACoders/OpenJK` (`codemp`)** | **GO (conditional) — primary** | Fork it and build a new Emscripten platform layer + WebGL renderer. Gate the work on a native MP baseline and G0/G1/G2. |
| **`lklacar/q3js`** | **NO-GO** | Quake III, not JKA; non-engine code proprietary. |
| **Build from scratch** | **NO-GO** | The existing engine already implements the hard parts. |

### 9.2 The decision

**Proceed with a native OpenJK MP baseline, then a time-boxed Emscripten/WebGL port.** The project is viable only if (a) native OpenJK MP plays a base `.dm_26` demo with user-supplied assets, (b) the jka-web rendering issue is understood, and (c) an OpenJK MP build boots and renders under Emscripten. If the native baseline fails, stop and fix the engine/demo path before writing browser code. If the WebGL spike fails for a systemic reason, stop rather than build a frontend around a non-rendering engine.

**Do not** start from `openjk-emscripten` (SP-only, obsolete, unlicensed) or from `jk.q3js.com`/`q3js` (no reusable source/license). **Do not** inherit `jka-web` without root-causing its rendering issues. **Do not** distribute any game assets or demos; the user supplies their own. **Do** publish the complete GPLv2 source and build scripts for every deployed wasm binary.

### 9.3 Success condition

The research phase is successful if the first implementation milestones can answer "yes" to these questions:

1. Does a native OpenJK MP build play a base `.dm_26` demo with user-supplied assets?
2. Is the jka-web rendering issue reproduced and classified as engine-specific or systemic?
3. Does OpenJK MP boot under Emscripten and render a map?
4. Does a base `.dm_26` demo reach `CA_ACTIVE` in the browser with no network?
5. Can a user select local assets and a demo and watch it without uploading anything?

Everything else — timeline scrubbing, free camera, match inspector, polish — is secondary to those five.

### 9.4 Decision log

| Date | Decision | Evidence / reason |
|---|---|---|
| 2026-11-13 | Primary foundation: `jka-web` + in-tree `codemp` | jka-web was the only public JKA-specific browser port; MP source present; GPLv2 |
| 2026-11-15 | Primary foundation: `OpenJK codemp` + new Emscripten layer | User tested jka-web and observed rendering issues; root cause unresolved; OpenJK is the maintained MP engine and avoids inheriting a defective port |
| 2026-11-15 | `jka-web` demoted to reference/platform-layer donor | Still useful for FS staging, GL flags, test harnesses, and renderer-fix catalog, but not trusted as the engine base |
| 2026-11-15 | Add G0: native baseline + rendering triage | Separates demo/engine defects from WebGL defects before the browser port |

**Open question for the user:** the exact rendering symptom matters. A screenshot, browser/GPU details, and the console output would let us determine whether the defect is in jka-web's SP renderer or in the shared GL emulation. That classification decides how much of jka-web's platform layer is safe to reuse.
