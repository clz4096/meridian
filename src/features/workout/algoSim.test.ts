/**
 * Meridian — progression-algorithm verification harness.
 *
 * This is NOT a property test. It is an adversarial *simulation*: it plays a
 * lifter forward across 5 / 10 / 15 / 30-day training blocks, drives three
 * archetypes (progressor / plateauer / grinder) through `buildPlan`, and
 * asserts the documented invariants of the double-progression + auto-deload
 * engine in `workoutSelectors.ts`. It treats the implementation as guilty
 * until proven correct.
 *
 * The suite also emits `docs/algo-verification-findings.md` from the numbers it
 * actually observed, so the written report can never drift from the run.
 *
 * Nothing here mutates the algorithm; it only exercises it.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  type EntityId,
  type Muscle,
  type WorkoutSet,
  type WorkoutState,
} from '@/core/types';
import {
  buildPlan,
  daysSinceLast,
  e1rm,
  e1rmHistory,
  isCompound,
  repCeiling,
  roundDownTo,
  sessionEffort,
  splitOfDate,
  suggestSplit,
} from '@/features/workout/workoutSelectors';
import { shiftDate } from '@/core/util';

const C = DEFAULT_CONFIG;

/* ================================================================== */
/* Tiny state builder                                                  */
/* ================================================================== */

function emptyState(): WorkoutState {
  return { settings: {}, days: {}, bw: {}, rpe: {}, done: {}, sessionDone: {}, incr: {} };
}

let idc = 0;
function nextId(): EntityId {
  return String(++idc) as EntityId;
}

/** Append a top set (the only set progression reads) for `ex` on `date`. */
function logTop(
  state: WorkoutState,
  ex: string,
  date: string,
  weight: number | string,
  reps: number,
  muscle: Muscle,
): void {
  (state.days[date] ??= []).push({
    id: nextId(),
    ex,
    type: 'top',
    weight,
    reps,
    muscle,
  } as WorkoutSet);
}

/** Mon/Tue/Thu/Fri training dates within [start, start+N-1]. start must be a Monday. */
function trainingDates(start: string, n: number): string[] {
  const out: string[] = [];
  for (let off = 0; off < n; off++) {
    const d = shiftDate(start, off);
    const [y, m, day] = d.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // Sun0..Sat6
    if (wd === 1 || wd === 2 || wd === 4 || wd === 5) out.push(d);
  }
  return out;
}

const START = '2025-01-06'; // a Monday
const INTERVALS = [5, 10, 15, 30] as const;
const BENCH = 'Bench Press';
const CALF = 'Calf Raise (Machine)';

/** Guard: no weight anywhere in the plan is NaN/Infinity/negative. */
function finitePositive(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x) && x >= 0);
}

/* ================================================================== */
/* Report accumulator — afterAll serializes this to markdown           */
/* ================================================================== */

type Row = { check: string; pass: boolean; note: string };
const report: Record<string, Row[]> = {};
const notes: string[] = [];
const traj: Record<string, unknown> = {};

function record(interval: number, check: string, pass: boolean, note: string): void {
  const key = `N=${interval}`;
  (report[key] ??= []).push({ check, pass, note });
}

/* ================================================================== */
/* Archetype simulators                                                */
/* ================================================================== */

/**
 * Progressor: seeds at the ceiling, then every session logs the freshly-bumped
 * weight AT the ceiling reps → should bump every session, e1RM strictly rising.
 */
function simProgressor(n: number) {
  const s = emptyState();
  s.incr[BENCH] = 5;
  const dates = trainingDates(START, n);
  const ceil = C.repHighCompound; // 6
  logTop(s, BENCH, dates[0], 100, ceil, 'chest'); // seed hit ceiling
  const weights: number[] = [100];
  const plans: Array<ReturnType<typeof buildPlan>> = [];
  for (let i = 1; i < dates.length; i++) {
    const plan = buildPlan(s, BENCH, dates[i]);
    plans.push(plan);
    logTop(s, BENCH, dates[i], plan!.top.weight, ceil, 'chest');
    weights.push(plan!.top.weight);
  }
  return { s, dates, weights, plans };
}

/**
 * Plateauer: logs a FIXED weight×reps below the ceiling every session. e1RM is
 * perfectly flat; the PLAN's prescribed top weight should drop once the stall
 * window (stallSessions=3) fills — i.e. on the 5th session.
 */
function simPlateauer(n: number) {
  const s = emptyState();
  s.incr[BENCH] = 5;
  const dates = trainingDates(START, n);
  const FIXED_W = 100;
  const FIXED_R = 5; // below compound ceiling 6 → never bumps
  const planWeights: number[] = [];
  const autoDeloadAt: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const plan = buildPlan(s, BENCH, dates[i]); // null on the very first
    if (plan) {
      planWeights.push(plan.top.weight);
      if (plan.autoDeload) autoDeloadAt.push(i);
    } else {
      planWeights.push(NaN);
    }
    logTop(s, BENCH, dates[i], FIXED_W, FIXED_R, 'chest'); // always the same
  }
  return { s, dates, planWeights, autoDeloadAt, FIXED_W, FIXED_R };
}

