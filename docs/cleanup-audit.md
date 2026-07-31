# Meridian — Cleanup / Modularization Audit

_Read-only audit, 2026-07-31. Three parallel passes: legacy JS in `index.html`, the `meridian-ts` module tree + tooling, and repo-root artifacts. Key claims spot-verified._

## Executive summary

Meridian is a **strangler-fig migration that's ~80% done**. The clean half is genuinely high quality: pure, parameterized selectors under `meridian-ts/src/`, a well-designed `SyncEngine` port boundary, and strong vitest + fast-check property tests. The unfinished half is a **~101 KB hand-written "legacy" blob inside `index.html`** — and that blob is now the single biggest liability.

**The headline number:** `index.html` is 177 KB and ~90% script. The readable legacy region (101 KB) is **nearly double the minified compiled core (57 KB)**, and **~50 KB of the legacy region is inert data literals**, not logic. So the actual hand-written logic left to deal with is only ~51 KB, and half the file's bulk is data that should be JSON assets.

**North star:** finish the migration. `index.html` should become a thin shell — HTML + CSS + a single mount call — with all logic in typed/tested modules and all seed data in `questions/`-style JSON assets. The quality gate (`npm run verify`) should be green and enforced.

**Do this in reviewer-safe order:** fix the broken gate and real bugs first (so tests protect the rest), then delete dead code, then extract modules, then externalize data.

---

## Severity findings

### 🔴 HIGH — The quality gate is broken (nothing is actually enforced)
- `npm run typecheck` **fails**: `tsconfig.json` sets `"types": ["node"]` but `@types/node` isn't installed, and **no `src/**` file uses any Node global** (grep for `node:`/`process`/`Buffer`/`__dirname` = 0 hits). Fix: delete `"types": ["node"]` (1 line). Alternatively `npm i -D @types/node`, but that's an unused dep.
- `bench.mjs`, `parity.mjs`, `boottest.mjs` all `readFileSync('../site/index.html')` / `'site/index.html'` — **`site/` does not exist** (the app is repo-root `index.html`). So `verify` (typecheck → test → build:check → **boottest** → **bench**) can't pass past step 1, and even if it did, boottest/bench/parity would throw ENOENT.
- **Net:** `verify` has been non-functional; regressions land unguarded. Repoint the three scripts to `../index.html` (or delete boottest and drop `test:boot` from the `verify` chain).

### 🔴 HIGH — Real bugs the (disabled) tests already catch
- **`dataView.ts` renders unbalanced markup.** `npm test` = 2 failures in `mealView.test.ts` (which actually tests `dataView` under a mislabeled `describe('data view')`). The balanced-markup property test reports **33 `<div>` open / 34 close** — an orphan `</div>` around the pantry-input row (~`renderDataHTML` lines 50–54). Genuine regression from the uncommitted `dataView.ts` edits.
- **`savePantryId` signature drift** — the other failing assertion expects `savePantryId('my-id')` but the controller now calls `savePantryId('my-id', '')` (2-arg). Stale test; update it.
- **`cloudId` is undefined** — `MC.sync.create({ getPantryId: () => cloudId() })` references a symbol defined nowhere (verified: 1 occurrence). Latent `ReferenceError`, dormant only because the live path is `SupabaseCloudProvider`, not Pantry. Remove the callback or the dead Pantry path.
- **`masterLabel` reads `MC.MASTERY_LABEL`** which the core doesn't export (core exposes `MC.MASTERY`). Dead function, but the reference is wrong.

### 🟠 MEDIUM — Dead code (safe deletions, ~zero risk)
All verified as call-count 1 (definition only). In `index.html` legacy JS:
- Sync shims never called: `cloudPush`, `cloudPull`, `cloudMerge`; dead work `snapshotClean`/`cleanSnapshot` (written, never read).
- Old hand-written `renderWorkout` remnants (fully replaced by `MC.selectWorkoutView`): `topOf`, `lastSession`, `isCardio`, `allExercises`, `latestTop`, `firstTop`, `weeklySets`, `bwTrend`, `toggleExDone`, plus data `EX_ORDER`, `LOWER_MUSCLES`, `UPPER_MUSCLES`.
- Old knowledge helpers: `srsOf`, `dueCount`, `bookRef`, `fmtReveal`, `allItemIds`, `masterLabel`.
- Removed schedule/time UI: `toMin`, `fromMin`, `h12`.
- Dead globals: `cloudRetryTimer`, `cleanState`, `coreHydrated`, `PANTRY_BASE`, `BASKET`, `MIN_PUSH_GAP`, `lastPushAt`, `pushBackoffUntil`.
- **Loose root scripts — all dead:** `boottest.mjs`, `livetest.js`, `simtest.js`, `synctest.js`, `unittest.js` regex/eval old inline functions out of the nonexistent `site/index.html`; superseded by the vitest suites. Delete all five (+ drop `test:boot`).
- `index.html.bak` (build backup, gitignored), and `git rm --cached` the two committed `.DS_Store` files.

### 🟠 MEDIUM — Data literals masquerading as code
~50 KB of the legacy region is baked-in JSON: `DEFAULT_WK` (31 KB seed workout), `KG_GYM` (11.8 KB), `KG_BOOKS` (4 KB), `KG_TOPICS` (1.3 KB), `KG_TARGETS`, `EX_VIDEO`/`EX_ORDER`. **Move these to `assets/*.json` (or extend `questions/`) and fetch them like the question bank already does** — this alone nearly halves the legacy region and gets seed data out of source review.

