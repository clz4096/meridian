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
  bandScore,
  buildPlan,
  canonicalSlot,
  dayGrade,
  daysSinceLast,
  e1rm,
  exerciseScore,
  exerciseSplit,
  habitualStaples,
  inferIncrement,
  isCompound,
  isOptional,
  isSessionComplete,
  isStalled,
  repCeiling,
  restSeconds,
  selectWorkoutView,
  sessionEffort,
  splitOfDate,
  STAPLE_WINDOW,
  suggestSplit,
  trainedDaysInWeek,
  weeklyWorkingSets,
  weekGrade,
  weekStrength,
  WEEK_TRAINING_TARGET,
} from '@/features/workout/workoutSelectors';
import defaultWorkoutData from '@/core/data/defaultWorkout.json';
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
          // Layoff plans deload (a break at the ceiling backs off, not bumps), so they are
          // already excluded by the plan.deload guard below alongside stalls and manual deloads.
          if (!plan || plan.cardio || plan.deload) continue;
          if (plan.bumped) {
            expect(plan.lastTopReps).toBeGreaterThanOrEqual(plan.repHigh);
          } else {
            expect(plan.top.weight).toBe(plan.lastTopWeight);
            expect(plan.lastTopReps).toBeLessThan(plan.repHigh);
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

/* ================================================================== */
/* Algorithm: estimated 1RM, class, effort & stalls                    */
/* ================================================================== */

/** Build a minimal WorkoutState from top-set rows (date, exercise, weight, reps, muscle). */
function stateOf(
  rows: Array<{ date: string; ex: string; weight: number; reps: number; muscle?: Muscle; type?: SetType }>,
): WorkoutState {
  const days: Record<string, WorkoutSet[]> = {};
  let n = 0;
  for (const r of rows) {
    (days[r.date] ??= []).push({
      id: ('e' + n++) as EntityId,
      ex: r.ex,
      weight: r.weight,
      reps: r.reps,
      type: r.type ?? 'top',
      muscle: r.muscle,
    });
  }
  return { settings: {}, days, bw: {}, rpe: {}, done: {}, sessionDone: {}, incr: {} };
}
const D = (offset: number) => shiftDate('2025-01-01', offset);

describe('back-off set floor (missing-sets regression)', () => {
  it('a lift keeps its default back-off sets even after top-set-only sessions', () => {
    // Reproduce the bug: several recent sessions with ONLY a top set drive the
    // modal back-off count to 0, which made logSet auto-complete the exercise
    // right after the top set. The baked-in default for this lift prescribes
    // back-offs, so buildPlan must still prescribe them.
    const s = stateOf([
      { date: D(0), ex: 'Bicep Curl (Dumbbell)', weight: 30, reps: 8, muscle: 'biceps' },
      { date: D(3), ex: 'Bicep Curl (Dumbbell)', weight: 30, reps: 8, muscle: 'biceps' },
      { date: D(6), ex: 'Bicep Curl (Dumbbell)', weight: 30, reps: 8, muscle: 'biceps' },
    ]);
    const plan = buildPlan(s, 'Bicep Curl (Dumbbell)', D(9))!;
    expect(plan.backs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Away-mode home substitute', () => {
  // Leg Press (gym machine) → Goblet Squat (dumbbell sub), approved start 30 × 10.
  const away = {
    swap: { 'Leg Press': 'Goblet Squat' },
    start: { 'Goblet Squat': { weight: 30, reps: 10, muscle: 'quads' } },
  };

  it('buildPlan seeds a no-history sub from its approved start weight', () => {
    const s = stateOf([]); // no history at all
    // no away override → nothing to progress from
    expect(buildPlan(s, 'Goblet Squat', D(5))).toBeNull();
    // with the seed → a full first session (top + 3 straight back-offs) at the approved load
    const plan = buildPlan(s, 'Goblet Squat', D(5), { away })!;
    expect(plan).not.toBeNull();
    expect(plan.cardio).toBe(false);
    expect(plan.top).toEqual({ weight: 30, reps: 10 });
    expect(plan.warms).toEqual([]);
    expect(plan.backs).toEqual([
      { weight: 30, reps: 10 },
      { weight: 30, reps: 10 },
      { weight: 30, reps: 10 },
    ]);
    expect(plan.bumped).toBe(false);
    expect(plan.deload).toBe(false);
    expect(plan.lastTopWeight).toBe(30);
    expect(plan.lastTopReps).toBe(10);
    expect(plan.lastDate).toBeNull();
    expect(plan.incr).toBeGreaterThan(0);
  });

  it('once the sub has its own logged history it progresses normally, ignoring the seed', () => {
    // sub already trained at 40 (heavier than the 30 seed) → real history wins
    const s = stateOf([{ date: D(0), ex: 'Goblet Squat', weight: 40, reps: 10, muscle: 'quads' }]);
    const plan = buildPlan(s, 'Goblet Squat', D(3), { away })!;
    expect(plan.lastTopWeight).toBe(40);
    expect(plan.top.weight).toBeGreaterThanOrEqual(40);
  });

  it('selectWorkoutView routes the gym slot to its substitute (plan/performed/completed)', () => {
    const s = stateOf([
      { date: D(0), ex: 'Leg Press', weight: 200, reps: 8, muscle: 'quads' }, // machine history
      { date: D(0), ex: 'Goblet Squat', weight: 35, reps: 10, muscle: 'quads' }, // the sub's prior session
      { date: D(2), ex: 'Goblet Squat', weight: 40, reps: 10, muscle: 'quads' }, // today's sub set
    ]);
    const view = selectWorkoutView(s, D(2), D(2), { split: 'all', away });
    // the list position/slot stays the gym lift…
    expect(view.exercises).toContain('Leg Press');
    // …and the substitute never appears as its own separate card
    expect(view.exercises).not.toContain('Goblet Squat');
    // …but plan + performed for that slot are the substitute's, not the machine's
    expect(view.plans['Leg Press']!.exercise).toBe('Goblet Squat');
    expect(view.plans['Leg Press']!.lastTopWeight).toBe(35); // progresses off the sub's own history, not the machine's 200
    expect(view.performed['Leg Press']!.map((x) => x.ex)).toEqual(['Goblet Squat']);
    expect(view.performed['Leg Press']![0]!.weight).toBe(40);
    // A substitute is floored to its baseline structure (top + 3 back-offs), so one
    // logged top set is NOT the whole prescription — it must not auto-complete at 1
    // (the reported set-erosion bug). Four sets are prescribed.
    expect(view.plans['Leg Press']!.backs.length).toBe(3);
    expect(view.completed['Leg Press']).toBe(false);
  });

  it('a first-time sub seeds its slot even with no sub history, driven off the gym slot', () => {
    const s = stateOf([{ date: D(0), ex: 'Leg Press', weight: 200, reps: 8, muscle: 'quads' }]);
    const view = selectWorkoutView(s, D(2), D(2), { split: 'all', away });
    expect(view.exercises).toContain('Leg Press');
    // no Goblet Squat history yet → seeded starting plan from the approved weight
    expect(view.plans['Leg Press']!.top).toEqual({ weight: 30, reps: 10 });
    expect(view.performed['Leg Press']).toEqual([]);
  });
});

describe('workout bug-bash regressions', () => {
  const away = { swap: { 'Leg Press': 'Goblet Squat' }, start: { 'Goblet Squat': { weight: 30, reps: 10, muscle: 'quads' as Muscle } } };

  it('canonicalSlot maps a substitute back to its gym slot, leaves others alone', () => {
    expect(canonicalSlot('Goblet Squat')).toBe('Leg Press');
    expect(canonicalSlot('Leg Press')).toBe('Leg Press');
    expect(canonicalSlot('Bench Press')).toBe('Bench Press');
  });

  it('C · a substitute with accrued history never leaks into the Gym-mode list', () => {
    // Goblet Squat was trained at home, so it has logged history…
    const s = stateOf([
      { date: D(0), ex: 'Leg Press', weight: 200, reps: 8, muscle: 'quads' },
      { date: D(1), ex: 'Goblet Squat', weight: 35, reps: 10, muscle: 'quads' },
    ]);
    expect(allExercises(s)).toContain('Goblet Squat'); // it IS in the raw roster
    const gym = selectWorkoutView(s, D(3), D(3), { split: 'all' }); // Gym mode: no away override
    expect(gym.exercises).toContain('Leg Press');
    expect(gym.exercises).not.toContain('Goblet Squat'); // …but never shows as its own gym card
  });

  it('B · viewing a PAST gym session in Away mode shows the real logged sets, not an empty sub card', () => {
    const s = stateOf([
      { date: D(0), ex: 'Leg Press', weight: 200, reps: 8, muscle: 'quads' },
      { date: D(3), ex: 'Leg Press', weight: 205, reps: 8, muscle: 'quads' }, // the past gym session
    ]);
    const view = selectWorkoutView(s, D(3), D(6), { split: 'all', away }); // past date, Away toggled ON
    expect(view.isPast).toBe(true);
    expect(view.exercises).toContain('Leg Press');
    expect(view.performed['Leg Press']!.map((x) => x.weight)).toEqual([205]); // real sets, not swapped away
  });

  it('E · a full home lower day satisfies the gym-lift staples (week is not graded Weak)', () => {
    // Establish Leg Press as a lower staple from prior gym sessions, then train lower
    // at home via Goblet Squat inside the 7-day window. The slot is satisfied.
    const rows = [] as Array<{ date: string; ex: string; weight: number; reps: number; muscle?: Muscle }>;
    for (const off of [-10, -8, -6, -4]) rows.push({ date: D(off), ex: 'Leg Press', weight: 200, reps: 8, muscle: 'quads' });
    // home lower days: substitute, hitting a strong session each time
    for (const off of [-2, 0]) rows.push({ date: D(off), ex: 'Goblet Squat', weight: 45, reps: 12, muscle: 'quads' });
    const s = stateOf(rows);
    // the substitute-trained day must NOT read as a skipped Leg Press staple
    expect(dayGrade(s, D(0))).not.toBeNull();
    expect(weekStrength(s, D(0))).not.toBe('weak');
  });

  it('D#20 · an unknown-muscle (other) lift is not silently hidden on a split day', () => {
    const s = stateOf([
      { date: D(0), ex: 'Bench Press', weight: 135, reps: 8, muscle: 'chest' },
      { date: D(0), ex: 'Mystery Lift', weight: 50, reps: 10, muscle: '' as Muscle }, // unknown → 'other'
    ]);
    expect(exerciseSplit(s, 'Mystery Lift')).toBe('other');
    const view = selectWorkoutView(s, D(2), D(2), { split: 'upper' });
    expect(view.exercises).toContain('Mystery Lift'); // shown, not dropped
  });
});

describe('estimated 1RM (Epley)', () => {
  it('matches the Epley formula and floors non-positive input to 0', () => {
    expect(e1rm(100, 1)).toBeCloseTo(103.333, 2);
    expect(e1rm(100, 5)).toBeCloseTo(116.667, 2);
    expect(e1rm(200, 8)).toBeCloseTo(253.333, 2);
    expect(e1rm(0, 5)).toBe(0);
    expect(e1rm(100, 0)).toBe(0);
    expect(e1rm(-5, 5)).toBe(0);
  });
  it('rises with both weight and reps', () => {
    expect(e1rm(105, 5)).toBeGreaterThan(e1rm(100, 5));
    expect(e1rm(100, 6)).toBeGreaterThan(e1rm(100, 5));
  });
});

describe('exercise class & rep ceilings', () => {
  it('compounds get the strength ceiling, isolation the hypertrophy ceiling', () => {
    const s = stateOf([
      { date: D(0), ex: 'Bench Press', weight: 135, reps: 5, muscle: 'chest' },
      { date: D(0), ex: 'Bicep Curl', weight: 30, reps: 8, muscle: 'biceps' },
    ]);
    expect(isCompound(s, 'Bench Press')).toBe(true);
    expect(isCompound(s, 'Bicep Curl')).toBe(false);
    expect(repCeiling(s, 'Bench Press')).toBe(DEFAULT_CONFIG.repHighCompound);
    expect(repCeiling(s, 'Bicep Curl')).toBe(DEFAULT_CONFIG.repHighIsolation);
  });
  it('a compound bumps at its ceiling (6) while an isolation lift still holds', () => {
    const s = stateOf([
      { date: D(0), ex: 'Bench Press', weight: 135, reps: 6, muscle: 'chest' },
      { date: D(0), ex: 'Bicep Curl', weight: 30, reps: 6, muscle: 'biceps' },
    ]);
    const bench = buildPlan(s, 'Bench Press', D(3))!; // normal 3-day cadence (no layoff)
    const curl = buildPlan(s, 'Bicep Curl', D(3))!;
    expect(bench.bumped).toBe(true); // 6 >= 6
    expect(bench.top.weight).toBeGreaterThan(135);
    expect(bench.top.reps).toBe(DEFAULT_CONFIG.repsAfterBumpCompound);
    expect(curl.bumped).toBe(false); // 6 < 12
    expect(curl.top.weight).toBe(30);
  });
});

describe('strength stall → auto-deload', () => {
  // 3-day spacing = a normal 2x/week per-lift cadence (below the layoff thresholds),
  // so this isolates the stall path from the time-off path.
  const flat = [0, 3, 6, 9].map((d) => ({ date: D(d), ex: 'Bench Press', weight: 135, reps: 5, muscle: 'chest' as Muscle }));
  it('flags a stall after N non-improving sessions, not before', () => {
    expect(isStalled(stateOf(flat), 'Bench Press', D(12))).toBe(true);
    const rising = [0, 3, 6, 9].map((d, i) => ({ date: D(d), ex: 'Bench Press', weight: 135 + i * 5, reps: 5, muscle: 'chest' as Muscle }));
    expect(isStalled(stateOf(rising), 'Bench Press', D(12))).toBe(false);
    // too little history to judge
    expect(isStalled(stateOf(flat.slice(0, 2)), 'Bench Press', D(12))).toBe(false);
  });
  it('auto-deloads a stalled lift: deload set, weight backed off, never a bump', () => {
    const plan = buildPlan(stateOf(flat), 'Bench Press', D(12))!;
    expect(plan.autoDeload).toBe(true);
    expect(plan.deload).toBe(true);
    expect(plan.bumped).toBe(false);
    expect(plan.top.weight).toBeLessThanOrEqual(135);
    expect(plan.top.weight).toBeGreaterThan(0);
  });
});

describe('session effort (absolute, current session)', () => {
  // Bench Press is compound: floor 3 (repsAfterBumpCompound), ceiling 6 (repHighCompound).
  const bench = (reps: number) => ({ ex: 'Bench Press', weight: 135, reps, muscle: 'chest' as Muscle, date: D(0) });
  it('is null when nothing gradable was logged', () => {
    expect(sessionEffort(stateOf([]), D(0))).toBeNull();
  });
  it('grades by where the top set lands in the rep range, not versus last time', () => {
    expect(sessionEffort(stateOf([bench(6)]), D(0))).toBe('strong'); // at the ceiling
    expect(sessionEffort(stateOf([bench(5)]), D(0))).toBe('moderate'); // mid-range
    expect(sessionEffort(stateOf([bench(3)]), D(0))).toBe('weak'); // at the floor
  });
  it('does not read as strong just because a session repeats the last one', () => {
    // two identical mid-range sessions — the fixed grade is moderate both times (was 'strong' when self-referential)
    const s = stateOf([bench(5), { ...bench(5), date: D(7) }]);
    expect(sessionEffort(s, D(0))).toBe('moderate');
    expect(sessionEffort(s, D(7))).toBe('moderate');
  });
});

describe('days since last', () => {
  it('counts whole days to the previous session, null when none', () => {
    const s = stateOf([{ date: D(0), ex: 'Bench Press', weight: 135, reps: 5, muscle: 'chest' }]);
    expect(daysSinceLast(s, 'Bench Press', D(10))).toBe(10);
    expect(daysSinceLast(s, 'Bench Press', D(0))).toBeNull();
    expect(daysSinceLast(s, 'Squat', D(10))).toBeNull();
  });
});

describe('deload does not spiral', () => {
  const flat = [0, 3, 6, 9].map((d) => ({ date: D(d), ex: 'Bench Press', weight: 135, reps: 5, muscle: 'chest' as Muscle }));
  it('after an obeyed deload, a rebuild window opens before it can deload again', () => {
    // stalled at 135 → deload to 120; the lifter obeys and logs 120 (3-day cadence, no layoff).
    const obeyed = [...flat, { date: D(12), ex: 'Bench Press', weight: 120, reps: 5, muscle: 'chest' as Muscle }];
    // the very next session must NOT auto-deload again — the drop sits in the stall window.
    expect(isStalled(stateOf(obeyed), 'Bench Press', D(15))).toBe(false);
    expect(buildPlan(stateOf(obeyed), 'Bench Press', D(15))!.autoDeload).toBe(false);
  });
});

describe('time off (layoff) handling — graduated', () => {
  const hist = [{ date: D(0), ex: 'Bench Press', weight: 135, reps: 6, muscle: 'chest' as Muscle }]; // hit the ceiling → would bump
  it('a normal few-day cadence is unaffected (still bumps off the ceiling)', () => {
    const plan = buildPlan(stateOf(hist), 'Bench Press', D(4))!; // 4d: at the threshold, not over
    expect(plan.autoDeload).toBe(false);
    expect(plan.bumped).toBe(true);
  });
  it('a short layoff eases back with a MILD deload', () => {
    const plan = buildPlan(stateOf(hist), 'Bench Press', D(6))!; // 6d: > gapRepeatDays(4), <= gapDeloadDays(7)
    expect(plan.autoDeload).toBe(true);
    expect(plan.bumped).toBe(false);
    expect(plan.top.weight).toBeLessThan(135);
  });
  it('a long layoff deloads MORE than a short one', () => {
    const short = buildPlan(stateOf(hist), 'Bench Press', D(6))!; // mild (×0.95)
    const long = buildPlan(stateOf(hist), 'Bench Press', D(30))!; // full (×0.9)
    expect(long.autoDeload).toBe(true);
    expect(long.top.weight).toBeLessThan(short.top.weight);
    expect(long.top.weight).toBeLessThan(135);
  });
});

/* ================================================================== */
/* Week strength grade                                                 */
/* ================================================================== */

describe('exerciseScore — top set vs planned target', () => {
  // One prior session (100×5) sets a HOLD target of 100×5 for D(3); the actual
  // top set logged on D(3) is graded against it. Compound Bench, 3-day cadence,
  // one prior session → no bump, no layoff, no stall: the target is a clean hold.
  const hist = { date: D(0), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' as Muscle };
  const score = (weight: number, reps: number) =>
    exerciseScore(
      stateOf([hist, { date: D(3), ex: 'Bench Press', weight, reps, muscle: 'chest' }]),
      'Bench Press',
      D(3),
    );

  it('hit both weight and reps → strong', () => expect(score(100, 5)).toBe('strong'));
  it('exceed both → strong', () => expect(score(105, 6)).toBe('strong'));
  it('miss both → weak', () => expect(score(95, 4)).toBe('weak'));
  it('hit weight only → moderate', () => expect(score(100, 4)).toBe('moderate'));
  it('hit reps only → moderate', () => expect(score(95, 5)).toBe('moderate'));

  it('a planned lift with no logged top set that day → weak', () => {
    // history exists (so there IS a target) but nothing was logged on D(3)
    expect(exerciseScore(stateOf([hist]), 'Bench Press', D(3))).toBe('weak');
  });

  it('is ungradable (null) with no prior history and for cardio', () => {
    // first-ever session: no target to grade against
    expect(exerciseScore(stateOf([{ ...hist, date: D(3) }]), 'Bench Press', D(3))).toBeNull();
    // cardio is excluded entirely
    const cardio = stateOf([{ date: D(0), ex: 'Treadmill', weight: 0, reps: 0, muscle: 'cardio', type: 'cardio' }]);
    expect(exerciseScore(cardio, 'Treadmill', D(0))).toBeNull();
  });
});

describe('optional accessories', () => {
  it('the three grip/forearm lifts are flagged optional; core lifts are not', () => {
    expect(isOptional('Hammer Curl (Dumbbell)')).toBe(true);
    expect(isOptional('Wrist Curl (Dumbbell)')).toBe(true);
    expect(isOptional('Reverse Wrist Curl (Dumbbell)')).toBe(true);
    expect(isOptional('Bench Press')).toBe(false);
    expect(isOptional('Bicep Curl (Dumbbell)')).toBe(false);
  });

  it('an optional lift is excluded from the day average', () => {
    // Bench (upper) hits its target → strong; a weak optional Hammer Curl is present
    // that same upper day. If optionals counted, the day would drop to moderate;
    // because Hammer Curl is optional, the day stays strong.
    const s = stateOf([
      { date: D(0), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' },
      { date: D(0), ex: 'Hammer Curl (Dumbbell)', weight: 30, reps: 10, muscle: 'biceps' },
      { date: D(3), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // hits hold target → strong
      { date: D(3), ex: 'Hammer Curl (Dumbbell)', weight: 20, reps: 4, muscle: 'biceps' }, // would be weak
    ]);
    expect(dayGrade(s, D(3))).toBe('strong');
  });
});

describe('dayGrade — average of planned strength lifts', () => {
  it('averages the per-lift scores and bands them (weak+moderate+strong → moderate)', () => {
    // three upper lifts with hold targets of X; actuals hit both / one / neither.
    const s = stateOf([
      // seeds (targets)
      { date: D(0), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' },
      { date: D(0), ex: 'Lat Pulldown', weight: 120, reps: 5, muscle: 'back' },
      { date: D(0), ex: 'Bicep Curl (Dumbbell)', weight: 30, reps: 8, muscle: 'biceps' },
      // the graded day
      { date: D(3), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // strong (3)
      { date: D(3), ex: 'Lat Pulldown', weight: 120, reps: 4, muscle: 'back' }, // moderate (2): weight only
      { date: D(3), ex: 'Bicep Curl (Dumbbell)', weight: 25, reps: 6, muscle: 'biceps' }, // weak (1)
    ]);
    // (3 + 2 + 1) / 3 = 2.0 → moderate
    expect(dayGrade(s, D(3))).toBe('moderate');
  });

  it('a cardio-only day grades weak (not empty)', () => {
    const s = stateOf([{ date: D(0), ex: 'Treadmill', weight: 0, reps: 0, muscle: 'cardio', type: 'cardio' }]);
    expect(dayGrade(s, D(0))).toBe('weak');
  });
});

describe('bandScore — §4 boundaries', () => {
  it('bands at exactly 1.67 and 2.34', () => {
    expect(bandScore(1.66)).toBe('weak');
    expect(bandScore(1.67)).toBe('moderate'); // lower moderate boundary
    expect(bandScore(2.33)).toBe('moderate');
    expect(bandScore(2.34)).toBe('strong'); // lower strong boundary
    expect(bandScore(1)).toBe('weak');
    expect(bandScore(3)).toBe('strong');
  });
});

describe('weekStrength — median of day grades, then frequency cap', () => {
  // Roster is exactly one upper lift (Bench) and one lower lift (Leg Press), so
  // each day's planned slate is a single lift and day grades are easy to reason
  // about. Seeds sit BEFORE the 7-day window (today = D(6), window [D(0), D(6)]),
  // so they set targets without counting as trained days. All gaps are ≤ 4 days,
  // below the layoff thresholds, so targets are clean holds.

  it('§5 ex.1 — three Strong lift days + a cardio day, 4 trained of 4 → Strong', () => {
    const s = stateOf([
      { date: D(-3), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // seed
      { date: D(-1), ex: 'Leg Press', weight: 200, reps: 5, muscle: 'quads' }, // seed
      { date: D(0), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // strong
      { date: D(2), ex: 'Leg Press', weight: 200, reps: 5, muscle: 'quads' }, // strong
      { date: D(4), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // strong (target from D(0))
      { date: D(6), ex: 'Treadmill', weight: 0, reps: 0, muscle: 'cardio', type: 'cardio' }, // weak
    ]);
    expect(trainedDaysInWeek(s, D(6))).toEqual([D(0), D(2), D(4), D(6)]);
    // median([3,3,3,1]) = 3 → strong; 4 trained = target → no cap
    expect(weekStrength(s, D(6))).toBe('strong');
  });

  it('§5 ex.2 — one Strong lift, 1 trained of 4 → not Strong (floors at Weak)', () => {
    const s = stateOf([
      { date: D(-3), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // seed (out of window)
      { date: D(0), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // strong day
    ]);
    expect(trainedDaysInWeek(s, D(6))).toEqual([D(0)]);
    expect(dayGrade(s, D(0))).toBe('strong');
    expect(weekStrength(s, D(6))).not.toBe('strong');
    expect(weekStrength(s, D(6))).toBe('weak'); // ≤1 training day floors at Weak
  });

  it('§5 ex.3 — one treadmill day → Weak', () => {
    const s = stateOf([{ date: D(0), ex: 'Treadmill', weight: 0, reps: 0, muscle: 'cardio', type: 'cardio' }]);
    expect(weekStrength(s, D(6))).toBe('weak');
  });

  it('2–3 trained days pull the median down one band', () => {
    // two Strong lift days; median = Strong, but < 4 trained → one band down = Moderate
    const s = stateOf([
      { date: D(-3), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // seed
      { date: D(-1), ex: 'Leg Press', weight: 200, reps: 5, muscle: 'quads' }, // seed
      { date: D(0), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }, // strong
      { date: D(2), ex: 'Leg Press', weight: 200, reps: 5, muscle: 'quads' }, // strong
    ]);
    expect(trainedDaysInWeek(s, D(6)).length).toBe(2);
    expect(weekStrength(s, D(6))).toBe('moderate');
  });

  it('no trained days in the window → rest', () => {
    const s = stateOf([{ date: D(-3), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }]);
    expect(trainedDaysInWeek(s, D(6))).toEqual([]);
    expect(weekStrength(s, D(6))).toBe('rest');
  });

  it('exposes the training-day target as 4', () => {
    expect(WEEK_TRAINING_TARGET).toBe(4);
  });
});

describe('weekStrength — reality check (must NOT over-read as Strong)', () => {
  it('a realistic beginner week that mostly MISSES its targets reads Weak, never Strong', () => {
    // Two upper lifts (Bench, Lat Pulldown) and two lower lifts (Leg Press, Leg
    // Extension). Seeds set solid targets; every in-window session comes in UNDER
    // target on both weight and reps — the beginner is grinding and falling short.
    // The grade must reflect that, not read full-strength on weak data (the class
    // of bug that shipped before). 4-day gaps keep targets as clean holds.
    const s = stateOf([
      // seeds (targets), before the window
      { date: D(-4), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' },
      { date: D(-4), ex: 'Lat Pulldown', weight: 120, reps: 5, muscle: 'back' },
      { date: D(-2), ex: 'Leg Press', weight: 200, reps: 5, muscle: 'quads' },
      { date: D(-2), ex: 'Leg Extension', weight: 90, reps: 5, muscle: 'quads' },
      // Upper day 1 — misses both lifts
      { date: D(0), ex: 'Bench Press', weight: 92, reps: 4, muscle: 'chest' },
      { date: D(0), ex: 'Lat Pulldown', weight: 110, reps: 4, muscle: 'back' },
      // Lower day 1 — misses both lifts
      { date: D(2), ex: 'Leg Press', weight: 185, reps: 4, muscle: 'quads' },
      { date: D(2), ex: 'Leg Extension', weight: 85, reps: 4, muscle: 'quads' },
      // Upper day 2 — keeps sliding (targets now the D(0) numbers)
      { date: D(4), ex: 'Bench Press', weight: 88, reps: 3, muscle: 'chest' },
      { date: D(4), ex: 'Lat Pulldown', weight: 100, reps: 3, muscle: 'back' },
      // Lower day 2 — keeps sliding (targets now the D(2) numbers)
      { date: D(6), ex: 'Leg Press', weight: 170, reps: 3, muscle: 'quads' },
      { date: D(6), ex: 'Leg Extension', weight: 80, reps: 3, muscle: 'quads' },
    ]);
    expect(trainedDaysInWeek(s, D(6))).toEqual([D(0), D(2), D(4), D(6)]);
    expect(dayGrade(s, D(0))).toBe('weak');
    expect(dayGrade(s, D(2))).toBe('weak');
    expect(dayGrade(s, D(4))).toBe('weak');
    expect(dayGrade(s, D(6))).toBe('weak');
    expect(weekStrength(s, D(6))).not.toBe('strong');
    expect(weekStrength(s, D(6))).toBe('weak');
  });
});

/* ================================================================== */
/* Habitual-staple model + new-model regression coverage              */
/* ================================================================== */

describe('habitualStaples — behavioural, not the full roster', () => {
  // Three upper lifts done every session; an "Overhead Press" done once and
  // abandoned. Staples are the habitual lifts, not everything ever logged.
  const seeds = [0, 3, 6].flatMap((d) => [
    { date: D(d), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' as Muscle },
    { date: D(d), ex: 'Lat Pulldown', weight: 120, reps: 5, muscle: 'back' as Muscle },
    { date: D(d), ex: 'Tricep Pushdown (Rope)', weight: 40, reps: 8, muscle: 'triceps' as Muscle },
  ]);
  const abandoned = { date: D(0), ex: 'Overhead Press', weight: 60, reps: 5, muscle: 'shoulders' as Muscle };
  // an upper session ON the query day, so splitOfDate resolves to 'upper'
  const query = { date: D(9), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' as Muscle };

  it('K (the same-split window) is 4', () => expect(STAPLE_WINDOW).toBe(4));

  it('keeps lifts in ≥50% of the recent same-split sessions, drops one-offs', () => {
    const s = stateOf([...seeds, abandoned, query]);
    expect(habitualStaples(s, D(9)).sort()).toEqual(['Bench Press', 'Lat Pulldown', 'Tricep Pushdown (Rope)']);
    // Overhead Press appeared in 1 of the 3 recent upper sessions (33%) → not a staple
    expect(habitualStaples(s, D(9))).not.toContain('Overhead Press');
  });

  it('optional and cardio lifts are never staples', () => {
    const s = stateOf([
      ...[0, 3, 6].flatMap((d) => [
        { date: D(d), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' as Muscle },
        { date: D(d), ex: 'Hammer Curl (Dumbbell)', weight: 30, reps: 10, muscle: 'biceps' as Muscle },
        { date: D(d), ex: 'Treadmill', weight: 0, reps: 0, muscle: 'cardio' as Muscle, type: 'cardio' as SetType },
      ]),
      { date: D(9), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' as Muscle },
    ]);
    expect(habitualStaples(s, D(9))).toEqual(['Bench Press']);
  });

  it('no prior same-split history → no staples', () => {
    expect(habitualStaples(stateOf([{ date: D(9), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' }]), D(9))).toEqual([]);
  });
});

describe('dayGrade under the staple model (subset of a seeded roster)', () => {
  // Roster of 3 habitual upper lifts + an abandoned Overhead Press (once, at D(0)).
  const seeds = [
    ...[0, 3, 6].flatMap((d) => [
      { date: D(d), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' as Muscle },
      { date: D(d), ex: 'Lat Pulldown', weight: 120, reps: 5, muscle: 'back' as Muscle },
      { date: D(d), ex: 'Tricep Pushdown (Rope)', weight: 40, reps: 8, muscle: 'triceps' as Muscle },
    ]),
    { date: D(0), ex: 'Overhead Press', weight: 60, reps: 5, muscle: 'shoulders' as Muscle },
  ];
  const hit = {
    bench: { date: D(9), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' as Muscle },
    lat: { date: D(9), ex: 'Lat Pulldown', weight: 120, reps: 5, muscle: 'back' as Muscle },
    tri: { date: D(9), ex: 'Tricep Pushdown (Rope)', weight: 40, reps: 8, muscle: 'triceps' as Muscle },
  };

  it('a focused day hitting all its staples grades Strong', () => {
    expect(dayGrade(stateOf([...seeds, hit.bench, hit.lat, hit.tri]), D(9))).toBe('strong');
  });

  it('skipping a staple pulls the day down (Strong → Moderate)', () => {
    // Tricep is a staple but has no top set today → weak for that slot; [3,3,1] → 2.33 → moderate
    expect(dayGrade(stateOf([...seeds, hit.bench, hit.lat]), D(9))).toBe('moderate');
  });

  it('an abandoned roster lift does NOT count against the day', () => {
    // Overhead Press (in the seeded roster but not habitual) is neither a staple
    // nor logged today, so it never drags the grade — the day stays Strong.
    const s = stateOf([...seeds, hit.bench, hit.lat, hit.tri]);
    expect(habitualStaples(s, D(9))).not.toContain('Overhead Press');
    expect(dayGrade(s, D(9))).toBe('strong');
  });

  it('a one-off brand-new lift logged today is excluded, not counted against you', () => {
    // Face Pull is logged for the first time (no target) → dropped from the average;
    // the staples were all hit, so the day is still Strong.
    const s = stateOf([
      ...seeds,
      hit.bench,
      hit.lat,
      hit.tri,
      { date: D(9), ex: 'Face Pull', weight: 50, reps: 12, muscle: 'shoulders' },
    ]);
    expect(dayGrade(s, D(9))).toBe('strong');
  });
});

describe('ungradable days vs cardio-only days', () => {
  it('a day whose only strength work is a first-timer is ungradable (null), NOT weak', () => {
    // brand-new Leg Press, no prior history → no target → the day cannot be graded
    const s = stateOf([{ date: D(0), ex: 'Leg Press', weight: 140, reps: 8, muscle: 'quads' }]);
    expect(dayGrade(s, D(0))).toBeNull();
  });

  it('a cardio-only day is a weak lifting day', () => {
    const s = stateOf([{ date: D(0), ex: 'Treadmill', weight: 0, reps: 0, muscle: 'cardio', type: 'cardio' }]);
    expect(dayGrade(s, D(0))).toBe('weak');
  });
});

describe('weekGrade — median + frequency cap (pure)', () => {
  const W = 'weak' as const;
  const M = 'moderate' as const;
  const S = 'strong' as const;

  it('even-count median ties DOWN to the lower grade, symmetrically', () => {
    expect(weekGrade([W, W, M, S], 4)).toBe('weak'); // central (weak,moderate) = 1½ → weak
    expect(weekGrade([M, M, S, S], 4)).toBe('moderate'); // central (moderate,strong) = 2½ → moderate
    expect(weekGrade([W, W, S, S], 4)).toBe('moderate'); // central (weak,strong) = 2 → moderate
    expect(weekGrade([S, S, S, S], 4)).toBe('strong'); // exact integer median unaffected
  });

  it('frequency cap: ≥4 keeps the median, 2–3 pulls down a band, ≤1 floors at weak', () => {
    expect(weekGrade([S, S, S, S], 4)).toBe('strong');
    expect(weekGrade([S, S, S], 3)).toBe('moderate'); // median strong, 3 trained → down one
    expect(weekGrade([S, S], 2)).toBe('moderate');
    expect(weekGrade([S], 1)).toBe('weak'); // one good day is not a strong week
    expect(weekGrade([], 0)).toBe('rest');
  });

  it('ungradable (null) days drop from the median but still count for the cap', () => {
    expect(weekGrade([S, null, S, null], 4)).toBe('strong'); // 4 trained, 2 gradable strong → strong
    expect(weekGrade([S, null], 2)).toBe('moderate'); // graded [S] median strong, 2 trained → down → moderate
    expect(weekGrade([null], 1)).toBe('rest'); // the lone training day was ungradable → rest
    expect(weekGrade([null, null, null], 3)).toBe('rest'); // nothing gradable all week
  });
});

describe('week strength on the REAL seeded default program', () => {
  const real = (): WorkoutState => ({
    settings: {},
    days: (defaultWorkoutData as unknown as { days: WorkoutState['days'] }).days,
    bw: {},
    rpe: {},
    done: {},
    sessionDone: {},
    incr: {},
  });

  it('Strong is reachable — a full habitual session grades Strong (not universally weak)', () => {
    expect(dayGrade(real(), '2026-07-05')).toBe('strong');
    expect(dayGrade(real(), '2026-07-09')).toBe('strong');
  });

  it('the real focused Leg Press day (2026-07-22, a first-timer) is ungradable, NOT forced weak', () => {
    // This was the shipped bug: under the old full-roster slate this day read weak.
    expect(dayGrade(real(), '2026-07-22')).toBeNull();
  });

  it('a full training week reads Strong end-to-end', () => {
    expect(weekStrength(real(), '2026-07-09')).toBe('strong');
  });
});
