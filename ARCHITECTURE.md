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
  features/     # the four tabs — each owns its read-model + component + types + tests
    workout/    #   workoutSelectors (progression math) + WorkoutTab.tsx + types.ts
    meal/       #   mealSelectors (calorie/macro math) + MealTab.tsx + types.ts
    knowledge/  #   knowledgeSelectors (spaced repetition) + questionBank + KnowledgeTab.tsx + types.ts
    data/       #   dataSelectors (storage/sync status) + DataTab.tsx + types.ts
  ui/           # the Preact layer + shared presentation
    charts/     #   chart (numbers -> inline SVG) + progress (series builders)
    components/  #   shared components: Chart, Carousel, SectionHead, SaveChip, RestBar
    App.tsx Hub.tsx store.ts(signals) actions.ts host.ts html.ts tokens.ts restTimer.ts hubTypes.ts
  services/     # external calls — ai.ts (meal estimation, answer grading via the cloud proxy)
  app/          # composition root — bootstrap.ts (wiring) + main.tsx (Vite entry, landing gate)
  landing/      # the Three.js constellation gate (lazy-loaded, decorative)
  test/         # setup.ts — jsdom localStorage polyfill for the component tests
```

**Dependency direction:** `app → features → ui/services → core`. The core never imports upward.

**Path alias:** `@/` → `src/` (e.g. `import { chart } from '@/ui/charts/chart'`).

## Key ideas

- **Preact + signals.** UI state lives as signals in `ui/store.ts`; `ui/actions.ts` mutates the
  plain store objects in place and calls `bump()` to trigger a reactive re-derive. Components read
  the signals they depend on and derive their ViewModel via a selector — no manual re-render
  orchestration, no repaint controller. `ui/host.ts` is the thin side-effect surface (localStorage,
  dialogs, the save-chip/rest-bar bridged to signals) that actions + `appState` call.
- **Selectors are pure read-models.** A component derives its ViewModel from a selector over a plain
  store object; no derivation logic lives in the markup. The same selectors are unit-tested directly.
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