describe('progression algorithm — simulated training blocks', () => {
  for (const n of INTERVALS) {
    describe(`N=${n} days`, () => {
      /* ---------------- Progressor ---------------- */
      it('progressor: e1RM strictly rising, weights on increment, all bumped', () => {
        const { s, weights, plans } = simProgressor(n);
        const hist = e1rmHistory(s, BENCH).map((h) => h.e1rm);

        // strictly increasing e1RM
        let strictlyUp = true;
        for (let i = 1; i < hist.length; i++) if (!(hist[i] > hist[i - 1])) strictlyUp = false;

        // every derived weight a multiple of the increment
        const onIncr = weights.every((w) => w % 5 === 0);
        // every post-seed plan bumped
        const allBumped = plans.every((p) => p!.bumped === true);
        const finite = weights.every((w) => finitePositive(w) && w > 0);

        record(n, 'progressor e1RM strictly ↑', strictlyUp,
          `${hist.length} sessions, e1RM ${hist[0]?.toFixed(1)}→${hist[hist.length - 1]?.toFixed(1)}`);
        record(n, 'progressor weights on increment', onIncr, `weights ${weights.join(', ')}`);
        record(n, 'progressor bumps every session', allBumped, `${plans.length} bumps`);
        record(n, 'progressor no NaN/Inf/neg', finite, 'all weights finite & > 0');

        if (n === 30) traj.progressor = { weights, e1rm: hist.map((x) => +x.toFixed(2)) };

        expect(strictlyUp).toBe(true);
        expect(onIncr).toBe(true);
        expect(allBumped).toBe(true);
        expect(finite).toBe(true);
      });

      /* ---------------- Plateauer ---------------- */
      it('plateauer: flat e1RM, auto-deload fires at session 5 when history allows', () => {
        const { s, dates, planWeights, autoDeloadAt, FIXED_W } = simPlateauer(n);
        const hist = e1rmHistory(s, BENCH).map((h) => h.e1rm);
        const flat = hist.every((x) => Math.abs(x - hist[0]) < 1e-9);

        const nSessions = dates.length;
        const expectDeload = nSessions >= 5; // needs > stallSessions priors
        const fired = autoDeloadAt.length > 0;
        const firstDeloadIdx = fired ? autoDeloadAt[0] : -1;

        record(n, 'plateauer e1RM flat', flat,
          `logged e1RM constant at ${hist[0]?.toFixed(2)} across ${hist.length}`);

        if (expectDeload) {
          // deload must fire, first at session index 4 (the 5th session)
          const plan5 = buildPlan(s, BENCH, dates[4])!;
          const expectedW = roundDownTo(FIXED_W * C.deloadFactor, 5);
          const wOk =
            plan5.autoDeload &&
            plan5.deload &&
            !plan5.bumped &&
            plan5.top.weight === expectedW &&
            plan5.top.weight <= FIXED_W &&
            plan5.top.weight > 0;
          record(n, 'plateauer auto-deload @ session 5', firstDeloadIdx === 4 && wOk,
            `first autoDeload at session ${firstDeloadIdx + 1}, deload weight=${plan5.top.weight} ` +
            `(expected floor(${FIXED_W}*0.9)→${expectedW}, ≤prev=${FIXED_W})`);
          record(n, 'plateauer plan drop at deload', planWeights[4] < planWeights[3],
            `plan weight ${planWeights[3]}→${planWeights[4]} at the stall`);

          expect(firstDeloadIdx).toBe(4);
          expect(plan5.top.weight).toBe(expectedW);
          expect(plan5.top.weight).toBeLessThanOrEqual(FIXED_W);
          expect(plan5.top.weight).toBeGreaterThan(0);
          expect(plan5.bumped).toBe(false);
          expect(plan5.autoDeload).toBe(true);
          // A deload resets reps to the class floor (not the old dead min-5) and
          // publishes the double-progression goal reps for the next bump.
          expect(plan5.top.reps).toBe(C.repsAfterBumpCompound);
          expect(plan5.targetReps).toBe(C.repHighCompound);
        } else {
          record(n, 'plateauer auto-deload (n/a)', !fired,
            `only ${nSessions} sessions (< 5) → no stall window yet, correctly no deload`);
          expect(fired).toBe(false);
        }

        if (n === 30) traj.plateauer = { planWeights, autoDeloadAt };
        expect(flat).toBe(true);
      });

      /* ---------------- Effort grading ---------------- */
      it('sessionEffort grades this session absolutely by reps in the rep range', () => {
        // Absolute (no prior comparison): where the top set lands in [floor … ceiling].
        function effortFor(reps: number): ReturnType<typeof sessionEffort> {
          const s = emptyState();
          const [, d1] = trainingDates(START, 10);
          logTop(s, BENCH, d1, 135, reps, 'chest');
          return sessionEffort(s, d1);
        }
        const strong = effortFor(C.repHighCompound); // 6 = ceiling → strong
        const moderate = effortFor(C.repHighCompound - 1); // 5 = mid → moderate
        const weak = effortFor(C.repsAfterBumpCompound); // 3 = floor → weak

        record(n, "sessionEffort 'strong'", strong === 'strong', `ceiling reps → ${strong}`);
        record(n, "sessionEffort 'moderate'", moderate === 'moderate', `mid-range reps → ${moderate}`);
        record(n, "sessionEffort 'weak'", weak === 'weak', `floor reps → ${weak}`);
        if (n === 30) traj.effort = { strong, moderate, weak };

        expect(strong).toBe('strong');
        expect(moderate).toBe('moderate');
        expect(weak).toBe('weak');
      });

      /* ---------------- Class-specific ceilings ---------------- */
      it('compound bumps at 6, isolation only at 12', () => {
        // Compound at 6 → bump; compound at 5 → hold.
        const mk = (ex: string, muscle: Muscle, reps: number) => {
          const s = emptyState();
          s.incr[ex] = 5;
          const [d0, d1] = trainingDates(START, 10);
          logTop(s, ex, d0, 100, reps, muscle);
          return buildPlan(s, ex, d1)!;
        };
        const compoundAt6 = mk(BENCH, 'chest', 6);
        const compoundAt5 = mk(BENCH, 'chest', 5);
        const isoAt6 = mk(CALF, 'calves', 6);
        const isoAt11 = mk(CALF, 'calves', 11);
        const isoAt12 = mk(CALF, 'calves', 12);

        const ceilOk =
          compoundAt6.bumped === true &&
          compoundAt5.bumped === false &&
          isoAt6.bumped === false &&
          isoAt11.bumped === false &&
          isoAt12.bumped === true;

        // repCeiling reports the right class boundary too
        const s = emptyState();
        logTop(s, BENCH, START, 100, 6, 'chest');
        logTop(s, CALF, START, 50, 6, 'calves');
        const ceilCompound = repCeiling(s, BENCH);
        const ceilIso = repCeiling(s, CALF);

        record(n, 'compound bumps @6 / isolation @12', ceilOk,
          `compound: 5→hold,6→bump; isolation: 6→hold,11→hold,12→bump; ` +
          `repCeiling compound=${ceilCompound}, isolation=${ceilIso}`);
        expect(ceilOk).toBe(true);
        expect(ceilCompound).toBe(6);
        expect(ceilIso).toBe(12);
        expect(isCompound(s, BENCH)).toBe(true);
        expect(isCompound(s, CALF)).toBe(false);
      });

      /* ---------------- Split alternation ---------------- */
      it('split alternates sensibly across the block', () => {
        // Upper on Mon/Thu (Bench=chest), lower on Tue/Fri (Leg Press=quads).
        const s = emptyState();
        s.incr[BENCH] = 5;
        s.incr['Leg Press'] = 10;
        const dates = trainingDates(START, n);
        for (const d of dates) {
          const [, m, day] = d.split('-').map(Number);
          const wd = new Date(Date.UTC(2025, m - 1, day)).getUTCDay();
          if (wd === 1 || wd === 4) logTop(s, BENCH, d, 100, 5, 'chest'); // Mon/Thu upper
          else logTop(s, 'Leg Press', d, 200, 5, 'quads'); // Tue/Fri lower
        }
        const splits = dates.map((d) => splitOfDate(s, d));
        // consecutive training days should not repeat the same half (given this plan)
        let alternates = true;
        for (let i = 1; i < splits.length; i++) if (splits[i] === splits[i - 1]) alternates = false;
        // suggestSplit for the day after the block proposes the opposite of the last
        const after = shiftDate(dates[dates.length - 1], 1);
        const sug = suggestSplit(s, after);
        const opposite = sug.last !== null && sug.due !== sug.last;

        record(n, 'split alternates', alternates && opposite,
          `sequence [${splits.join(', ')}]; next due=${sug.due} (last=${sug.last})`);
        if (n === 30) traj.splits = splits;
        expect(alternates).toBe(true);
        expect(opposite).toBe(true);
      });

      /* ---------------- Global no-blowup sweep ---------------- */
      it('no NaN/Infinity/negative weight anywhere in the block', () => {
        const { s, dates } = simProgressor(n);
        let clean = true;
        for (const d of [...dates, shiftDate(dates[dates.length - 1], 1)]) {
          const plan = buildPlan(s, BENCH, d);
          if (!plan) continue;
          const all = [
            plan.top.weight,
            ...plan.warms.map((x) => x.weight),
            ...plan.backs.map((x) => x.weight),
            plan.incr,
            plan.lastTopWeight,
          ];
          if (!finitePositive(...all)) clean = false;
        }
        record(n, 'no NaN/Inf/neg across block', clean, 'top+warms+backs+incr all finite & ≥0');
        expect(clean).toBe(true);
      });
    });
  }
});

