import { describe, expect, it } from 'vitest';
import { psetOfWeek } from './curriculum';

// Pin New York so the UTC-vs-local difference is real. Each test file runs in its own
// forked process, and every Date below is built after this line.
process.env.TZ = 'America/New_York';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
// The (course, pset) wrapper is rebuilt per call; the pset object itself is stable.
const pset = (d: Date) => psetOfWeek(d)?.pset;

describe('psetOfWeek turns over at local midnight, like paperOfWeek', () => {
  it('keeps Wednesday night 23:30 in the same week as Wednesday noon', () => {
    // Sep 30 2026 is a Wednesday; 23:30 EDT is already Thursday in UTC, where the old
    // UTC week boundary fell.
    expect(pset(at(2026, 9, 30, 23, 30))).toBeDefined();
    expect(pset(at(2026, 9, 30, 23, 30))).toBe(pset(at(2026, 9, 30, 12)));
    expect(pset(at(2026, 9, 30, 23, 30))).toBe(pset(at(2026, 9, 24, 0, 30)));
  });

  it('moves to the next problem set at 00:30 local on Thursday and holds it all week', () => {
    const thu = at(2026, 10, 1, 0, 30);
    expect(pset(thu)).not.toBe(pset(at(2026, 9, 30, 23, 30)));
    expect(pset(thu)).toBe(pset(at(2026, 10, 7, 23, 30)));
  });
});
