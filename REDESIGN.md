# Meridian redesign

Branch `redesign`, cut from `main` @ `e7ff8d2`, built 2026-09-29. Nothing is committed: every change is staged for you, and the proposed commits are in `COMMITS.md`.

- **Preview (demo data only):** https://clz4096.github.io/meridian/preview/redesign/
- **Progress page:** https://clz4096.github.io/meridian/preview/redesign/progress/
- **Style guide:** https://clz4096.github.io/meridian/preview/redesign/#/styleguide

## Scoreboard

Measured on the same Mac (Intel i7-8750H). Before and after were interleaved in one session (A/B, n=5) to cancel machine noise. Full tables are in `perf/baseline.md` (before) and `perf/after.md` (after).

| Metric | Before | After | Target |
|---|---|---|---|
| Home usable, seeded (A/B median) | 1,162 ms | 537 ms (-54%) | |
| Home usable, empty (A/B median) | 803 ms | 486 ms (-39%) | |
| Lighthouse mobile Performance | 99 | 96 | 90 or more: pass |
| Lighthouse mobile Accessibility | 84 | 100 | 95 or more: pass |
| Lighthouse TBT | 87 ms | 7 ms | |
| Lighthouse FCP | 1,659 ms | 1,358 ms | |
| Lighthouse LCP | 1,676 ms (landing tagline) | 2,759 ms (Today) | see note |
| Worst INP proxy (seeded) | 256 ms | 152 ms | |
| Worst route CLS | 0.065 | 0.000 | |
| Main JS gzip | 100.1 KB | 73.3 KB (-27%) | |
| Main CSS gzip | 22.2 KB | 15.2 KB (-32%) | |
| three.js at startup | 133.8 KB gzip | 0 | |
| Service worker precache | 1,824.7 KiB | 1,376.2 KiB | |
| Text/background pairs failing AA | not checked | 0 | |

**About LCP.** Before, Lighthouse scored the static landing page, whose tagline paints before any JavaScript runs. Now the first screen is Today, which JavaScript renders, so the numbers measure different screens. The real time to a usable home screen fell by 39 to 54%. A prerendered shell in `index.html` paints Today's frame immediately.

## Screenshots

- `design/before/`: 20 screens, empty and seeded, at 390 x 844.
- `design/after/`: 24 screens, adding the WGU, Math, CS and Teach screens.

The progress page shows them side by side.

## What changed, by stage

### 1. Map and baseline
- `ARCHITECTURE.md` matches the code again: five stores, lazy views, telemetry, teaching, and a routes and bundles map.
- `perf/baseline.md` holds the numbers above.
- `perf/routes.mjs` measures per-route open time, an INP proxy, CLS and bytes, and takes the screenshots. The Stage 1 reviewer found four measurement bugs in it, so the baseline was re-shot from a clean worktree (D7).

### 2. Performance: the top five, each re-measured (`perf/stage2.md`)
1. **Open straight into Today.** three.js (133.8 KB gzip) leaves the startup path. The intro stays available under Data, "Play the intro".
2. **Split every view.** Each non-home screen is its own chunk, prefetched one per idle slot after Today paints.
3. **Stop fetching the whole question bank on Today.** Today needs counts only, which now come from `index.json` (8.3 KB instead of 16 files and about 535 KB). Knowledge loads the bank when it opens.
4. **Non-blocking service worker registration.** A smaller precache.
5. **Remove dead CSS.** 303 rules removed, each checked by hand.

The stage review also found that one failed chunk download broke that screen for the whole session. "Try again" now reloads into the screen (D16).

### 3. Design system
- **Tokens:** `src/styles/tokens.css` holds every token (color, type, spacing, radius, shadow, motion, layout) in one file. `primitives.css` has the shared pieces.
- **Palette:** two variants were built. A, "Cream and Coral", won 6 of 8 stated criteria; B, "Ember", stays on the style guide (D10, `design/palette-decision.md`).
- **Type:** Source Sans 3 and Source Code Pro, OFL, self-hosted, latin subset, 50.8 KB total. They are preloaded, with a metric-matched fallback so the swap doesn't shift layout (D9).
- **Contrast:** `scripts/contrast.mjs` checks every text/background pair in both variants (WCAG AA) and runs as a test, so a regression fails `npm test`.

