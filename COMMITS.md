# Proposed commits (owner runs these)

Everything is staged on branch `redesign`. Run the commits below in order: each one commits only its pathspec out of the staged changes.

The stages touched the same files (`app.css` changed in Stages 2 and 5; `main.tsx` in 2, 3 and 4), so the commits are grouped by concern, not by stage. An intermediate commit may not build on its own; after the last one, `npm run verify` passes (866 tests).

Before you commit:
- `src/ui/components/SecHero.tsx` is unused. Delete it with `git rm src/ui/components/SecHero.tsx` (my `git rm` was blocked) and include it in commit 4.
- `design/before` and `design/after` add about 42 MB of PNGs. `node perf/routes.mjs --shots <dir>` regenerates them, so you can drop them from commit 6 with `git restore --staged design/before design/after`.
- `meridian-checkpoint.md` and `review.md` stay untracked. They are not staged.

## 1. Measurement: map, baseline, harness

```
git commit -m "perf: per-route harness and the pre-redesign baseline" -- ARCHITECTURE.md perf/baseline.md perf/routes.mjs perf/run.mjs perf/README.md
```

Body:
> ARCHITECTURE.md matches the code again (five stores, lazy views, telemetry, teaching, routes and bundles). perf/routes.mjs measures per-route open time, an INP proxy, CLS and bytes, and saves screenshots; `--legacy` measures the old shell. perf/run.mjs follows the new Today. perf/baseline.md records e7ff8d2.

## 2. Design system

```
git commit -m "design: tokens, primitives, fonts, and an AA contrast gate" -- src/styles/tokens.css src/styles/primitives.css src/styles/contrast.test.ts src/assets scripts/contrast.mjs scripts/contrastCore.mjs scripts/contrastCore.d.mts src/features/styleguide design/contrast.md design/palette-decision.md design/token-map.md
```

Body:
> One file of CSS variables for color, type, spacing, radius, shadow, motion and layout. Two palettes: A, "Cream and Coral", is the default; B, "Ember", stays on #/styleguide. Source Sans 3 and Source Code Pro are self-hosted, subset and OFL (50.8 KB), preloaded, with a metric-matched fallback. scripts/contrast.mjs checks every text/background pair in both palettes, and runs as a test.

## 3. Today and the three study paths

```
git commit -m "today: weather, reading, and WGU / Math / CS paths as the home screen" -- src/features/today src/features/paths src/content src/services/weather.ts src/services/weather.test.ts src/features/studytracker/algorithms.ts src/features/studytracker/algorithms.test.ts src/features/studytracker/papers.ts src/features/studytracker/papers.test.ts src/features/studytracker/curriculum.ts src/features/studytracker/curriculum.test.ts src/features/studytracker/curriculum.fixture.json src/features/studytracker/psetOfWeek.test.ts src/features/wgu/roadmapData.ts src/features/wgu/WGURoadmap.tsx src/features/wgu/WGURoadmap.test.tsx src/features/wgu/wgu.css src/core/util.ts src/core/util.test.ts docs/redesign-contract.md
```

Body:
> Today reads top to bottom:
> - date and Brooklyn weather (Open-Meteo, 30-minute cache, honest offline and stale states),
> - the paper of the week with its next Keshav pass,
> - WGU, Math and CS path cards, each with one next action and a progress bar,
> - the day's todos,
> - the other sections.
>
> Each path has one editable content file (roadmapData.ts, content/math.ts, content/cs.ts), and the Massey curriculum reads the same course records. Math has 21 daily problems and proofs with Stanford Stats featured. The algorithm, paper and problem rotations all turn over at local midnight.

## 4. App shell, performance, and the restyle of every tab

```
git commit -m "app: open straight into Today, lazy views, light restyle of every tab" -- index.html vite.config.ts src/app/main.tsx src/ui src/styles/app.css src/landing src/core/storage src/features/data src/features/knowledge src/features/meal src/features/scratch src/features/todos src/features/workout src/features/studytracker src/features/teaching src/test/setup.ts public/questions/index.json scripts/question-index.mjs perf/stage2.md perf/stage5-perf.md perf/after.md BUGS.md
```

Body:
> Home usable is 486 ms (empty) and 537 ms (seeded), from 803 and 1,162 ms (A/B, n=5). Main JS is 100 → 73 KB gzip, CSS 22 → 15 KB. Lighthouse mobile is 96 performance and 100 accessibility, from 99 and 84.
>
> Performance:
> - three.js leaves startup; the intro is under Data, "Play the intro".
> - Every view is a lazy chunk, prefetched at idle; a failed chunk recovers by reloading into its screen.
> - Today reads question counts from index.json.
> - 303 dead CSS rules are removed.
>
> Restyle, visual only:
> - Every tab is on the new tokens, with one header language and one gutter.
> - Text is 16 px or more; the zoom lock is removed.
> - Targets are 44 px or more.
>
> Bugs found on the way are in BUGS.md (64 fixed), including the Export box that stayed empty.

## 5. Demo preview infrastructure

```
git commit -m "preview: demo build with isolated storage and a progress page" -- src/app/demo.ts src/app/demoSeed.ts .env.demo .gitignore scripts/preview.mjs
```

Body:
> `vite build --mode demo` prefixes every localStorage key and IndexedDB name and seeds synthetic data, so the public preview never touches real data or credentials. scripts/preview.mjs builds it plus a static progress page, and `--publish` copies it to main's public/preview/redesign/.

## 6. Redesign record

```
git commit -m "docs: redesign report, decisions, and screenshots" -- REDESIGN.md DECISIONS.md COMMITS.md design/before design/after design/scoreboard.json
```

## Already on `main` (preview only, pushed with your OK)

`cb0e018 sw: keep /preview/ pages out of the app shell and offline cache`, plus the preview files under `public/preview/redesign/`. `main`'s app code is unchanged. When `redesign` merges, commit 4's `vite.config.ts` carries the same service-worker exclusions, so the merge conflict is trivial.
