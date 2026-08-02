import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { KnowledgeState, Mastery, SrsEntry } from '@/core/types';
import {
  DEFAULT_SRS, daysBetween, dueCards, isDue, normaliseEntry,
  schedule, selectStudyView, studyStreak, toCard,
} from '@/features/knowledge/knowledgeSelectors';
import { shiftDate } from '@/core/util';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;
const C = DEFAULT_SRS;

const arbDate = fc.integer({ min: 0, max: 400 }).map((o) => shiftDate('2025-01-01', o));
const arbRating = fc.constantFrom<Mastery>(1, 2, 3, 4, 5);
const arbEntry: fc.Arbitrary<SrsEntry> = fc.record({
  due: arbDate,
  ivl: fc.integer({ min: 0, max: 400 }),
  ease: fc.double({ min: 1.0, max: 3.5, noNaN: true }),
  n: fc.integer({ min: 0, max: 40 }),
});
/** Deliberately hostile inputs: legacy field names, strings, nulls, NaN. */
const arbMessyEntry = fc.oneof(
  arbEntry,
  fc.record({ interval: fc.integer({ min: -50, max: 500 }), ease: fc.constantFrom(0, -1, NaN, 99), reps: fc.integer({ min: -5, max: 50 }) }),
  fc.record({ ivl: fc.constantFrom('7', 'abc', null, undefined), ease: fc.constantFrom('2.5', ''), n: fc.constantFrom('3', null) }),
  fc.constant(undefined), fc.constant(null), fc.constant({}),
);

describe('normalisation is total', () => {
  it('always yields a finite, in-range entry from any input', () => {
    fc.assert(
      fc.property(arbMessyEntry, (raw) => {
        const e = normaliseEntry(raw as never);
        expect(Number.isFinite(e.ivl)).toBe(true);
        expect(Number.isFinite(e.ease)).toBe(true);
        expect(Number.isFinite(e.n)).toBe(true);
        expect(e.ivl).toBeGreaterThanOrEqual(0);
        expect(e.ivl).toBeLessThanOrEqual(C.maxInterval);
        expect(e.ease).toBeGreaterThanOrEqual(C.minEase);
        expect(e.ease).toBeLessThanOrEqual(C.maxEase);
        expect(e.n).toBeGreaterThanOrEqual(0);
      }),
      opts,
    );
  });

  it('accepts the legacy `interval`/`reps` field names', () => {
    const e = normaliseEntry({ interval: 12, reps: 4, ease: 2.2, due: '2026-01-01' } as never);
    expect(e.ivl).toBe(12);
    expect(e.n).toBe(4);
  });
});

describe('a pass advances the schedule', () => {
  it('never decreases the interval, and never exceeds the ceiling', () => {
    fc.assert(
      fc.property(arbMessyEntry, fc.constantFrom<Mastery>(2, 3, 4, 5), arbDate, (raw, rating, today) => {
        const prev = normaliseEntry(raw as never);
        const next = schedule(prev, rating, today);
        expect(next.ivl).toBeGreaterThanOrEqual(1);
        expect(next.ivl).toBeLessThanOrEqual(C.maxInterval);
        if (prev.n >= 2 && prev.ivl >= 1) {
          expect(next.ivl).toBeGreaterThanOrEqual(prev.ivl); // ease >= 1.3 so it grows
        }
      }),
      opts,
    );
  });

  it('increments the repetition count on every pass', () => {
    fc.assert(
      fc.property(arbMessyEntry, fc.constantFrom<Mastery>(2, 3, 4, 5), arbDate, (raw, rating, today) => {
        const prev = normaliseEntry(raw as never);
        expect(schedule(prev, rating, today).n).toBe(prev.n + 1);
      }),
      opts,
    );
  });

  it('follows the 1 -> 3 -> interval x ease ladder', () => {
    fc.assert(
      fc.property(fc.constantFrom<Mastery>(3, 4, 5), arbDate, (rating, today) => {
        const first = schedule(undefined, rating, today);
        expect(first.ivl).toBe(C.firstInterval);
        const second = schedule(first, rating, today);
        expect(second.ivl).toBe(C.secondInterval);
        const third = schedule(second, rating, today);
        expect(third.ivl).toBe(Math.min(C.maxInterval, Math.round(second.ivl * second.ease)));
      }),
      opts,
    );
  });

  it('a higher rating never schedules sooner than a lower one', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbDate, (raw, today) => {
        const prev = normaliseEntry(raw as never);
        const lo = schedule(prev, 2, today);
        const hi = schedule(prev, 5, today);
        expect(hi.ivl).toBeGreaterThanOrEqual(lo.ivl);
        expect(hi.ease).toBeGreaterThanOrEqual(lo.ease);
      }),
      opts,
    );
  });
});

