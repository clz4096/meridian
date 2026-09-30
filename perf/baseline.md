# Baseline (redesign Stage 1)

Measured 2026-09-29 on `main` @ `e7ff8d2`, on this Mac (Intel i7-8750H). Every later stage compares against these numbers. The 09-24 figures in the old checkpoint were taken on a different machine and are not comparable.

Raw data:
- `perf/results/2026-09-29T18-07-34-963Z-e7ff8d2.json` (`npm run perf`, n=5)
- `perf/results/routes-before.json` (`node perf/routes.mjs`, n=1)

Screenshots: `design/before/` (390 x 844, empty and seeded, every screen).

## How it was measured

- **Lighthouse:** `npm run perf`. Default mobile profile (4x CPU, simulated slow 4G), n=5, median. Lighthouse runs don't block off-origin requests; the runtime runs do.
  - Lighthouse only sees the landing screen, because the app is gated behind Enter. Its LCP element is the landing tagline, not Today (from the full Lighthouse report; the summary JSON does not store it).
- **Runtime:** also from `npm run perf`. Headless Chrome at 390 x 844 with 4x CPU throttle. Each figure is the time from the click until two animation frames after the screen appears.
- **Per route:** `node perf/routes.mjs --dir ../meridian-base` (a clean worktree of `e7ff8d2`). Same viewport, device scale and CPU throttle as the runtime runs, service worker bypassed, n=1. Open time runs from the tap's event timestamp to two frames after the screen appears. It records:
  - "Home usable": time to the Enter button being tappable, plus Enter to Today on screen.
  - INP proxy: the longest Event Timing duration of the real tap that opens the route.
  - CLS added during the route.
  - JS and CSS bytes first fetched by the route.

## Bundle (production build)

| Asset | Raw | gzip |
|---|---|---|
| Main JS (whole app except the tracker; sizes in this table are 1,000-byte KB) | 312.3 KB | 100.1 KB |
| Landing JS (three.js, loaded before Enter) | 532.4 KB | 133.8 KB |
| Main CSS | 121.5 KB | 22.2 KB |
| Tracker JS (lazy, prefetched at idle) | 169.2 KB | 58.2 KB |
| Tracker CSS (lazy) | 35.4 KB | 5.8 KB |
| `princeton-shield.png` (shown at 24 px on Today) | 61.5 KB | not compressible |
| Question bank (`public/questions/`, fetched on Today) | 552 KB on disk | |
| Service worker precache | 34 entries, 1,824.7 KiB | |

Asset sizes not in the raw JSON (shield PNG, question bank folder, precache total) come from `ls -l dist/assets`, `du -sh public/questions`, and the vite-plugin-pwa build log on the same commit.

## Lighthouse (mobile, landing screen), n=5 median [min..max]

| Metric | Value |
|---|---|
| Performance | 99 [48..99] |
| Accessibility | 84 |
| Best practices | 100 [100..100] |
| FCP | 1,658 ms |
| LCP | 1,683 ms |
| TBT | 91 ms |
| CLS | 0 |
| TTI | 2,938 ms |

Failing audits: `meta-viewport` (`maximum-scale=1`), `valid-source-maps`.

## Runtime, n=5 median

| Action | Empty | Seeded (90 days, 380 KB) |
|---|---|---|
| Enter to Today | 622 ms | 818 ms |
| Long tasks during Enter | 439 ms | 580 ms |
| Todos | 106 ms | 172 ms |
| Scratchpad | 55 ms | 178 ms |
| Knowledge | 78 ms | 78 ms |
| Princeton Roadmap | 379 ms | 393 ms |
| WGU Roadmap | 162 ms | 145 ms |
| Workout | 129 ms | 144 ms |
| Food & Body | 80 ms | 112 ms |
| Data | 110 ms | 129 ms |
| JS heap | 9.2 MB | 10.7 MB |

## Per route (routes.mjs, n=1, re-shot after review)

| Route | Open, empty | INP proxy, empty | Open, seeded | INP proxy, seeded |
|---|---|---|---|---|
| Home usable (gate + Enter) | 701 ms | | 858 ms | |
| Todos | 99 ms | 96 ms | 163 ms | 144 ms |
| Scratchpad | 61 ms | 24 ms | 135 ms | 80 ms |
| Knowledge | 78 ms | 40 ms | 62 ms | 48 ms |
| Princeton Roadmap | 312 ms | 264 ms | 265 ms | 232 ms |
| WGU Roadmap | 131 ms | 96 ms | 128 ms | 96 ms |
| Workout | 97 ms | 80 ms | 128 ms | 96 ms |
| Food & Body | 79 ms | 64 ms | 113 ms | 88 ms |
| Data | 130 ms | 64 ms | 113 ms | 64 ms |

- Route CLS (every shift in the transition window) is 0 on every route except Scratchpad empty (0.065). Load CLS is 0.
- No route fetched new JS or CSS: the tracker chunk is prefetched at idle within the first 2.5 s after Enter.
- JS and CSS fetched before the home screen: 230.6 KiB JS + 22.5 KiB CSS transfer (1 KiB = 1,024 bytes), with the service worker bypassed.
- n=1, so single routes are noisy. The Princeton Roadmap cost (about 250 to 300 ms) is consistent across every run.
- "Empty" means no seeded state. The app still ships a built-in workout template (`src/core/data/defaultWorkout.json`), so Workout and Data show that template's sets.
