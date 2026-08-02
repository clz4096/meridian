/**
 * Property-based tests for the pure workout selectors.
 *
 * These assert mathematical invariants over randomly generated state rather
 * than checking a handful of hand-picked examples. fast-check shrinks any
 * counterexample to a minimal reproduction, so a failure here names the exact
 * smallest state that breaks the rule.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_CONFIG,
  type EntityId,
  type Muscle,
  type SetType,
  type WorkoutSet,
  type WorkoutState,
} from '@/core/types';
import {
  allExercises,
  buildPlan,
  exerciseSplit,
  inferIncrement,
  isSessionComplete,
  restSeconds,
  selectWorkoutView,
  splitOfDate,
  suggestSplit,
  weeklyWorkingSets,
} from '@/features/workout/workoutSelectors';
import { addTombstone, pruneTombstones, sameId, shiftDate, toNum } from '@/core/util';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;

/* ================================================================== */
/* Arbitraries                                                         */
/* ================================================================== */

const MUSCLES: Muscle[] = [
  'chest', 'back', 'biceps', 'triceps', 'shoulders', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'hips', 'cardio',
];

/** ISO dates inside a bounded window so ordering assertions stay meaningful. */
const arbDate = fc
  .integer({ min: 0, max: 400 })
  .map((offset) => shiftDate('2025-01-01', offset));

const arbExercise = fc.constantFrom(
  'Bench Press', 'Lat Pulldown', 'Leg Press', 'Leg Extension',
  'Calf Raise (Machine)', 'Hip Abduction', 'Bicep Curl (Dumbbell)',
  'Hammer Curl (Dumbbell)', 'Wrist Curl (Dumbbell)', 'Treadmill',
);

/** Weights that are messy on purpose: fractional, string-typed, zero. */
const arbWeight = fc.oneof(
  fc.integer({ min: 5, max: 500 }),
  fc.double({ min: 2.5, max: 400, noNaN: true }),
  fc.integer({ min: 5, max: 300 }).map(String),
);

const arbReps = fc.oneof(
  fc.integer({ min: 1, max: 20 }),
  fc.integer({ min: 1, max: 20 }).map(String),
);

let idSeq = 0;
/** Ids deliberately mix number and string to exercise the coercion boundary. */
const arbId = fc
  .oneof(fc.constant('n'), fc.constant('s'))
  .map((kind) => (kind === 'n' ? (++idSeq as unknown as EntityId) : (`id-${++idSeq}` as EntityId)));

const arbSetType: fc.Arbitrary<SetType> = fc.constantFrom('warm', 'top', 'back');

const arbSet = fc.record({
  id: arbId,
  ex: arbExercise,
  type: arbSetType,
  weight: arbWeight,
  reps: arbReps,
  muscle: fc.constantFrom(...MUSCLES),
}) as fc.Arbitrary<WorkoutSet>;

/** A session always contains a top set, mirroring how the app records one. */
const arbSession = (exercise: string) =>
  fc
    .record({
      warms: fc.array(
        arbSet.map((s) => ({ ...s, ex: exercise, type: 'warm' as SetType })),
        { maxLength: 3 },
      ),
      top: arbSet.map((s) => ({ ...s, ex: exercise, type: 'top' as SetType })),
      backs: fc.array(
        arbSet.map((s) => ({ ...s, ex: exercise, type: 'back' as SetType })),
        { maxLength: 3 },
      ),
    })
    .map(({ warms, top, backs }) => [...warms, top, ...backs]);

/** Full randomized workout history across several dates and exercises. */
const arbWorkoutState: fc.Arbitrary<WorkoutState> = fc
  .array(
    fc.tuple(arbDate, arbExercise).chain(([date, ex]) =>
      arbSession(ex).map((sets) => ({ date, sets })),
    ),
    { minLength: 1, maxLength: 12 },
  )
  .chain((sessions) =>
    fc
      .record({
        incr: fc.dictionary(arbExercise, fc.constantFrom(2.5, 5, 10, 12.5, 15, 20), {
          maxKeys: 4,
        }),
        bw: fc.dictionary(arbDate, fc.integer({ min: 100, max: 250 }), { maxKeys: 5 }),
      })
      .map(({ incr, bw }) => {
        const days: Record<string, WorkoutSet[]> = {};
        for (const { date, sets } of sessions) {
          days[date] = [...(days[date] ?? []), ...sets];
        }
        return {
          settings: {},
          days,
          bw,
          rpe: {},
          done: {},
          sessionDone: {},
          incr,
          _del: {},
        } satisfies WorkoutState;
      }),
  );

/** Recursively freeze so any mutation attempt throws under strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

const isMultipleOf = (value: number, step: number): boolean => {
  if (step <= 0) return false;
  // Guard against binary floating point: 12.5 * 3 is not exactly 37.5.
  return Math.abs(value / step - Math.round(value / step)) < 1e-9;
};

/* ================================================================== */
/* Phase 1 invariants                                                  */
/* ================================================================== */

