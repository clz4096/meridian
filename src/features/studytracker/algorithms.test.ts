import { afterEach, describe, expect, it, vi } from 'vitest';
import { localEpochDay } from '@/core/util';
import { ALGORITHMS, algoOfDay } from './algorithms';

// The bug only shows in a zone behind UTC, so pin New York. Vitest's default forks pool
// gives each test file its own process, so this doesn't leak into other files. Node reads
// TZ on each Date call, and every Date below is built after this line.
process.env.TZ = 'America/New_York';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const nth = (d: Date) => ALGORITHMS[localEpochDay(d) % ALGORITHMS.length]!;

describe('algoOfDay rolls over at local midnight', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs in New York time', () => {
    // 23:30 EDT on Sep 29 is 03:30 UTC on Sep 30: the case a UTC day count gets wrong.
    expect(at(2026, 9, 29, 23, 30).toISOString()).toBe('2026-09-30T03:30:00.000Z');
  });

  it('keeps the same algorithm at 23:30 as at noon', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 9, 29, 23, 30));
    expect(algoOfDay().name).toBe(algoOfDay(at(2026, 9, 29, 12)).name);
    expect(algoOfDay()).toBe(nth(at(2026, 9, 29)));
    expect(localEpochDay(new Date())).toBe(20725);
  });

  it('switches to the next algorithm at 00:30', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 9, 30, 0, 30));
    expect(localEpochDay(new Date())).toBe(20726);
    expect(algoOfDay()).toBe(nth(at(2026, 9, 30)));
    expect(algoOfDay().name).not.toBe(algoOfDay(at(2026, 9, 29, 23, 30)).name);
  });

  it('is stable across a DST change day', () => {
    // Nov 1 2026: clocks fall back at 2 am, so the local day is 25 hours long.
    const first = algoOfDay(at(2026, 11, 1, 0, 5));
    for (const h of [1, 3, 12, 23]) expect(algoOfDay(at(2026, 11, 1, h, 55))).toBe(first);
  });
});
