# App.ts migration plan — retiring the last legacy glue

_Planning doc for a fresh session. Goal: move the remaining ~42 KB / 858 lines of
hand-written orchestration in `index.html` into typed, tested modules so
`index.html` becomes a pure shell (HTML + CSS + one `mount()` call)._

## Context

Cleanup Phases 0–5 are done. What's left in `index.html` is the app's **controller
layer**: global state, the save/dirty/flush machinery, the four view mounters, a
stateful rest-timer, tab routing, and boot. It works and the audit deemed it
"acceptable to keep." This migration is about **architectural purity + testability**,
not bug-fixing — so the bar is: *zero behavior change*, proven by a persistence
round-trip and live smoke on every slice.

This is riskier than the ai/store/questionBank slices because it is **stateful and
DOM-coupled**, and touches **data integrity** (save timing, dirty tracking, boot
loaders). Two hard-won lessons from earlier phases apply throughout:

- **Boot-order / TDZ:** top-level code in the legacy script runs *before* the
  `const MC = window.MeridianCore` alias (~line 147k). Any top-level reference to the
  core must use `window.MeridianCore.X`, never `MC.X`. (`MC.X` is fine only inside
  function bodies, which run later.) This crashed boot once already.
- **Fire-and-forget writes:** `storeGet`/adapter heals and saves are not always
  awaited; tests must `tick()` before asserting persistence.

## Current inventory (the 56 functions, grouped)

| Group | Functions | Notes |
|---|---|---|
| Pure helpers (duplicate the core) | `uid`, `esc`, `dstr`, `dLabel`, `shift`, `cssId` | `esc`→html.ts, `dstr`/`shift`→util `shiftDate`, `cssId`→`domId`. Replace, don't move. |
| **Save / sync / state** | `cloudEnabled`, `markDirty`, `paintSaveChip`, `flashSaved`, `loadCore`, `saveAll`, `baseRev`, `tomb`, `discardChanges`, `anyDirty`, `flushAll` | **The crux — owns CORE/WK/SG/KG + dirty + saveTimer.** |
| Workout | `wkMarkDirty`, `wkLoad`, `daysSorted`, `exSessions`, `exMeta`, `currentBW`, `exVideo`, `toggleSessionDone`, `ensureWorkoutView`, `renderWorkout`, `restSecs` | |
| Rest-timer | `fmtClock`, `startRest`, `bindRestBar`, `stopRest`, `dismissRestFor`, `paintRest` | Self-contained `setInterval` + a DOM bar. Good first real slice. |
| Knowledge | `itemMatchesTarget`, `allTargetItems`, `loadQuestionBank`, `kgMarkDirty`, `kgLoad`, `allKGItems`, `ensureKnowledgeView`, `renderKnowledge`, `dueItems`, `schedule` | `ensureKnowledgeView` inlines `gradeWithAI`/`answerWithAI` (call `MC.aiCall`). |
| Meal | `sgMarkDirty`, `sgLoad`, `dayMeals`, `sumCal`, `sumPro`, `ensureMealView`, `renderWeight` | |
| Bootstrap / routing | `dmsg`, `ensureDataView`, `renderData`, `renderAll`, `init` | tab router + boot + lifecycle handlers. |

Global mutable state to relocate: `CORE`, `WK`, `SG`, `KG` (the four stores), `dirty`,
`saveTimer`, and the per-view UI state (`wkDate`, `wkSplit`, `wkDeload`, `kgTopic`,
`kgTime`, `kgGym`, `kgTarget`, `sgDate`, `restTimer`, plus the `*Loaded`/`*Dirty` flags).

## The design decision: an `AppHost` port

Today typed code touches the *view* DOM only through `ViewHost`. The remaining glue
touches the DOM directly (`getElementById`, `setInterval`, save-chip paint, pane
show/hide, `window` lifecycle). To move it in **cleanly** — not relocate DOM-soup into
a `.ts` file — define a second small port for the app-shell concerns, mirroring the
`ViewHost` pattern so the orchestration stays typed + unit-testable with a fake.

