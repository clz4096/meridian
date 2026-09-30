# After (redesign Stage 6)

Measured 2026-09-29 on the `redesign` working tree (uncommitted, on top of `e7ff8d2`), on the same Mac as `perf/baseline.md` (Intel i7-8750H), after the Stage 6 regression fixes (see the last section). Machine load: the 1-minute load average was 9.9 at the start of the A/B run and 3.4 to 5.1 for the rest; the 5-minute average fell from 8.6 to 4.3 over the session. Another process held the load at 20 to 100 earlier in the session, so no numbers from that window are used here.

Raw data:
- `perf/results/2026-09-29T23-46-40-544Z-e7ff8d2-ab.json` (`npm run perf -- --against e7ff8d2 --port 4810`, n=5, interleaved)
- `perf/results/2026-09-29T23-57-11-408Z-e7ff8d2.json` (`npm run perf -- --port 4820`, n=5)
- `perf/results/routes-after.json` (`node perf/routes.mjs --port 4831`, n=1)
- `perf/results/routes-before-final.json` (baseline, n=1, from the first Stage 6 pass); `perf/results/routes-base-legacy.json` is the same baseline re-run with the new `--legacy` flag
- Logs, reviewer tests and screenshots: `perf/results/stage6/`. `slow3g-before.json` is the slow-network run before the fallback font; `slow3g.json` is after. `trace-todos-1.json` and `trace-todos-2.json` now hold the after traces (the before traces were overwritten; their numbers are quoted below).

## How it was measured

Same methods as `perf/baseline.md`, with three differences:

- **Home usable** is navigation start to Today painted (there is no Enter gate). For the baseline it is still gate-tappable plus Enter to Today, as in Stage 2, so the two compare like with like.
- **Per route, baseline:** `perf/routes.mjs --legacy` sets the baseline's selectors (`button.tile` for home ready, `.today-qbtn` for Todos and Scratchpad, tile labels for the rest). The baseline has no Math, Computer Science or Teach screens.
- **JS heap:** `perf/run.mjs` now reports two numbers. "JS heap" is `performance.memory` right after the tab tour, as before; it includes garbage the collector hasn't reached, so it moves with GC timing. "JS heap after GC" forces two collections first and is what the page retains.

## Scoreboard

| Metric | Before (`e7ff8d2`) | After | Change | Target |
|---|---|---|---|---|
| Home usable, empty (A/B median) | 803 ms | 486 ms | -39% | |
| Home usable, seeded (A/B median) | 1,162 ms | 537 ms [460..1,078] | -54% | |
| Home usable, empty / seeded (routes, n=1) | 646 / 808 ms | 262 / 289 ms | -59% / -64% | |
| Lighthouse LCP (mobile) | 1,676 ms (landing tagline) | 2,759 ms (Today reading title) | different screen | |
| Lab LCP, empty / seeded (routes) | 180 / 212 ms | 512 / 500 ms | different screen | |
| CLS on load (Lighthouse, routes) | 0 | 0 | | |
| CLS on load, slow 3G (`slow3g.mjs`) | | 0.0006 | was 0.017 before the fallback font | |
| Worst route CLS | 0.065 (Scratchpad) | 0.000 | | |
| Worst INP proxy, empty / seeded | 288 / 256 ms (Princeton) | 160 / 152 ms (Princeton) | -44% / -41% | |
| Main JS (gzip) | 100.1 KB | 73.3 KB | -27% | |
| Main CSS (gzip) | 22.2 KB | 15.2 KB | -32% | |
| Lighthouse performance | 99 [98..99] | 96 | -3 | 90 or more: pass |
| Lighthouse accessibility | 84 | 100 | +16 | 95 or more: pass |
| Lighthouse TBT | 87 ms | 7 ms | -92% | |
| Lighthouse FCP | 1,659 ms | 1,358 ms | -18% | |
| JS heap after the tab tour, seeded (after GC) | 7.4 MB | 6.3 MB | -15% | |
| Service worker precache | 34 entries, 1,824.7 KiB | 62 entries, 1,376.2 KiB | -25% | |

Before figures in the Lighthouse and A/B rows come from the interleaved A/B run above, so they differ slightly from `perf/baseline.md` (performance 99, FCP 1,658 ms).

## Bundle (production build)

