import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { groupThousands, localEpochDay, sameLocalDay } from '@/core/util';

const RUNS = Number(process.env.FC_RUNS ?? 100);

describe('groupThousands', () => {
  it('pins known values', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(999)).toBe('999');
    expect(groupThousands(1000)).toBe('1,000');
    expect(groupThousands(2450)).toBe('2,450');
    expect(groupThousands(1234567)).toBe('1,234,567');
    expect(groupThousands(-1234.5)).toBe('-1,234.5');
  });

  it("matches toLocaleString('en-US') for integers and kcal-sized decimals", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (n) => groupThousands(n) === n.toLocaleString('en-US')),
      { numRuns: RUNS },
    );
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: 0, max: 999 }), (i, f) => {
        const n = i + Math.sign(i || 1) * f / 1000;
        return groupThousands(n) === n.toLocaleString('en-US');
      }),
      { numRuns: RUNS },
    );
  });
});

describe('local day helpers', () => {
  it('count local days, not UTC ones', () => {
    const late = new Date(2026, 8, 29, 23, 30);
    const early = new Date(2026, 8, 30, 0, 30);
    expect(localEpochDay(late)).toBe(20725);
    expect(localEpochDay(early)).toBe(20726);
    expect(sameLocalDay(late.getTime(), new Date(2026, 8, 29, 0, 0).getTime())).toBe(true);
    expect(sameLocalDay(late.getTime(), early.getTime())).toBe(false);
  });
});
