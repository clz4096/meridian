# Cambridge Stage 4 review fix: load performance

Measured 2026-09-30 on the same Mac as `perf/cambridge-baseline.md`. The machine was busier than for the baseline (load average 3.9 to 6.8, against 2.5), so absolute Lighthouse numbers ran lower for every build, including the unchanged baseline. That is why an A/B against the baseline build, run alternately under the same load, is included.

## What changed

- **Today no longer loads the full catalog.** Today's Math card, the CS card and the tracker's b4/b7 text read `catalogIndex.ts`: a structure-only index (phases, blocks, unlock rules, item titles, question labels), generated at build time by `scripts/cambridge/index-plugin.mjs` from the same JSON and the same builder (`catalogBuild.ts`) the screens use. `catalogIndex.test.ts` pins that the index equals the full catalog's structure and that none of the three modules imports the catalog.
- **The screens that read the full catalog are not idle-prefetched** (path, study item, error log, CS path). They load on open.
- **Today's path modules start after the reading card's chunk settles and the page is idle**, behind their same-size skeletons (CLS stays 0).

| Chunk | Before | After |
|---|---|---|
| Catalog on Today's boot path | `catalog` 40.2 KB gzip | `catalogIndex` 9.9 KB gzip |
| Main JS gzip | 75.8 KB | 76.3 KB (+0.5 KB: `ui/reopen.ts`, the reload-into-screen recovery and deep links) |

## Lighthouse (`npm run perf -- --runs 3 --port 4700 --only load`)

| Run | Load average | Perf | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|
| Baseline (`cambridge-baseline.md`) | 2.45 | 95 | 1,360 ms | 2,814 ms | 4 ms | 0 |
| Stage 4 review, run 1 | 3.42 | 94 | 1,542 ms | 3,062 ms | 34 ms | 0 |
| Stage 4 review, run 2 | 3.46 | 93 | 1,362 ms | 3,219 ms | 30 ms | 0 |
| This fix, run 1 | 3.87 | 94 [93..94] | 1,480 ms | 3,026 ms | 8 ms | 0 |
| This fix, run 2 | 6.75 | 93 [92..96] | 1,845 ms | 3,035 ms | 5 ms | 0 |

TBT is back to baseline (5 to 8 ms against 30 to 34). Total byte weight per Lighthouse: 361 KB before, 284 KB after (baseline 298 KB).

## A/B against the pre-Cambridge baseline (`perf/results/lh-ab.mjs`, alternating runs)

The baseline build (`593e3e4`, extracted with `git archive` into a scratch directory) and this working tree, served side by side.

| Round | Load average | Baseline perf / LCP | This fix perf / LCP |
|---|---|---|---|
| 3 runs each | 3.8 to 4.5 | 92 / 3,316 ms | 93 / 3,029 ms |
| 5 runs each | 4.6 to 4.7 | 93 / 3,053 ms | 92 / 3,248 ms |

Under the same load the two builds are within run noise of each other (one point either way). The Performance >= 95 target was not reached in absolute terms on this machine today; the baseline build itself scored 92 to 93 in the same session.

## Seeded load JS (`node perf/routes.mjs --port 4701`)

| Build | Seeded load JS |
|---|---|
| Baseline | 125.8 KB |
| Stage 4 review | 165.5 KB |
| This fix, index only (before deferring the path cards) | 129.9 KB |
| This fix, final | 86.5 KB |

The final number is lower than the baseline because the routes harness counts what is fetched within about 3.7 s of load: the deferred path modules and the idle prefetch now land partly after that window. The index-only row is the fairer like-for-like figure. Raw: `perf/results/cam-s4-fix-routes.json`.
