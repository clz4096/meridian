# Redesign Stage 4 contract: Today and the three study paths

Frozen interface for the Stage 4 agents (Today + weather, WGU path, Math path, CS path). Build against this and don't change it without the orchestrator. Visuals come from the Stage 3 design system (`src/styles/tokens.css`, `/styleguide`); this file covers structure, data, and states only.

## Today, top to bottom

1. **Date and weather** (`src/features/today/WeatherBlock.tsx`)
   - Shows the date and Brooklyn weather: current temperature and condition, today's high and low, and precipitation (max probability and total amount).
   - Shows the last-updated time and an offline marker when the reading is stale.
2. **Today's reading** (`ReadingBlock.tsx`)
   - One item: the paper of the week with its next Keshav pass (1 Triage ~10 min, 2 Grasp ~60 min, 3 Reproduce ~3 h), taken from `paperOfWeek()` and `paperProgress` in `src/features/studytracker/papers.ts`.
   - When all three passes are done, it shows "Done this week" and next week's paper.
   - The time estimate shows as `~10 min`.
3. **Today's studies**: three `PathCard`s in this order: WGU, Math, Computer Science.
   - Each card shows one next action, a progress bar, and the current course.
   - Tapping a card opens that path's full screen.
4. **Your day**: the existing due-todos list and the two quick actions (Add a todo, Capture an idea). They are kept, not deleted.
5. **Navigation**: tiles for every other screen:
   - Surplus (Food & Body, `meal`)
   - Overload (Workout, `workout`)
   - Massey Standard (Princeton tracker, `tracker`)
   - Learn by Teaching (`teach`, new: renders `TeachSection` on its own)
   - Knowledge (`knowledge`)
   - Data (`data`)
   - The WGU Roadmap is reached through the WGU path, so it doesn't need a separate tile.
   - Each tile keeps its at-a-glance stat from `hubStats()`.

The Stage 2 perf work made each non-home view a lazy chunk. Path content that lives in heavy modules (`algorithms.ts`, `papers.ts`, `curriculum.ts` are in the tracker chunk) must load lazily from Today, with a loading state, and be prefetched at idle. Don't pull them into the main chunk: the main-chunk gzip size must not grow by more than 8 KB over the Stage 2 result.

## Routes

- New `Tab` ids in `src/ui/store.ts`: `wgu`, `math`, `cs`, `teach`.
  - `wgu` is the existing `WGURoadmapView` with a "Today" header on top, so `roadmap` stays as an alias of it.
  - `math` and `cs` are new path screens.
  - `teach` is `TeachSection` standalone.
- They are opened with `openSection(tab)`, so history, Back, and telemetry `navStart` and `navEnd` work unchanged.
- Hash routes, handled in `main.tsx` before rendering the app:
  - `#/styleguide` (Stage 3, lazy chunk)
  - `#/progress`, which redirects to `./progress/` (the static page `scripts/preview.mjs` generates)

## Data: one editable content file per path

Content files hold plain data only (typed objects, no logic, no JSX), and components never hardcode curriculum.

| Path | Content file | Holds |
|---|---|---|
| WGU | `src/features/wgu/roadmapData.ts` (existing; stays the single source) | Weeks, courses, dates, `doText`, links |
| Math | `src/content/math.ts` (new) | Ordered course plan and daily problems/proofs (below) |
| CS | `src/content/cs.ts` (new) | Ordered course plan and current-course pointer; the algorithm of the day still comes from `algorithms.ts` |

- **One source for courses:** `src/features/studytracker/curriculum.ts` must stop holding its own copy of these courses. Derive `CURRICULUM` from `content/math.ts` and `content/cs.ts` so the Massey screen and the paths read one list. Keep `CURRICULUM`'s exported shape and order identical; add a test that pins it.
- **Math daily items:** each is `{ id, courseCode, kind: 'proof' | 'problem', prompt, hint?, answer, source }`.
  - Rotate one per day, stable within the day (like `algoOfDay`).
  - The answer is revealed with `GatedReveal` (`src/features/studytracker/GatedReveal.tsx`) after an attempt.
  - Seed at least 14 items. Stanford Intro to Statistics is featured first, because the owner is taking it now for WGU C955: include hypothesis-test, confidence-interval, and regression problems, plus classic proofs from discrete math and calculus.
  - Every answer must be mathematically correct. The reviewer checks each one.

