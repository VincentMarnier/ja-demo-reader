# Rendering triage: `jka-web` issue and the OpenJK/WebGL port (M0.5)

**Status:** Triage incomplete. Classification **unresolved (d)** because the reported symptom and its environment were not supplied.
**Date:** 2026-11-16
**Scope:** Reproduce or bound the rendering problem the user saw in `jka-web`, compare with the native OpenJK MP baseline, and assess the risk to an OpenJK/WebGL port. No Emscripten build, no WebAssembly, no frontend work was performed.
**Related:** [research.md](./research.md) · [architecture.md](./architecture.md) · [milestones.md](./milestones.md) · [native-baseline.md](./native-baseline.md)

> **Decision update (2026-11-16):** the user **accepted the renderer risk** described in §4 and §6. G0 remains evidence-incomplete (d) for the reported symptom, but **M1 is authorized to proceed**, with the three §4 adaptations carried as first-class renderer-spike tasks. The "hold M1" recommendation in §7.2 and §8 is superseded by this decision. The missing symptom evidence is still an open item; it no longer blocks the platform-layer and engine-boot work.

---

## 1. The reported symptom and environment

### 1.1 What was reported

> The user tested `jka-web` and observed rendering issues.

That is the complete report available to this milestone.

### 1.2 What is missing

No screenshot, video, browser name/version, OS, GPU/driver, WebGL renderer string, console log, URL/build identifier, map/scene, or reproduction steps were supplied. Without at least a description of *what* is wrong (black screen, missing textures, shredded geometry, wrong colours, invisible models, HUD corruption, stutter-only, etc.), there is no defined behaviour to reproduce or falsify.

### 1.3 Why the environment cannot be assumed

The native baseline was produced on:

| Item | Value |
|---|---|
| OS | Ubuntu 26.04 LTS, kernel 7.0.0-43-generic |
| GPU | AMD Radeon RX 5700 XT (radeonsi, navi10) |
| GL driver | Mesa 26.0.8, OpenGL 4.6 Compatibility |
| Browser present | Brave (Snap) is installed; no Playwright/Puppeteer project is provisioned |
| Display | Xwayland on `:0` (real display) |

It is **not known** whether the user ran `jka-web` on this machine, which browser it used, or whether hardware acceleration was active. Treating this machine's environment as the user's would be an assumption, not evidence.

### 1.4 Which artefact was tested

The research documents three different things that are easy to conflate:

| Name | Build | MP? | Relevance |
|---|---|---|---|
| `Virtastic/jka-web` (`jka.virtastic.app`) | Raven SP drop + Emscripten 6.0.1 | **No** (MP source present, unported) | The named report target |
| `jk.q3js.com` | Unpublished OpenJK MP wasm | Yes | Different, closed-source integration; cannot be reproduced from source |
| `lklacar/openjk-emscripten` | OpenJK SP, Regal, old toolchain | No | Historical reference only |

The milestone names `jka-web`. Its current public build is **single-player**, and its multiplayer tree has no `__EMSCRIPTEN__` adaptations. Therefore a `jka-web` rendering observation is evidence about its **SP** renderer, not directly about an OpenJK MP renderer. If the user actually tested `jk.q3js.com`, that is a different artefact and must be identified as such.

---

## 2. The native reference: what is known to work

The native OpenJK MP baseline (see [native-baseline.md](./native-baseline.md)) renders a base-game demo correctly on the same machine and GPU:

| Evidence | Result |
|---|---|
| Demo | `basejka`, protocol 26, `mp/duel1`, base cgame (`vm_cgame 0`) |
| Assets | Retail `assets0..3.pk3` only; no mod, no community map |
| State | `CA_CONNECTED` → `CA_LOADING` → `CA_PRIMED` → `CA_ACTIVE` |
| Renderer | `rd-vanilla_x86_64.so`, OpenGL 4.6 compatibility, Mesa 26.0.8 |
| Frames | `/tmp/jka-demo-player/m0.5/shots/base_01.png`, `base_02.png` |
| Content | World geometry, textures, two lightsabers, HUD, duel scoreboard, animated camera |
| Network | No remote socket traffic; demo file read locally |

A second demo on a community map (`ffa_YavinPlaza`) also rendered correctly when the user's `base` folder was the base path.

**What this establishes:** the game data, the map assets, the AMD/Mesa driver, the native GL path, and OpenJK MP's demo/cgame/renderer integration are all capable of producing a correct picture on this machine.

