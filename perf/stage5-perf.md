# Stage 5 performance margin

Goal: Lighthouse mobile Performance 90 or more with margin. The Stage 5 review measured 89 to 92, with LCP at 3.3 to 3.5 s on `h3.td-read-title` and 87% of it render delay.

Every row is `npm run perf -- --runs 3 --port 4600 --only load` (medians of 3; Lighthouse mobile profile, simulated slow 4G and 4x CPU, off-origin requests aborted), run back to back in one session on the Intel i7-8750H. Each row changes one thing from the row it names.

| Run | Change | Perf | FCP | LCP | TBT | CLS (max) | Main JS gzip | CSS gzip | Kept |
|---|---|---|---|---|---|---|---|---|---|
| Base | Session baseline (review fixes not yet applied) | 91 | 1,657 ms | 3,468 ms | 10 ms | 0 | 73.0 KB | 15.0 KB | n/a |
| B0 | Stage 5 visual fixes (this round) | 92 | 1,810 ms | 3,258 ms | 17 ms | 0 | 73.1 KB | 15.0 KB | yes |
| A | B0 + `papers.ts` imported statically, so the reading renders in the first Preact render | 91 | 1,813 ms | 3,336 ms | 11 ms | 0.018 | 77.2 KB | 15.0 KB | no |
| B | B0 + `<link rel=preload as=font crossorigin>` for both woff2 files | 92 | 1,469 ms | 3,334 ms | 5 ms | 0 | 73.1 KB | 15.0 KB | yes |
| C | B + section prefetch waits until Today's own chunks settle | 92 | 1,359 ms | 3,331 ms | 8 ms | 0 | 73.1 KB | 15.0 KB | no (see D) |
| D | C + no opacity fade-in on the reading and path cards | **96** | 1,359 ms | **2,759 ms** | 9 ms | 0 | 73.1 KB | 15.0 KB | yes |
| D without C | D with the prefetch gate removed | **96** | 1,358 ms | **2,762 ms** | 8 ms | 0 | 73.1 KB | 15.0 KB | yes (final) |
| D + preconnect | `<link rel=preconnect href=https://api.open-meteo.com>` | 96 | 1,360 ms | 2,761 ms | 8 ms | 0 | 73.1 KB | 15.0 KB | no |

Final: **Performance 96, LCP 2.76 s, FCP 1.36 s, TBT 8 ms, CLS 0.** Main JS 73.1 KB gzip, under the 77.9 KB gate.

## What moved LCP

The render delay was not the chunk round trip. Run A put the reading in the first render and LCP did not move, so the lazy import was not the cost.

The cost was the fade. `.td-read` and the path cards animated in from `opacity: 0`, and Chrome does not count an element as painted while it is fully transparent. In the observed trace, the reading title reached the screen at about 180 ms but LCP was stamped at 573 ms, after the weather response and after the idle prefetch had started every lazy chunk. Lighthouse's simulation charges LCP for every request that started before the observed LCP, so those chunks and the forecast call landed on the LCP path. Without the fade, observed LCP is 238 ms and simulated LCP drops by 0.57 s.

The fade carried no information (the skeleton and the card have the same box), so removing it also follows the brief. The weather block keeps its fade; it is not the LCP element.

## Kept

- **Font preload** (B): FCP 1,810 to 1,469 ms. The fonts start with the HTML instead of after the CSS is parsed.
- **No fade on the reading and path cards** (D): LCP 3,334 to 2,759 ms, Performance 92 to 96.

## Reverted

- **Static `papers.ts`** (A): +4.2 KB main JS, no LCP gain, and a 0.018 CLS outlier.
- **Prefetch gate** (C): no change once the fade was gone (D vs D without C).
- **Preconnect to open-meteo**: the harness aborts off-origin requests, so it cannot show a gain there; a real-network Lighthouse run had flagged about 110 ms on the forecast call, which is not on the LCP path anymore. Not kept without a measured win.

## Not tried

- **Splitting the render-blocking CSS** into a Today-critical file and per-view files. Lighthouse now estimates about 300 ms for the one stylesheet, down from 600 to 750 ms, because the fonts no longer queue behind it. The split would move `app.css` rules for six screens into their lazy chunks, and those would then load after `tokens.css` and `primitives.css`, changing the cascade order the D25 aliases rely on. With LCP bound by the main JS and the score at 96, the risk is not worth it in a visual-only stage.

## Also measured

A real-network Lighthouse pass (`perf/results/stage5-fix/lh.mjs`, forecast call not aborted) on build D (prefetch gate still in): Performance 96, LCP 2.76 s, observed LCP 238 ms, LCP element `h3.td-read-title`.
