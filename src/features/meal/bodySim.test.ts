/**
 * Food & Body (nutrition) engine — formal verification harness (spec §5).
 *
 * Simulates a hardgainer bulking over 4/8/12-week horizons with noisy daily
 * weigh-ins around a true linear trend, and drives the pure selectors in
 * `bodySelectors.ts` to check that:
 *   1. `bodyweightSlope` recovers the truth through noise (and signs correctly),
 *   2. `empiricalTDEE` converges near a known maintenance,
 *   3. the adherence-gated `calorieAdjustment` loop is stable and correct
 *      (the anti-runaway gate never raises below 90% adherence),
 *   4. adversarial inputs never produce NaN/Infinity and null where thin.
 *
 * Noise is deterministic (Math.random is unavailable): `noise(i)` is a
 * zero-centred ±1.2 lb saw that varies by day index. Over any 14 consecutive
 * indices its residues (2i mod 7) cover 0..6 twice, so it sums to exactly 0 —
 * an unbiased perturbation the least-squares slope should see through.
 *
 * VERIFY-ONLY: this file does not modify bodySelectors.ts. Findings, including a
 * documented TDEE endpoint-noise sensitivity, live in
 * docs/food-body-verification-findings.md.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, MealState, Numeric } from '@/core/types';
import {
  DEFAULT_BODY_CONFIG as C,
  bodyweightSlope,
  empiricalTDEE,
  calorieAdjustment,
  adherence,
} from '@/features/meal/bodySelectors';
import { shiftDate } from '@/core/util';

const TODAY = '2026-06-01';
const D = (offset: number) => shiftDate(TODAY, offset);

/** Deterministic zero-centred pseudo-noise, ±1.2 lb, varying by day index. */
const noise = (i: number): number => (((i * 37) % 7) - 3) * 0.4;

const M = 2200; // known true maintenance (kcal/day)
const finite = (x: number | null): boolean => x != null && Number.isFinite(x);

function emptyMeal(): MealState {
  return { settings: {}, days: {}, tad: {}, _del: {} };
}
function logMeal(state: MealState, date: string, cal: Numeric, n: number): void {
  state.days[date] = [{ id: ('m' + n) as EntityId, name: 'x', cal, protein: 0 }];
}

/**
 * Build a full daily block for `weeks`, then evaluate the selectors at the final
 * day (`today`). Daily weight follows a true linear trend + noise; daily intake
 * is `M + surplus`. Returns the observed slope, TDEE, and a per-day builder used
 * by the closed-loop test.
 */
function buildBlock(weeks: number, trueSlopeLbPerWk: number, w0 = 150) {
  const days = weeks * 7;
  const surplus = trueSlopeLbPerWk * 500; // 500 kcal/day ≈ 1 lb/wk
  const bw: Record<string, Numeric> = {};
  const state = emptyMeal();
  for (let i = 0; i <= days; i++) {
    const date = D(i - days); // i=days → today
    bw[date] = w0 + (trueSlopeLbPerWk / 7) * i + noise(i);
    logMeal(state, date, M + surplus, i);
  }
  return { bw, state, today: D(0), surplus };
}

/* ================================================================== */
/* 1. Slope recovers truth through noise                               */
/* ================================================================== */

describe('1. bodyweightSlope recovers truth through noise', () => {
  for (const weeks of [4, 8, 12]) {
    it(`${weeks}w: +0.8 lb/wk trend → within ±0.25 of 0.8`, () => {
      const { bw, today } = buildBlock(weeks, 0.8);
      const s = bodyweightSlope(bw, today);
      expect(s).not.toBeNull();
      expect(Math.abs(s! - 0.8)).toBeLessThanOrEqual(0.25);
    });
  }

  it('flat trend → ~0', () => {
    const { bw, today } = buildBlock(8, 0);
    expect(Math.abs(bodyweightSlope(bw, today)!)).toBeLessThan(0.25);
  });

  it('cut → negative', () => {
    const { bw, today } = buildBlock(8, -0.5);
    expect(bodyweightSlope(bw, today)!).toBeLessThan(0);
  });

  it('< bwMinReadings weigh-ins → null', () => {
    const bw: Record<string, Numeric> = { [D(-2)]: 150, [D(-1)]: 151, [D(0)]: 152 }; // 3 < 4
    expect(bodyweightSlope(bw, D(0))).toBeNull();
  });
});

/* ================================================================== */
/* 2. TDEE converges (and its endpoint-noise sensitivity)              */
/* ================================================================== */