| Asset | Raw | gzip |
|---|---|---|
| Main JS (1,000-byte KB) | 228.3 KB | 73.3 KB |
| Main CSS | 91.4 KB | 15.2 KB |
| Intro JS (three.js, on demand from Data, not precached) | 533.7 KB | 134.3 KB |
| Princeton tracker, lazy: `StudyTracker` + `algorithms` + `curriculum` + `AlgoOfDay` | 159.8 KB | 57.9 KB |
| Tracker CSS, lazy | 36.2 KB | 5.1 KB |
| Other lazy views (Knowledge 9.5, Workout 6.0, Teach 5.3, Data 5.1, Food 4.9, papers 4.2, Charts 4.1, Math 1.7, Todos 1.4, WGU 1.3, Scratch 1.1, CS 1.0, Icons 0.7 KB gzip) | | 46.3 KB |
| `Styleguide` chunk (JS + CSS), precached | 27.8 KB | 8.9 KB |
| Fonts: Source Sans 3 + Source Code Pro variable woff2, preloaded | 50.8 KB | not compressible |
| `princeton-shield.png` | 61.5 KB | not compressible |
| Question bank (`public/questions/`, fetched when Knowledge opens) | 560 KB on disk, 16 files | |
| Service worker precache | 62 entries, 1,376.2 KiB | |

JS and CSS fetched before the home screen (routes, service worker bypassed, includes the idle prefetch inside the 2.5 s settle window): 175.9 KiB JS + 16.0 KiB CSS empty, 122.9 + 16.0 KiB seeded (baseline 230.6 + 22.5 KiB). The empty and seeded JS differ because the idle prefetch got further in one run than the other.

## Lighthouse (mobile, Today), n=5 median [min..max]

| Metric | Value |
|---|---|
| Performance | 95 [95..96] |
| Accessibility | 100 |
| Best practices | 100 |
| FCP | 1,468 ms [1,357..1,779] |
| LCP | 2,807 ms [2,772..2,910] |
| TBT | 2 ms |
| CLS | 0 |
| TTI | 2,807 ms |

Failing audits: none (baseline: `meta-viewport`, `valid-source-maps`). The A/B run above measured performance 96, FCP 1,358 ms and LCP 2,759 ms for the same build; the plain run's FCP spread (up to 1,779 ms) is load noise.

## Runtime, n=5 median (`npm run perf`)

| Action | Empty | Seeded (90 days, 380 KB) |
|---|---|---|
| Home usable | 548 ms | 434 ms [408..673] |
| Long tasks before Today | 128 ms | 127 ms [119..243] |
| Todos | 64 ms | 99 ms (long tasks 0 ms) |
| Scratchpad | 43 ms | 109 ms |
| Knowledge | 91 ms | 93 ms |
| Princeton Roadmap | 206 ms | 208 ms |
| WGU Roadmap | 124 ms | 126 ms |
| Math | 75 ms | 75 ms |
| Computer Science | 126 ms | 127 ms |
| Learn by Teaching | 58 ms | 77 ms |
| Workout | 88 ms | 92 ms |
| Food & Body | 72 ms | 76 ms |
| Data | 72 ms | 93 ms |
| JS heap, no GC | 8.4 MB | 15.5 MB [15.4..17.5] |
| JS heap after GC | 4.2 MB | 6.3 MB |

## Per route (routes.mjs, n=1)

| Route | Open, empty | INP proxy, empty | Open, seeded | INP proxy, seeded | Before, seeded (open / INP) |
|---|---|---|---|---|---|
| Home usable | 262 ms | | 289 ms | | 808 ms |
| Todos | 113 ms | 64 ms | 129 ms | 88 ms | 148 / 128 ms |
| Scratchpad | 48 ms | 24 ms | 112 ms | 72 ms | 146 / 96 ms |
| WGU | 128 ms | 96 ms | 128 ms | 88 ms | 130 / 96 ms |
| Math | 78 ms | 40 ms | 78 ms | 40 ms | |
| Computer Science | 128 ms | 96 ms | 143 ms | 112 ms | |
| Knowledge | 84 ms | 16 ms | 99 ms | 24 ms | 78 / 64 ms |
| Princeton tracker | 213 ms | 160 ms | 213 ms | 152 ms | 292 / 256 ms |
| Learn by Teaching | 64 ms | 32 ms | 65 ms | 40 ms | |
| Workout | 78 ms | 56 ms | 121 ms | 88 ms | 113 / 80 ms |
| Food & Body | 64 ms | 32 ms | 81 ms | 40 ms | 96 / 80 ms |
| Data | 78 ms | 40 ms | 125 ms | 72 ms | 128 / 80 ms |

- Route CLS is 0.000 on every route. Load CLS is 0.
- No route fetched new JS or CSS: every section is prefetched at idle after Today.
- No page errors in either build.

## Regression check against Stage 2 (`perf/stage2.md`)