**What this does not establish:** anything about WebGL, Emscripten's GL emulation, `jka-web`'s SP renderer, or the user's browser/driver.

---

## 3. Reproduction attempt and evidence

### 3.1 What was attempted

- Native OpenJK MP playback on the same machine: **done** (see §2).
- A metadata scan of the user's demo collection to find a pure base demo: **done** (49 demos; 38 pure `basejka`).
- Building `jka-web` or any WebAssembly: **not done** — explicitly out of M0.5 scope and prohibited by the milestone brief.
- Running the public `jka-web` build under browser automation: **not done** — no symptom to target, no automation harness provisioned, and loading a 1.2 GB retail asset set into a browser session would not produce comparable evidence without a defined defect.

### 3.2 Why a screenshot alone would not settle it

`jka-web`'s own engineering log records this lesson directly (fetched from the public repository at `73b6006ae1e5b0269eca595e6daf89bcf1582e0c`, `docs/WASM_ADAPTATIONS.md`):

> "A black screenshot is not a diagnosis. It cannot distinguish *stalled*, *running but drawing nothing*, and *drawing a genuinely dark scene*."

A reproduction must capture at least: RAF/draw-call counters, `texImage2D` arguments and GL errors, WebGL renderer string, console output, and a frame. Without that, even a reproduced image would not identify the cause.

### 3.3 Evidence still required

To close this triage, the user must supply, at minimum:

1. **Symptom description** — what is visually wrong, when it starts (launcher/menu/first map/during play), whether it is constant or intermittent, and whether audio/input still work.
2. **Artefact identity** — URL and build, or a local build with commit; specifically `jka-web` vs `jk.q3js.com` vs another port.
3. **Browser** — name/version, hardware acceleration on/off, `chrome://gpu` or equivalent.
4. **OS and GPU/driver** — exact versions.
5. **WebGL renderer string** — from `WEBGL_debug_renderer_info` (`UNMASKED_RENDERER_WEBGL`, `UNMASKED_VENDOR_WEBGL`).
6. **Console log** — WebGL errors/warnings, shader failures, wasm traps, out-of-memory.
7. **Screenshot or short video** — full window, not a crop, with the HUD visible.
8. **Scene** — map name, whether SP or MP, and the steps that produced it.

With items 1–8, a targeted reproduction on this machine is possible. Without item 1, no reproduction can be scored as success or failure.

---

## 4. Evidence review: what the code says about the risk

Even without the user's symptom, the pinned sources support a concrete risk assessment for an OpenJK MP + WebGL port. The following are **source-verified classes**, not guesses. All line numbers refer to `JACoders/OpenJK` at `260c59c2907187af555a676fe0cc798893bf7757`.

### 4.1 32-bit indices vs WebGL1's 16-bit client-array limit

```c
/* codemp/rd-vanilla/tr_local.h:32-33 */
#define GL_INDEX_TYPE   GL_UNSIGNED_INT
typedef unsigned int glIndex_t;
```

There is no `__EMSCRIPTEN__` branch. `tess.indexes` is `glIndex_t` (`tr_local.h:1474`) and is filled with `numVerts + n` arithmetic throughout `tr_backend.cpp`.

`jka-web`'s SP tree uses a 16-bit `glIndex_t` under `_XBOX || __EMSCRIPTEN__` for exactly this reason, and documents the failure when the type is 32-bit:

> "32-bit indices then aborted the first real draw. emscripten's `glDrawElements` asserts `type == GLctx.UNSIGNED_SHORT` when no element array buffer is bound, because WebGL1 client-array draws accept only 16-bit indices." (`WASM_ADAPTATIONS.md`, around lines 400–405)

and a related aliasing bug that "shredded the triangle" when a 32-bit write crossed two 16-bit slots (lines ~313, ~969).

**MP impact:** the MP renderer will need its own 16-bit index path (or a WebGL2/index-buffer strategy). This is a port task, independent of the user's symptom.

### 4.2 Texture upload internal formats invalid under WebGL1

`codemp/rd-vanilla/tr_image.cpp` selects legacy/sized internal formats:

```text
658:  *pformat = GL_RGB4_S3TC;
674:  *pformat = GL_RGB5;
676:  *pformat = GL_RGB8;
680:  *pformat = GL_RGB5;
684:  *pformat = GL_RGB8;
699:  *pformat = GL_RGBA4;
703:  *pformat = GL_RGBA8;
717:  qglTexImage2D( uiTarget, 0, *pformat, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, data );
...
```

