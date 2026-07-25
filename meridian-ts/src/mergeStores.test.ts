import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { MealState, WorkoutState } from './types.js';
import {
  mergeMeals, mergeScalarMap, mergeStore, mergeWorkout, sanitizeStore, unionById,
} from './mergeStores.js';
import { DEFAULT_CONFIG } from './types.js';
import { shiftDate } from './workoutSelectors.js';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;
const arbDate = fc.integer({ min: 0, max: 60 }).map((o) => shiftDate('2026-01-01', o));
const arbId = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');

const arbWK: fc.Arbitrary<WorkoutState> = fc.record({
  settings: fc.constant({}),
  days: fc.dictionary(arbDate, fc.array(fc.record({
    id: arbId, ex: fc.constantFrom('Bench', 'Squat'), type: fc.constantFrom('warm', 'top', 'back'),
    weight: fc.integer({ min: 1, max: 300 }), reps: fc.integer({ min: 1, max: 12 }),
  }), { maxLength: 4 }), { maxKeys: 4 }),
  bw: fc.dictionary(arbDate, fc.integer({ min: 100, max: 200 }), { maxKeys: 3 }),
  rpe: fc.constant({}),
  done: fc.dictionary(arbDate, fc.array(fc.constantFrom('Bench', 'Squat'), { maxLength: 2 }), { maxKeys: 3 }),
  sessionDone: fc.dictionary(arbDate, fc.boolean(), { maxKeys: 3 }),
  incr: fc.constant({}),
  _del: fc.dictionary(arbId, fc.integer({ min: 1, max: 1e12 }), { maxKeys: 3 }),
}) as fc.Arbitrary<WorkoutState>;

const ids = (s: WorkoutState): string[] =>
  Object.values(s.days).flat().map((x) => String(x.id)).sort();