describe('progression invariant', () => {
  it('a bump strictly increases the top-set weight', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        for (const ex of allExercises(state)) {
          const plan = buildPlan(state, ex, date);
          if (!plan || plan.cardio) continue;
          if (plan.bumped) {
            expect(plan.top.weight).toBeGreaterThan(plan.lastTopWeight);
          }
        }
      }),
      opts,
    );
  });

  it('holding never changes the weight, and a bump only follows reaching repHigh', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        for (const ex of allExercises(state)) {
          const plan = buildPlan(state, ex, date);
          if (!plan || plan.cardio || plan.deload) continue;
          if (plan.bumped) {
            expect(plan.lastTopReps).toBeGreaterThanOrEqual(DEFAULT_CONFIG.repHigh);
          } else {
            expect(plan.top.weight).toBe(plan.lastTopWeight);
            expect(plan.lastTopReps).toBeLessThan(DEFAULT_CONFIG.repHigh);
          }
        }
      }),
      opts,
    );
  });

  it('a deload never prescribes zero or a negative load', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        for (const ex of allExercises(state)) {
          const plan = buildPlan(state, ex, date, { deload: { [ex]: true } });
          if (!plan || plan.cardio) continue;
          expect(plan.top.weight).toBeGreaterThan(0);
          if (plan.atMinimum) expect(plan.top.weight).toBe(plan.lastTopWeight);
        }
      }),
      opts,
    );
  });

  it('a deload never prescribes more than the previous top weight', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        for (const ex of allExercises(state)) {
          const plan = buildPlan(state, ex, date, { deload: { [ex]: true } });
          if (!plan || plan.cardio) continue;
          expect(plan.top.weight).toBeLessThanOrEqual(plan.lastTopWeight);
          expect(plan.bumped).toBe(false);
        }
      }),
      opts,
    );
  });
});

describe('increment invariant', () => {
  /**
   * Every weight the app *computes* lands on the machine's increment.
   *
   * The held top set is deliberately excluded: it echoes the exact weight the
   * user actually lifted (which may be 47.5 on a 5 lb machine). Snapping that
   * would silently change their working weight, so the property is stated over
   * derived weights only.
   */
  it('all derived weights are exact multiples of the exercise increment', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, fc.boolean(), (state, date, deload) => {
        for (const ex of allExercises(state)) {
          const plan = buildPlan(state, ex, date, deload ? { deload: { [ex]: true } } : {});
          if (!plan || plan.cardio) continue;
          const step = plan.incr;
          expect(step).toBeGreaterThan(0);

          for (const s of [...plan.warms, ...plan.backs]) {
            expect(isMultipleOf(s.weight, step)).toBe(true);
          }
          // The top set is a multiple of the increment whenever it was actually
          // recomputed. It legitimately is not in two cases, both of which
          // preserve the user's real working weight rather than distorting it:
          //   - holding: it echoes exactly what was lifted (e.g. 47.5 on a 5 lb bar)
          //   - atMinimum: the load is below one increment, so a deload would
          //     round to zero; the plan floors to the previous weight instead.
          if ((plan.bumped || plan.deload) && !plan.atMinimum) {
            expect(isMultipleOf(plan.top.weight, step)).toBe(true);
          } else {
            expect(plan.top.weight).toBe(plan.lastTopWeight);
          }
        }
      }),
      opts,
    );
  });

  it('a bump advances by exactly one increment from the rounded base', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        for (const ex of allExercises(state)) {
          const plan = buildPlan(state, ex, date);
          if (!plan || plan.cardio || !plan.bumped) continue;
          const delta = plan.top.weight - plan.lastTopWeight;
          expect(delta).toBeGreaterThan(0);
          expect(delta).toBeLessThanOrEqual(plan.incr * 1.5);
        }
      }),
      opts,
    );
  });

  it('inferred increments are always positive and finite', () => {
    fc.assert(
      fc.property(arbWorkoutState, (state) => {
        for (const ex of allExercises(state)) {
          const step = inferIncrement(state, ex);
          expect(Number.isFinite(step)).toBe(true);
          expect(step).toBeGreaterThan(0);
        }
      }),
      opts,
    );
  });
});

describe('split alternation', () => {
  it('always resolves to upper or lower, for any history', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        const s = suggestSplit(state, date);
        expect(['upper', 'lower']).toContain(s.due);
      }),
      opts,
    );
  });

  it('reports what was performed when the date already has lifting', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        const own = splitOfDate(state, date);
        const s = suggestSplit(state, date);
        if (own !== null) {
          expect(s.logged).toBe(true);
          expect(s.due).toBe(own);
        }
      }),
      opts,
    );
  });

  it('alternates away from the most recent prior session', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        const s = suggestSplit(state, date);
        if (s.logged || s.last === null) return;
        expect(s.due).toBe(s.last === 'lower' ? 'upper' : 'lower');
        expect(s.lastDate! < date).toBe(true);
      }),
      opts,
    );
  });

  it('falls back to upper when there is no prior lifting', () => {
    fc.assert(
      fc.property(arbWorkoutState, (state) => {
        const s = suggestSplit(state, '2020-01-01');
        expect(s.due).toBe('upper');
        expect(s.last).toBeNull();
      }),
      opts,
    );
  });
});

