/**
 * Food & Body selector tests (spec §5): bodyweight trend, empirical TDEE, the
 * adherence-gated calorie decision, protein, and the cold-start estimate.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, MealState, Numeric } from '@/core/types';
import {
  DEFAULT_BODY_CONFIG as C,
  adherence,
  bodyweightSlope,
  calorieAdjustment,
  currentWeight,
  empiricalTDEE,
  maintenance,
  mifflinMaintenance,
  proteinTargetFor,
} from '@/features/meal/bodySelectors';
import { shiftDate } from '@/core/util';

const D = (offset: number) => shiftDate('2025-02-01', offset); // D(0) is the reference "today"

/** MealState from a { isoDate: calories } map (one meal per day). */
function mealState(byDate: Record<string, number>): MealState {
  const days: Record<string, MealState['days'][string]> = {};
  let n = 0;
  for (const [date, cal] of Object.entries(byDate)) {
    days[date] = [{ id: ('m' + n++) as EntityId, name: 'meal', cal, protein: 0 }];
  }
  return { settings: {}, days, tad: {}, _del: {} };
}
/** N trailing days ending at D(0), each logged with `cal`. */
function loggedDays(cal: number, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let g = 0; g < n; g++) out[D(-g)] = cal;
  return out;
}
const bw: (readings: Record<string, number>) => Record<string, Numeric> = (r) => r;

describe('bodyweight slope (lb/week)', () => {
  it('is null with too few weigh-ins', () => {
    expect(bodyweightSlope(bw({ [D(-2)]: 150, [D(-1)]: 151 }), D(0))).toBeNull();
  });
  it('recovers a steady +1 lb/week gain', () => {
    // 8 readings, +1/7 lb per day over two weeks → ~+1.0 lb/wk
    const r: Record<string, number> = {};
    for (let g = 0; g <= 14; g += 2) r[D(-g)] = 150 + ((14 - g) / 7) * 1;
    const s = bodyweightSlope(bw(r), D(0));
    expect(s).not.toBeNull();
    expect(s!).toBeCloseTo(1.0, 1);
  });
  it('is negative when weight trends down', () => {
    const r: Record<string, number> = {};
    for (let g = 0; g <= 14; g += 2) r[D(-g)] = 150 - ((14 - g) / 7) * 0.5;
    expect(bodyweightSlope(bw(r), D(0))!).toBeLessThan(0);
  });
  it('is ~0 for a flat trend', () => {
    const r: Record<string, number> = {};
    for (let g = 0; g <= 14; g += 2) r[D(-g)] = 150;
    expect(Math.abs(bodyweightSlope(bw(r), D(0))!)).toBeLessThan(0.01);
  });
});

describe('empirical TDEE', () => {
  it('backs maintenance out of intake and weight change', () => {
    // 2500 kcal/day for 14 logged days, +1 lb over the 14-day span → 2500 − 3500/14 = 2250
    const state = mealState(loggedDays(2500, 14));
    const weight = bw({ [D(-14)]: 100, [D(0)]: 101 });
    expect(empiricalTDEE(state, weight, D(0))).toBe(2250);
  });
  it('is null when too few days are logged', () => {
    const state = mealState(loggedDays(2500, 5)); // < tdeeMinLoggedDays
    const weight = bw({ [D(-14)]: 100, [D(0)]: 101 });
    expect(empiricalTDEE(state, weight, D(0))).toBeNull();
  });
  it('is null without two weigh-ins to measure a change', () => {
    const state = mealState(loggedDays(2500, 14));
    expect(empiricalTDEE(state, bw({ [D(0)]: 100 }), D(0))).toBeNull();
  });
  it('maintenance() falls back to the cold start when data is thin', () => {
    const state = mealState(loggedDays(2500, 3));
    expect(maintenance(state, bw({ [D(0)]: 100 }), D(0), 2150)).toBe(2150);
  });
});

describe('Mifflin cold-start (Albert: 118 lb, 5’7″, 38, male, ~1.5)', () => {
  it('lands near ~2120 kcal', () => {
    const m = mifflinMaintenance({ weightLb: 118, heightIn: 67, age: 38, sex: 'male', activity: 1.5 });
    expect(m).toBeGreaterThanOrEqual(2090);
    expect(m).toBeLessThanOrEqual(2150);
  });
});

describe('calorie adjustment (adherence-gated)', () => {
  it('is insufficient without a slope', () => {
    expect(calorieAdjustment(null, 1.0).verdict).toBe('insufficient');
  });
  it('will not raise while adherence is below the gate — says hit your target', () => {
    const a = calorieAdjustment(0.3, 0.8); // under target but only eating 80%
    expect(a.verdict).toBe('hit-target');
    expect(a.deltaKcal).toBe(0);
  });
  it('raises when adhering and gaining too slowly, capped', () => {
    const a = calorieAdjustment(0.3, 0.95); // eating 95%, gaining 0.3 < 0.8 target
    expect(a.verdict).toBe('raise');
    expect(a.deltaKcal).toBeGreaterThan(0);
    expect(a.deltaKcal).toBeLessThanOrEqual(C.adjustStepCapKcal);
  });
  it('trims when gaining past the cap — regardless of adherence', () => {
    const a = calorieAdjustment(1.6, 0.5); // 1.6 > 1.25 cap
    expect(a.verdict).toBe('trim');
    expect(a.deltaKcal).toBeLessThan(0);
    expect(a.deltaKcal).toBeGreaterThanOrEqual(-C.adjustStepCapKcal);
  });
  it('holds when on pace', () => {
    expect(calorieAdjustment(0.75, 0.95).verdict).toBe('hold');
  });
});

describe('adherence + protein + current weight', () => {
  it('adherence is mean intake over the target', () => {
    const state = mealState(loggedDays(2000, 14));
    expect(adherence(state, 2500, D(0))).toBeCloseTo(0.8, 2);
    expect(adherence(mealState({}), 2500, D(0))).toBe(0);
  });
  it('protein target scales with bodyweight', () => {
    expect(proteinTargetFor(150)).toBe(150);
    expect(proteinTargetFor(118)).toBe(118);
  });
  it('current weight is the latest reading on or before today', () => {
    expect(currentWeight(bw({ [D(-3)]: 149, [D(-1)]: 151 }), D(0))).toBe(151);
    expect(currentWeight(bw({ [D(1)]: 160 }), D(0))).toBeNull(); // future reading ignored
    expect(currentWeight(bw({}), D(0))).toBeNull();
  });
});
