# Stage 2: performance

Measured 2026-09-29 on the same Mac as `perf/baseline.md` (Intel i7-8750H), working tree on `redesign` against the baseline commit `e7ff8d2`.

Raw data (all in `perf/results/`, gitignored):
- Cumulative A/B, n=5, interleaved: `2026-09-29T18-39-18-023Z-e7ff8d2-ab.json` (`npm run perf -- --against e7ff8d2`)
- Absolute numbers for the new first screen, n=5: `2026-09-29T18-45-10-366Z-e7ff8d2.json` (`npm run perf`)
- Per step, n=1: `routes-s2-step1.json` to `routes-s2-step5.json` (`node perf/routes.mjs`)

Trust the A/B for runtime claims. The per-step routes runs are n=1 on a laptop with a load average of 3 to 9, so a single step can move 100 ms either way (step 4 is the clearest example).

## Summary (A/B, n=5 median)

| Metric | Before (`e7ff8d2`) | After | Change |
|---|---|---|---|
| Home usable, empty | 804 ms | 520 ms | -35% |
| Home usable, seeded (90 days) | 955 ms | 525 ms | -45% |
| Long tasks before Today, seeded | 434 ms | 262 ms | -40% |
| Main JS (gzip) | 100.1 KB | 69.9 KB | -30% |
| Main CSS (gzip) | 22.2 KB | 15.6 KB | -30% |
| three.js on the startup path | 133.8 KB gzip | 0 (on demand) | |
| Question bank fetched on Today | 16 files, about 535 KB | 1 file, 8.3 KB | |
| Service worker precache | 34 entries, 1,824.7 KiB | 43 entries, 1,286.7 KiB | -29% |
| JS heap after the tab tour, seeded | 14.5 MB | 13.3 MB | -8% |
| Lighthouse performance | 99 | 95 | see below |
| Lighthouse accessibility | 84 | 87 | +3 |
| Lighthouse FCP | 1,657 ms | 1,423 ms | -14% |
| Lighthouse LCP | 1,658 ms | 2,864 ms | see below |
| Lighthouse TBT | 79 ms | 44 ms | -44% |
| Lighthouse CLS | 0 | 0.011 | |

"Home usable" is time to a usable Today. Before, that was time to the Enter button being tappable plus Enter to Today (the pause before the tap excluded). After, it is navigation start to Today painted. `perf/routes.mjs` and `perf/run.mjs` now use the same definition, so the two builds compare like with like.

**Lighthouse is now measuring a different screen.** Before, it scored the static landing HTML: the LCP element was the landing tagline, painted before any JS ran. Now the first screen is Today, which Preact renders, so its LCP element (the clock, `.today-time`) waits for the app JS and CSS. Lighthouse puts 84% of the 2.9 s LCP in render delay under its simulated slow 4G. The drop from 99 to 95 is that LCP and nothing else: FCP and TBT both improved. Getting LCP back under 2.5 s means painting Today without waiting for the bundle (a prerendered shell). That is a larger change and was not in this stage's list.

