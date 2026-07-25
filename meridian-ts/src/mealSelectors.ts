/**
 * Meridian — pure meal & supplement selectors.
 *
 * Extracted from `renderWeight`. No DOM, no clock: `today` is a parameter.
 *
 * The macro model is deliberately honest about what the app actually stores.
 * A meal records `cal` and `protein` as two independently entered numbers —
 * there are no carb or fat fields — so calories are NOT derived from macros.
 * Rather than assert a relationship that does not exist, this module exposes
 * `macroConsistency`, which flags entries that are physically impossible
 * (protein alone contributes 4 kcal/g, so `cal` can never be below
 * `4 x protein`). That turns a silent data-entry error into a visible one.
 */

import type { IsoDate, Meal, MealSettings, MealState, Numeric } from './types.js';
import { shiftDate, toId, toNum, isUnparseableNumber } from './workoutSelectors.js';

/** Energy density in kcal per gram. */
export const KCAL_PER_G = { protein: 4, carb: 4, fat: 9, alcohol: 7 } as const;

/* ================================================================== */
/* Derived shapes                                                      */
/* ================================================================== */

export interface DayTotals {
  calories: number;
  protein: number;
  /** kcal above (or below) maintenance */
  surplus: number;
  /** kcal remaining to reach the daily target */
  remaining: number;
  mealCount: number;
  estimatedCount: number;
}

export interface MacroIssue {
  mealId: string;
  name: string;
  kind: 'impossible-calories' | 'unparseable-calories' | 'unparseable-protein' | 'negative';
  detail: string;
}

export interface MealTargets {
  current: number | null;
  goal: number | null;
  maintenance: number;
  surplus: number;
  dailyCalories: number;
  proteinTarget: number;
}

export interface MealViewModel {
  date: string;
  isToday: boolean;
  targets: MealTargets;
  meals: Meal[];
  totals: DayTotals;
  calorieProgress: number;
  proteinProgress: number;
  issues: MacroIssue[];
  supplement: SupplementView;
}

export interface SupplementView {
  todayCount: number;
  /** doses across the trailing window, inclusive of `date` */
  trailingCount: number;
  windowDays: number;
  steadyState: boolean;
}

export interface MealConfig {
  defaultMaintenance: number;
  defaultSurplus: number;
  defaultProteinTarget: number;
  supplementWindowDays: number;
  /** doses within the window that count as steady state */
  steadyStateDoses: number;
}

export const DEFAULT_MEAL_CONFIG: MealConfig = {
  defaultMaintenance: 2200,
  defaultSurplus: 500,
  defaultProteinTarget: 147,
  supplementWindowDays: 5,
  steadyStateDoses: 10,
};

/* ================================================================== */
/* Lookups                                                             */
/* ================================================================== */

function deadIds(state: MealState): Set<string> {
  return new Set(Object.keys(state._del ?? {}).map((k) => toId(k)));
}

/** Meals logged on a date, tombstoned rows excluded. Never returns undefined. */
export function mealsOn(state: MealState, date: string): Meal[] {
  const dead = deadIds(state);
  return (state.days?.[date] ?? []).filter((m) => m && !dead.has(toId(m.id)));
}

export function loggedDates(state: MealState): string[] {
  return Object.keys(state.days ?? {})
    .filter((d) => mealsOn(state, d).length > 0)
    .sort();
}

/* ================================================================== */
/* Macro math                                                          */
/* ================================================================== */

/**
 * Sum a day exactly.
 *
 * Sums integers where possible before touching floats, so a long day of
 * whole-number entries cannot accumulate binary drift.
 */
export function dayTotals(
  state: MealState,
  date: string,
  config: MealConfig = DEFAULT_MEAL_CONFIG,
): DayTotals {
  const meals = mealsOn(state, date);
  let calories = 0;
  let protein = 0;
  let estimatedCount = 0;
  for (const m of meals) {
    calories += toNum(m.cal, 0);
    protein += toNum(m.protein, 0);
    if (m.est) estimatedCount++;
  }
  const t = resolveTargets(state.settings, config);
  return {
    calories,
    protein,
    surplus: calories - t.maintenance,
    remaining: t.dailyCalories - calories,
    mealCount: meals.length,
    estimatedCount,
  };
}

/** Settings with defaults applied, so downstream never sees undefined. */
export function resolveTargets(
  settings: MealSettings | undefined,
  config: MealConfig = DEFAULT_MEAL_CONFIG,
): MealTargets {
  const s = settings ?? {};
  const maintenance = toNum(s.maintenance, config.defaultMaintenance) || config.defaultMaintenance;
  const surplus = toNum(s.surplus, config.defaultSurplus);
  const proteinTarget = toNum(s.proteinTarget, config.defaultProteinTarget) || config.defaultProteinTarget;
  const current = s.current === undefined ? null : toNum(s.current);
  const goal = s.goal === undefined ? null : toNum(s.goal);
  return {
    current,
    goal,
    maintenance,
    surplus,
    dailyCalories: maintenance + surplus,
    proteinTarget,
  };
}