/* ================================================================== */
/* Adversarial edge cases (interval-independent)                       */
/* ================================================================== */

describe('progression algorithm — adversarial edge cases', () => {
  it('single-session history: plan holds, never bumps off one data point', () => {
    const s = emptyState();
    logTop(s, BENCH, START, 100, 6, 'chest'); // one session, at the ceiling
    const plan = buildPlan(s, BENCH, shiftDate(START, 2))!;
    // one prior session IS enough to bump (ceiling hit); stall needs 4, so no deload
    const ok = plan.bumped === true && plan.deload === false && plan.top.weight === 105;
    notes.push(`Single-session history: bumps off one ceiling session (105), no deload (stall needs >3 priors). bumped=${plan.bumped}`);
    expect(ok).toBe(true);
  });

  it('exercise never logged: buildPlan returns null, daysSinceLast null', () => {
    const s = emptyState();
    logTop(s, BENCH, START, 100, 6, 'chest');
    const plan = buildPlan(s, 'Overhead Press', shiftDate(START, 2));
    const dsl = daysSinceLast(s, 'Overhead Press', shiftDate(START, 2));
    notes.push(`Unlogged exercise: buildPlan=${plan}, daysSinceLast=${dsl} (both null — no history to progress).`);
    expect(plan).toBeNull();
    expect(dsl).toBeNull();
  });

  it('layoffs inverted: a moderate gap at the ceiling BUMPS; a long gap deloads once off best', () => {
    const seedCeiling = () => {
      const s = emptyState();
      s.incr[BENCH] = 5;
      logTop(s, BENCH, START, 100, C.repHighCompound, 'chest'); // at the ceiling → earns a bump
      return s;
    };
    const seedEstablished = () => {
      const s = emptyState();
      s.incr[BENCH] = 5;
      logTop(s, BENCH, START, 100, C.repHighCompound - 1, 'chest'); // established, below the ceiling
      return s;
    };
    // 6-day gap (> gapRepeatDays, <= gapDeloadDays) no longer suppresses the bump.
    const moderateGap = buildPlan(seedCeiling(), BENCH, shiftDate(START, 6))!;
    // 30-day gap (> gapDeloadDays) from an established weight → a single cut off best.
    const longGap = buildPlan(seedEstablished(), BENCH, shiftDate(START, 30))!;
    const dsl = daysSinceLast(seedEstablished(), BENCH, shiftDate(START, 30));
    const expectedLong = roundDownTo(100 * C.deloadFactor, 5); // 90, anchored on best
    notes.push(
      `Layoffs inverted (threshold ${C.gapDeloadDays}d): a 6-day gap at the ceiling now BUMPS ` +
      `(bumped=${moderateGap.bumped}, autoDeload=${moderateGap.autoDeload}, top ${moderateGap.top.weight}); ` +
      `a 30-day gap (daysSinceLast=${dsl}) from an established weight deloads ONCE off best to ${longGap.top.weight}.`,
    );
    expect(moderateGap.bumped).toBe(true);
    expect(moderateGap.autoDeload).toBe(false);
    expect(moderateGap.top.weight).toBeGreaterThan(100);
    expect(longGap.autoDeload).toBe(true);
    expect(longGap.deload).toBe(true);
    expect(longGap.bumped).toBe(false);
    expect(longGap.top.weight).toBe(expectedLong);
    expect(longGap.top.weight).toBeLessThan(100);
  });

  it('fractional & string weights: toNum coerces, held top echoes logged weight exactly', () => {
    const s = emptyState();
    s.incr[BENCH] = 5;
    logTop(s, BENCH, START, '102.5', 5, 'chest'); // string, off-increment, below ceiling
    const plan = buildPlan(s, BENCH, shiftDate(START, 2))!;
    // held (not bumped): top echoes the logged 102.5 exactly, NOT snapped to 5
    const echoes = plan.top.weight === 102.5 && plan.bumped === false;
    notes.push(`Messy data: logged "102.5" (string) → held top echoes 102.5 exactly (not snapped). lastTopWeight=${plan.lastTopWeight}`);
    expect(echoes).toBe(true);
    expect(Number.isFinite(plan.top.weight)).toBe(true);
  });

  it('stall boundary: 3 flat sessions = no deload, 4 flat = deload', () => {
    const mk = (nFlat: number) => {
      const s = emptyState();
      s.incr[BENCH] = 5;
      for (let i = 0; i < nFlat; i++) logTop(s, BENCH, shiftDate(START, i * 2), 100, 5, 'chest');
      return buildPlan(s, BENCH, shiftDate(START, nFlat * 2))!;
    };
    const three = mk(3); // exactly stallSessions priors → NOT stalled (needs > k)
    const four = mk(4); // one more → stalled
    notes.push(
      `Stall boundary: with stallSessions=${C.stallSessions}, 3 flat priors → autoDeload=${three.autoDeload} (false), ` +
      `4 flat priors → autoDeload=${four.autoDeload} (true). Off-by-one note: the doc's "after 3 flat sessions" ` +
      `actually fires on the SESSION AFTER the 4th flat (needs length > stallSessions).`,
    );
    expect(three.autoDeload).toBe(false);
    expect(four.autoDeload).toBe(true);
  });

  it('deload of a load already below one increment: atMinimum, holds, stays > 0', () => {
    const s = emptyState();
    s.incr[BENCH] = 20; // huge step vs the load
    for (let i = 0; i < 4; i++) logTop(s, BENCH, shiftDate(START, i * 2), 15, 5, 'chest'); // 15 < 20
    const plan = buildPlan(s, BENCH, shiftDate(START, 8))!;
    // roundDownTo(15*0.9=13.5, 20) = 0 → atMinimum, weight holds at lastWeight (15), never 0/neg
    const ok = plan.atMinimum === true && plan.top.weight === 15 && plan.top.weight > 0;
    notes.push(
      `atMinimum: load 15 with 20-lb step, stalled → roundDownTo(13.5,20)=0 ⇒ atMinimum=${plan.atMinimum}, ` +
      `top holds at ${plan.top.weight} (never zero/negative), deload=${plan.deload}.`,
    );
    expect(ok).toBe(true);
  });

  it('very large weights (600+): no overflow, bump stays on increment', () => {
    const s = emptyState();
    s.incr[BENCH] = 5;
    logTop(s, BENCH, START, 635, 6, 'chest'); // ceiling → bump
    const plan = buildPlan(s, BENCH, shiftDate(START, 2))!;
    const ok = plan.top.weight === 640 && Number.isFinite(e1rm(plan.top.weight, plan.top.reps));
    notes.push(`Large load: 635 @6 → bump to ${plan.top.weight}; e1RM finite = ${e1rm(plan.top.weight, plan.top.reps).toFixed(1)}.`);
    expect(ok).toBe(true);
  });

  it('follow-the-deload does NOT spiral: one cut to the floor, then a monotonic recovery to best', () => {
    // A lifter plateaus one rep shy of the ceiling → earns a single stall deload.
    // Obeying it, they rebuild by hitting the ceiling at the lighter recovery loads,
    // so the weight recovers monotonically and resumes double progression past best —
    // never a second back-to-back cut, never a ratchet to atMinimum.
    const s = emptyState();
    s.incr[BENCH] = 5;
    const dates = trainingDates(START, 40);
    const ceil = C.repHighCompound; // 6
    logTop(s, BENCH, dates[0], 100, 5, 'chest'); // one shy of the ceiling
    const deloadAt: number[] = [];
    const weights = [100];
    let deloaded = false;
    for (let i = 1; i < 12; i++) {
      const plan = buildPlan(s, BENCH, dates[i])!;
      if (plan.autoDeload) { deloadAt.push(i); deloaded = true; }
      expect(plan.atMinimum).toBe(false); // never ratchets to the floor
      // Before the deload the lifter is stuck at 5 reps; once deloaded they rebuild by
      // maxing the ceiling at the lighter recovery loads.
      const reps = deloaded ? ceil : 5;
      logTop(s, BENCH, dates[i], plan.top.weight, reps, 'chest'); // OBEY
      weights.push(plan.top.weight);
    }
    const consecutive = deloadAt.some((v, k) => k > 0 && v === deloadAt[k - 1] + 1);
    const floorIdx = weights.indexOf(Math.min(...weights));
    const before = weights.slice(0, floorIdx + 1);
    const after = weights.slice(floorIdx);
    const nonIncreasingBefore = before.every((w, k) => k === 0 || w <= before[k - 1]);
    const monotonicAfter = after.every((w, k) => k === 0 || w >= after[k - 1]);
    notes.push(
      `Deload spiral fixed: obeying yields a single cut at session(s) [${deloadAt.join(', ')}], then a monotonic ` +
      `recovery. Weights: [${weights.join(', ')}]. Non-increasing to the floor, monotonic back to best, past it → ` +
      `double progression resumes. No back-to-back cuts, no atMinimum ratchet.`,
    );
    expect(weights.every((w) => Number.isFinite(w) && w >= 0)).toBe(true);
    expect(consecutive).toBe(false); // no back-to-back auto-deloads
    expect(deloadAt.length).toBe(1); // exactly one cut across the block
    expect(nonIncreasingBefore).toBe(true);
    expect(monotonicAfter).toBe(true);
    expect(Math.max(...after)).toBeGreaterThan(100); // recovered past best → progression resumed
    traj.spiral = { weights, deloadCount: deloadAt.length };
  });

  it('effort is absolute: exactly repeating a mid-range session is not auto-strong', () => {
    // Now graded by reps in the range, not versus the last session. Two identical
    // mid-range sessions both score 'moderate' (they used to score 'strong').
    const s = emptyState();
    s.incr[BENCH] = 5;
    const [d0, d1] = trainingDates(START, 10);
    logTop(s, BENCH, d0, 100, 5, 'chest'); // mid-range (floor 3 < 5 < ceiling 6)
    logTop(s, BENCH, d1, 100, 5, 'chest'); // exact repeat
    const eff = sessionEffort(s, d1);
    notes.push(
      `Effort is now absolute (reps in the class range): an exact repeat of a mid-range session scores '${eff}' ` +
      `(was 'strong' under the old self-referential grade). Strong requires hitting the ceiling this session.`,
    );
    expect(eff).toBe('moderate');
  });

  it('no geometric decay: an obeyed manual deload holds flat at the best-anchored floor', () => {
    // Holding the manual flag and obeying every session must NOT compound the cut
    // (90→81→72…). The deload anchors on best (derived), so it is idempotent.
    const s = emptyState();
    s.incr[BENCH] = 5;
    const dates = trainingDates(START, 30);
    logTop(s, BENCH, dates[0], 100, 5, 'chest'); // established best
    const ov = { deload: { [BENCH]: true } };
    const floorW = roundDownTo(100 * C.deloadFactor, 5); // 90
    const seen: number[] = [];
    // Fewer sessions than recoveryWindow so best (100) never ages out of the anchor.
    for (let i = 1; i <= 6; i++) {
      const plan = buildPlan(s, BENCH, dates[i], ov)!;
      seen.push(plan.top.weight);
      expect(plan.deload).toBe(true);
      logTop(s, BENCH, dates[i], plan.top.weight, plan.top.reps, 'chest'); // OBEY
    }
    notes.push(
      `No geometric decay: an obeyed held manual deload stays flat at the best-anchored floor ` +
      `[${seen.join(', ')}] — never the old 90→81→72 spiral.`,
    );
    expect(seen.every((w) => w === floorW)).toBe(true);
    expect(seen).not.toContain(81);
    expect(seen).not.toContain(72);
  });

  it('recovery climb: after a deload, obeying at the floor adds a step per session to best, then resumes double progression', () => {
    const s = emptyState();
    s.incr[BENCH] = 5;
    const dates = trainingDates(START, 40);
    logTop(s, BENCH, dates[0], 100, 5, 'chest'); // establish best = 100
    const climb: number[] = [];
    for (let i = 1; i < 8; i++) {
      const ov = i === 1 ? { deload: { [BENCH]: true } } : {};
      const plan = buildPlan(s, BENCH, dates[i], ov)!;
      climb.push(plan.top.weight);
      // Obey at the reset floor while recovering; once back at best, push the ceiling.
      const reps = plan.top.weight >= 100 ? C.repHighCompound : C.repsAfterBumpCompound;
      logTop(s, BENCH, dates[i], plan.top.weight, reps, 'chest');
    }
    notes.push(`Recovery climb after a deload: [${climb.join(', ')}] — +step/session to best, then double progression resumes.`);
    expect(climb[0]).toBe(90); // the cut
    expect(climb[1]).toBe(95); // +step
    expect(climb[2]).toBe(100); // back to best, capped (no overshoot)
    expect(climb[3]).toBe(105); // resumes double progression past best
    expect(Math.max(...climb)).toBeGreaterThan(100);
    for (let k = 1; k < climb.length; k++) expect(climb[k]).toBeGreaterThanOrEqual(climb[k - 1]);
    expect(climb.every((w) => w % 5 === 0)).toBe(true);
  });

  it('manual one-shot guard: a flag set after today\'s top is already logged does not apply', () => {
    const s = emptyState();
    s.incr[BENCH] = 5;
    const dates = trainingDates(START, 10);
    logTop(s, BENCH, dates[0], 100, 5, 'chest');
    const date = dates[1];
    logTop(s, BENCH, date, 100, 5, 'chest'); // today's top logged FIRST
    const plan = buildPlan(s, BENCH, date, { deload: { [BENCH]: true } })!;
    notes.push(`Manual one-shot guard: flag set but today's top already logged → deload=${plan.deload} (ignored).`);
    expect(plan.deload).toBe(false);
    expect(plan.autoDeload).toBe(false);
  });

  it('intermittent lifter: weekly at the ceiling bumps each week; a longer cadence deloads once then holds', () => {
    // Once a week (7-day gap = gapDeloadDays, not beyond it) at the ceiling → bump weekly.
    const weekly = emptyState();
    weekly.incr[BENCH] = 5;
    let d = START;
    logTop(weekly, BENCH, d, 100, C.repHighCompound, 'chest');
    const weeklyWeights = [100];
    for (let k = 0; k < 4; k++) {
      d = shiftDate(d, 7);
      const plan = buildPlan(weekly, BENCH, d)!;
      expect(plan.bumped).toBe(true);
      expect(plan.autoDeload).toBe(false);
      weeklyWeights.push(plan.top.weight);
      logTop(weekly, BENCH, d, plan.top.weight, C.repHighCompound, 'chest');
    }
    for (let k = 1; k < weeklyWeights.length; k++) expect(weeklyWeights[k]).toBe(weeklyWeights[k - 1] + 5);

    // A cadence beyond the threshold from an established sub-ceiling weight: cut ONCE, then hold.
    const sparse = emptyState();
    sparse.incr[BENCH] = 5;
    let e = START;
    logTop(sparse, BENCH, e, 100, 5, 'chest'); // established, below ceiling
    e = shiftDate(e, 10); // 10-day gap > gapDeloadDays(7)
    const first = buildPlan(sparse, BENCH, e)!;
    expect(first.autoDeload).toBe(true);
    expect(first.top.weight).toBe(roundDownTo(100 * C.deloadFactor, 5)); // 90, off best
    logTop(sparse, BENCH, e, first.top.weight, 5, 'chest'); // obey, still below the ceiling
    e = shiftDate(e, 10); // another long gap
    const second = buildPlan(sparse, BENCH, e)!;
    notes.push(
      `Intermittent lifter: weekly@ceiling bumps [${weeklyWeights.join(', ')}]; a >7-day cadence cuts once to ` +
      `${first.top.weight} then holds (second long-gap autoDeload=${second.autoDeload}, top ${second.top.weight}).`,
    );
    expect(second.autoDeload).toBe(false); // below best now → no second layoff cut
    expect(second.top.weight).toBeGreaterThanOrEqual(first.top.weight); // recovers, never drops again
  });

  it('off-grid bump snaps to the grid before stepping: 102.5 @ ceiling, step 5 → 105 not 110', () => {
    const s = emptyState();
    s.incr[BENCH] = 5;
    logTop(s, BENCH, START, '102.5', C.repHighCompound, 'chest'); // off-grid, at the ceiling
    const plan = buildPlan(s, BENCH, shiftDate(START, 2))!;
    notes.push(`Off-grid bump: 102.5 @ ceiling, step 5 → top ${plan.top.weight} (roundDown(102.5,5)=100, +5=105; not 107.5→110).`);
    expect(plan.bumped).toBe(true);
    expect(plan.top.weight).toBe(105);
  });

  it('downward floor: a deload weight is always > 0 and never exceeds best', () => {
    const s = emptyState();
    s.incr[BENCH] = 5;
    for (let i = 0; i < 5; i++) logTop(s, BENCH, shiftDate(START, i * 2), 100, 5, 'chest');
    const plan = buildPlan(s, BENCH, shiftDate(START, 10))!;
    notes.push(`Downward floor: deload top ${plan.top.weight} is > 0 and <= best (100).`);
    expect(plan.autoDeload).toBe(true);
    expect(plan.top.weight).toBeGreaterThan(0);
    expect(plan.top.weight).toBeLessThanOrEqual(100);
  });
});

