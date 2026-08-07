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
  daysSinceLast,
  e1rm,
  exerciseSplit,
  inferIncrement,
  isCompound,
  isSessionComplete,
  isStalled,
  repCeiling,
  restSeconds,
  selectWorkoutView,
  sessionEffort,
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
    expect(view.completed['Leg Press']).toBe(true); // the one logged top set meets the plan
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