WebGL1 requires `internalformat == format` for unsized formats and rejects sized internal formats in this call shape. `jka-web` documents the exact consequence:

> "`texImage2D(...,internalformat=3,...,GL_RGBA,...) -> 0x501`. The renderer selects the GL 1.x component-count shorthand (3/4) — or a sized/S3TC enum — as internalformat, then uploads GL_RGBA pixels. WebGL1 requires internalformat == pixel format, so **every texture failed to upload and sampled solid black**; the world's lightmap modulate then blacked out the whole scene." (`WASM_ADAPTATIONS.md`, lines ~366–376)

**MP impact:** the same class exists in MP's `Upload32`. A black world in an OpenJK/WebGL build is a predictable failure until this is adapted.

### 4.3 Primitive path defaults to the non-WebGL-friendly path

`codemp/rd-vanilla/tr_init.cpp`:

```text
1459: primitives = r_primitives->integer;
1460: if ( primitives == 0 ) {
1461:     if ( qglLockArraysEXT ) {
1462:         primitives = 2;
1463:     } else {
1464:         primitives = 1;
1465:     }
1466: }
```

WebGL has no compiled-vertex-array extension, so a desktop-style build selects path 1 (array-element draws) unless `r_primitives` is forced to 2. `jka-web` records that this path emitted nothing under its GL emulation and that `r_primitives 2` was required:

> "`r_primitives` picked the immediate-mode path. It defaults to `0` ... WebGL has no compiled vertex arrays, so it chose **1** → ... and `glArrayElement` is a no-op stub ... Every vertex vanished, silently. Force `r_primitives 2`." (`WASM_ADAPTATIONS.md`, lines ~390–400)

**MP impact:** even with indices and textures fixed, the default draw path must be audited. This is another predictable port task.

### 4.4 Structural risk: four modules, not one

The native baseline confirms OpenJK MP loads `rd-vanilla`, `cgame`, and `ui` as separate shared objects. A browser port must either statically link them or build side modules. `jka-web`'s fixes live in its **SP** engine, where the renderer is linked into the engine; the MP tree is a different, divergent copy with zero Emscripten adaptations (research §2.3.4). Fixes are therefore transferable as *techniques*, not as patches.

### 4.5 What these findings do and do not mean

They mean: **an unadapted OpenJK MP renderer will not render correctly through WebGL1.** They do **not** mean the user's `jka-web` symptom is systemic. The symptom could be:

- `jka-web`-specific (SP renderer bug, its platform layer, its asset staging);
- systemic in class (WebGL1 emulation constraints like §4.1–4.3) and therefore also hit by OpenJK;
- browser/driver/data-specific (hardware acceleration off, blocklisted driver, incomplete PK3, wrong demo/mod);
- several of these at once.

The source evidence narrows the *port's* required work but does not attribute the *report*.

---

## 5. Classification

### 5.1 Verdict

**Classification: (d) unresolved / insufficient evidence.**

**Confidence in the classification: high** — not because a cause is known, but because the minimum evidence needed to distinguish (a), (b), and (c) is absent. No specific cause is claimed.

### 5.2 Why not (a), (b), or (c)

| Candidate | Why it cannot be selected yet |
|---|---|
| **(a) jka-web-specific** | Plausible: `jka-web` is SP-only, uses a Raven 2003 renderer tree, and has a history of its own fixed bugs. But there is no evidence the user's symptom came from that code path rather than the shared WebGL constraints. |
| **(b) systemic Emscripten/WebGL/GL-emulation** | Plausible and partly supported: the MP renderer's 32-bit indices, sized internal formats, and primitive default are exactly the classes `jka-web` had to fix. But no OpenJK/WebGL build exists yet, and the user's symptom is not described. |
| **(c) browser/driver/data** | Plausible: hardware acceleration, blocklisted drivers, incomplete asset sets, and the wrong demo/mod are common. The native baseline rules out gross asset corruption and a GPU that cannot render JKA content natively, but not a browser-specific driver path. |
| **(d) unresolved** | **Selected.** The evidence cannot separate the above. |

### 5.3 Confidence in the risk assessment

Independent of the classification, confidence is **high** that the MP renderer needs the §4.1–4.3 adaptations. That is a planning fact with source evidence, and it should be scheduled whether the user's symptom turns out to be (a), (b), or (c).

---

## 6. Risk to the OpenJK/WebGL port

