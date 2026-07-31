# Wiring the typed core into index.html

> **Status (2026-07-31):** the legacy→typed migration this doc describes is **complete** (cleanup-audit Phases 0–4). `index.html` is now a thin shell over the compiled core plus ~42 KB of DOM glue, and all four views (workout · meal · data · knowledge) ship. This file remains as a historical record of the strangler-fig wiring; for the current module map see [`../docs/cleanup-audit.md`](../docs/cleanup-audit.md). (The code lives in `meridian-ts/`, not `ts/`.)

The build injects `window.MeridianCore` **before** the legacy inline script, so
everything below is available by the time the legacy code runs.

## 1. Create the handle once (near the other module-level `let`s)

```js
let wkView = null;                    // WorkoutViewHandle | null

function ensureWorkoutView() {
  if (wkView) return wkView;
  wkView = MeridianCore.mountWorkoutView({
    container: paneWorkout,
    videoUrl:  exVideo,               // existing helper
    dateLabel: dLabel,                // existing helper
    actions: {
      logSet(ex, type, weight, reps) {
        logSet(ex, type, weight, reps);       // existing mutation
        wkView.clearEdits(cssId(ex));         // typed values revert to prescription
      },
      deleteSet(date, id) {
        tomb(WK, id);
        WK.days[date] = (WK.days[date] || []).filter(s => String(s.id) !== id);
        wkMarkDirty(); renderWorkout();
      },
      toggleExerciseDone: ex => toggleExDone(ex),
      toggleSessionDone:  ()  => toggleSessionDone(),
      toggleDeload(ex) { wkDeload[ex] = !wkDeload[ex]; renderWorkout(); },
      editIncrement(ex) {
        const v = prompt('Smallest weight step for ' + ex + ' (lb).',
                         MeridianCore.inferIncrement(WK, ex));
        if (v === null || v === '') return;
        (WK.incr ||= {})[ex] = Math.max(1, +v || 5);
        wkMarkDirty(); renderWorkout();
      },
      startRest: (ex, type) => startRest(ex, type),
      changeDate(which) {
        wkDate = which === 'today' ? dstr()
               : MeridianCore.shiftDate(wkDate || dstr(), which === 'next' ? 1 : -1);
        wkSplitTouched = false;
        renderWorkout();
      },
      changeSplit(split) { wkSplit = split; wkSplitTouched = true; renderWorkout(); },
      logBodyweight(v) {
        if (!v) return;
        WK.bw[wkDate || dstr()] = v;
        if (!WK.settings.bwCurrent) WK.settings.bwCurrent = v;
        wkMarkDirty(); renderWorkout();
      },
    },
  });
  return wkView;
}
```

## 2. Replace the body of `renderWorkout`

The whole 12.7KB function collapses to this:

```js
function renderWorkout() {
  if (!wkLoaded) {
    paneWorkout.innerHTML = '<div class="empty">Loading…</div>';
    wkLoad().then(() => renderWorkout());
    return;
  }
  ensureWorkoutView().repaint(
    WK,
    wkDate || dstr(),
    dstr(),
    { deload: wkDeload, split: wkSplitTouched ? wkSplit : undefined },
    { current: currentBW(), goal: +WK.settings.bwGoal || null },
  );
}
```

`keepScroll` is gone — scroll, focus and caret are preserved on every repaint.

## 3. Delete these, now dead

| Symbol | Replaced by |
|---|---|
| `patchLift`, `updateSessionCounter` | full repaint + change detection |
| `buildPlan`, `template`, `inferIncr` | `MeridianCore` pure layer |
| `suggestedSplit`, `exSplit`, `exOrder` | `selectWorkoutView` |
| `estimateSession`, `plannedSetCount` | `selectWorkoutView` |
| `exDone`, `sessionDone`, `loggedExercises` | view model fields |
| `wireWorkout` and its `querySelectorAll` binding | event delegation |
| `round5` / `roundTo` in the inline script | `roundDownTo` in the core |

## 4. Call sites to update

```js
logSet(...)               -> unchanged; it now calls renderWorkout() once at the end
renderWorkout(true)       -> renderWorkout()
autoCompleteChecks(ex)    -> keep; but its renderWorkout(true) becomes renderWorkout()
```

## 5. Build

```bash
cd ts
npm run build          # compile + minify + inject
npm run build:check    # CI: fails if index.html is stale
```
