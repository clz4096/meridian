import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CoreState } from './types.js';
import {
  entriesOn, entryStreak, parseClock, scheduleBlocks, scheduleFor,
  selectTodayView, streamTotals,
} from './coreSelectors.js';
import { shiftDate } from './workoutSelectors.js';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;
const arbDate = fc.integer({ min: 0, max: 200 }).map((o) => shiftDate('2026-01-01', o));
const arbClock = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

const arbCore: fc.Arbitrary<CoreState> = fc.record({
  schedule: fc.dictionary(arbDate, fc.array(fc.record({
    id: fc.uuid(), label: fc.string({ maxLength: 20 }),
    start: arbClock, end: arbClock, done: fc.boolean(),
  }), { maxLength: 6 }), { maxKeys: 5 }),
  entries: fc.array(fc.record({
    id: fc.uuid(), date: arbDate, stream: fc.constantFrom('math', 'kg', 'lc'),
    xp: fc.integer({ min: 0, max: 100 }),
    status: fc.constantFrom('solved', 'attempted', ''),
  }), { maxLength: 20 }) as never,
  _del: fc.constant({}),
}) as fc.Arbitrary<CoreState>;

describe('clock parsing is total', () => {
  it('round-trips valid clock strings', () => {
    fc.assert(fc.property(arbClock, (s) => {
      const m = parseClock(s)!;
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(24 * 60);
    }), opts);
  });
  it('returns null for anything invalid instead of NaN', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const v = parseClock(s);
      expect(v === null || Number.isFinite(v)).toBe(true);
    }), opts);
    for (const bad of ['25:00', '12:60', '', '1200', 'abc', '-1:00']) expect(parseClock(bad)).toBeNull();
  });
});

describe('schedule derivation', () => {
  it('blocks are sorted by start time, unparseable last', () => {
    fc.assert(fc.property(arbCore, arbDate, fc.integer({ min: 0, max: 1439 }), (state, date, now) => {
      const blocks = scheduleBlocks(state, date, now);
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i - 1]!.startMinutes ?? 1e9).toBeLessThanOrEqual(blocks[i]!.startMinutes ?? 1e9);
      }
      expect(blocks.length).toBe(scheduleFor(state, date).length);
    }), opts);
  });

  it('at most one block is current, and it contains now', () => {
    fc.assert(fc.property(arbCore, arbDate, fc.integer({ min: 0, max: 1439 }), (state, date, now) => {
      const blocks = scheduleBlocks(state, date, now);
      for (const b of blocks.filter((x) => x.current)) {
        expect(b.startMinutes).not.toBeNull();
        expect(now).toBeGreaterThanOrEqual(b.startMinutes!);
      }
    }), opts);
  });

  it('nothing is current when the clock is unknown', () => {
    fc.assert(fc.property(arbCore, arbDate, (state, date) => {
      expect(scheduleBlocks(state, date, null).some((b) => b.current)).toBe(false);
    }), opts);
  });
});

describe('XP aggregation is exact', () => {
  it('total XP equals the sum of the day\u2019s entries', () => {
    fc.assert(fc.property(arbCore, arbDate, (state, date) => {
      const manual = entriesOn(state, date).reduce((a, e) => a + Number(e.xp ?? 0), 0);
      expect(streamTotals(state, date).reduce((a, s) => a + s.xp, 0)).toBe(manual);
    }), opts);
  });

  it('per-stream counts partition the day without loss', () => {
    fc.assert(fc.property(arbCore, arbDate, (state, date) => {
      const totals = streamTotals(state, date);
      expect(totals.reduce((a, s) => a + s.count, 0)).toBe(entriesOn(state, date).length);
      for (const s of totals) expect(s.solved + s.attempted).toBeLessThanOrEqual(s.count);
    }), opts);
  });

  it('streams are ordered by XP descending', () => {
    fc.assert(fc.property(arbCore, arbDate, (state, date) => {
      const t = streamTotals(state, date);
      for (let i = 1; i < t.length; i++) expect(t[i - 1]!.xp).toBeGreaterThanOrEqual(t[i]!.xp);
    }), opts);
  });

  it('the streak is finite, non-negative, and stops at the first gap', () => {
    fc.assert(fc.property(arbCore, arbDate, (state, today) => {
      const n = entryStreak(state, today);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      const dates = new Set(state.entries.map((e) => e.date));
      if (n > 0) expect(dates.has(shiftDate(today, -(n - 1)))).toBe(true);
      expect(dates.has(shiftDate(today, -n))).toBe(false);
    }), opts);
  });
});

describe('today view model', () => {
  it('never mutates state and totals are consistent', () => {
    fc.assert(fc.property(arbCore, arbDate, arbDate, fc.integer({ min: 0, max: 1439 }), (state, date, today, now) => {
      const before = JSON.stringify(state);
      const vm = selectTodayView(state, date, today, now);
      expect(JSON.stringify(state)).toBe(before);
      expect(vm.totalBlocks).toBe(vm.schedule.length);
      expect(vm.completedBlocks).toBeLessThanOrEqual(vm.totalBlocks);
      expect(vm.xpToday).toBe(vm.streams.reduce((a, s) => a + s.xp, 0));
      expect(Number.isFinite(vm.xpToday)).toBe(true);
      if (vm.currentBlock) expect(vm.currentBlock.current).toBe(true);
      if (vm.nextBlock && now !== null) expect(vm.nextBlock.startMinutes!).toBeGreaterThan(now);
    }), opts);
  });
});