| Risk | Assessment | Reason |
|---|---|---|
| The user's defect is systemic and inherited | **Medium–high, unresolved** | The MP renderer shares the WebGL1 constraints that produced `jka-web`'s black-world and shredded-geometry bugs. |
| The defect is specific to `jka-web`'s SP tree | **Medium** | Different renderer tree and platform layer; not evidence about MP. |
| The defect is environmental (browser/driver/data) | **Medium** | Cannot be assessed without the environment; native rendering works on this machine. |
| The MP renderer cannot be made to work through WebGL | **Low–medium** | Every identified class has a known fix in the same engine family (16-bit indices, internalformat, `r_primitives 2`, texenv/shader audits). The work is real but bounded, not a research dead end. |
| Module loading (renderer/cgame/UI) blocks bring-up | **Medium** | MP's four-module split is additional work compared with `jka-web`'s SP layout; static-link-first is the planned mitigation. |
| Schedule | **High** | Renderer bring-up remains the critical path; M2's estimate should assume at least the three adaptations above plus a texenv/shader audit. |

**Not a stop-level finding yet.** The native baseline passes, and the known WebGL failure classes are fixable. What is missing is attribution of the user's report, not feasibility of the port.

---

## 7. Recommended next action

### 7.1 Immediate (to close G0)

1. **Obtain the evidence in §3.3 from the user**, starting with the symptom description and the artefact identity.
2. If the report was from `jka-web`, confirm whether it was the public SP build or a local/modified build, and whether the scene was SP or MP.
3. Reproduce on this machine only after the symptom is defined. Capture the §3.2 instrumented evidence (RAF/draw counters, `texImage2D` arguments, GL errors, WebGL renderer string, console) and a full-window frame.
4. Run the identical scene/map in the native OpenJK MP baseline for comparison (the native baseline is already available).
5. Re-classify as (a), (b), or (c) from that evidence. If the symptom persists in an OpenJK/WebGL build, it is (b) by construction.

### 7.2 Decision taken

On 2026-11-16 the user explicitly accepted the renderer risk. The project proceeds to M1. The missing `jka-web` evidence stays open but no longer blocks boot work; it must still be supplied before the renderer strategy is considered validated.

M1's renderer-related scope is therefore the **bounded spike**:

- 16-bit index path / element-buffer strategy;
- `internalformat == format` texture uploads;
- `r_primitives 2` and client-array audit;
- texenv/shader compatibility for the MP shader set.

Until those pass against the native screenshots, the port's rendering remains an assumption, not a proven capability.

### 7.3 Renderer plan regardless of the triage outcome

Carry these as first-class M2 tasks, validated against native screenshots:

1. 16-bit index path (or WebGL2 element-array-buffer strategy) for `glIndex_t`/`tess.indexes`.
2. `internalformat == format` texture upload adaptation in `Upload32`, plus S3TC/compressed-texture gating.
3. Force/validate `r_primitives 2` and audit any `qglArrayElement`/client-array path under Emscripten.
4. Texenv/shader emulation audit against `LEGACY_GL_EMULATION` for the MP shader set.
5. Native-vs-browser screenshot comparison for a stock map (`mp/duel1` is a good first target) and a Ghoul2-heavy scene.

### 7.4 What would change the verdict

| New evidence | New classification |
|---|---|
| Symptom reproduces in `jka-web` and also in a minimal OpenJK/WebGL build on the same machine | **(b) systemic** (and the port plan must absorb the fix) |
| Symptom reproduces only in `jka-web`, while OpenJK/WebGL renders the same map correctly | **(a) jka-web-specific** |
| Symptom disappears with hardware acceleration/driver change, different browser, or a complete asset set | **(c) environment/data** |
| No reproduction and no usable description | **(d) remains** |

---

## 8. G0 decision

| Half of G0 | Result |
|---|---|
| Native OpenJK MP plays a base demo and renders | **PASS** (see [native-baseline.md](./native-baseline.md)) |
| `jka-web` rendering issue classified well enough to plan the renderer | **NOT MET** — classification (d), missing symptom/environment evidence |

**Overall G0: PARTIAL — accepted.** Native playback passes; the rendering report is unclassified, but the user accepted the risk on 2026-11-16 and authorized M1.

Native playback is not the blocker. The remaining G0 evidence (symptom, browser, GPU, console, screenshot) is still wanted before the renderer strategy is validated, but M1 platform-layer and engine-boot work may proceed. Do not treat the renderer as proven until the §4 classes are fixed and a map is compared against the native baseline.