Absolute Lighthouse on the new first screen (`npm run perf`, n=5): performance 95, accessibility 87, FCP 1,467 ms, LCP 2,862 ms, TBT 47 ms, CLS 0.011, TTI 2,877 ms. Failing binary audits: `meta-viewport` (kept on purpose, see change 1) and `font-size` (new, because Lighthouse now sees Today's small labels; for the design stage).

## 1. three.js off the startup path

**What changed.** Today is the first screen. `src/app/main.tsx` boots the stores and renders `<App/>` immediately, with `import '@/app/demo'` still first. The Enter gate (`#landing` markup, `.pre-enter`, the dark void paint) and the live WebGL background (`#bg-graph`) are gone from startup. The intro is still reachable: the Data tab has an Intro card with a "Play the intro" button that lazily imports `@/landing/index` and calls the new `playIntro(opener)`. The intro builds the same overlay full-screen as a `role="dialog"`, focuses Enter, closes on Enter or Escape, and returns focus to the button. The `#landing` CSS moved out of `app.css` into `src/landing/landing.css`, which ships with the lazy chunk.

The `boot:enter` telemetry span keeps its key so history stays comparable. It now spans boot to the first Today paint, and the Performance & health panel labels it "Start to Today".

**Colors.** `index.html`'s critical inline style, `theme-color`, and the manifest's `background_color` and `theme_color` are now the neutral light `#FBF7F1`, as the brief asked. The app's own CSS is still dark, and the render-blocking stylesheet paints before the inline color can show, so the only visible effect until the design stage is a light browser/status bar over a dark app. `color-scheme: dark` and `apple-mobile-web-app-status-bar-style` were left alone because they serve the app, not only the landing.

**Viewport.** `maximum-scale=1` stays. Form inputs are 12.5 to 15 px (`.minp` 15 px, `.addslim-in` 14 px, `.mpanel input` 13 px, `.algo-pi-input` 12.5 px), and iOS Safari zooms the page on focus when an input is under 16 px. A comment in `index.html` records why. Remove it when the design stage sets inputs to 16 px or more.

**Files.** `src/app/main.tsx`, `index.html`, `vite.config.ts` (manifest colors), `src/landing/landing.ts`, `src/landing/index.ts`, `src/landing/landing.css` (new), `src/styles/app.css`, `src/features/data/DataTab.tsx`, `src/features/data/HealthPanel.tsx` (label), `perf/run.mjs` (the gate is optional).

**Measured (routes, n=1).** Home usable 1,171 to 540 ms empty, 1,100 to 576 ms seeded. JS fetched before Today dropped from 230 KB to 156 KB: three.js no longer loads, and the tracker chunk still arrives at idle.

## 2. Code-split the non-home views

**What changed.** `src/ui/App.tsx` generalizes the existing `loadTracker` pattern into `lazyView()`. Todos, Scratchpad, Knowledge, Workout, Food & Body, Data, WGU Roadmap, and the Princeton tracker are each a lazy chunk with the same `.pane-loading` placeholder, error message, and Try again button. After the first Today paint they prefetch one per idle slot, so a slow phone never parses them all in one long task. Without `requestIdleCallback` (Safari), the queue waits 1.5 s once, then runs back to back. Telemetry is unchanged: a lazy pane counts as opened when its real content renders (`LAZY[tab].ready`).

In `src/ui/actions.ts`, the AI client (`@/services/ai`, 11 KB) is only needed when an AI action runs, so it now loads through `import()` on the first AI tap. A failed import (only possible on a never-cached, offline launch) comes back as an ordinary failed AI call with a message, not an exception.

**Declined, with reasons.**
- `ts-fsrs` (59 KB of the main chunk) stays. Today's mastery % calls `isMastered`, which needs FSRS retrievability. Moving it out would mean reimplementing the formula.
- `dataSelectors` stays. The Data tile's KB figure needs `normaliseState`, which is most of that module; Rollup keeps a module in one chunk, so the export and import code can't leave without splitting the file.
- `defaultWorkout.json`, `gym.json`, `roadmapData`, and `trackerStore` stay: Today's Workout, WGU, and Princeton tiles need them.

**Files.** `src/ui/App.tsx`, `src/ui/actions.ts`.

**Measured.** Main JS 311.3 KB / 100.1 KB gzip to 215.5 KB / 70.0 KB (-30% gzip). Main CSS 22.2 to 20.7 KB gzip (the WGU CSS left with its view). Routes, n=1: home usable 326 ms empty, 296 ms seeded.

## 3. Today no longer downloads the question bank

**What changed.** `public/questions/index.json` now lists each topic's question `ids` (and `count`), generated by `node scripts/question-index.mjs`. The file is 8.3 KB. Today loads only the knowledge store and this index (`fetchQuestionIndex`). The 15 topic files load when Knowledge opens (`loadKnowledge`, unchanged for the tab). `hubStats()` builds the curriculum id set from the index, falling back to the loaded bank if the index is unavailable. A failed index fetch retries on the next visit to Today. The sync gate (`registerLoadAll`) now loads only the store, not the bank.

The synchronous `JSON.stringify` of the whole bank into `localStorage['kg_bank_cache']` is gone. The service worker precaches every file under `questions/`, so offline already works without it. The old mirror is still read as a last resort (offline with no service worker), and it is deleted after the next complete download, which frees about 550 KB of localStorage quota shared with the user's own data. An incomplete download leaves it in place.

**Tests.**
- `src/features/knowledge/questionIndex.test.ts` fails if `index.json`'s ids or counts drift from the topic files, or if a topic file is missing from the index.
- `src/ui/actions.test.ts` pins the user-facing number on the real shipped files: with 34 of 339 curated questions mastered (plus a retired id and a mastered AI card, which must not count), the Knowledge tile reads `10` from the full bank (the old path) and `10` from the index alone (the new path).
- `src/features/knowledge/questionBank.test.ts` covers `fetchQuestionIndex` and the mirror's new write-free behavior.

**Files.** `public/questions/index.json`, `scripts/question-index.mjs` (new), `src/features/knowledge/questionBank.ts`, `src/ui/store.ts` (`kgIndexIds`), `src/ui/actions.ts`, and the three test files above.

**Measured.** Question files fetched on Today: 16 (about 535 KB decoded) to 1 (8.3 KB). Opening Knowledge now fetches them: 17 requests, 532.6 KB decoded. The A/B shows the Knowledge open at 62 to 79-80 ms (+17 ms), which is the bank parse moving from Today to the tab that uses it. Routes, n=1: home usable 350 ms empty, 364 ms seeded (within noise of step 2).

## 4. Service worker registration and precache

**What changed.**
- `injectRegister: 'script-defer'`: `registerSW.js` is now `<script defer>` instead of a parser-blocking script in `<head>`.
- three.js and `src/landing` are named `intro-*` through `manualChunks`. That is the only way to tell them apart by file name; before, the chunk was an unnamed `index-*`, like the entry.
- `globIgnores` leaves `assets/intro-*` out of the precache. A `CacheFirst` runtime route caches it the first time the intro plays (content-hashed names, so a cached copy is never stale), so it works offline after that.
- The app shell, every view chunk, and the question bank stay precached, so offline launches still work.

**Why not keep three.js precached.** It is 533 KB raw (134 KB gzip) for a feature that now only plays from the Data tab, and every first visit and every three.js upgrade would download it.

**Files.** `vite.config.ts`, `perf/run.mjs` (build-size detection for the renamed chunk).

**Measured.** Precache 34 entries / 1,824.7 KiB to 43 entries / 1,286.7 KiB (the entry count rose because each view is now its own file). Routes, n=1: home usable 355 ms empty, 482 ms seeded. The seeded figure is load noise: every route in that run was slower, including ones this step can't touch.

## 5. Dead CSS

**What changed.** Every class in the listed families was checked against `src/**/*.{ts,tsx,mjs}` and `index.html`, both as a whole word and as the start of a string (for built names like `'bc-' + x`). None had a reference. The only hits were prose: "hub" in comments and the `--hub` color token, and `.qcard` in a KnowledgeTab comment. A small parser removed only the selectors naming those classes. No rule had a live selector mixed in, and six `@media` blocks ended up empty and went too. Section comments left with nothing under them (the Daily nav header, the gallery and Base Camp headers) were removed. `#landing` moved to the lazy chunk in change 1 rather than being deleted, and `.pre-enter` and `#bg-graph` were removed there.

Families removed: `.bc-*`, `.tov-*`, `.hub`/`.hubrow`/`.hubtag`, `.navbar`/`.tabbar`/`#tabbar`, `.ktabs`/`.ktab`/`.tprog`/`.timebar`/`.qcard`/`.qtop`, `.khead`/`.ktopic*`/`.klist-item`/`.kprog`/`.kdue*`/`.kgymrow`, `.kfilters*`/`.fgrp-l`, `.slabel`/`.sched-edit`/`.subblocks`/`.sentry`/`.mapline`/`.noteline`, `.nowtag`, `.tdrow`, `.heroduo*`, `.kpath*`, `.daynav*`: 303 rules in total.

**Verification.** Screenshots of every screen, empty and seeded, with the pre-prune CSS and the pruned CSS (same code otherwise), compared pixel by pixel. 16 of 18 are identical. The two home screens differ only inside the clock (a different second).

**Left alone.** `wgu.css` has no unreferenced class. `studytracker.css` has nine names with no literal reference (`algo-pi-actions`, `medal`, `panel-top`, `pt-glance-streak`, `serif`, `streakwrap`, `today-xp`, `ttl`, `xpblock`), and `app.css` has about 60 more. Many are built at runtime (`'tone-' + x`, `'eff-' + x`, `'z-' + x`, `'g' + n`), so none of them is clearly dead. They need a per-name check before deleting.

**Files.** `src/styles/app.css`.

**Measured.** Main CSS 113.6 KB / 20.7 KB gzip to 85.4 KB / 15.8 KB gzip (the A/B total, all steps: 22.2 to 15.6 KB gzip, -30%). Routes, n=1: home usable 261 ms empty, 267 ms seeded.

## Harness changes

- `perf/run.mjs`: the `#enter` gate is optional (clicked if present, so `--against` older refs still works). The new "Home usable" line is comparable across the gate removal, and the old "Enter -> Today" line is kept as "Enter (or load) -> Today", which is not comparable across the gate. Build-size detection now finds three.js by content, whatever the chunk is named. `--port <n>` moves both preview servers, because 4318 was held by another session's long-running server.
- `perf/routes.mjs` needed no change: it already treated the gate as optional, and the home tiles didn't change.

## Not done (audit items 6 to 8)

6. `princeton-shield.png` is 61 KB and shown at 24 px on Today. A small SVG or a 48 px PNG would do. Left for the design stage, which may replace it.
7. The storage heal runs on the critical path. Moving it is risky and needs property tests first.
8. Weather is refetched on every Today mount. Today is being redone in Stage 4.

## Open observations

- The A/B shows the Princeton tracker's long tasks at 163 ms against 137 ms seeded (+26 ms, ranges don't overlap), with open time unchanged (263 ms against 262 ms). The chunk is the same size. Not investigated in this stage.
- `mountBackground` and `backgroundPreset` are no longer called. They were kept, not deleted, for the design stage to reuse or drop.
