# Cambridge run: after (Stage 6)

Measured 2026-09-30 on branch `cambridge` (working tree over `593e3e4`), same Mac as `perf/cambridge-baseline.md`.
Raw data: `perf/results/2026-09-30T08-29-39-025Z-593e3e4.json` (`npm run perf -- --runs 3 --only load`, load average 4.0 to 3.7), and the interleaved A/B runs against `main` (n=5 each): `perf/results/2026-09-30T08-22-43-981Z-593e3e4-ab.json` (A/B 1, load average 9.3 to 4.1) and `perf/results/2026-09-30T08-53-27-693Z-593e3e4-ab.json` (A/B 2, load average 3.1 to 5.0). Logs: `perf/results/cam-s6/`.

| Metric | Value |
|---|---|
| Lighthouse mobile Performance (absolute, n=3) | 94 [94..96] |
| Lighthouse mobile Accessibility | 100 |
| FCP (absolute) | 1,365 ms |
| LCP (absolute) | 3,031 ms |
| TBT (absolute) | 8 ms |
| CLS | 0 |
| Lighthouse Performance, A/B 1: cambridge / main | 92 [91..94] / 94 [92..95] |
| Lighthouse Performance, A/B 2: cambridge / main | 93 [92..94] / 93 [92..94] |
| LCP, A/B 1: cambridge / main | 3,258 / 2,866 ms |
| LCP, A/B 2: cambridge / main | 3,069 / 3,109 ms |
| Home usable, empty / seeded (A/B 2, n=5): cambridge | 682 / 777 ms |
| Home usable, empty / seeded (A/B 2, n=5): main | 562 / 703 ms |
| Main JS gzip | 76.1 KB (main 73.3 KB, +2.8 KB) |
| Main CSS gzip | 17.4 KB (main 15.2 KB, +2.2 KB) |
| Tracker open, empty (A/B 2, n=5): cambridge / main | 270 / 275 ms |
| Math path open, empty (A/B 2): cambridge / main | 175 / 130 ms |
| CS path open, empty (A/B 2): cambridge / main | 261 / 197 ms |
| JS heap, empty (A/B 2): cambridge / main | 10.2 / 7.6 MB |

| Lazy chunk | gzip |
|---|---|
| CambridgePath (js + css) | 4.1 + 1.3 KB |
| StudyItem | 7.5 KB |
| WriteupPreview (KaTeX, js + css) | 78.7 + 8.0 KB |
| ErrorLog (js + css) | 3.8 + 0.8 KB |
| Glossary (js + css) + glossary data | 1.2 + 0.6 + 2.4 KB |
| catalog (full) / catalogIndex (Today) | 39.5 / 9.8 KB |
| todayCard + schedule | 1.1 + 2.6 KB |
| photos | 1.4 KB |
| migration | 1.4 KB |

## Stage 6 fix round

Measured 2026-09-30, same Mac. Final A/B against `main` (n=5, interleaved): `perf/results/2026-09-30T09-42-33-148Z-593e3e4-ab.json`, load average 11.5 falling to 4.2 over the run (log `perf/results/cam-s6/perf-fix-ab3.log`). Before: A/B 2 above. Routes: `perf/results/cam-s6/routes-fix.json`. Probes: `perf/results/cam-s6/track-probe.mjs`, `open-trace.mjs`, `heap-probe.mjs`, `skel-probe.mjs`, `sub16-fix.log`.