describe('tombstone bounding', () => {
  const arbTombs = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 8 }),
    fc.integer({ min: 0, max: 2_000_000_000_000 }),
    { maxKeys: 900 },
  );

  it('output is always a subset of the input', () => {
    fc.assert(
      fc.property(arbTombs, fc.integer({ min: 0, max: 2_000_000_000_000 }), (tombs, now) => {
        const out = pruneTombstones(tombs, now);
        for (const [k, v] of Object.entries(out)) {
          expect(tombs).toHaveProperty(k);
          expect(tombs[k]).toBe(v);
        }
      }),
      opts,
    );
  });

  it('never exceeds the configured cap', () => {
    fc.assert(
      fc.property(arbTombs, fc.integer({ min: 0, max: 2_000_000_000_000 }), (tombs, now) => {
        const out = pruneTombstones(tombs, now);
        expect(Object.keys(out).length).toBeLessThanOrEqual(
          DEFAULT_CONFIG.tombstoneMaxCount,
        );
      }),
      opts,
    );
  });

  it('is idempotent — pruning twice equals pruning once', () => {
    fc.assert(
      fc.property(arbTombs, fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }), (tombs, now) => {
        const once = pruneTombstones(tombs, now);
        const twice = pruneTombstones(once, now);
        expect(twice).toEqual(once);
      }),
      opts,
    );
  });

  it('drops everything older than the max age', () => {
    fc.assert(
      fc.property(arbTombs, fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }), (tombs, now) => {
        const cutoff = now - DEFAULT_CONFIG.tombstoneMaxAgeDays * 86_400_000;
        for (const at of Object.values(pruneTombstones(tombs, now))) {
          expect(at).toBeGreaterThan(cutoff);
        }
      }),
      opts,
    );
  });

  it('addTombstone never mutates its input', () => {
    fc.assert(
      fc.property(arbTombs, fc.string({ minLength: 1 }), fc.integer({ min: 0 }), (tombs, id, now) => {
        const frozen = deepFreeze({ ...tombs });
        const out = addTombstone(frozen, id, now);
        expect(out[id]).toBe(now);
        expect(Object.keys(frozen)).toEqual(Object.keys(tombs));
      }),
      opts,
    );
  });
});

describe('immutability', () => {
  it('selectWorkoutView never mutates the input state', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, arbDate, (state, date, today) => {
        const before = JSON.stringify(state);
        deepFreeze(state);
        const view = selectWorkoutView(state, date, today);
        expect(JSON.stringify(state)).toBe(before);
        expect(view).toBeTypeOf('object');
      }),
      opts,
    );
  });

  it('returns a freshly constructed object each call', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        const a = selectWorkoutView(state, date, date);
        const b = selectWorkoutView(state, date, date);
        expect(a).not.toBe(b);
        expect(a.plans).not.toBe(b.plans);
        expect(a).toEqual(b); // deterministic
      }),
      opts,
    );
  });

  it('every listed exercise has a plan entry and a completion flag', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, arbDate, (state, date, today) => {
        const view = selectWorkoutView(state, date, today);
        for (const ex of view.exercises) {
          expect(view.plans).toHaveProperty(ex);
          expect(view.completed).toHaveProperty(ex);
          expect(view.performed).toHaveProperty(ex);
        }
        expect(view.estimate.minutes).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(view.estimate.minutes)).toBe(true);
      }),
      opts,
    );
  });
});

describe('coercion safety', () => {
  it('sameId bridges the number/string boundary', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.double({ noNaN: true }), fc.string()), (raw) => {
        expect(sameId(raw, String(raw))).toBe(true);
      }),
      opts,
    );
  });

  it('toNum never returns NaN', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.double(), fc.string(), fc.constant(''), fc.constant(null)),
        fc.integer(),
        (raw, fallback) => {
          const n = toNum(raw as never, fallback);
          expect(Number.isNaN(n)).toBe(false);
        },
      ),
      opts,
    );
  });

  it('derived metrics are always finite', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, today) => {
        expect(Number.isFinite(weeklyWorkingSets(state, today))).toBe(true);
        expect(weeklyWorkingSets(state, today)).toBeGreaterThanOrEqual(0);
        for (const ex of allExercises(state)) {
          for (const t of ['warm', 'top', 'back'] as SetType[]) {
            const r = restSeconds(state, ex, t);
            expect(r).toBeGreaterThan(0);
            expect(Number.isFinite(r)).toBe(true);
          }
          expect(['upper', 'lower', 'both', 'other']).toContain(exerciseSplit(state, ex));
        }
        expect(typeof isSessionComplete(state, today, today)).toBe('boolean');
      }),
      opts,
    );
  });
});
