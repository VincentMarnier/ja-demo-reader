# GitHub Pages deployment

The workflow at `.github/workflows/deploy-pages.yml` builds the rd-rend2 engine
and the React app, then deploys `app/dist` to GitHub Pages.

## One-time repository setup

1. Push `main` to GitHub.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Run the workflow manually once from **Actions → Build and deploy GitHub Pages
   → Run workflow**, or push to `main`.

The site is served at:

- `https://<owner>.github.io/<repo>/` for a project repository, or
- `https://<owner>.github.io/` for a user/organization repository.

The Vite `base` is relative (`./`), so the same build works for both layouts.

## What the workflow does

| Step | Purpose |
|---|---|
| `actions/checkout` with submodules | Fetches `references/OpenJK` at its pinned submodule commit |
| `actions/setup-node` | Node 22 and npm cache for `app/package-lock.json` |
| `mymindstorm/setup-emsdk` | Emscripten 6.0.1 with a cached SDK |
| `apt-get install libgl1-mesa-dev` | Host GL headers for the native `compact_glsl` shader generator |
| `engine/scripts/build-mp-wasm.sh` | Builds the static rd-rend2 engine with `BUILD_REND2=1 BUILD_CGAME=1 NO_PRELOAD=1` |
| `scripts/stage-engine.sh` | Copies the wasm engine into `app/public/engine` |
| `npm ci && npm run build` | Builds the static site in `app/dist` |
| `upload-pages-artifact` / `deploy-pages` | Publishes the build |

The workflow only triggers on `main` and manual dispatch. The `rd-vanilla`
branch is not deployed; rebuild and deploy it separately if needed.

## Notes

- The engine build takes several minutes; the job allows 45 minutes for it.
- No game data is built or deployed. `*.pk3` and `*.dm_26` are ignored, and the
  deployed page still asks the user to select their own local assets.
- The built engine files in `app/public/engine` are intentionally gitignored;
  CI creates them during the build.
- If deployment fails with a Pages permission error, confirm that **Settings →
  Pages → Source** is **GitHub Actions**.