What changed:
- **The catalog is split per track.** The Vite plugin (`scripts/cambridge/index-plugin.mjs`) now emits the built tracks as `virtual:cambridge-track/step`, `/courses` and `/cst`, one lazy chunk each, beside the index. `catalog.ts` loads only what a screen shows (`loadPath('math')` is step and courses, `loadPath('cst')` is cst, `loadItem(id)` is the item's track); nothing is built at runtime, and the raw JSON (past papers, Part IB notes, schema fields) no longer ships. Listing a path whose tracks have not loaded throws, so a missed load fails loudly. The error log reads titles from the index and loads no track.
- **Path screens are prefetched again; tracks are not.** The two path chunks are now small, so they join the idle prefetch like every other section (main does the same). The track chunks load when a path opens, behind the existing same-size skeleton.
- **The CS path draws the CST track after the rest has painted and gone idle.** The track starts about 5,700 px down (below the paper of the week) and doubles the pane's DOM (355 nodes vs 166 on main). A CPU profile showed the gap to main was Preact creating that DOM, not the chunk (it evaluates in 1.5 ms).
- The Cambridge path skeleton gained the tools row, and `<Gloss>` remounts instead of reusing the plain text node. Chrome had counted the reused text node as a 0.0024 shift. Math open CLS is now 0.

| Metric (A/B, n=5) | Before (A/B 2): cambridge / main | After: cambridge / main |
|---|---|---|
| Math path open, empty | 175 [162..194] / 130 [92..172] ms | 77 [75..92] / 77 [73..89] ms |
| Math path open, seeded | 148 [130..255] / 110 [102..122] ms | 77 [76..93] / 75 [72..89] ms |
| CS path open, empty | 261 [256..405] / 197 [159..249] ms | 137 [122..141] / 127 [122..129] ms |
| CS path open, seeded | 259 [208..287] / 160 [156..233] ms | 138 [138..140] / 127 [122..128] ms |
| Home usable, empty | 682 / 562 ms | 437 / 496 ms |
| JS heap after GC, empty | 5.3 / 4.2 MB | 5.1 / 4.2 MB |
| Lighthouse Performance | 93 / 93 | 94 / 96 |
| LCP | 3,069 / 3,109 ms | 2,991 / 2,809 ms |

| Chunk (gzip) | Before | After |
|---|---|---|
| Catalog on the Math path | 39.5 KB (all three tracks) | 7.7 KB step + 2.3 KB courses + 2.1 KB loader |
| Catalog on the CS path | 39.5 KB | 15.6 KB cst + 2.1 KB loader |
| catalogIndex (Today) | 9.8 KB | 10.3 KB |

Time until the catalog content is on screen, not only the pane (`track-probe.mjs`, empty, 390x844, 4x CPU, n=5, cambridge only): at the start of this round the CS pane took 259 ms and the full CST track 363 ms. After: pane 184 ms, full track 242 ms. On the Math path (opened after CS) the pane takes 54 ms and the phase map 92 ms.

Notes:
- CS stays about 10 ms behind main: the ranges overlap on the empty profile, but seeded is rank-clear by 11 ms (138 [138..140] vs 127 [122..128]). The residual is the skeleton and the extra CST content that main does not have. Held on its skeleton in an experiment, the CS path opened in 176 to 186 ms against main's 175 (`perf/results/2026-09-30T09-32-48-547Z-593e3e4.json`, runtime only, n=3).
- The Lighthouse and LCP rows swung the other way from A/B 2 (93 / 93 and 3,069 / 3,109 ms) without a change to the load path; the run started at load average 11.5.
- Heap: the live heap on Today alone is about 0.25 MB over main (the index and card modules), and about 0.45 MB more after visiting both paths (the track data, which the module cache holds for the page's life). The old catalog's second copy, the raw JSON, is gone. The rest of the +0.9 MB is outside the Cambridge code.
- Two single-run stalls of about 15 s (Math and Scratchpad, no long tasks) appeared in a runtime-only run and in one probe, never in the n=5 A/B runs. Scratchpad has no Cambridge code, so these look like a headless-Chrome frame stall in the harness.
- Every section open shifts its content 8 px when the shell's `body:not(.at-home) .tabpane` padding applies a moment after the first render. This is outside the Cambridge code and main does the same.

## Final LCP fix

Measured 2026-09-30, same Mac. Before: `perf/results/2026-09-30T09-42-33-148Z-593e3e4-ab.json` (the Stage 6 A/B above). After: two A/B runs against `main` (n=5, interleaved, `--port 4417`), `perf/results/2026-09-30T10-23-04-212Z-593e3e4-ab.json` (load average 18.7 falling to 5.8, log `perf/results/cam-lcp/ab1.log`) and `perf/results/2026-09-30T10-29-53-675Z-593e3e4-ab.json` (4.6 to 5.1, `ab2.log`). Probes: `perf/results/cam-lcp/lcp-probe.mjs` (Lighthouse, lists the requests that end before the observed LCP) and `lcp-trace.mjs` (4x CPU, LCP entries, DOM insert and frame times).

What Lighthouse measures: its simulated LCP replays every request that finished before the observed LCP paint, plus the main-thread work before it, under slow 4G and 4x CPU. A request that ends before the reading title reaches the screen adds to LCP even when nothing on screen needs it. On a fresh profile the Cambridge build had two sources of such work:
- **The path cards' modules.** Today already started them after the reading chunk settled and the page went idle, but at startup a frame can reach the screen hundreds of ms after its rAF, so the idle slot came first. `todayCard`, `schedule`, `method`, `catalogIndex` (10.8 KB), `cs`, `wgu` and `algorithms` (28.6 KB) all finished before the LCP paint.
- **The first-run re-render waited for the Massey backup.** Boot held `bump()` until the backup's IndexedDB writes finished, so on a fresh profile Today's re-render with the loaded stores (and its layout) landed next to the LCP paint instead of well before it. Runs where the backup finished early estimated about 3,200 ms; runs where it finished late, about 2,870 ms.

What changed:
- `boot()` publishes the loaded stores (tracker projection, `bump()`, save chip) before it waits for the backup. Only the tracker's day rollover, the first write to a Massey key, still waits for the backup on a device's first run. `cambridgeReady` and the Cambridge screens' gate are unchanged.
- Today's path modules start after the browser reports the reading title as a largest-contentful-paint entry (`afterLargestPaint` in `src/core/telemetry.ts`), then an idle slot. It falls back to the next painted frame where there are no LCP entries (Safari) or after the first input, and to a 1.5 s timer when the title never becomes the largest paint (a wide screen, an error state).
- Tests: `src/app/bootstrap.test.tsx` holds the backup open and checks that Today shows the loaded core data, that the tracker store is not rolled over (in memory or in localStorage) and `cambridgeReady` is pending, then releases it and checks the rollover and the marker. It fails against the old ordering. `src/core/telemetry.lcp.test.tsx` covers the helper.

| Metric (A/B, n=5) | Before: cambridge / main | After, run 1: cambridge / main | After, run 2: cambridge / main |
|---|---|---|---|
| LCP | 2,991 [2,931..3,033] / 2,809 [2,802..2,863] ms | 2,990 [2,941..3,028] / 3,173 [2,849..3,333] ms | 2,994 [2,416..3,281] / 3,185 [3,097..3,350] ms |
| Lighthouse Performance | 94..95 / 95..96 | 94 [94..94] / 92 [91..95] | 94 [92..97] / 92 [91..93] |
| FCP | 1,362 / 1,357 ms | 1,554 / 1,778 ms | 1,555 / 1,779 ms |
| TBT | 3 / 4 ms | 9 [8..10] / 4 [3..6] ms | 10 [8..14] / 5 [4..7] ms |
| Home usable, empty | 437 / 496 ms | 804 [446..847] / 569 [472..837] ms | 560 [455..686] / 701 [464..838] ms |

Notes:
- The ranges overlap in both runs, and cambridge's median is lower. Main's LCP moved between 2,809 and 3,185 ms across these runs with no change to it, so the gap is within the noise of this machine; the point of the fix is that nothing Cambridge added finishes before the LCP paint any more (checked with `lcp-probe.mjs`: the requests that end before the LCP paint are now the reading chunk, the icons, the section prefetch that main also runs there, and the 1.8 KB `migration` chunk; none of the path chunks).
- The `migration` chunk still loads before LCP on a first run. It was left there on purpose: starting the backup later would widen the window in which an owner's edit (ticking a paper pass on Today, which writes `meridian.papers.v1`) could reach a Massey key before the backup exists. That window already exists (rendering never waited for the backup) and is not closed by this change.
- The path cards now appear about 150 ms after the reading title on a cold 4x CPU load (`lcp-trace.mjs`), behind their same-size skeletons, so CLS stays 0.
- TBT rose from 3 to about 10 ms (main 4 to 5 ms), most likely because the path modules now evaluate after the LCP paint, inside Lighthouse's TBT window, instead of before it. Lighthouse scores TBT under 200 ms as full marks, so the Performance score does not move.