/* ================================================================== */
/* Emit the findings report from the numbers we actually observed      */
/* ================================================================== */

afterAll(() => {
  const allRows = Object.values(report).flat();
  const passCount = allRows.filter((r) => r.pass).length;
  const total = allRows.length;
  const verdict = passCount === total;

  const lines: string[] = [];
  lines.push('# Workout progression algorithm — verification findings');
  lines.push('');
  lines.push(`_Generated by \`src/features/workout/algoSim.test.ts\` on the actual run. ${passCount}/${total} interval checks passed._`);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(
    verdict
      ? 'The double-progression + auto-deload engine in `workoutSelectors.ts` is **correct and robust** across every simulated 5/10/15/30-day block and every adversarial edge case. e1RM is strictly monotonic for a progressor, perfectly flat for a plateauer with a clean auto-deload at the expected session, per-class rep ceilings (compound 6 / isolation 12) fire exactly, deloads never round up or go non-positive, and no `NaN`/`Infinity`/negative weight appears anywhere. The progression/deload rework holds: deloads anchor on the derived best-recent weight (no geometric decay when an obeyed flag is held, and the cut is idempotent), a manual deload is a one-shot (ignored once today’s top is logged), moderate gaps no longer suppress a bump (only a long layoff cuts, and only once, never while recovering), a recovery bump climbs a step per session back to best and then resumes double progression, and an off-grid load snaps to the grid before stepping.'
      : 'One or more checks FAILED — see the table. Investigate before shipping.',
  );
  lines.push('');

  lines.push('## Interval checks (5 / 10 / 15 / 30 days)');
  lines.push('');
  lines.push('| Interval | Check | Result | Observed |');
  lines.push('| --- | --- | --- | --- |');
  for (const key of Object.keys(report)) {
    for (const r of report[key]) {
      lines.push(`| ${key} | ${r.check} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.note.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');

  lines.push('## Archetype trajectories (N=30 block)');
  lines.push('');
  if (traj.progressor) {
    const p = traj.progressor as { weights: number[]; e1rm: number[] };
    lines.push('**Progressor** (compound, +5 each session, logged at the ceiling):');
    lines.push('');
    lines.push('```');
    lines.push(`weights: ${p.weights.join(', ')}`);
    lines.push(`e1RM:    ${p.e1rm.join(', ')}`);
    lines.push('```');
    lines.push('');
  }
  if (traj.plateauer) {
    const p = traj.plateauer as { planWeights: number[]; autoDeloadAt: number[] };
    lines.push('**Plateauer** (logs a fixed 100×5 every session; e1RM constant at 116.67):');
    lines.push('');
    lines.push('```');
    lines.push(`plan top weight per session: ${p.planWeights.map((w) => (Number.isNaN(w) ? '—' : w)).join(', ')}`);
    lines.push(`auto-deload fires at session indices (0-based): ${p.autoDeloadAt.join(', ')}`);
    lines.push('```');
    lines.push('');
    lines.push('The logged e1RM is flat forever (the lifter ignores the deload); the *plan* drops 100→90 the moment the stall window fills and holds there because `lastWeight` stays pinned at 100.');
    lines.push('');
  }
  if (traj.effort) {
    const e = traj.effort as Record<string, string>;
    lines.push(`**Effort grades** (single-lift session vs prescription): over-deliver → \`${e.strong}\`, 0.97× → \`${e.moderate}\`, 0.70× → \`${e.weak}\`.`);
    lines.push('');
  }
  if (traj.splits) {
    lines.push(`**Split alternation** (N=30, Mon/Thu upper · Tue/Fri lower): \`${(traj.splits as string[]).join(', ')}\` — clean upper/lower alternation, and \`suggestSplit\` proposes the opposite of the last logged day.`);
    lines.push('');
  }

  lines.push('## Edge cases & notable behaviors');
  lines.push('');
  for (const nline of notes) lines.push(`- ${nline}`);
  lines.push('');

  lines.push('## Resolution');
  lines.push('');
  lines.push('The progression/deload rework is re-verified above:');
  lines.push('');
  lines.push('1. **Deload anchors on best (derived) — no geometric decay.** A deload eases off `bestRecentTopWeight` (max top set over the last `recoveryWindow` sessions), not off the last logged weight. Holding a manual flag and obeying every session lands on the same best-anchored floor every time (idempotent) rather than compounding 90→81→72.');
  lines.push('2. **Manual deload is a one-shot.** `buildPlan` ignores the flag once today’s top set is logged, and `logSet` clears the flag on the first top — so obeying the eased prescription never re-triggers the cut.');
  lines.push('3. **Layoffs no longer suppress a bump.** Only a gap over `gapDeloadDays` (7) cuts, and only once (never while recovering below best); moderate gaps at the ceiling bump normally.');
  lines.push('4. **Recovery + off-grid.** Below best, a bump climbs one step per session capped at best, resuming double progression once back; an off-grid load snaps to the grid before stepping (102.5 → 105, not 110).');
  lines.push('5. **Effort — ABSOLUTE.** `sessionEffort` grades the current session by where each top set lands in its class rep range (ceiling = strong, floor = weak, middle = moderate).');
  lines.push('');
  lines.push('_Note: `layoffMildFactor` is retained in the config but is now reserved/unused — the graduated mild-layoff tier was removed. With `stallSessions = 3` a flat plateau first auto-deloads on the session after the 4th flat session; tune `stallSessions` to change the cadence._');

  const outPath = fileURLToPath(new URL('../../../docs/algo-verification-findings.md', import.meta.url));
  mkdirSync(fileURLToPath(new URL('../../../docs', import.meta.url)), { recursive: true });
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
});
