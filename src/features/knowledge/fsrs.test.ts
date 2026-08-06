/**
 * FSRS wrapper — pure-transition tests. Scheduling is deterministic given an
 * injected `now`, so these pin the shape: intervals grow on repeated success,
 * a lapse drops stability + increments lapses, legacy SM-2 rows migrate without
 * losing history, and the forgetting curve decays over time.
 */
import { describe, it, expect } from 'vitest';
import { scheduleFsrs, readFsrs, queuedEntry, retrievability, type FsrsEntry } from './fsrs';

const D = (s: string): Date => new Date(s + 'T00:00:00Z');
const gap = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

describe('fsrs · schedule', () => {
  it('a new card graded Good schedules a future review and builds stability', () => {
    const e = scheduleFsrs(undefined, 3, D('2026-08-06'));
    expect(e.due > '2026-08-06').toBe(true);
    expect(e.stability).toBeGreaterThan(0);
    expect(e.reps).toBe(1);
    expect(e.lapses).toBe(0);
  });

  it('repeated Good grades push the interval out monotonically', () => {
    let e: FsrsEntry | undefined;
    let prev = 0;
    let now = '2026-08-06';
    for (let i = 0; i < 3; i++) {
      const next = scheduleFsrs(e, 3, D(now));
      const g = gap(now, next.due);
      if (i > 0) expect(g).toBeGreaterThan(prev);
      prev = g;
      e = next;
      now = next.due;
    }
  });

  it('Again lapses the card: stability drops and lapses increments', () => {
    const good = scheduleFsrs(scheduleFsrs(undefined, 3, D('2026-08-06')), 3, D('2026-08-09'));
    const lapsed = scheduleFsrs(good, 1, D('2026-08-23'));
    expect(lapsed.lapses).toBe(good.lapses + 1);
    expect(lapsed.stability).toBeLessThan(good.stability);
  });

  it('is deterministic for identical inputs', () => {
    expect(scheduleFsrs(undefined, 4, D('2026-08-06'))).toEqual(scheduleFsrs(undefined, 4, D('2026-08-06')));
  });
});

describe('fsrs · migration', () => {
  it('seeds FSRS state from a legacy SM-2 row without losing history', () => {
    const e = readFsrs({ due: '2026-08-20', ivl: 14, ease: 2.5, n: 3 });
    expect(e.due).toBe('2026-08-20');
    expect(e.reps).toBe(3);
    expect(e.stability).toBeGreaterThanOrEqual(14);
    expect(e.state).toBe(2); // Review
  });

  it('treats an undefined/empty entry as unseen', () => {
    const e = readFsrs(undefined);
    expect(e.due).toBe('');
    expect(e.stability).toBe(0);
    expect(e.reps).toBe(0);
  });

  it('passes an existing FSRS entry through cleanly', () => {
    const src: FsrsEntry = { due: '2026-09-01', stability: 20, difficulty: 5, reps: 4, lapses: 1, state: 2, lastReview: '2026-08-12' };
    expect(readFsrs(src)).toEqual(src);
  });
});

describe('fsrs · helpers', () => {
  it('queuedEntry sets the due date and a learning state', () => {
    const e = queuedEntry('2026-08-07');
    expect(e.due).toBe('2026-08-07');
    expect(e.state).toBe(1);
  });

  it('retrievability decays from ~1 at review time toward the target over one stability', () => {
    const e: FsrsEntry = { due: '2026-08-20', stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 2, lastReview: '2026-08-06' };
    const r0 = retrievability(e, '2026-08-06'); // same day
    const r10 = retrievability(e, '2026-08-16'); // one stability later ≈ 0.9
    expect(r0).toBeGreaterThan(r10);
    expect(r10).toBeLessThan(1);
    expect(r10).toBeGreaterThan(0.5);
  });
});
