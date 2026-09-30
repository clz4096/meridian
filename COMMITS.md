# Proposed commits: the Cambridge Method (owner runs these)

Branch `cambridge`, from `main` @ `593e3e4`. Everything is staged. Each commit below takes only its pathspec from the staged changes, so run them in order. The groups are by concern. An intermediate commit may not build on its own; after the last one, `npm run verify` passes (1,112 tests).

Before you commit:
- `design/cambridge/` holds about 20 MB of JPEG screenshots. `node perf/routes.mjs --shots <dir>` regenerates them. To leave them out, run `git restore --staged design/cambridge` before commit 6.
- `meridian-checkpoint.md` and `review.md` stay untracked; they are not staged.

(The redesign's commit list that used to live in this file shipped on 09-29; see `git log`.)

## 1. The map, baseline and contracts
```
git commit -m "cambridge: map the Massey Standard and freeze the Cambridge contracts" -- ARCHITECTURE-cambridge.md perf/cambridge-baseline.md docs/cambridge-contract.md docs/cambridge-screens.md docs/cst-track.md
```

## 2. Curriculum data and its tooling
```
git commit -m "cambridge: curriculum data for STEP, Part IA and the CST track, with link checks" -- data scripts/cambridge src/features/cambridge/data.test.ts tsconfig.json vitest.config.ts
```
Body:
> Everything under `data/cambridge/` is owner-editable JSON: the glossary, the method, the STEP track (124 items), Underground stations, Part IA courses, the CST track (83 items) and resources. Schemas validate each file in `npm test`. `scripts/cambridge/scrape.mjs` refreshes links but keeps the owner's edits; `verify-links.mjs` checks all 980 URLs. Retired Massey content is archived in `data/archive/`.

## 3. Store, migration, XP and scheduling
```
git commit -m "cambridge: synced store with per-record merge, Massey backup, new XP events, sunset-based scheduling" -- src/features/cambridge/types.ts src/features/cambridge/store.ts src/features/cambridge/migration.ts src/features/cambridge/masseyKeys.ts src/features/cambridge/schedule.ts src/features/cambridge/xp.ts src/features/cambridge/scorecard.ts src/features/cambridge/photos.ts src/app src/core src/features/data src/features/studytracker/trackerStore.ts src/features/studytracker/trackerStore.test.ts src/features/studytracker/phase1.test.ts src/ui/actions.ts src/ui/actions.test.ts
```
Body:
> A sixth synced store, `cambridge`. Each record carries a timestamp and the newer copy wins, so edits reach other devices; a missing store from an old build never wipes local data.
>
> The first launch snapshots every Massey key at boot, before the first render, and saves a dated backup (IndexedDB + localStorage, downloadable from Data). Nothing old is deleted or rewritten.
>
> New XP: cold attempt +20, write-up +15, supervision +25, redo +15, STEP self-mark +10, gate +200, each paid once per item. The weekly Cambridge scorecard feeds Focus and Progress. Friday-to-Saturday sundown uses computed Brooklyn sunsets.

## 4. Screens
```
git commit -m "cambridge: path, study item, error log, glossary and the Today card" -- src/features/cambridge src/ui src/features/today src/features/paths src/styles src/features/styleguide scripts/contrastCore.mjs design/contrast.md package.json package-lock.json vite.config.ts
```
Body:
> - **Path:** the Cambridge path, with a phase map and "Pass gate".
> - **Study item:** the loop stepper, a persistent cold timer with hints locked for 60 minutes, a Markdown + KaTeX write-up and photos, the one-tap supervisor prompt, and an automatic 48 h redo.
> - **Error log and glossary:** an error log with a weekly trend, and a glossary with tap-to-define.
> - **Today:** Today's Math card shows the current item and loop step. The CS path gains the CST track.
>
> Everything is code-split per track; KaTeX and photos are lazy. Lighthouse is within noise of main (A/B).

## 5. Retire the old climbs and curriculum; rename to The Cambridge Method
```
git commit -m "tracker: retire the three climbs and curriculum UI, rename to The Cambridge Method" -- src/features/studytracker src/content
```
Body:
> Removes the three climbs, the curriculum track, the problem set of the week, the proof-journal panel, the Princeton Theory group and the COS/MAT list from the UI. Their content is archived in `data/archive/`, checked by `archive.test.ts`.
>
> Deep Blocks 1 and 3 now follow the current Cambridge item; their ids are unchanged. Adds the weekly Cambridge scorecard and a credit line for the Massey Standard's scoring.

## 6. Report, decisions and screenshots
```
git commit -m "docs: Cambridge Method report, decisions, bugs, and screenshots" -- CAMBRIDGE.md DECISIONS.md BUGS.md COMMITS.md perf/cambridge-after.md perf/cambridge-stage4-perf.md design/cambridge
```

## 7. WGU: the four enrolled courses; no standalone teaching tab
```
git commit -m "wgu: plan the four enrolled courses; drop the standalone teaching tab" -- src/features/wgu perf/routes.mjs perf/run.mjs ARCHITECTURE.md
```
Body:
> The WGU plan now covers only C955, D326, D315 and D279, week by week to Oct 25, with a buffer week. The 13-course plan is archived. Stored ticks are kept; counts use only the plan's courses. The Learn by Teaching tile and screen are removed; teaching stays in the tracker, and the `teach` id opens the tracker (DECISIONS C20, C21).

The rest of this change rides in earlier commits, because their pathspecs already cover it:
- commit 2 (`data`): `data/archive/wgu-plan-2026-09.json`, `data/archive/README.md`;
- commit 4 (`src/ui`, `src/features/today`, `src/features/paths`): `src/ui/App.tsx`, `src/ui/store.ts`, `src/features/today/TodayTab.tsx`, `src/features/today/TodayTab.test.tsx`, the deletion of `src/features/today/TeachScreen.tsx` and `TeachScreen.test.tsx`, `src/features/paths/wgu.test.ts`;
- commit 6: `CAMBRIDGE.md`, `DECISIONS.md`, `COMMITS.md`, `design/cambridge/final/today-390.jpg`, `wgu-390.jpg`, `wgu-390-full.jpg`.

So commit 4's WGU tests expect the 4-course plan before commit 7 lands it; the tree builds and passes after commit 7.