describe('merge algebra on the real store shapes', () => {
  it('is idempotent', () => {
    fc.assert(fc.property(arbWK, (a) => {
      expect(ids(mergeWorkout(a, a, true))).toEqual(ids(mergeWorkout(mergeWorkout(a, a, true), a, true)));
    }), opts);
  });

  it('is commutative on surviving ids', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      expect(ids(mergeWorkout(a, b, true))).toEqual(ids(mergeWorkout(b, a, false)));
    }), opts);
  });

  it('is associative on surviving ids', () => {
    fc.assert(fc.property(arbWK, arbWK, arbWK, (a, b, c) => {
      const l = mergeWorkout(mergeWorkout(a, b, true), c, true);
      const r = mergeWorkout(a, mergeWorkout(b, c, true), true);
      expect(ids(l)).toEqual(ids(r));
    }), opts);
  });

  it('never resurrects a tombstoned row', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const dead = new Set([...Object.keys(a._del ?? {}), ...Object.keys(b._del ?? {})]);
      for (const id of ids(mergeWorkout(a, b, true))) expect(dead.has(id)).toBe(false);
    }), opts);
  });

  it('never drops a live row present on either side', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const dead = new Set([...Object.keys(a._del ?? {}), ...Object.keys(b._del ?? {})]);
      const live = new Set([...ids(a), ...ids(b)].filter((i) => !dead.has(i)));
      const out = new Set(ids(mergeWorkout(a, b, true)));
      for (const id of live) expect(out.has(id)).toBe(true);
    }), opts);
  });

  it('unions completion flags rather than picking a side', () => {
    fc.assert(fc.property(arbWK, arbWK, arbDate, (a, b, d) => {
      const merged = mergeWorkout(a, b, true);
      for (const ex of [...(a.done[d] ?? []), ...(b.done[d] ?? [])]) {
        expect(merged.done[d]).toContain(ex);
      }
    }), opts);
  });

  it('keeps disjoint scalar keys from both sides', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), fc.integer(), { maxKeys: 5 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), fc.integer(), { maxKeys: 5 }),
      fc.boolean(),
      (a, b, aWins) => {
        const out = mergeScalarMap(a, b, aWins);
        for (const k of [...Object.keys(a), ...Object.keys(b)]) expect(out).toHaveProperty(k);
        for (const k of Object.keys(a)) if (!(k in b)) expect(out[k]).toBe(a[k]);
        for (const k of Object.keys(b)) if (!(k in a)) expect(out[k]).toBe(b[k]);
      },
    ), opts);
  });

  it('unionById is stable and never yields duplicates', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ id: arbId }), { maxLength: 8 }),
      fc.array(fc.record({ id: arbId }), { maxLength: 8 }),
      (a, b) => {
        const out = unionById(a, b, new Set());
        expect(new Set(out.map((x) => String(x.id))).size).toBe(out.length);
      },
    ), opts);
  });

  it('two devices converge regardless of sync order', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const deviceA = mergeWorkout(mergeWorkout(a, b, true), b, true);
      const deviceB = mergeWorkout(mergeWorkout(b, a, true), a, true);
      expect(ids(deviceA)).toEqual(ids(deviceB));
    }), opts);
  });

  it('meals merge with the same guarantees', () => {
    const arbSG: fc.Arbitrary<MealState> = fc.record({
      settings: fc.constant({}),
      days: fc.dictionary(arbDate, fc.array(fc.record({
        id: arbId, name: fc.string({ maxLength: 6 }),
        cal: fc.integer({ min: 0, max: 900 }), protein: fc.integer({ min: 0, max: 60 }),
      }), { maxLength: 4 }), { maxKeys: 4 }),
      tad: fc.dictionary(arbDate, fc.integer({ min: 0, max: 4 }), { maxKeys: 3 }),
      _del: fc.dictionary(arbId, fc.integer({ min: 1 }), { maxKeys: 2 }),
    }) as fc.Arbitrary<MealState>;
    const mids = (s: MealState): string[] => Object.values(s.days).flat().map((m) => String(m.id)).sort();
    fc.assert(fc.property(arbSG, arbSG, (a, b) => {
      expect(mids(mergeMeals(a, b, true))).toEqual(mids(mergeMeals(b, a, false)));
      const dead = new Set([...Object.keys(a._del ?? {}), ...Object.keys(b._del ?? {})]);
      for (const id of mids(mergeMeals(a, b, true))) expect(dead.has(id)).toBe(false);
    }), opts);
  });

  it('mergeStore dispatches without losing rows', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const viaDispatch = mergeStore('overload', a as never, b as never, true) as unknown as WorkoutState;
      expect(ids(viaDispatch)).toEqual(ids(mergeWorkout(a, b, true)));
    }), opts);
  });
});

describe('sanitize bounds tombstones on every save', () => {
  it('never exceeds the cap, regardless of how large the input is', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 2e12 }), { maxKeys: 900 }),
      fc.integer({ min: 1.6e12, max: 2e12 }),
      (del, now) => {
        const out = sanitizeStore('overload', { _del: del } as never, now) as { _del: Record<string, number> };
        expect(Object.keys(out._del).length).toBeLessThanOrEqual(DEFAULT_CONFIG.tombstoneMaxCount);
      },
    ), opts);
  });

  it('is a no-op when there is nothing to prune (preserves identity)', () => {
    const data = { _del: {}, days: {} } as never;
    expect(sanitizeStore('overload', data, Date.now())).toBe(data);
  });

  it('never mutates its input', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 2e12 }), { maxKeys: 700 }),
      (del) => {
        const input = { _del: { ...del } } as never;
        const before = JSON.stringify(input);
        sanitizeStore('overload', input, 2e12);
        expect(JSON.stringify(input)).toBe(before);
      },
    ), { numRuns: Math.min(RUNS, 2000) });
  });

  it('leaves the knowledge store untouched (it has no tombstones)', () => {
    const kg = { mastery: { a: 5 } } as never;
    expect(sanitizeStore('csgraph', kg, Date.now())).toBe(kg);
  });
});