### 🟠 MEDIUM — Duplication
- **Legacy re-implements the core.** `esc` (duplicates the core's `esc`/`u`), `dstr`/`shift` (duplicate `MC.shiftDate`), and a whole second persistence path: `rawGet`/`rawSet` (3-backend read + version-heal) run at load time while `MC.sync`'s `write` callback writes localStorage directly — **two independent storage writers**. Unify on one.
- **View controllers copy-paste the repaint contract.** The focus-preserving `repaint()` (~12–14 lines) and the `onClick` delegation + constructor are duplicated verbatim across `workoutView`/`mealView`/`dataView`/`knowledgeView` (~60–70 lines total). It's **already drifted**: `DataViewController.repaint` silently dropped scroll save/restore the other three have. A `BaseViewController<VM>` (holds `host`, `lastHTML`, the repaint skeleton with abstract `render(vm)`, and the delegation constructor) collapses this to one place. **Highest-value view-layer cleanup.**

### 🟡 MEDIUM — Modularity
- **Shared primitives are trapped in feature files.** `toId`/`sameId`/`toNum`/`roundTo`/`shiftDate`/`pruneTombstones`/`addTombstone` live in `workoutSelectors.ts` (743 LOC, the outlier), so `coreSelectors`/`mealSelectors`/`entry.ts` all depend on the *workout* file just for utilities → extract a `util.ts`. Likewise `ViewHost` + `esc` live in `workoutView.ts` and are imported by the other three views → extract `viewHost.ts` / `html.ts`.
- **Tombstone-set construction** (`new Set(Object.keys(state._del ?? {}).map(toId))`) is inlined in several selectors → one `deadIdSet(state)` helper.
- **The `browser/` adapter layer is a coverage hole.** `adapters.ts` (282 LOC) holds the riskiest real-world logic — localStorage/IndexedDB version reconciliation and the Supabase public-read-vs-authenticated-write URL logic whose own comments cite past cross-device data-loss — and has **zero tests**, though its ports are trivially mockable. `dataView.ts` also lacks its own test file. Close these.

### 🟡 LOW — Verbose glue (acceptable, but trimmable)
The `ensure*View` mounters (`ensureWorkoutView` ~89 lines, `ensureKnowledgeView` ~80, `ensureDataView` ~72, `ensureMealView` ~67) mix DOM mounting + business logic (SRS writes, `CORE.entries` pushes) + AI/network in their callback bodies. Their *rendering* logic already lives in the core; extracting the callback bodies (SRS, AI) into typed modules leaves these as declarative wiring.

### 🟡 LOW — Docs & PWA drift
- `SYNC_INTEGRATION.md` still documents the **Pantry** backend + `getPantryId`; the app is on **Supabase**. `INTEGRATION.md` documents only the workout view (3 newer views undocumented). Both say `cd ts` (dir is `meridian-ts`).
- `sw.js` (cache `meridian-v10`) bypasses caching for **`anthropic.com`** (0 refs now) but **not `supabase.co`** (the current sync + AI host, 10 refs) — a Supabase GET could be served stale from cache-first. Swap the bypass host.
- CSS (16 KB, well-organized): `.appwrap` and `.setrow.cur` each defined twice; `.mapline`, `.nowtag` appear to be dead selectors.
- `.gitignore` lists `.DS_Store` twice and doesn't cover a Python `pdfenv`/`__pycache__` (used by the page-extraction pipeline).

---

## Prioritized roadmap

**Phase 0 — Make the gate real (do first; everything else rides on it).**
1. Remove `"types": ["node"]` from `tsconfig.json`. 2. Repoint `bench.mjs`/`parity.mjs`/`boottest.mjs` to `../index.html` (or delete boottest + drop `test:boot`). 3. Fix the `dataView.ts` unbalanced `<div>`; update the stale `savePantryId` assertion. 4. Confirm `npm run verify` is green. → **Now tests protect all further changes.**

**Phase 1 — Delete dead weight (mechanical, low risk, big readability win).**
Remove the dead functions/globals list; delete the 5 loose root scripts; delete `index.html.bak`; `git rm --cached` the `.DS_Store` files; fix `.gitignore`. Rebuild, re-verify.

**Phase 2 — Externalize data.** Move `DEFAULT_WK`, `KG_GYM`, `KG_BOOKS`, `KG_TOPICS`, `KG_TARGETS`, `EX_VIDEO` to `assets/*.json`, fetched like the question bank. Nearly halves the legacy region.

**Phase 3 — De-duplicate & modularize the core.**
`util.ts` (shared primitives out of `workoutSelectors`), `viewHost.ts`/`html.ts` (out of `workoutView`), `BaseViewController<VM>` (collapse the 4 repaint/delegation copies; restore scroll on data tab), `deadIdSet` helper.

**Phase 4 — Migrate remaining legacy logic into typed modules.**
`ai.ts` (`aiCall`/`aiProxyUrl`/`aiAnon`/`ossEstimate` + inlined `gradeWithAI`), a `MultiBackendStore` (unify `rawGet`/`rawSet` with the `MC.sync` writer — kills the dual-write), a typed question-bank loader. Replace legacy `esc`/`dstr`/`shift` with core equivalents. Goal: `index.html` script region → the `ensure*View` wiring + a boot call, nothing more.

**Phase 5 — Close coverage & docs.**
Test `browser/adapters.ts` (highest-risk untested code) and give `dataView` its own test. Refresh `SYNC_INTEGRATION.md`/`INTEGRATION.md` for Supabase + the 3 newer views. Fix `sw.js` host bypass.

## What NOT to do
- Don't rewrite the pure selectors/SyncEngine — they're the good part.
- Don't touch the compiled region in `index.html` directly (it's generated; edit `meridian-ts/src` + `build.mjs`).
- Don't start Phases 1–4 until Phase 0 makes `verify` green — otherwise refactors are unguarded.