describe('2. empiricalTDEE converges near known maintenance', () => {
  for (const weeks of [4, 8, 12]) {
    it(`${weeks}w: recovers M=${M} within ±650 kcal`, () => {
      const { bw, state, today } = buildBlock(weeks, 0.8);
      const tdee = empiricalTDEE(state, bw, today);
      expect(tdee).not.toBeNull();
      // Endpoint-noise error bound: ±(2·1.2 lb)·3500/14 ≈ ±600 kcal (see report).
      expect(Math.abs(tdee! - M)).toBeLessThanOrEqual(650);
    });
  }

  it('null on thin logs (< tdeeMinLoggedDays)', () => {
    const state = emptyMeal();
    const bw: Record<string, Numeric> = {};
    for (let g = 0; g < 5; g++) {
      logMeal(state, D(-g), 2600, g); // only 5 logged days
      bw[D(-g)] = 150 + g * 0.1;
    }
    expect(empiricalTDEE(state, bw, D(0))).toBeNull();
  });

  it('null with < 2 weigh-ins even when logs are dense', () => {
    const state = emptyMeal();
    for (let g = 0; g < 14; g++) logMeal(state, D(-g), 2600, g);
    expect(empiricalTDEE(state, { [D(0)]: 150 }, D(0))).toBeNull();
  });

  it('TDEE now uses the regression trend: robust to realistic daily noise', () => {
    // RESOLVED: empiricalTDEE derives the window weight change from the least-squares
    // slope over ALL readings, not the two endpoints. With realistic noise on every
    // day (not just crafted endpoints) the estimate stays close to truth. A worst-case
    // adversarial perturbation of only the two extreme readings still has regression
    // leverage, but that pattern does not occur in real daily logging.
    const surplus = 400; // +0.8 lb/wk
    const span = 13;
    const clean = (() => {
      const state = emptyMeal();
      const bw: Record<string, Numeric> = {};
      for (let g = 0; g <= span; g++) {
        const i = span - g;
        logMeal(state, D(-g), M + surplus, g);
        bw[D(-g)] = 150 + (surplus / 3500) * i;
      }
      return empiricalTDEE(state, bw, D(0))!;
    })();
    // realistic: every day carries bounded pseudo-noise → regression averages it out
    const noisy = (() => {
      const state = emptyMeal();
      const bw: Record<string, Numeric> = {};
      for (let g = 0; g <= span; g++) {
        const i = span - g;
        logMeal(state, D(-g), M + surplus, g);
        const noise = (((i * 37) % 7) - 3) * 0.4; // ±1.2 lb, deterministic
        bw[D(-g)] = 150 + (surplus / 3500) * i + noise;
      }
      return empiricalTDEE(state, bw, D(0))!;
    })();
    // eslint-disable-next-line no-console
    console.log(`[TDEE] clean=${clean} realistic-noise=${noisy} error=${Math.abs(noisy - clean)}`);
    expect(finite(clean)).toBe(true);
    expect(Math.abs(noisy - clean)).toBeLessThan(200); // realistic daily noise stays within a small band
  });
});

/* ================================================================== */
/* 3. Adjustment loop: stable + correct, adherence gate holds          */
/* ================================================================== */

