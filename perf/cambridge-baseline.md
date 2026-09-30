# Cambridge run: baseline before any change

Measured 2026-09-30 on `main` @ `593e3e4` (the shipped redesign), same Mac as the earlier runs.
Raw data: `perf/results/2026-09-30T05-35-33-690Z-593e3e4.json` (`npm run perf -- --runs 3`) and `perf/results/cam-routes-before.json` (`node perf/routes.mjs`, n=1). Screenshots: `design/cambridge/before/`.

| Metric | Value |
|---|---|
| Lighthouse mobile Performance | 95 [95..96] |
| Lighthouse mobile Accessibility | 100 |
| FCP | 1,360 ms |
| LCP | 2,814 ms |
| TBT | 4 ms |
| CLS | 0 |
| Home usable, empty / seeded (harness, n=3) | 489 / 700 ms |
| Main JS gzip | 73.3 KB |
| Main CSS gzip | 15.2 KB |
| Tracker (Massey) open, empty (routes, n=1) | 212 ms, INP proxy 152 ms |

The gate for Stage 6 is no regression on these: Performance and Accessibility at least as high (within run noise of 1 point), main JS and CSS within the redesign's 8 KB growth budget, and the tracker screen no slower.
