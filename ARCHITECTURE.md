# Architecture

Meridian is a single-page, offline-first PWA (workouts, meals, knowledge/study) that syncs
across devices with no server-side database. It builds with Vite and deploys to GitHub Pages via
CI. The code is organized **feature-sliced** over a framework-agnostic core.

## Layout

```
src/
  core/         # the brain — pure logic, no DOM, no framework (fully unit-tested)
    sync/       #   SyncEngine (offline sync: revisions + tombstones), mergeStores (CRDT-ish merge)
    storage/    #   appState (save/dirty/autosave), adapters (cloud: Supabase/Pantry), store (IndexedDB)
    data/       #   seed content (books, defaultWorkout, exVideo, gym, targets, topics) + loader
    types.ts util.ts coreSelectors.ts appHost.ts(port interface)
  features/     # the four tabs — each owns its read-model + view + tests
    workout/    #   workoutSelectors (progression math) + view
    meal/       #   mealSelectors (calorie/macro math) + view
    knowledge/  #   knowledgeSelectors (spaced repetition) + questionBank + view
    data/       #   dataSelectors (storage/sync status) + view
  ui/           # shared presentation
    charts/     #   chart (numbers -> inline SVG) + progress (series builders)
    html.ts tokens.ts restTimer.ts hubView.ts viewHost.ts
  services/     # external calls — ai.ts (meal estimation, answer grading via the cloud proxy)
  app/          # composition root / wiring — main (Vite entry), entry, app (orchestrator), dom*Host
  landing/      # the Three.js constellation gate (lazy-loaded, decorative)
```

**Dependency direction:** `app → features → ui/services → core`. The core never imports upward.

**Path alias:** `@/` → `src/` (e.g. `import { chart } from '@/ui/charts/chart'`).

## Key ideas

- **Ports & adapters.** `appHost` (interface) / `domAppHost` (DOM implementation) is the app-shell
  port+adapter; `viewHost` / `domHost` is the per-screen rendering port+adapter. Splitting the
  contract from the DOM is what lets the logic be tested against a fake host with no browser.
  *(Most of this rendering machinery is slated to be replaced by a UI framework — see below.)*
- **Selectors are pure read-models.** A view is a pure `ViewModel -> HTML` function; the ViewModel
  comes from a selector over a plain store object. No derivation lives in the view.
- **Offline-first sync.** Each store has a monotonic revision and tombstones; two device copies
  merge without conflict. Cloud (Supabase/Pantry) is optional — the app is fully usable offline.

## Build, test, run

- `npm run dev` — Vite dev server (HMR).
- `npm run build` — typecheck + Vite production build (Workbox PWA). Output → `dist/`.
- `npm test` — Vitest (unit + fast-check property tests).
- `npm run bench` — Vitest benchmarks (`src/perf.bench.ts`) over the hot data-core paths.
- Deploy: push to `main` → GitHub Actions builds and publishes to Pages.

## In-flight

The view layer is migrating from hand-rolled string renderers + a bespoke repaint controller
(`viewHost`, `domHost`, `BaseViewController`, the `*View.ts` files, `app.ts`'s manual re-render
orchestration) to **Preact + signals**. After that, the confusing rendering plumbing disappears —
components consume the same selectors, and the tree is essentially `core/` + `features/*.tsx` +
a thin `ui/` + bootstrap.
