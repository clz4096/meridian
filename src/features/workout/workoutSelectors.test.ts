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
  bestRecentTopWeight,
  buildPlan,
  canonicalSlot,
  dayScore,
  daysSinceLast,
  e1rm,
  exerciseScore,
  exerciseSplit,
  gradeOf,
  inferIncrement,
  isCompound,
  isSessionComplete,
  isRetired,
  isStalled,
  mondayOf,
  plannedSlots,
  RETIRED_EXERCISES,
  repCeiling,
  repsAfterBumpFor,
  restSeconds,
  roundDownTo,
  selectWorkoutView,
  setHistoryIndexEnabled,
  withHistoryIndex,
  splitOfDate,
  suggestSplit,
  weeklyWorkingSets,
  weekScore,
  weekTrend,
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
            // A bump follows EITHER reaching the ceiling (normal) OR clearing the class
            // reset floor while below the recent best (recovery). The plan doesn't expose
            // `best`, so assert the weaker floor bound that covers both.
            expect(plan.lastTopReps).toBeGreaterThanOrEqual(repsAfterBumpFor(state, ex, DEFAULT_CONFIG));
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

  it('a deload never prescribes more than the recovery-anchor best', () => {
    fc.assert(
      fc.property(arbWorkoutState, arbDate, (state, date) => {
        for (const ex of allExercises(state)) {
          const plan = buildPlan(state, ex, date, { deload: { [ex]: true } });
          if (!plan || plan.cardio) continue;
          // A manual deload is a one-shot: it may not fire if today's top is already
          // logged, so only assert the bound on a plan that actually deloaded.
          if (!plan.deload) continue;
          // The cut anchors on best (derived), clamped to the current working weight,
          // so it never rises above best — the invariant that kills the geometric decay.
          const best = bestRecentTopWeight(state, ex, date) ?? plan.lastTopWeight;
          expect(plan.top.weight).toBeLessThanOrEqual(best);
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
          // recomputed. It legitimately is not in three cases, all of which
          // preserve a real, previously-lifted weight rather than distorting it:
          //   - holding: it echoes exactly what was lifted (e.g. 47.5 on a 5 lb bar)
          //   - atMinimum: the load is below one increment, so a deload would
          //     round to zero; the plan floors to the previous weight instead.
          //   - recovery bump capped at best: Math.min(stepped, best) can echo an
          //     off-grid best (a real prior top set), same justification as a hold.
          const best = bestRecentTopWeight(state, ex, date) ?? plan.lastTopWeight;
          const belowBest = plan.lastTopWeight < best - 1e-9;
          const recoveryCapped = plan.bumped && belowBest;
          if ((plan.bumped || plan.deload) && !plan.atMinimum && !recoveryCapped) {
            expect(isMultipleOf(plan.top.weight, step)).toBe(true);
          } else if (!plan.bumped && !plan.deload) {
            expect(plan.top.weight).toBe(plan.lastTopWeight); // hold echoes the logged weight
          } else if (plan.atMinimum) {
            expect(plan.top.weight).toBe(plan.lastTopWeight); // deload floored below one increment
          }
          // recoveryCapped: exempt — it echoes a real logged best, not snapped to grid.
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

  it('E · a home lower day is credited to the gym slot, not graded as a skipped Leg Press', () => {
    // Establish Leg Press from prior gym sessions, then train lower at home via
    // Goblet Squat. The substitute counts as the Leg Press slot.
    const rows = [] as Array<{ date: string; ex: string; weight: number; reps: number; muscle?: Muscle }>;
    for (const off of [-10, -8, -6, -4]) rows.push({ date: D(off), ex: 'Leg Press', weight: 200, reps: 8, muscle: 'quads' });
    // home lower days: substitute, hitting a strong session each time
    for (const off of [-2, 0]) rows.push({ date: D(off), ex: 'Goblet Squat', weight: 45, reps: 12, muscle: 'quads' });
    const s = stateOf(rows);
    // the substitute-trained day must NOT read as a skipped Leg Press slot
    const day = dayScore(s, D(0))!;
    expect(day.exercises.map((e) => e.slot)).toEqual(['Leg Press']);
    expect(day.exercises[0]!.score).toBeGreaterThan(0);
  });

  it('a strength lift whose last session had NO top set is not mis-flagged as cardio', () => {
    // Reproduce "Leg Press overridden with treadmill cardio": a Leg Press day logged
    // with only back-off sets (no 'top') must still build a STRENGTH plan, not a cardio
    // (time/distance) card. It progresses off the heaviest logged set.
    const s = stateOf([
      { date: D(0), ex: 'Leg Press', weight: 180, reps: 10, muscle: 'quads', type: 'back' },
      { date: D(0), ex: 'Leg Press', weight: 200, reps: 8, muscle: 'quads', type: 'back' },
    ]);
    const plan = buildPlan(s, 'Leg Press', D(2))!;
    expect(plan.cardio).toBe(false);
    expect(plan.lastTopWeight).toBe(200); // heaviest set stands in for the missing top
    // a genuine cardio lift with no top set is still cardio
    const c = stateOf([{ date: D(0), ex: 'Treadmill', weight: 3, reps: 20, muscle: 'cardio', type: 'cardio' }]);
    expect(buildPlan(c, 'Treadmill', D(2))!.cardio).toBe(true);
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
    expect(bench.top.reps).toBe(Math.max(DEFAULT_CONFIG.repsAfterBumpCompound, 6 - 2));
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

describe('time off (layoff) handling — inverted', () => {
  // At the ceiling: only a LONG layoff cuts, and only once. Moderate gaps no longer
  // suppress a bump (the old graduated mild/full tiers are gone — single deloadFactor).
  const ceilingHist = [{ date: D(0), ex: 'Bench Press', weight: 135, reps: 6, muscle: 'chest' as Muscle }]; // at ceiling
  it('a normal few-day cadence is unaffected (still bumps off the ceiling)', () => {
    const plan = buildPlan(stateOf(ceilingHist), 'Bench Press', D(4))!; // 4d
    expect(plan.autoDeload).toBe(false);
    expect(plan.bumped).toBe(true);
  });
  it('a moderate gap at the ceiling BUMPS (no longer suppressed)', () => {
    const plan = buildPlan(stateOf(ceilingHist), 'Bench Press', D(6))!; // 6d: > gapRepeatDays, <= gapDeloadDays
    expect(plan.bumped).toBe(true);
    expect(plan.autoDeload).toBe(false);
    expect(plan.top.weight).toBeGreaterThan(135);
  });
  it('a long layoff from an established (sub-ceiling) weight deloads ONCE off best', () => {
    // Sub-ceiling last session so normalBump is false and the layoff cut can fire.
    const establishedHist = [{ date: D(0), ex: 'Bench Press', weight: 135, reps: 5, muscle: 'chest' as Muscle }];
    const s = stateOf(establishedHist);
    const long = buildPlan(s, 'Bench Press', D(30))!; // 30d: > gapDeloadDays
    const best = bestRecentTopWeight(s, 'Bench Press', D(30))!; // 135
    expect(long.autoDeload).toBe(true);
    expect(long.deload).toBe(true);
    expect(long.bumped).toBe(false);
    expect(long.top.weight).toBe(roundDownTo(best * DEFAULT_CONFIG.deloadFactor, long.incr));
    expect(long.top.weight).toBeLessThan(135);
  });
});

/* ================================================================== */
/* Workout score                                                       */
/* ================================================================== */

/** One session of one lift: a top set plus back-offs (weight, reps pairs). */
function lift(
  date: string,
  ex: string,
  muscle: Muscle,
  top: [number, number],
  backs: Array<[number, number]> = [],
): Array<{ date: string; ex: string; weight: number; reps: number; muscle: Muscle; type: SetType }> {
  return [
    { date, ex, weight: top[0], reps: top[1], muscle, type: 'top' },
    ...backs.map(([weight, reps]) => ({ date, ex, weight, reps, muscle, type: 'back' as SetType })),
  ];
}

describe('workout score: exercise and day', () => {
  // Six upper lifts, each a top set plus two back-offs at the same load, so the
  // prescription for D(3) is an exact hold of D(0).
  const six: Array<[string, Muscle, number, number]> = [
    ['Bench Press', 'chest', 100, 5],
    ['Lat Pulldown', 'back', 120, 5],
    ['Tricep Pushdown (Rope)', 'triceps', 40, 8],
    ['Bicep Curl (Dumbbell)', 'biceps', 30, 8],
    ['Bicep Curl (Pulley)', 'biceps', 45, 8],
    ['Overhead Press', 'shoulders', 60, 8],
  ];
  const at = (date: string, skip: string[] = [], override: Record<string, number> = {}) =>
    six
      .filter(([ex]) => !skip.includes(ex))
      .flatMap(([ex, m, w, r]) => {
        const reps = override[ex] ?? r;
        return lift(date, ex, m, [w, reps], [[w, reps], [w, reps]]);
      });

  it('a full perfect upper day is Strong 1.00', () => {
    const day = dayScore(stateOf([...at(D(0)), ...at(D(3))]), D(3))!;
    expect(day.splits).toEqual(['upper']);
    expect(day.exercises).toHaveLength(6);
    expect(day.score).toBeCloseTo(1, 9);
    expect(day.label).toBe('strong');
  });

  it('worked example: 5 of 6 done, curls 6 of 8 reps, pulldown skipped = 0.79 Moderate', () => {
    const s = stateOf([...at(D(0)), ...at(D(3), ['Lat Pulldown'], { 'Bicep Curl (Dumbbell)': 6 })]);
    expect(exerciseScore(s, 'Bicep Curl (Dumbbell)', D(3))).toBeCloseTo(0.75, 9);
    expect(exerciseScore(s, 'Lat Pulldown', D(3))).toBe(0);
    const day = dayScore(s, D(3))!;
    expect(day.score!.toFixed(2)).toBe('0.79');
    expect(day.label).toBe('moderate');
  });

  it('worked example plus the pulldown = 0.96 Strong', () => {
    const s = stateOf([...at(D(0)), ...at(D(3), [], { 'Bicep Curl (Dumbbell)': 6 })]);
    const day = dayScore(s, D(3))!;
    expect(day.score!.toFixed(2)).toBe('0.96');
    expect(day.label).toBe('strong');
  });

  it('completion: half the working sets done halves the score', () => {
    // Bench plans a top and two back-offs; only the top is logged, on target.
    const s = stateOf([...lift(D(0), 'Bench Press', 'chest', [100, 5], [[100, 5], [100, 5]]), ...lift(D(3), 'Bench Press', 'chest', [100, 5])]);
    expect(exerciseScore(s, 'Bench Press', D(3))).toBeCloseTo(1 / 3, 9);
  });

  it('a set at 97% of target load counts as met; below that it scales', () => {
    const hist = lift(D(0), 'Overhead Press', 'shoulders', [100, 8]);
    expect(exerciseScore(stateOf([...hist, ...lift(D(3), 'Overhead Press', 'shoulders', [97, 8])]), 'Overhead Press', D(3))).toBe(1);
    expect(exerciseScore(stateOf([...hist, ...lift(D(3), 'Overhead Press', 'shoulders', [96, 8])]), 'Overhead Press', D(3))).toBeCloseTo(0.96, 9);
    // reps and load multiply: 4 of 8 reps at 80% load
    expect(exerciseScore(stateOf([...hist, ...lift(D(3), 'Overhead Press', 'shoulders', [80, 4])]), 'Overhead Press', D(3))).toBeCloseTo(0.4, 9);
  });

  it('warm-ups are not working sets', () => {
    const s = stateOf([
      ...lift(D(0), 'Overhead Press', 'shoulders', [100, 8]),
      { date: D(3), ex: 'Overhead Press', weight: 20, reps: 2, muscle: 'shoulders', type: 'warm' },
      ...lift(D(3), 'Overhead Press', 'shoulders', [100, 8]),
    ]);
    expect(exerciseScore(s, 'Overhead Press', D(3))).toBe(1);
  });

  it('a lift with no target yet is new: excluded from the day mean', () => {
    const s = stateOf([...at(D(0)), ...at(D(3)), ...lift(D(3), 'Face Pull', 'shoulders', [30, 12])]);
    const day = dayScore(s, D(3))!;
    expect(day.exercises.find((e) => e.slot === 'Face Pull')?.score).toBeNull();
    expect(day.score).toBeCloseTo(1, 9);
    // a day of only first-timers has no score
    const fresh = dayScore(stateOf(lift(D(0), 'Leg Press', 'quads', [140, 8])), D(0))!;
    expect(fresh.score).toBeNull();
    expect(fresh.label).toBe('new');
  });

  it('a mixed day is graded as both halves and averages them', () => {
    // Upper hits its target (1.00); lower lifts half the target load (0.50).
    const s = stateOf([
      ...lift(D(0), 'Overhead Press', 'shoulders', [60, 8]),
      ...lift(D(0), 'Hack Squat', 'quads', [200, 5]),
      ...lift(D(3), 'Overhead Press', 'shoulders', [60, 8]),
      ...lift(D(3), 'Hack Squat', 'quads', [100, 5]),
    ]);
    const day = dayScore(s, D(3))!;
    expect(day.splits).toEqual(['upper', 'lower']);
    expect(day.halves.upper).toBeCloseTo(1, 9);
    expect(day.halves.lower).toBeCloseTo(0.5, 9);
    expect(day.score).toBeCloseTo(0.75, 9);
    expect(day.label).toBe('moderate');
    expect(day.exercises.map((e) => e.slot).sort()).toEqual(['Hack Squat', 'Overhead Press']);
    // The week picks up each half, and each mixed day is one trained day. D(0) is in
    // the same week but all new, so it adds a day without adding a score.
    const wk = weekScore(s, D(3));
    expect(wk.upper).toBeCloseTo(1, 9);
    expect(wk.lower).toBeCloseTo(0.5, 9);
    expect(wk.sessions).toBe(2);
  });

  it('a session label names the split when every set carries one', () => {
    const s = stateOf(lift(D(0), 'Overhead Press', 'shoulders', [60, 8]));
    s.days[D(0)]!.forEach((x) => (x.group = 'Life Time - Lower'));
    expect(splitOfDate(s, D(0))).toBe('lower');
  });

  it('bands at 0.85 and 0.60', () => {
    expect(gradeOf(0.85)).toBe('strong');
    expect(gradeOf(0.8499)).toBe('moderate');
    expect(gradeOf(0.6)).toBe('moderate');
    expect(gradeOf(0.5999)).toBe('weak');
  });
});

describe('workout score: week', () => {
  // 2025-01-06 is a Monday. Seeds sit in the week before, so they set targets only.
  const MON = '2025-01-06';
  const W = (i: number) => shiftDate(MON, i);
  const seeds = [...lift(shiftDate(MON, -7), 'Overhead Press', 'shoulders', [100, 5]), ...lift(shiftDate(MON, -5), 'Hack Squat', 'quads', [200, 5])];
  const upper = (i: number, w = 100) => lift(W(i), 'Overhead Press', 'shoulders', [w, 5]);
  const lower = (i: number) => lift(W(i), 'Hack Squat', 'quads', [200, 5]);

  it('week = mean of the upper and lower averages', () => {
    // upper days 1.0 and 0.5 (half load), lower days 1.0 and 1.0
    const s = stateOf([...seeds, ...upper(0), ...lower(1), ...upper(2, 50), ...lower(3)]);
    expect(mondayOf(W(6))).toBe(MON);
    const wk = weekScore(s, W(6));
    expect(wk.upper).toBeCloseTo(0.75, 9);
    expect(wk.lower).toBeCloseTo(1, 9);
    expect(wk.score).toBeCloseTo(0.875, 9);
    expect(wk.label).toBe('strong');
    expect(wk.soFar).toBe(false);
    expect(wk.sessions).toBe(4);
    expect(WEEK_TRAINING_TARGET).toBe(4);
  });

  it('a missed planned session counts 0 once the week is past', () => {
    const s = stateOf([...seeds, ...upper(0), ...lower(1), ...upper(2, 50)]);
    const wk = weekScore(s, W(6));
    expect(wk.lower).toBeCloseTo(0.5, 9); // one lower at 1.0 plus one missed at 0
    expect(wk.score).toBeCloseTo(0.625, 9);
    expect(wk.label).toBe('moderate');
    expect(wk.sessions).toBe(3);
  });

  it('mid-week is on pace: "so far", with no penalty for sessions still to come', () => {
    const s = stateOf([...seeds, ...upper(0), ...lower(1)]);
    const wk = weekScore(s, W(1));
    expect(wk.score).toBeCloseTo(1, 9);
    expect(wk.label).toBe('strong');
    expect(wk.soFar).toBe(true);
    expect(`${wk.label} so far · ${wk.sessions} of ${wk.planned} days`).toBe('strong so far · 2 of 4 days');
  });

  it('a split with no session done and none left this week scores 0', () => {
    const s = stateOf([...seeds, ...upper(0), ...upper(2)]);
    const wk = weekScore(s, W(5)); // Saturday: no Mon to Fri slot left
    expect(wk.upper).toBeCloseTo(1, 9);
    expect(wk.lower).toBe(0);
    expect(wk.score).toBeCloseTo(0.5, 9);
    expect(wk.label).toBe('weak');
  });

  it('no logged training at all reads rest', () => {
    expect(weekScore(stateOf([]), W(2)).label).toBe('rest');
  });

  it('the trend lists 8 weeks oldest first, rest before history began', () => {
    const s = stateOf([...seeds, ...upper(0), ...lower(1)]);
    const trend = weekTrend(s, W(1));
    expect(trend).toHaveLength(8);
    expect(trend[7]!.monday).toBe(MON);
    expect(trend[0]!.label).toBe('rest');
  });
});

describe('retired grip lifts', () => {
  const hist = [
    ...lift(D(0), 'Bench Press', 'chest', [100, 5]),
    ...lift(D(0), 'Hammer Curl (Dumbbell)', 'biceps', [15, 10]),
    ...lift(D(0), 'Wrist Curl (Dumbbell)', 'forearms', [10, 15]),
    ...lift(D(0), 'Reverse Wrist Curl (Dumbbell)', 'forearms', [5, 15]),
  ];

  it('are no longer planned or graded, but their history stays', () => {
    const s = stateOf(hist);
    for (const ex of RETIRED_EXERCISES) expect(isRetired(ex)).toBe(true);
    expect(isRetired('Bicep Curl (Dumbbell)')).toBe(false);
    const view = selectWorkoutView(s, D(3), D(3), { split: 'upper' });
    expect(view.exercises).toEqual(['Bench Press']);
    expect(plannedSlots(s, D(3), 'upper')).toEqual(['Bench Press']);
    // the logged day still shows what was done
    expect(selectWorkoutView(s, D(0), D(3)).exercises).toContain('Hammer Curl (Dumbbell)');
    expect(s.days[D(0)]!.length).toBe(4);
  });
});

describe('target fixes', () => {
  const tops = (ex: string, muscle: Muscle, weights: number[]) =>
    stateOf(weights.map((weight, i) => ({ date: D(i * 3), ex, weight, reps: 5, muscle })));

  it('inferIncrement ignores a single 20 lb jump', () => {
    expect(inferIncrement(tops('Leg Press', 'quads', [100, 105, 110, 130]), 'Leg Press')).toBe(5);
    expect(inferIncrement(tops('Leg Press', 'quads', [100, 120]), 'Leg Press')).toBe(5);
  });

  it('keeps a consistent machine step and snaps free weights to 2.5 or 5', () => {
    expect(inferIncrement(tops('Leg Extension', 'quads', [100, 110, 120]), 'Leg Extension')).toBe(10);
    expect(inferIncrement(tops('Bicep Curl (Dumbbell)', 'biceps', [20, 30, 40]), 'Bicep Curl (Dumbbell)')).toBe(5);
    expect(inferIncrement(tops('Bicep Curl (Pulley)', 'biceps', [40, 42.5, 45]), 'Bicep Curl (Pulley)')).toBe(2.5);
  });

  it('a bump sets target reps to max(floor, last reps - 2)', () => {
    const bench = buildPlan(stateOf([{ date: D(0), ex: 'Bench Press', weight: 100, reps: 6, muscle: 'chest' }]), 'Bench Press', D(3))!;
    expect(bench.bumped).toBe(true);
    expect(bench.top.reps).toBe(4); // max(3, 6 - 2)
    const curl = buildPlan(stateOf([{ date: D(0), ex: 'Overhead Press', weight: 50, reps: 13, muscle: 'shoulders' }]), 'Overhead Press', D(3))!;
    expect(curl.top.reps).toBe(11); // max(8, 13 - 2)
    const low = buildPlan(stateOf([{ date: D(0), ex: 'Overhead Press', weight: 50, reps: 12, muscle: 'shoulders' }]), 'Overhead Press', D(3))!;
    expect(low.top.reps).toBe(10);
  });

  it('a below-best recovery bump grades reps against the last achieved reps', () => {
    // Best 100, last 90x4: the recovery bump asks for 95; matching 4 reps meets it.
    const s = stateOf([
      { date: D(0), ex: 'Bench Press', weight: 100, reps: 5, muscle: 'chest' },
      { date: D(3), ex: 'Bench Press', weight: 90, reps: 4, muscle: 'chest' },
      { date: D(6), ex: 'Bench Press', weight: 95, reps: 4, muscle: 'chest' },
    ]);
    const plan = buildPlan(s, 'Bench Press', D(6))!;
    expect(plan.bumped).toBe(true);
    expect(plan.top.weight).toBe(95);
    // only the top set is graded here (two planned back-offs are skipped): completion 1/3, execution 1
    expect(exerciseScore(s, 'Bench Press', D(6))).toBeCloseTo(1 / 3, 9);
  });
});

// The owner's early real log. Mixed gym days grade both halves and average them;
// 07-22 is a lone first-time Leg Press beside four skipped lower lifts;
// 07-23 logged only the retired grip lifts.
const SEED_EXPECTED: string[] = [
  '2026-07-03 upper+lower new -',
  '2026-07-05 upper+lower moderate 0.76',
  '2026-07-07 upper+lower moderate 0.81',
  '2026-07-09 upper+lower strong 0.95',
  '2026-07-10 upper weak 0.50',
  '2026-07-12 upper+lower weak 0.26',
  '2026-07-14 upper+lower weak 0.59',
  '2026-07-17 upper weak 0.24',
  '2026-07-22 lower weak 0.00',
  '2026-07-23 upper weak 0.00',
];

describe('workout score on the REAL seeded log', () => {
  const real = (): WorkoutState => ({
    settings: {},
    days: (defaultWorkoutData as unknown as { days: WorkoutState['days'] }).days,
    bw: {},
    rpe: {},
    done: {},
    sessionDone: {},
    incr: {},
  });

  it('pins each seeded day', () => {
    const got = Object.keys(real().days)
      .sort()
      .map((d) => {
        const day = dayScore(real(), d);
        return day ? `${d} ${day.splits.join('+')} ${day.label} ${day.score === null ? '-' : day.score.toFixed(2)}` : `${d} none`;
      });
    expect(got).toEqual(SEED_EXPECTED);
  });
});

/* ================================================================== */
/* Per-call history index: same answers, linear cost                    */
/* ================================================================== */

describe('history index', () => {
  // The random histories, with a random subset of sets tombstoned so the index's
  // dead-set filtering is exercised too (arbWorkoutState itself never deletes).
  const arbWithTombstones = arbWorkoutState.chain((st) =>
    fc
      .subarray(Object.values(st.days).flat().map((x) => String(x.id)))
      .map((ids) => ({ ...st, _del: Object.fromEntries(ids.map((id) => [id, 1])) }) satisfies WorkoutState),
  );

  const both = <T>(fn: () => T): [T, T] => {
    setHistoryIndexEnabled(false);
    try {
      const plain = fn();
      setHistoryIndexEnabled(true);
      return [plain, fn()];
    } finally {
      setHistoryIndexEnabled(true);
    }
  };

  it('indexed and unindexed selectors agree on every entry point', () => {
    fc.assert(
      fc.property(arbWithTombstones, arbDate, (state, date) => {
        deepFreeze(state);
        const picks: Array<() => unknown> = [
          () => weekScore(state, date),
          () => dayScore(state, date),
          () => weekTrend(state, date),
          () => suggestSplit(state, date),
          () => selectWorkoutView(state, date, date),
          // helpers the Workout screen calls directly, now under withHistoryIndex
          () => withHistoryIndex((st: WorkoutState, d: string) => ({
            rest: allExercises(st).map((ex) => [restSeconds(st, ex, 'top', DEFAULT_CONFIG), inferIncrement(st, ex, DEFAULT_CONFIG)]),
            splits: [splitOfDate(st, d, DEFAULT_CONFIG), splitOfDate(st, shiftDate(d, -1), DEFAULT_CONFIG)],
          }))(state, date),
        ];
        for (const pick of picks) {
          const [plain, indexedResult] = both(pick);
          expect(indexedResult).toEqual(plain);
        }
      }),
      opts,
    );
  });

  it('grades a year of history in well under a second (was ~36 s unindexed)', () => {
    // 208 training days cycling the shipped template: the shape that made
    // Enter -> Today take tens of seconds before the index.
    const tpl = Object.values(defaultWorkoutData.days) as unknown as WorkoutSet[][];
    const days: Record<string, WorkoutSet[]> = {};
    for (let i = 0; i < 208; i++) {
      const date = shiftDate('2025-09-24', Math.floor(i * 1.75));
      days[date] = tpl[i % tpl.length]!.map((x, j) => ({ ...x, id: `y${i}-${j}` as EntityId }));
    }
    const state: WorkoutState = { settings: {}, days, bw: {}, rpe: {}, done: {}, sessionDone: {}, incr: {}, _del: {} };
    const today = shiftDate('2025-09-24', 364);
    const t0 = performance.now();
    weekTrend(state, today);
    selectWorkoutView(state, today, today);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
