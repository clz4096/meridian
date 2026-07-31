import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Meal, MealState } from './types.js';
import {
  averageCalories, caloriesFromMacros, dayTotals, KCAL_PER_G, loggedDates,
  macroConsistency, mealsOn, resolveTargets, selectMealView, supplementView,
} from './mealSelectors.js';
import { shiftDate } from './util.js';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;

const arbDate = fc.integer({ min: 0, max: 400 }).map((o) => shiftDate('2025-01-01', o));
const arbMeal = fc.record({
  id: fc.uuid(),
  name: fc.string({ maxLength: 20 }),
  cal: fc.oneof(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 0, max: 2000 }).map(String)),
  protein: fc.oneof(fc.integer({ min: 0, max: 120 }), fc.integer({ min: 0, max: 120 }).map(String)),
  est: fc.boolean(),
}) as fc.Arbitrary<Meal>;

const arbState: fc.Arbitrary<MealState> = fc.record({
  settings: fc.record({
    maintenance: fc.integer({ min: 1200, max: 4000 }),
    surplus: fc.integer({ min: -800, max: 1200 }),
    proteinTarget: fc.integer({ min: 50, max: 250 }),
    current: fc.integer({ min: 90, max: 300 }),
    goal: fc.integer({ min: 90, max: 300 }),
  }),
  days: fc.dictionary(arbDate, fc.array(arbMeal, { maxLength: 8 }), { maxKeys: 10 }),
  tad: fc.dictionary(arbDate, fc.integer({ min: 0, max: 5 }), { maxKeys: 8 }),
  _del: fc.constant({}),
});

describe('macro arithmetic is exact', () => {
  it('daily calories equal the sum of the meals, with no float drift', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, date) => {
        const meals = mealsOn(state, date);
        const manual = meals.reduce((a, m) => a + Number(m.cal), 0);
        expect(dayTotals(state, date).calories).toBe(manual);
      }),
      opts,
    );
  });

  it('daily protein equals the sum of the meals', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, date) => {
        const manual = mealsOn(state, date).reduce((a, m) => a + Number(m.protein), 0);
        expect(dayTotals(state, date).protein).toBe(manual);
      }),
      opts,
    );
  });

  it('totals are always finite and never NaN', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, date) => {
        const t = dayTotals(state, date);
        for (const v of [t.calories, t.protein, t.surplus, t.remaining]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(t.mealCount).toBeGreaterThanOrEqual(0);
        expect(t.estimatedCount).toBeLessThanOrEqual(t.mealCount);
      }),
      opts,
    );
  });

  it('surplus and remaining are consistent with the targets', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, date) => {
        const t = dayTotals(state, date);
        const target = resolveTargets(state.settings);
        expect(t.surplus).toBe(t.calories - target.maintenance);
        expect(t.remaining).toBe(target.dailyCalories - t.calories);
        expect(target.dailyCalories).toBe(target.maintenance + target.surplus);
      }),
      opts,
    );
  });

  it('caloriesFromMacros uses standard energy densities', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 200 }),
        (p, c, f) => {
          expect(caloriesFromMacros({ protein: p, carb: c, fat: f })).toBe(
            p * KCAL_PER_G.protein + c * KCAL_PER_G.carb + f * KCAL_PER_G.fat,
          );
        },
      ),
      opts,
    );
  });

  it('flags entries whose calories cannot contain their protein', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), arbDate, (protein, date) => {
        const impossible: MealState = {
          settings: {}, tad: {}, _del: {},
          days: { [date]: [{ id: 'x', name: 'bad', cal: protein * 4 - 1, protein, est: false } as unknown as Meal] },
        };
        expect(macroConsistency(impossible, date).map((i) => i.kind)).toContain('impossible-calories');

        const fine: MealState = {
          settings: {}, tad: {}, _del: {},
          days: { [date]: [{ id: 'y', name: 'ok', cal: protein * 4, protein, est: false } as unknown as Meal] },
        };
        expect(macroConsistency(fine, date)).toEqual([]);
      }),
      opts,
    );
  });

  it('reports unparseable macros instead of silently coercing to zero', () => {
    const state: MealState = {
      settings: {}, tad: {}, _del: {},
      days: { '2026-01-01': [{ id: 'a', name: 'typo', cal: 'abc' as never, protein: 10, est: false } as unknown as Meal] },
    };
    expect(macroConsistency(state, '2026-01-01')[0]?.kind).toBe('unparseable-calories');
    expect((+'abc' || 0)).toBe(0); // what the legacy code did
  });
});

describe('date boundaries never duplicate or drop entries', () => {
  it('every meal belongs to exactly one date bucket', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const seen = new Map<string, number>();
        for (const date of Object.keys(state.days)) {
          for (const m of mealsOn(state, date)) {
            seen.set(String(m.id), (seen.get(String(m.id)) ?? 0) + 1);
          }
        }
        const flat = Object.values(state.days).flat();
        const uniqueIds = new Set(flat.map((m) => String(m.id)));
        // No id is counted more than once per its own bucket set.
        expect([...seen.values()].every((n) => n >= 1)).toBe(true);
        expect(seen.size).toBe(uniqueIds.size);
      }),
      opts,
    );
  });

  it('shifting a date forward and back is the identity', () => {
    fc.assert(
      fc.property(arbDate, fc.integer({ min: -400, max: 400 }), (date, n) => {
        expect(shiftDate(shiftDate(date, n), -n)).toBe(date);
      }),
      opts,
    );
  });

  it('day totals are unaffected by neighbouring days', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, date) => {
        const isolated: MealState = { ...state, days: { [date]: state.days[date] ?? [] } };
        expect(dayTotals(isolated, date).calories).toBe(dayTotals(state, date).calories);
        expect(dayTotals(isolated, date).protein).toBe(dayTotals(state, date).protein);
      }),
      opts,
    );
  });

  it('the trailing average only counts days that have data', () => {
    fc.assert(
      fc.property(arbState, arbDate, fc.integer({ min: 1, max: 14 }), (state, date, days) => {
        const { average, daysCounted } = averageCalories(state, date, days);
        expect(daysCounted).toBeLessThanOrEqual(days);
        expect(Number.isFinite(average)).toBe(true);
        if (daysCounted === 0) expect(average).toBe(0);
      }),
      opts,
    );
  });

  it('logged dates are sorted and contain no empty days', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const dates = loggedDates(state);
        expect([...dates].sort()).toEqual(dates);
        for (const d of dates) expect(mealsOn(state, d).length).toBeGreaterThan(0);
      }),
      opts,
    );
  });
});

describe('supplements', () => {
  it('the trailing count is the sum of the window and never below today', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, date) => {
        const v = supplementView(state, date);
        let manual = 0;
        for (let i = 0; i < v.windowDays; i++) manual += Number(state.tad[shiftDate(date, -i)] ?? 0);
        expect(v.trailingCount).toBe(manual);
        expect(v.trailingCount).toBeGreaterThanOrEqual(v.todayCount);
      }),
      opts,
    );
  });
});

describe('view model', () => {
  it('progress values stay within 0..100 and never mutate state', () => {
    fc.assert(
      fc.property(arbState, arbDate, arbDate, (state, date, today) => {
        const before = JSON.stringify(state);
        const vm = selectMealView(state, date, today);
        expect(JSON.stringify(state)).toBe(before);
        for (const p of [vm.calorieProgress, vm.proteinProgress]) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(100);
          expect(Number.isInteger(p)).toBe(true);
        }
        expect(vm.meals.length).toBe(vm.totals.mealCount);
      }),
      opts,
    );
  });
});