/**
 * Flag entries whose macros cannot be true.
 *
 * Protein alone supplies 4 kcal/g, so `cal < 4 * protein` is physically
 * impossible and means one of the two numbers was mistyped. The old
 * `+x || 0` coercion turned "abc" into 0 silently; here it is reported.
 */
export function macroConsistency(state: MealState, date: string): MacroIssue[] {
  const issues: MacroIssue[] = [];
  for (const m of mealsOn(state, date)) {
    const id = toId(m.id);
    const name = String(m.name ?? '');
    if (isUnparseableNumber(m.cal as Numeric)) {
      issues.push({ mealId: id, name, kind: 'unparseable-calories', detail: `cal="${String(m.cal)}"` });
      continue;
    }
    if (isUnparseableNumber(m.protein as Numeric)) {
      issues.push({ mealId: id, name, kind: 'unparseable-protein', detail: `protein="${String(m.protein)}"` });
      continue;
    }
    const cal = toNum(m.cal, 0);
    const protein = toNum(m.protein, 0);
    if (cal < 0 || protein < 0) {
      issues.push({ mealId: id, name, kind: 'negative', detail: `cal=${cal} protein=${protein}` });
      continue;
    }
    const floor = protein * KCAL_PER_G.protein;
    if (protein > 0 && cal < floor) {
      issues.push({
        mealId: id,
        name,
        kind: 'impossible-calories',
        detail: `${cal} kcal cannot contain ${protein}g protein (needs at least ${floor})`,
      });
    }
  }
  return issues;
}

/** Convenience: kcal contributed by a macro split, for future carb/fat fields. */
export function caloriesFromMacros(macros: {
  protein?: Numeric;
  carb?: Numeric;
  fat?: Numeric;
  alcohol?: Numeric;
}): number {
  return (
    toNum(macros.protein, 0) * KCAL_PER_G.protein +
    toNum(macros.carb, 0) * KCAL_PER_G.carb +
    toNum(macros.fat, 0) * KCAL_PER_G.fat +
    toNum(macros.alcohol, 0) * KCAL_PER_G.alcohol
  );
}

/* ================================================================== */
/* Supplements                                                         */
/* ================================================================== */

export function supplementView(
  state: MealState,
  date: string,
  config: MealConfig = DEFAULT_MEAL_CONFIG,
): SupplementView {
  const todayCount = toNum(state.tad?.[date], 0);
  let trailingCount = 0;
  for (let i = 0; i < config.supplementWindowDays; i++) {
    trailingCount += toNum(state.tad?.[shiftDate(date, -i)], 0);
  }
  return {
    todayCount,
    trailingCount,
    windowDays: config.supplementWindowDays,
    steadyState: trailingCount >= config.steadyStateDoses,
  };
}

/* ================================================================== */
/* Trends                                                              */
/* ================================================================== */

/** Mean daily calories over the trailing window, ignoring days with no data. */
export function averageCalories(
  state: MealState,
  date: string,
  days: number,
  config: MealConfig = DEFAULT_MEAL_CONFIG,
): { average: number; daysCounted: number } {
  let sum = 0;
  let counted = 0;
  for (let i = 0; i < days; i++) {
    const d = shiftDate(date, -i);
    if (mealsOn(state, d).length === 0) continue;
    sum += dayTotals(state, d, config).calories;
    counted++;
  }
  return { average: counted > 0 ? sum / counted : 0, daysCounted: counted };
}

/* ================================================================== */
/* View model                                                          */
/* ================================================================== */

export function selectMealView(
  state: MealState,
  date: string,
  today: string,
  config: MealConfig = DEFAULT_MEAL_CONFIG,
): MealViewModel {
  const targets = resolveTargets(state.settings, config);
  const totals = dayTotals(state, date, config);
  const pct = (value: number, target: number): number =>
    target > 0 ? Math.max(0, Math.min(100, Math.round((100 * value) / target))) : 0;

  return {
    date,
    isToday: date === today,
    targets,
    meals: mealsOn(state, date),
    totals,
    calorieProgress: pct(totals.calories, targets.dailyCalories),
    proteinProgress: pct(totals.protein, targets.proteinTarget),
    issues: macroConsistency(state, date),
    supplement: supplementView(state, date, config),
  };
}

export type { IsoDate };