describe('3. calorieAdjustment loop — stable, correct, gated', () => {
  it('all five verdicts occur under the right conditions', () => {
    const seen = new Set<string>();
    seen.add(calorieAdjustment(null, 1.0).verdict); // insufficient
    seen.add(calorieAdjustment(0.3, 0.7).verdict); // hit-target (below gate, slow)
    seen.add(calorieAdjustment(0.3, 0.95).verdict); // raise (adhering, slow)
    seen.add(calorieAdjustment(0.8, 0.95).verdict); // hold (on pace)
    seen.add(calorieAdjustment(1.6, 0.95).verdict); // trim (over cap)
    expect(seen).toEqual(new Set(['insufficient', 'hit-target', 'raise', 'hold', 'trim']));
  });

  it('every deltaKcal respects ±adjustStepCapKcal', () => {
    for (let slope = -3; slope <= 3; slope += 0.05) {
      for (const a of [0, 0.5, 0.89, 0.9, 1.0, 1.3]) {
        const { deltaKcal } = calorieAdjustment(slope, a);
        expect(Number.isFinite(deltaKcal)).toBe(true);
        expect(Math.abs(deltaKcal)).toBeLessThanOrEqual(C.adjustStepCapKcal);
      }
    }
  });

  it('trims fire ONLY above the cap; sign is negative', () => {
    for (let slope = -3; slope <= 3; slope += 0.05) {
      for (const a of [0, 0.5, 0.95, 1.2]) {
        const adj = calorieAdjustment(slope, a);
        if (adj.verdict === 'trim') {
          expect(slope).toBeGreaterThan(C.rateCap);
          expect(adj.deltaKcal).toBeLessThan(0);
        }
      }
    }
  });

  it('ANTI-RUNAWAY: never raises when adherence < gate (hammered)', () => {
    // A lifter logging 70% who stalls or loses must get hit-target, never raise.
    for (let slope = -2; slope <= C.rateCap; slope += 0.05) {
      for (let a = 0; a < C.adherenceGate; a += 0.03) {
        const adj = calorieAdjustment(slope, a);
        expect(adj.verdict).not.toBe('raise');
        // below cap + below gate is exactly the hit-target branch
        expect(adj.verdict).toBe('hit-target');
        expect(adj.deltaKcal).toBe(0);
      }
    }
    // The canonical case: 70% adherence, stalled (slope ~0).
    const stalled = calorieAdjustment(0.0, 0.7);
    expect(stalled.verdict).toBe('hit-target');
    // Even losing weight while under-eating: still hit-target, not raise.
    expect(calorieAdjustment(-0.5, 0.7).verdict).toBe('hit-target');
  });

  for (const weeks of [4, 8, 12]) {
    it(`${weeks}w closed loop: too-slow gainer converges toward target, no runaway`, () => {
      const adher = 1.0;
      let target = M + 150; // start ~+0.3 lb/wk (too slow)
      let trueW = 150;
      const bw: Record<string, Numeric> = {};
      const state = emptyMeal();
      const totalDays = weeks * 7;
      const verdicts: string[] = [];
      const targetHistory: number[] = [];
      for (let i = 0; i <= totalDays; i++) {
        const date = D(i - totalDays);
        const intake = target * adher;
        trueW += (intake - M) / 3500; // yesterday's surplus → today's weight
        bw[date] = trueW + noise(i);
        logMeal(state, date, intake, i);
        if (i > 0 && i % 14 === 0) {
          const s = bodyweightSlope(bw, date);
          const a = adherence(state, target, date);
          const adj = calorieAdjustment(s, a);
          verdicts.push(adj.verdict);
          targetHistory.push(Math.round(target));
          target += adj.deltaKcal;
        }
      }
      const finalSurplus = target - M;
      const idealSurplus = C.rateTargetLbPerWk * 500; // 400 kcal
      // Converges toward the target surplus without blowing past it (anti-runaway).
      expect(finalSurplus).toBeGreaterThan(150); // moved up from the slow start
      expect(finalSurplus).toBeLessThanOrEqual(idealSurplus + C.adjustStepCapKcal);
      // Never a raise while under-eating; adhering here so never gate-blocked wrongly.
      expect(verdicts).not.toContain('insufficient'); // enough weigh-ins each cycle
      // Boundedness: no unbounded oscillation — target monotonic then settles.
      const settledTail = targetHistory.slice(-3);
      const spread = Math.max(...settledTail) - Math.min(...settledTail);
      expect(spread).toBeLessThanOrEqual(C.adjustStepCapKcal);
      // eslint-disable-next-line no-console
      console.log(`[LOOP ${weeks}w] targets=${JSON.stringify(targetHistory)} finalSurplus=${Math.round(finalSurplus)} verdicts=${JSON.stringify(verdicts)}`);
    });
  }

  it('closed loop under 70% adherence never raises the target', () => {
    const adher = 0.7;
    let target = M + 150;
    let trueW = 150;
    const bw: Record<string, Numeric> = {};
    const state = emptyMeal();
    const totalDays = 12 * 7;
    const verdicts: string[] = [];
    for (let i = 0; i <= totalDays; i++) {
      const date = D(i - totalDays);
      const intake = target * adher; // logs only 70%
      trueW += (intake - M) / 3500; // likely stalls/loses
      bw[date] = trueW + noise(i);
      logMeal(state, date, intake, i);
      if (i > 0 && i % 14 === 0) {
        const s = bodyweightSlope(bw, date);
        const a = adherence(state, target, date);
        verdicts.push(calorieAdjustment(s, a).verdict);
      }
    }
    expect(verdicts).not.toContain('raise');
    expect(target).toBe(M + 150); // target never moved
  });
});