### 4. Today and the three paths (`docs/redesign-contract.md`)
Today reads from top to bottom:
1. **Date and Brooklyn weather:** current, high/low, rain chance and amount. Open-Meteo, no key, 30-minute cache, and it says so when offline or stale.
2. **Today's reading:** the paper of the week, with its next Keshav pass and a time estimate.
3. **Three path cards:**
   - **WGU:** current course, today's task, and days to Oct 24.
   - **Math:** the current course (Stanford Stats featured) and today's problem or proof.
   - **Computer Science:** the algorithm of the day and the current course.
4. **Your day:** due todos and the quick actions.
5. **Everything else:** Surplus, Overload, Massey Standard, Learn by Teaching, Knowledge, Data.

Each path card opens its full screen. Curriculum lives in one editable data file per path:
- `src/features/wgu/roadmapData.ts`,
- `src/content/math.ts`: courses plus 21 daily problems and proofs, all checked by an independent reviewer,
- `src/content/cs.ts`.

The Massey curriculum reads the same records, so there is one course list. Every block has loading, empty, error and offline states, with tests.

### 5. Restyle of the existing tabs (visual only)
- Every screen is on the new tokens: no raw colors remain, and Princeton orange is retired because it failed contrast (D22).
- One header language, one gutter, and warning colors only for real warnings (D28, D29).
- Body text is 16 px or more, and every input is 16 px or more, so the zoom lock is gone. Every target is 44 px or more.
- The reviewer confirmed behavior is unchanged: the same seeded flows give the same stored state, and Data export matched across 20,163 JSON nodes.
- `BUGS.md` lists 66 bugs found along the way: 64 fixed, 2 open. The biggest, which predates the redesign: Export showed an empty backup box, so Copy copied nothing.

### 6. Verify (`perf/after.md`)
- Both targets are met.
- Offline after first visit, slow 3G with 4x CPU, empty data, and iPhone widths (375, 390, 430 and landscape with insets) all pass.
- Four regressions against Stage 2 were fixed:
  - **Todos first layout:** 467 → 20 ms. Glyphs neither font covered cost about 500 ms of font fallback; they are now inline icons.
  - **Boot re-render cost:** reduced.
  - **Font-swap shift:** 0.017 → 0.0006.
  - **Test suite:** now exits cleanly.

## Decisions

All 33 are in `DECISIONS.md`, with reasons. The ones you'll notice:
- **D1, D6:** the phone preview is a demo build on GitHub Pages instead of a tunnel, as you asked. Publishing it needed your OK, because it pushes to `main`.
- **D2:** the preview uses demo data in isolated storage. It never reads your real data or credentials.
- **D12:** new screens use the new tokens only; old token names survive as aliases (D25).
- **D16:** a failed screen download recovers by reloading into that screen.
- **D32:** two sync bugs are reported, not fixed (below).

## Known issues

1. **Sync (P1, predates the redesign, needs your decision).** Tested against a local mock, never the real cloud:
   - A tick or edit to an existing item on one device never reaches the other.
   - Two devices pushing at the same moment can lose one device's edits.
   The sync code is identical to `main`. This is the open sync-redesign item: the engine owns the stores, or a three-way merge with compare-and-swap on `rev`.
2. **Seeded home usable is sometimes slow.** One run in five reaches about 1.1 s, because the workout grade recomputes on every Today render. A safe cache needs a workout-store change counter.
3. **Knowledge opens about 30 ms slower** (seeded) than at Stage 2, from parsing the question bank there instead of on Today.
4. **The Data tile shows "storage"** for a few seconds until the size count lands.
5. **Paper progress is keyed by title**, so a paper that comes round again in the rotation starts as done.
6. **Open bugs in `BUGS.md`:** the Workout week strip has no visible legend (A19), and full-page screenshots show fixed bars mid-page (a capture artifact, TR-15).
7. **`src/ui/components/SecHero.tsx` is unused.** My `git rm` was blocked; delete it when you commit.
8. **Screenshot size.** `design/before` and `design/after` are about 42 MB of PNGs. `perf/routes.mjs --shots` regenerates them, so drop them from the commit if you prefer.
9. **Leftovers from this run:**
   - Two extra worktrees: `../meridian-base` (baseline build) and `../meridian-pages` (`main`, for the preview). Remove them with `git worktree remove`.
   - Node now lives in `~/.local/node`, because it had disappeared from this Mac (D4).

## Proposed commits

In order, in `COMMITS.md`. Stages share files (for example, `app.css` changed in Stages 2 and 5), so the commits are grouped by concern rather than by stage. Intermediate commits may not build on their own; the full set does (`npm run verify` passes).