describe('a fail resets to the floor', () => {
  it('drops the interval to the lapse value and zeroes the streak', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbDate, (raw, today) => {
        const prev = normaliseEntry(raw as never);
        const next = schedule(prev, 1, today);
        expect(next.ivl).toBe(C.lapseInterval);
        expect(next.n).toBe(0);
        expect(next.due).toBe(shiftDate(today, C.lapseInterval));
        if (prev.ivl > C.lapseInterval) expect(next.ivl).toBeLessThan(prev.ivl); // strictly decreases
      }),
      opts,
    );
  });

  it('a lapse never pushes ease outside its bounds', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbDate, (raw, today) => {
        const next = schedule(normaliseEntry(raw as never), 1, today);
        expect(next.ease).toBeGreaterThanOrEqual(C.minEase);
        expect(next.ease).toBeLessThanOrEqual(C.maxEase);
      }),
      opts,
    );
  });

  it('repeated failures cannot drive the interval below the floor', () => {
    fc.assert(
      fc.property(arbEntry, arbDate, (start, today) => {
        let e = start;
        for (let i = 0; i < 20; i++) e = schedule(e, 1, today);
        expect(e.ivl).toBe(C.lapseInterval);
        expect(e.ivl).toBeGreaterThan(0);
      }),
      opts,
    );
  });
});

describe('intervals are always sane', () => {
  it('never negative, never NaN, never beyond the ceiling — over long histories', () => {
    fc.assert(
      fc.property(fc.array(arbRating, { minLength: 1, maxLength: 60 }), arbDate, (ratings, today) => {
        let e: SrsEntry | undefined;
        let day = today;
        for (const r of ratings) {
          e = schedule(e, r, day);
          expect(Number.isFinite(e.ivl)).toBe(true);
          expect(Number.isNaN(e.ivl)).toBe(false);
          expect(e.ivl).toBeGreaterThan(0);
          expect(e.ivl).toBeLessThanOrEqual(C.maxInterval);
          expect(e.ease).toBeGreaterThanOrEqual(C.minEase);
          expect(e.due > day).toBe(true);        // always scheduled in the future
          day = e.due;
        }
      }),
      opts,
    );
  });

  it('the due date is exactly today + interval', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbRating, arbDate, (raw, rating, today) => {
        const next = schedule(normaliseEntry(raw as never), rating, today);
        expect(next.due).toBe(shiftDate(today, next.ivl));
        expect(daysBetween(today, next.due)).toBe(next.ivl);
      }),
      opts,
    );
  });

  it('scheduling is deterministic and does not mutate the previous entry', () => {
    fc.assert(
      fc.property(arbEntry, arbRating, arbDate, (prev, rating, today) => {
        const frozen = Object.freeze({ ...prev });
        const a = schedule(frozen, rating, today);
        const b = schedule(frozen, rating, today);
        expect(a).toEqual(b);
        expect(frozen).toEqual(prev);
      }),
      opts,
    );
  });
});

describe('due queue and view model', () => {
  const arbKG = fc.record({
    mastery: fc.dictionary(fc.hexaString({ minLength: 1, maxLength: 4 }), arbRating, { maxKeys: 12 }),
    srs: fc.dictionary(fc.hexaString({ minLength: 1, maxLength: 4 }), arbEntry, { maxKeys: 12 }),
    gymDone: fc.constant({}),
    log: fc.array(fc.record({ id: fc.uuid(), qid: fc.hexaString({ maxLength: 4 }), at: fc.integer({ min: 0 }), rating: arbRating, date: arbDate }), { maxLength: 20 }) as never,
  }) as unknown as fc.Arbitrary<KnowledgeState>;

  it('every due card is actually due, sorted most-overdue first', () => {
    fc.assert(
      fc.property(arbKG, arbDate, (kg, today) => {
        const ids = Object.keys(kg.srs);
        const due = dueCards(ids, kg, today);
        for (const c of due) {
          expect(c.due <= today).toBe(true);
          expect(isDue(kg.srs[c.id], today)).toBe(true);
        }
        for (let i = 1; i < due.length; i++) {
          expect(due[i - 1]!.overdueDays).toBeGreaterThanOrEqual(due[i]!.overdueDays);
        }
      }),
      opts,
    );
  });

  it('the view model partitions ids without loss or overlap', () => {
    fc.assert(
      fc.property(arbKG, arbDate, (kg, today) => {
        const ids = [...new Set([...Object.keys(kg.srs), ...Object.keys(kg.mastery), 'never-seen'])];
        const vm = selectStudyView(ids, kg, today);
        const covered = new Set([...vm.due.map((c) => c.id), ...vm.upcoming.map((c) => c.id), ...vm.unseen]);
        expect(covered.size).toBeLessThanOrEqual(ids.length);
        expect(vm.unseen).toContain('never-seen');
        for (const c of vm.due) expect(vm.upcoming.find((u) => u.id === c.id)).toBeUndefined();
        expect(vm.streakDays).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(vm.streakDays)).toBe(true);
      }),
      opts,
    );
  });

  it('toCard never produces NaN', () => {
    fc.assert(
      fc.property(arbKG, arbDate, (kg, today) => {
        for (const id of Object.keys(kg.srs)) {
          const c = toCard(id, kg, today);
          expect(Number.isNaN(c.interval)).toBe(false);
          expect(Number.isNaN(c.ease)).toBe(false);
          expect(Number.isNaN(c.reps)).toBe(false);
        }
        expect(studyStreak(kg, today)).toBeGreaterThanOrEqual(0);
      }),
      opts,
    );
  });
});