| Metric | Stage 2 | Now | Verdict |
|---|---|---|---|
| Main JS (gzip) | 69.9 KB | 73.3 KB | +3.4 KB, under the 77.9 KB gate |
| Main CSS (gzip) | 15.6 KB | 15.2 KB | better |
| Lighthouse performance / accessibility | 95 / 87 | 96 / 100 (A/B), 95 / 100 (plain) | same or better; both targets met |
| Lighthouse LCP | 2,864 ms | 2,759 ms | better |
| Home usable, empty (A/B) | 520 ms | 486 ms | better |
| Home usable, seeded (A/B) | 525 ms | 537 ms [460..1,078]; plain run 434 ms [408..673] | same; 1 of 5 A/B runs still slow (see below) |
| Todos open, seeded (A/B) | 129 ms, long tasks 59 ms | 106 ms, long tasks 0 ms | better (was 204 ms / 161 ms before the fixes) |
| Knowledge open, seeded (A/B) | 80 ms | 110 ms [92..110] | +30 ms, not in the fix list; the plain run measured 93 ms |
| JS heap after the tab tour, seeded | 13.3 MB (no GC) | 15.5 MB no GC; 6.3 MB after GC (baseline 7.4 MB) | no leak: see below |
| Precache | 43 entries, 1,286.7 KiB | 62 entries, 1,376.2 KiB | +89.5 KiB (new sections, fonts, the `Styleguide` chunk) |

## Stage 6 regression fixes

**1. Todos first open.** Before: seeded 204 to 233 ms with 161 to 188 ms of long tasks; the trace showed one 467 ms layout of 542 objects at 4x CPU (60 ms the second time). Cause: the first character on a page that neither Source Sans 3 nor the system UI font covers sends Chrome through the operating system's font fallback, about 500 ms at 4x CPU once per page, whichever glyph triggers it (measured: `＋` first 530 ms, then `✎` 29 ms; reversed, `✎` 507 ms, then `＋` 51 ms). Todos rendered `✎` on every row and a full-width `＋` in the + button. Scratchpad, Food & Body, Workout, Data and the chart toggle used `＋ ⚙ ✕ ↩ ☁ ✦ ⌄` the same way. They are now small inline SVG icons (`src/ui/components/Icons.tsx`), `✕` became `×`, and prose `＋` became `+`. A CDP font scan finds no fallback font on any of those screens. After: first layout 20 ms (second 11 ms). A second cost was in `dueChip`: `toLocaleDateString` built a date formatter per row, 62 to 67 ms for 60 todos; it is hand rolled now, like `groupThousands`, with a test pinning "Sep 5" and "Dec 31". Result: Todos seeded 106 ms, long tasks 0 ms (A/B; baseline 138 ms / 62 ms).

Content glyphs outside the fonts (math notation in the Math path, the weather icon, emoji) still use the fallback where they appear; they are content, not chrome.

**2. JS heap.** No leak. After the seeded tour, the page retains 6.3 MB after a forced GC, against 7.4 MB for the baseline (empty: 4.2 against 5.3 MB). A heap snapshot by constructor shows nothing that grows per tab visit. The 19.0 MB figure was `performance.memory` read straight after a fast tour: parsed and compiled lazy chunks, the question-bank JSON and render garbage the collector had not reached yet. It now reads 15.5 MB [11.9..17.5] because Today allocates less on boot (fix 5), and the harness reports the after-GC number next to it.

**3. Font-swap layout shift.** Added a metric-matched fallback face, `Source Sans 3 Fallback` (`local(Arial)` at 400, `local(Arial Bold)` at 600 and up), in `src/styles/tokens.css`, second in `--font-sans` and in `index.html`'s inline stack. The overrides come from Chrome's own measurements: Source Sans 3 has ascent 1.02 em, descent 0.40 em and no line gap, and its average advance is 0.925 of Arial and 0.889 of Arial Bold. With them the fallback matches vertical metrics exactly and widths within 0.5%. Slow 3G load CLS: 0.017 before, 0.0006 after (a sub-pixel nudge of a small-caps label).

**4. Test suite exit code.** `src/test/setup.ts` replaces `sync.save` on bootstrap's real `sync` object with a local-only success for every test file that imports bootstrap, so the 1 s autosave can't reject with "sync not initialised" after a test ends. `npm run verify` exits 0: 60 files, 866 tests, no unhandled errors.

**5. Seeded home bimodal.** The slow runs are the ones where the harness's two-frame probe lands behind the boot re-renders instead of before them. Each store load at boot (workout, meals, knowledge) bumps `dataRev`, and Today re-rendered in full each time: about 145, 145 and 58 ms at 4x CPU. Inside each render, `hubStats()` normalised and stringified all five stores for the Data tile's "KB" (about 100 ms, its `dataRev` memo never hit during boot) and `localeCompare` built an ICU collator to sort todos (about 50 ms once). The KB count now runs at idle after `dataRev` has been quiet for 1 s (the tile shows "storage" until the first count lands) and the todo sort compares ISO dates directly. Boot long tasks after the first render fell from about 350 ms to about 125 ms. `weekStrength` (about 50 ms per render) still runs per render; memoizing it safely needs a workout-store revision, which doesn't exist. One of five A/B seeded runs was still slow (1,078 ms).

**Tooling.** `perf/routes.mjs --legacy` sets the baseline's selectors, so `node perf/routes.mjs --legacy --dir ../meridian-base` reproduces the baseline run. `perf/run.mjs` adds "JS heap after GC".