## Path model (`src/features/paths/types.ts`)

```ts
export type PathId = 'wgu' | 'math' | 'cs';
export interface PathSummary {
  id: PathId;
  title: string;                 // 'WGU', 'Math', 'Computer Science'
  course: string;                // current course, e.g. 'C955 · Applied Probability & Statistics'
  next: { label: string; detail?: string; minutes?: number };  // the ONE next action
  progress: { done: number; total: number; caption: string };  // e.g. 3 of 13 courses, 'term ends Oct 24'
}
```

- Each path exposes a pure `summarize(now: Date, state): PathSummary` in `src/features/paths/<id>.ts`, with unit tests using fixed dates. The `state` is whatever checks and progress it needs, passed in rather than read globally.
- **WGU:**
  - Current course: the first not-done course in the week containing today; if all of that week's courses are done, the first not-done course overall.
  - Next action: that course's `doText`.
  - Progress: courses done out of the total, with the caption showing days left to the target date.
- **Math:**
  - Current course: the first not-done Math course in plan order (the featured course first).
  - Next action: today's problem or proof.
  - Progress: Math courses done out of the total.
- **CS:**
  - Current course: the first not-done CS course in plan order.
  - Next action: "Algorithm of the day: <name>", plus its one-liner.
  - Progress: CS courses done out of the total.
- Each path module also exports `currentSummary(now = new Date()): PathSummary`. It reads that path's own live state (signals, stores) and calls `summarize`. This is the only entry point Today uses, always through a dynamic `import()`.
- Each path screen is its own module, exporting a view Today's router lazy-loads:
  - WGU: `WGURoadmapView` in `src/features/wgu/WGURoadmap.tsx` (existing, gains a Today header)
  - Math: `MathPathView` in `src/features/paths/MathPath.tsx`
  - CS: `CSPathView` in `src/features/paths/CSPath.tsx`
- `PathCard` (`src/features/paths/PathCard.tsx`) renders a `PathSummary` and nothing else.
- The course lists are already split: `src/content/math.ts` exports `MATH_COURSES` and `src/content/cs.ts` exports `CS_COURSES`. `curriculum.ts` derives `CURRICULUM` from them, pinned by `curriculum.test.ts`. Course completion is `curriculumChecks` in `curriculum.ts` (Math and CS); WGU completion is `roadmapChecks` in `src/features/wgu/roadmapStore.ts`.

## States (required for every Today block and path card)

| State | When | Shows |
|---|---|---|
| Loading | Lazy content or weather not ready | A skeleton the same size as the content. No layout shift (CLS must stay 0). |
| Empty | No data (e.g., no paper, all courses done) | A one-line message and, if possible, the next step. |
| Error | Fetch or import failed | What failed, plus a Try again button (44 px minimum). |
| Offline | `navigator.onLine === false` or a failed fetch with a cache present | Cached content, a "Saved <time>" note, and no error styling. |

Each state has a test (`@testing-library/preact`).

## Weather (`src/services/weather.ts`)

- **Location:** default to Brooklyn, NY (lat 40.6782, lon -73.9442, America/New_York), with no geolocation prompt. A saved city still overrides it, and geocoded coordinates are cached with it.
- **Request:** one Open-Meteo call:
  - `current=temperature_2m,weather_code`
  - `daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum`
  - `temperature_unit=fahrenheit`, `precipitation_unit=inch`, `timezone=America/New_York`, `forecast_days=1`
- **Caching:** the result goes in localStorage with its fetch time.
  - Fetch only when the cache is older than 30 minutes, the app returns to the foreground with a stale cache, or the user taps refresh.
  - Keep the old `Weather` fields so current callers still compile.
- **Offline:** show the cache with "Updated h:mm a"; with no cache, show the empty state.

## Tests and gates

- `npm run verify` passes.
- Unit tests pin `summarize()` for each path at fixed dates. At least one test per path pins the exact user-facing numbers for a known state, e.g., 2 of 13 courses done gives "2 of 13" and a 15% bar.
- `perf/routes.mjs` ROUTES and HOME_READY are updated to the new Today selectors.
- Home usable and the main-chunk size are reported against Stage 2.
