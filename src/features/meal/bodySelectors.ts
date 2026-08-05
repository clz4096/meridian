/**
 * Food & Body selectors — the nutrition half of the engine (spec §5).
 *
 * Pure functions over bodyweight readings + meal logs: smooth the weigh-in trend,
 * back out maintenance calories empirically from intake vs. weight change, and
 * decide whether to nudge the daily calorie target. No clock, no DOM, no mutation,
 * so every rule here is deterministic and property-testable in isolation.
 *
 * Bodyweight readings live in the workout store (`WorkoutState.bw`); these
 * selectors take that map directly rather than the whole state, so they stay
 * single-purpose and don't couple the two stores.
 */
import type { MealState, Numeric } from '@/core/types';
import { toNum } from '@/core/util';
import { mealsOn } from '@/features/meal/mealSelectors';

export interface BodyConfig {
  /** trailing window (days) for the smoothed bodyweight slope */
  bwWindowDays: number;
  /** minimum weigh-ins in-window before the slope is trusted */
  bwMinReadings: number;
  /** trailing window (days) for the empirical TDEE estimate */
  tdeeWindowDays: number;
  /** minimum logged meal-days in-window before TDEE is trusted */
  tdeeMinLoggedDays: number;
  /** target rate of gain (lb/week) and its acceptable band + hard cap */
  rateTargetLbPerWk: number;
  rateBandLo: number;
  rateBandHi: number;
  rateCap: number;
  /** how far below target the slope must sit before calories are raised */
  rateTolerance: number;
  /** biggest single calorie adjustment (kcal) */
  adjustStepCapKcal: number;
  /** minimum adherence (0–1) before the target is allowed to rise */
  adherenceGate: number;
  /** energy per pound of bodyweight change */
  kcalPerLb: number;
  /** protein target as grams per pound of current bodyweight */
  proteinPerLb: number;
}

export const DEFAULT_BODY_CONFIG: BodyConfig = {
  bwWindowDays: 14,
  bwMinReadings: 4,
  tdeeWindowDays: 14,
  tdeeMinLoggedDays: 10,
  rateTargetLbPerWk: 0.8,
  rateBandLo: 0.5,
  rateBandHi: 1.0,
  rateCap: 1.25,
  rateTolerance: 0.25,
  adjustStepCapKcal: 250,
  adherenceGate: 0.9,
  kcalPerLb: 3500,
  proteinPerLb: 1.0,
};

/* ================================================================== */
/* Date + reading helpers                                              */
/* ================================================================== */

/** Whole days from `a` to `b` (UTC, DST-independent). Positive when b is later. */
function dayGap(a: string, b: string): number {
  const x = Date.parse(a + 'T00:00:00Z');
  const y = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(x) || Number.isNaN(y)) return 0;
  return Math.round((y - x) / 86_400_000);
}

interface Reading {
  date: string;
  offset: number; // whole days before `today` (0 = today), used as the regression x
  lb: number;
}

