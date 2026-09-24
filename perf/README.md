# Performance harness

`npm run perf` builds the app, serves the production bundle locally, and measures it in headless Chrome. Every request to another origin is blocked, so nothing leaves the machine.

| Command | Measures |
|---|---|
| `npm run perf` | Build sizes, Lighthouse (mobile profile), and per-tab open time on empty and seeded data |
| `npm run perf -- --only runtime` | Per-tab open time only |
| `npm run perf -- --only resources` | Renderer process CPU and memory against the limits in `src/core/resourceBudgets.json` |
| `npm run perf -- --only resources --check` | Same, and exits 1 if any limit is exceeded |
| `npm run perf -- --against <ref>` | A/B: alternates runs of `<ref>` and the working tree |

Use `--against` to judge a change. Background load on a laptop moves timings by up to 3x between separate runs, so two separate runs compare noise. Alternating runs puts both builds under the same conditions. With 5 runs each, a result counts as clear when every new run beats every old one (rank test, p ≈ 0.008).

Results go to `perf/results/`, which is gitignored.

## Resource limits

The limits live in `src/core/resourceBudgets.json`. The in-app Performance & health panel reads the same file.

| Limit | Value | Where it's measured |
|---|---|---|
| Idle CPU | ≤ 5% of one core | Harness: 10 s idle on Today, then 10 s idle on Workout |
| Idle main-thread busy | ≤ 2% | Harness |
| Main-thread busy while switching tabs | ≤ 25% | Harness; the app records it per minute |
| Longest freeze while switching tabs | ≤ 200 ms | Harness |
| JS memory, with 1 year of data | ≤ 50 MB | Harness; the app records it where the browser exposes it (Chromium) |
| Page elements | ≤ 3,000 | Harness (peak across tabs); the app records it per minute |
| Renderer process memory (desktop Chrome) | ≤ 500 MB | Harness |

## Measuring on iPhone

Safari gives a web page no way to read its own process CPU or memory. The in-app panel therefore records only what a page can observe: main-thread busy time, estimated from how late a 250 ms heartbeat fires, and the page element count.

To measure the iPhone process itself:

1. On the iPhone, turn on **Settings → Apps → Safari → Advanced → Web Inspector**.
2. Connect the iPhone to a Mac with a cable, and open Meridian from the home screen.
3. On the Mac, open Safari, then choose **Develop → [your iPhone] → Meridian**.
4. In Web Inspector, open **Timelines**, turn on the **CPU** and **Memory** instruments, and record:
   - 30 s idle on Today
   - 30 s switching tabs
5. Compare against the limits above. There is no iPhone process-memory limit yet: record the first measurement, then set one.