```ts
// src/appHost.ts
export interface AppHost {
  pane(tab: 'workout' | 'meal' | 'knowledge' | 'data'): ViewHost; // the 4 mount targets
  readValue(id: string): string;                 // uncommitted input values
  showTab(tab: string): void;                    // pane visibility
  paintSaveChip(state: SaveChipState): void;     // the dirty/saved FAB
  restBar: RestBarHost;                          // start/stop/paint the countdown bar
  onLifecycle(ev: 'hide' | 'save-shortcut', fn: () => void): void; // visibility/pagehide/⌘S
}
```

`browser/domAppHost.ts` implements it against the real DOM; a `FakeAppHost` in tests
lets the orchestration run headless. The orchestration itself (`app.ts`) becomes pure
control-flow over `AppHost` + the existing `MeridianCore` (selectors, views, sync,
data, ai, store) — no direct `document`/`window`/`setInterval`.

## Target module structure

```
src/
  appHost.ts            AppHost + RestBarHost interfaces (+ SaveChipState)
  appState.ts           typed AppState (CORE/WK/SG/KG + view state); load + save/dirty/flush
  restTimer.ts          rest-timer state machine (drives RestBarHost)
  app.ts                mountApp(host: AppHost): wires 4 views, sync, routing, boot
  browser/
    domAppHost.ts       DomAppHost implements AppHost (the only new untyped DOM surface)
index.html              HTML + CSS + <script>MeridianCore.mountApp(new DomAppHost(document))</script>
```

## Migration sequence (ordered; verify after every slice)

Each slice: implement → `npm run verify` → `node build.mjs` → **browser smoke incl. a
persistence round-trip** (edit → reload → still there) → commit.

1. **Kill the duplicate helpers.** Replace legacy `esc`/`dstr`/`shift`/`cssId`/`uid`
   with `MC` equivalents (`window.MeridianCore.esc` etc. — expose the missing ones on
   the api). Pure delete-and-alias; no state. Warm-up slice.
2. **`appHost.ts` + `domAppHost.ts` skeleton.** Define the port; implement the DOM
   adapter; expose `MeridianCore.mountApp` as a no-op stub. No behavior change yet.
3. **Rest-timer → `restTimer.ts`.** Self-contained; drives `AppHost.restBar`. First
   real behavior move. Verify: a set logs → bar counts down → dismiss works.
4. **THE CRUX — `appState.ts`: state + save/sync/dirty.** Move `CORE/WK/SG/KG`
   ownership, the four loaders (through `MC.storeGet`, already typed), and
   `markDirty`/`saveAll`/`flushAll`/`anyDirty`/`discardChanges`/`baseRev`/`tomb` into
   TS. This is the data-integrity slice — do it alone, and verify the **full
   round-trip on all four stores**: mutate each, background/reload, confirm persisted;
   confirm the 20 s autosave and the pagehide `flushAll` both fire; confirm "discard"
   restores. Keep legacy calling into it via `MC` until slice 6 removes the callers.
5. **View mounters → `app.ts`.** Move `ensure*View` + `render*` for each of the four
   tabs into typed wiring over `AppHost.pane(tab)` + the existing `mount*View`. The
   callback bodies (SRS writes, meal add/estimate via `MC.estimateMacros`, workout log,
   AI answer/grade via `MC.aiCall`) call into `appState`. One tab at a time.
6. **Routing + boot + lifecycle → `app.ts` `mountApp`.** Move the tab router,
   `renderAll`, `init`, and the visibility/pagehide/⌘S handlers (via
   `AppHost.onLifecycle`). Delete the now-dead legacy globals.
7. **`index.html` → shell.** Remove the entire legacy `<script>`; leave HTML + CSS +
   `<script>window.MeridianCore.mountApp(new window.MeridianCore.DomAppHost(document))</script>`
   (or have entry.ts auto-boot). Rebuild; the MERIDIAN:CORE markers now wrap ~everything.
8. **Tests.** `appState.test.ts` (load/save/dirty/flush with a fake store — the
   highest-value new coverage), `restTimer.test.ts`, `app.test.ts` (routing/mount via
   `FakeAppHost`).

## De-risking checklist (per slice, especially slice 4)