/** Positive-weight readings within [today − windowDays, today], ascending by date. */
function windowReadings(bw: Record<string, Numeric>, today: string, windowDays: number): Reading[] {
  const out: Reading[] = [];
  for (const [date, v] of Object.entries(bw ?? {})) {
    const g = dayGap(date, today);
    if (g < 0 || g > windowDays) continue;
    const lb = toNum(v);
    if (lb > 0) out.push({ date, offset: -g, lb });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Latest positive weigh-in on or before `today`, or null. */
export function currentWeight(bw: Record<string, Numeric>, today: string): number | null {
  let best: { date: string; lb: number } | null = null;
  for (const [date, v] of Object.entries(bw ?? {})) {
    if (date > today) continue;
    const lb = toNum(v);
    if (lb <= 0) continue;
    if (!best || date > best.date) best = { date, lb };
  }
  return best ? best.lb : null;
}

/* ================================================================== */
/* Trend, calories, TDEE                                               */
/* ================================================================== */

/**
 * Smoothed bodyweight trend in lb/week — the least-squares slope over the
 * trailing window. Returns null when there are too few weigh-ins to trust it,
 * so callers never react to a single noisy reading.
 */
export function bodyweightSlope(
  bw: Record<string, Numeric>,
  today: string,
  config: BodyConfig = DEFAULT_BODY_CONFIG,
): number | null {
  const pts = windowReadings(bw, today, config.bwWindowDays);
  if (pts.length < config.bwMinReadings) return null;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    n++;
    sx += p.offset;
    sy += p.lb;
    sxx += p.offset * p.offset;
    sxy += p.offset * p.lb;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null; // all readings on one day → no slope
  const perDay = (n * sxy - sx * sy) / denom;
  return perDay * 7;
}

/** Calories logged on a date (0 when nothing is logged). */
export function dailyCalories(state: MealState, date: string): number {
  return mealsOn(state, date).reduce((a, m) => a + toNum(m.cal, 0), 0);
}

/** Logged calories for each of the trailing `windowDays`, days with none omitted. */
function windowCalories(state: MealState, today: string, windowDays: number): number[] {
  const out: number[] = [];
  for (let g = 0; g < windowDays; g++) {
    const c = dailyCalories(state, shiftBack(today, g));
    if (c > 0) out.push(c);
  }
  return out;
}

/** ISO date `g` whole days before `today` (UTC). */
function shiftBack(today: string, g: number): string {
  const t = Date.parse(today + 'T00:00:00Z');
  return new Date(t - g * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Empirical maintenance (TDEE), learned from the trailing window:
 *   TDEE ≈ mean daily intake − (weight change in lb × kcalPerLb / days)
 * Returns null when logging is too thin to trust (fewer than `tdeeMinLoggedDays`
 * meal-days, or fewer than two weigh-ins to measure a change).
 */
export function empiricalTDEE(
  state: MealState,
  bw: Record<string, Numeric>,
  today: string,
  config: BodyConfig = DEFAULT_BODY_CONFIG,
): number | null {
  const kcals = windowCalories(state, today, config.tdeeWindowDays);
  if (kcals.length < config.tdeeMinLoggedDays) return null;
  const meanIntake = kcals.reduce((a, c) => a + c, 0) / kcals.length;

  const pts = windowReadings(bw, today, config.tdeeWindowDays);
  if (pts.length < 2) return null;
  const start = pts[0];
  const end = pts[pts.length - 1];
  const spanDays = dayGap(start.date, end.date);
  if (spanDays <= 0) return null;
  const deltaLb = end.lb - start.lb;
  return Math.round(meanIntake - (deltaLb * config.kcalPerLb) / spanDays);
}

/** Sex used by the Mifflin–St Jeor cold-start estimate. */
export type Sex = 'male' | 'female';

/**
 * Cold-start maintenance (Mifflin–St Jeor × activity) for when the logs are too
 * thin for an empirical estimate. Activity is a multiplier (~1.4 sedentary …
 * ~1.7 very active); ~1.5 fits a lifter training a few days a week.
 */
export function mifflinMaintenance(p: {
  weightLb: number;
  heightIn: number;
  age: number;
  sex: Sex;
  activity: number;
}): number {
  const kg = p.weightLb * 0.453592;
  const cm = p.heightIn * 2.54;
  const bmr = 10 * kg + 6.25 * cm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  return Math.round(bmr * p.activity);
}

/** Maintenance to use today: the empirical estimate if trustworthy, else the cold-start. */
export function maintenance(
  state: MealState,
  bw: Record<string, Numeric>,
  today: string,
  coldStart: number,
  config: BodyConfig = DEFAULT_BODY_CONFIG,
): number {
  return empiricalTDEE(state, bw, today, config) ?? Math.round(coldStart);
}

/* ================================================================== */
/* Adherence + the calorie decision                                    */
/* ================================================================== */

/**
 * Adherence over the window: mean logged intake ÷ target (clamped ≥ 0). 0 when
 * nothing is logged, so a non-logger never trips the "raise" branch.
 */
export function adherence(
  state: MealState,
  targetKcal: number,
  today: string,
  config: BodyConfig = DEFAULT_BODY_CONFIG,
): number {
  if (targetKcal <= 0) return 0;
  const kcals = windowCalories(state, today, config.tdeeWindowDays);
  if (kcals.length === 0) return 0;
  const mean = kcals.reduce((a, c) => a + c, 0) / kcals.length;
  return Math.max(0, mean / targetKcal);
}

export type CalorieVerdict = 'raise' | 'trim' | 'hold' | 'hit-target' | 'insufficient';

export interface CalorieAdjustment {
  verdict: CalorieVerdict;
  deltaKcal: number; // signed change to apply to the daily target (0 unless raise/trim)
  slopeLbPerWk: number | null;
  reason: string;
}

/**
 * The periodic calorie decision (spec §5.4). Adherence-gated so the target can
 * only rise when the user is actually eating the current one — otherwise the fix
 * is "hit your target", never a bigger number. Steps are capped so it never
 * overshoots, and a too-fast gain trims instead.
 */
export function calorieAdjustment(
  slopeLbPerWk: number | null,
  adherenceRatio: number,
  config: BodyConfig = DEFAULT_BODY_CONFIG,
): CalorieAdjustment {
  if (slopeLbPerWk == null) {
    return { verdict: 'insufficient', deltaKcal: 0, slopeLbPerWk, reason: 'not enough weigh-ins yet' };
  }
  const target = config.rateTargetLbPerWk;
  const step = (rate: number) => Math.min(config.adjustStepCapKcal, Math.max(0, Math.round((rate * config.kcalPerLb) / 7)));

  if (slopeLbPerWk > config.rateCap) {
    return {
      verdict: 'trim',
      deltaKcal: -step(slopeLbPerWk - target),
      slopeLbPerWk,
      reason: `gaining ${slopeLbPerWk.toFixed(2)} lb/wk — over the ${config.rateCap} cap`,
    };
  }
  if (adherenceRatio < config.adherenceGate) {
    return {
      verdict: 'hit-target',
      deltaKcal: 0,
      slopeLbPerWk,
      reason: `eating ${Math.round(adherenceRatio * 100)}% of target — hit it before adding calories`,
    };
  }
  if (slopeLbPerWk < target - config.rateTolerance) {
    return {
      verdict: 'raise',
      deltaKcal: step(target - slopeLbPerWk),
      slopeLbPerWk,
      reason: `gaining ${slopeLbPerWk.toFixed(2)} lb/wk — below the ${target} target`,
    };
  }
  return { verdict: 'hold', deltaKcal: 0, slopeLbPerWk, reason: 'on pace' };
}

/** Protein target (grams) from current bodyweight. */
export function proteinTargetFor(currentLb: number, config: BodyConfig = DEFAULT_BODY_CONFIG): number {
  return Math.round(Math.max(0, currentLb) * config.proteinPerLb);
}