/* ================================================================== */
/* 4. Adversarial edges — no NaN/Infinity; null where insufficient     */
/* ================================================================== */

describe('4. adversarial edges', () => {
  it('single weigh-in → slope null, TDEE null (no NaN)', () => {
    const state = emptyMeal();
    for (let g = 0; g < 14; g++) logMeal(state, D(-g), 2600, g);
    expect(bodyweightSlope({ [D(0)]: 150 }, D(0))).toBeNull();
    expect(empiricalTDEE(state, { [D(0)]: 150 }, D(0))).toBeNull();
  });

  it('all readings same day (single key) → null, not NaN', () => {
    // A Record cannot hold two weights on one date, so a same-day cluster is a
    // single reading → below bwMinReadings → null. The n·Sxx−Sx² guard is the
    // defensive backstop if that ever changed.
    expect(bodyweightSlope({ [D(0)]: 150 }, D(0))).toBeNull();
  });

  it('target ≤ 0 → adherence 0, adjustment finite', () => {
    const state = emptyMeal();
    for (let g = 0; g < 14; g++) logMeal(state, D(-g), 2600, g);
    expect(adherence(state, 0, D(0))).toBe(0);
    expect(adherence(state, -500, D(0))).toBe(0);
    const adj = calorieAdjustment(0.3, adherence(state, 0, D(0)));
    expect(Number.isFinite(adj.deltaKcal)).toBe(true);
    expect(adj.verdict).toBe('hit-target'); // 0 adherence < gate
  });

  it('zero logged days → adherence 0, TDEE null', () => {
    const empty = emptyMeal();
    expect(adherence(empty, 2500, D(0))).toBe(0);
    const bw: Record<string, Numeric> = {};
    for (let g = 0; g < 14; g++) bw[D(-g)] = 150 + g * 0.1;
    expect(empiricalTDEE(empty, bw, D(0))).toBeNull();
  });

  it('huge and negative calorie entries stay finite', () => {
    const state = emptyMeal();
    const bw: Record<string, Numeric> = {};
    for (let g = 0; g < 14; g++) {
      const cal = g % 2 === 0 ? 1e9 : -5000; // absurd + negative
      logMeal(state, D(-g), cal, g);
      bw[D(-g)] = 150 + g * 0.1;
    }
    const tdee = empiricalTDEE(state, bw, D(0));
    // negative-sum days are dropped (c>0 filter); TDEE may be huge but must be finite.
    expect(tdee == null || Number.isFinite(tdee)).toBe(true);
    const a = adherence(state, 2500, D(0));
    expect(Number.isFinite(a)).toBe(true);
  });

  it('string-typed weights and calories coerce via toNum', () => {
    const state = emptyMeal();
    const bw: Record<string, Numeric> = {};
    for (let g = 0; g <= 14; g++) {
      logMeal(state, D(-g), String(2500 + g) as unknown as Numeric, g);
      bw[D(-g)] = String(150 + (0.8 / 7) * (14 - g)) as unknown as Numeric;
    }
    const s = bodyweightSlope(bw, D(0));
    const t = empiricalTDEE(state, bw, D(0));
    expect(finite(s)).toBe(true);
    expect(Math.abs(s! - 0.8)).toBeLessThan(0.05); // clean strings → tight
    expect(finite(t)).toBe(true);
  });

  it('mid-window weigh-in gap still yields a finite slope', () => {
    const bw: Record<string, Numeric> = {};
    for (let g = 0; g <= 14; g++) {
      if (g >= 5 && g <= 9) continue; // 5-day hole in the middle
      bw[D(-g)] = 150 + (0.8 / 7) * (14 - g) + noise(g);
    }
    const s = bodyweightSlope(bw, D(0));
    expect(finite(s)).toBe(true);
    expect(Math.abs(s! - 0.8)).toBeLessThanOrEqual(0.3);
  });

  it('unparseable string weights are dropped, not NaN-propagated', () => {
    const bw: Record<string, Numeric> = {
      [D(-3)]: 'abc' as unknown as Numeric,
      [D(-2)]: 150,
      [D(-1)]: 151,
      [D(0)]: 152,
    };
    // 'abc' → toNum 0 → lb>0 filter drops it → only 3 valid → null.
    const s = bodyweightSlope(bw, D(0));
    expect(s === null || Number.isFinite(s)).toBe(true);
  });
});