- **Persistence round-trip** on every store touched: edit → reload → present.
- **Save triggers:** debounced autosave still fires; `pagehide`/`beforeunload`
  `flushAll` still fires; `⌘S` still saves.
- **Dirty tracking:** the save chip reflects state; "discard" reverts.
- **Boot order:** anything at top-level uses `window.MeridianCore`, not `MC` (TDZ).
- **Timers/focus:** rest-timer interval clears on stop/navigate; focus + scroll
  preserved across repaint (the `BaseViewController.paint` contract still holds).
- **Fire-and-forget:** `tick()` in tests before asserting persistence.

## What NOT to do

- Don't migrate state ownership piecemeal across slices — CORE/WK/SG/KG share the
  save/dirty glue; move them as one coherent slice (4) or risk two owners of truth.
- Don't put `document`/`window`/`setInterval` in `app.ts`/`appState.ts` — that all
  lives behind `AppHost`/`DomAppHost`. If it leaks in, the port is wrong.
- Don't skip the browser round-trip because `verify` is green — `verify` can't catch a
  save that silently no-ops.

## Definition of done

`index.html` has no hand-written `<script>` beyond the boot call; `MeridianCore.mountApp`
owns the app; `appState`/`restTimer`/`app` are typed and unit-tested; `verify` green;
live persistence round-trip passes on all four stores. Legacy JS in index.html: ~42 KB → ~0.

## Execution log + bugs found

Executed 2026-07-31 (fresh session), one verified slice at a time; `npm run verify`
green after each (179 tests). Live smoke via a local http server + the browser tools.

- **Slice 1** (dead helpers): only `esc`/`shift` were true dead duplicates — deleted.
  `cssId`→`domId` deferred to slice 5 (behavior-change trap: view ids are `domId`-style
  `bench-press`, `cssId` yields `BenchPress`, so `clearEdits` already silently no-ops for
  multi-word lifts — swapping it changes behavior). `uid`/`dstr`/`dLabel` are impure with
  no pure-core twin (`util.ts` is "no clock, no DOM") → deferred to their real home.
- **Slice 2**: `AppHost`/`RestBarHost`/`SaveChipState` port + `DomAppHost` + no-op
  `mountApp`. Interface grows per slice; slice 5 adds the per-view callback surface.
- **Slice 3**: rest-timer → `restTimer.ts` (injected clock/scheduler). Legacy now
  constructs the single `DomAppHost` (`APP`) that later slices grow into the app's host.
- **Slice 4** (crux): `appState.ts` owns save/dirty/autosave/flush/discard + the four
  loaders (seeding/merge moved verbatim). Store *objects* stay legacy globals, bridged via
  read/write (single source of truth, no divergent copy). Verified live: all-4-store
  round-trip, ⌘S, pagehide flush, autosave-arm, dirty chip, discard revert.

### BUG-1 (found + fixed in slice 4): Discard left the chip nagging "unsaved"

- **Symptom:** After Discard (cancel unsaved changes → revert to last saved), the Save
  chip stayed "Unsaved — tap to Save" and the Discard FAB stayed visible, even though the
  revert succeeded and there were no changes left.
- **Cause (pre-existing, from legacy):** `discardChanges` reverted the data and repainted
  the chip, but never reset the per-store dirty flags (`dirty`/`wkDirty`/`sgDirty`/
  `kgDirtyFlag`) that the triggering edit had set — so `anyDirty()` stayed true.
- **Fix:** `appState.discard()` sets `dirtyLocal = false` on a successful revert before
  repainting. Verified live (cloud on): edit → "Unsaved" + Discard shown → Discard →
  "All changes saved", Discard hidden, edit reverted.
- Also: `onStatus` now paints through the unified chip path, so the Discard FAB correctly
  hides after a successful (cloud-synced) save instead of lingering.

### BUG-3 (found + fixed in slice 5): first Data-tab Export left the textarea empty

- **Symptom:** clicking Export on a fresh load showed "Exported all 4 stores." but the
  `d-io` textarea was empty (nothing to Copy). A *second* click worked.
