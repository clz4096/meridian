/**
 * Performance benchmarks — Vitest's built-in `bench` (Tinybench under the hood).
 * Run: `npm run bench`. Measures the perf-sensitive data-core + selector paths on
 * a realistic state (the default workout + a filled meal day). Reports mean/hz per
 * op; the whole hot path stays well within one 60fps frame.
 */
import { bench, describe } from 'vitest';
import defaultWorkout from '@/core/data/defaultWorkout.json';
import { selectWorkoutView } from '@/features/workout/workoutSelectors';
import { renderWorkoutHTML, type WorkoutViewOptions } from '@/features/workout/workoutView';
import { selectMealView } from '@/features/meal/mealSelectors';
import { schedule } from '@/features/knowledge/knowledgeSelectors';
import { storageMetrics, normaliseState, roundTrip } from '@/features/data/dataSelectors';
import { mergeStore } from '@/core/sync/mergeStores';
import { pruneTombstones } from '@/core/util';

const DAY = '2026-07-25';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- benchmark fixtures, shapes are exercised by the real tests
const WK = defaultWorkout as any;
const SG = {
  settings: { maintenance: 2200, surplus: 500, proteinTarget: 147 },
  days: { [DAY]: Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, name: 'Meal ' + i, cal: 300, protein: 25 })) },
  tad: {},
} as any;
const state = {
  core: { schedule: {}, entries: [], _del: {} },
  overload: WK,
  surplus: SG,
  csgraph: { mastery: {}, srs: {}, log: [], gymDone: {} },
} as any;
const opts = {
  restSeconds: new Proxy({}, { get: () => ({ warm: 60, top: 180, back: 120 }) }) as WorkoutViewOptions['restSeconds'],
  increments: new Proxy({}, { get: () => 5 }) as WorkoutViewOptions['increments'],
  videoUrl: () => '#',
  bodyweight: { current: 120, goal: 150, toGoal: 30 },
  dateLabel: (d: string) => d,
  isToday: true,
};

describe('data core + selectors', () => {
  bench('selectWorkoutView', () => { selectWorkoutView(WK, DAY, DAY); });
  bench('renderWorkoutHTML', () => { renderWorkoutHTML(selectWorkoutView(WK, DAY, DAY), opts); });
  bench('selectMealView', () => { selectMealView(SG, DAY, DAY); });
  bench('SRS schedule transition', () => { schedule({ due: '2026-01-01', ivl: 10, ease: 2.5, n: 4 }, 4, DAY); });
  bench('normaliseState + metrics', () => { storageMetrics(normaliseState(state)); });
  bench('roundTrip (export + import)', () => { roundTrip(normaliseState(state)); });
  bench('mergeStore (full workout)', () => { mergeStore('overload', WK, WK, true); });
  bench('pruneTombstones (1200)', () => {
    const tombs = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => ['t' + i, Date.now() - i * 1000]));
    pruneTombstones(tombs, Date.now());
  });
});