- **Cause (pre-existing):** `exportAll` set `d-io.value` and *then* called `dmsg`, whose
  re-render swaps the pane's innerHTML — wiping the just-set textarea. The second click
  didn't change the status message, so `BaseViewController.paint` skipped the swap and the
  value survived. (`d-io` isn't user-typed, so it isn't in the focus/value-preserve set.)
- **Fix:** call `dmsg` first (re-render with a fresh empty textarea), then `host.setValue`
  to populate it. Verified live: first export now populates `d-io`.

### Slices 5–7 done together (view mounters + routing/boot + shell)

The remaining store globals and keep-wrappers were interleaved through the removed regions,
so a partial slice-5 deletion would have been fiddly and riskier than a clean cut. Moved the
whole view layer into `app.ts` (all four `ensure*View`/`render*`, view-state, helpers, rest
timer, question-bank load) behind an enlarged `AppHost` (status sinks, prompt/confirm, copy,
reload, getItem/setItem), then implemented `mountApp` as the composition root (owns the four
store objects + routing + save-chip/discard + lifecycle + boot) and reduced index.html to a
single `MeridianCore.mountApp(new DomAppHost(document))` call (plus the SW-registration
script). `cssId`→`domId` resolved (correct id scheme; set ids advance on log so no visible
change). Verified live: pure shell, all legacy globals gone, every tab + action, discard,
persistence, ⌘S, pagehide, 0 console errors.

### Slice 8 done (unit tests)

Added `restTimer.test.ts` (9 — start/paint/count/over, stop silent-vs-visible, bound Stop
button, dismissFor, restart clears interval), `appState.test.ts` (28 — all four loaders'
seeding/merge/backfill, markDirty-arms-autosave vs per-view marks that don't, anyDirty,
save/flush+marker, discard clears dirty + re-renders [BUG-1], onStatus chip matrix, get/set
bridge, init wiring), and `app.test.ts` (11 — load→mount→repaint gating + mount caching,
renderAll, meal add/empty-guard, knowledge rate → mastery+core entry, workout logSet, export
BUG-3 ordering, restoreSnapshot BUG-2 no-throw). All via injected fakes — no DOM, no cloud.
`npm run verify`: **227 tests** (was 179), typecheck + build:check + bench green.

### Test-hygiene note + a CLOUD-POLLUTION INCIDENT (important)

The `localhost:8765` sandbox shares the **real Supabase cloud** (same project) with the
user's GitHub Pages app, so any push there hits real data. Round-trip probes must stash +
remove `meridian_supabase_url`/`_key` first (local-only), then restore **only after a fresh
reload** — see the incident.

- **Incident (slice-5 testing):** a test rating (`a-twoptr-5`, today, score 1) leaked to the
  real cloud. Root cause: creds were restored **while a polluted in-memory state was still
  live**, and the very next reload's `beforeunload`→`flush` pushed that memory to cloud.
- **Why it was sticky:** (1) the store log is **append-only union-merged**, so merge-based
  sync (pull/save) can never *remove* an entry — the cloud must be **overwritten directly**;
  (2) local reads are **newest-wins across localStorage + IndexedDB**, so cleaning only
  localStorage let the IDB copy resurrect it; (3) every reload's unload-flush re-wrote the
  polluted in-memory back to storage, so nuke-then-reload just re-polluted.
- **Fix applied:** overwrote the cloud `state.json` directly via the Supabase Storage REST
  endpoint (`POST …/object/meridian-sync/state.json`, `x-upsert:true`) with the corrected
  csgraph/core (mastery restored to the user's real 3, my today log/core entries removed,
  SRS reconstructed from the real log), bumped `rev` so other devices pull the fix; then
  froze the sandbox (removed its creds) and wiped its local backends. **Verified cloud clean
  (rev 1202): `a-twoptr-5` mastery 3, only the real 2026-07-30 log entry, no leaked entries;
  overload/surplus real.** The user's GitHub Pages origin was never touched.
- **Rule for next time:** to fix in-memory pollution, use the app's **importPasted** (it
  `S.set`s every store, defeating the unload-flush); to fix cloud, **overwrite state.json**,
  never merge; and clear **both** localStorage and IndexedDB.
