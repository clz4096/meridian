// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '@/app/bootstrap';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import {
  coldSeconds, currentItem, elapsedSec, fmtDue, inSabbath, isoWeek, nyParts, phaseUnlocked, redoDue,
  startColdTimer, stopColdTimer, sunset, supervisionsThisWeek, type CatalogEntry,
} from '@/features/cambridge/schedule';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** An instant from a Brooklyn wall-clock reading; `offset` is the UTC offset in hours (-4 EDT, -5 EST). */
const ny = (iso: string, offset: number): number => Date.parse(iso + 'Z') - offset * HOUR;
const nyClock = (t: number): number => {
  const p = nyParts(t);
  return p.h * 60 + p.min;
};

describe('sunset (NOAA, Brooklyn, read in America/New_York)', () => {
  // Reference values: sunsets for Brooklyn (40.6782 N, 73.9442 W) from the
  // sunrise-sunset.org API (api.sunrise-sunset.org/json, tzid=America/New_York),
  // fetched 2026-09-30 by hand, not by the test: 20:31:58, 16:33:15, 19:09:06.
  // Rounded to the minute below; the contract tolerance is 3 minutes.
  const cases: Array<[string, number, number]> = [
    ['2026-06-21', 20, 32], // summer solstice, EDT (20:31:58)
    ['2026-12-21', 16, 33], // winter solstice, EST (16:33:15)
    ['2026-03-20', 19, 9], // March equinox, EDT (19:09:06)
  ];
  for (const [date, h, m] of cases) {
    it(`${date} is ${h}:${String(m).padStart(2, '0')} within 3 min`, () => {
      const s = sunset(date).getTime();
      expect(Math.abs(nyClock(s) - (h * 60 + m))).toBeLessThanOrEqual(3);
      // and it falls on that Brooklyn date, even though it is after midnight UTC
      expect(new Date(s).toISOString() > date).toBe(true);
      const p = nyParts(s);
      expect(`${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`).toBe(date);
    });
  }

  it('takes an instant and uses its Brooklyn date', () => {
    // 01:00 UTC on 22 Jun is still 21 Jun in Brooklyn.
    expect(sunset(Date.parse('2026-06-22T01:00:00Z')).getTime()).toBe(sunset('2026-06-21').getTime());
  });
});

describe('inSabbath (Friday sunset to Saturday sunset)', () => {
  // Friday 2026-06-19 and Saturday 2026-06-20, EDT.
  const friSunset = sunset('2026-06-19').getTime();
  const satSunset = sunset('2026-06-20').getTime();

  it('is off on Friday before sunset and on just after it', () => {
    expect(inSabbath(friSunset - MIN)).toBe(false);
    expect(inSabbath(friSunset)).toBe(true);
    expect(inSabbath(friSunset + MIN)).toBe(true);
  });

  it('runs through Saturday and ends at Saturday sunset', () => {
    expect(inSabbath(ny('2026-06-20T00:30:00', -4))).toBe(true);
    expect(inSabbath(ny('2026-06-20T12:00:00', -4))).toBe(true);
    expect(inSabbath(satSunset - MIN)).toBe(true);
    expect(inSabbath(satSunset)).toBe(false);
  });

  it('is off every other day, and follows the winter sunset', () => {
    expect(inSabbath(ny('2026-06-18T21:00:00', -4))).toBe(false); // Thursday night
    expect(inSabbath(ny('2026-06-21T10:00:00', -4))).toBe(false); // Sunday
    // Friday 2026-12-18: 5 PM is already after a ~4:30 PM sunset.
    expect(inSabbath(ny('2026-12-18T17:00:00', -5))).toBe(true);
    expect(inSabbath(ny('2026-12-18T16:00:00', -5))).toBe(false);
  });

  it('reads Brooklyn time whatever zone the device is in', () => {
    // 23:00 UTC Friday is 7 PM EDT: before the ~8:30 PM June sunset.
    expect(inSabbath(Date.parse('2026-06-19T23:00:00Z'))).toBe(false);
  });
});

describe('redoDue (48 h, shifted out of the Sabbath)', () => {
  it('is 48 hours later on an ordinary week', () => {
    const mon = ny('2026-06-15T18:00:00', -4);
    expect(redoDue(mon)).toBe(mon + 48 * HOUR);
    expect(fmtDue(redoDue(mon))).toBe('Wed 6 PM');
  });

  it('a due time inside the Sabbath moves to Saturday sunset + 1 h', () => {
    const thu = ny('2026-06-18T21:00:00', -4);
    const wed = ny('2026-06-17T22:00:00', -4); // due Fri 22:00, inside the Sabbath
    expect(inSabbath(wed + 48 * HOUR)).toBe(true);
    expect(redoDue(wed)).toBe(sunset('2026-06-20').getTime() + HOUR);
    // Thu 13:00 is due Sat 13:00, inside the Sabbath: same Saturday.
    const thuDay = ny('2026-06-18T13:00:00', -4);
    expect(redoDue(thuDay)).toBe(sunset('2026-06-20').getTime() + HOUR);
    // Thu 21:00 is due Sat 21:00, after the Sabbath ended (~8:31 PM): unchanged.
    expect(redoDue(thu)).toBe(thu + 48 * HOUR);
  });

  it('never returns a time inside the Sabbath', () => {
    const start = ny('2026-06-15T00:00:00', -4);
    for (let t = start; t < start + 7 * 24 * HOUR; t += 37 * MIN) {
      expect(inSabbath(redoDue(t))).toBe(false);
      expect(redoDue(t)).toBeGreaterThanOrEqual(t + 48 * HOUR);
    }
  });
});

describe('isoWeek (Brooklyn calendar)', () => {
  it('numbers weeks from Monday, ISO style', () => {
    expect(isoWeek(ny('2026-09-28T09:00:00', -4))).toBe('2026-W40'); // Monday
    expect(isoWeek(ny('2026-10-04T23:00:00', -4))).toBe('2026-W40'); // Sunday night
    expect(isoWeek(ny('2026-10-05T00:30:00', -4))).toBe('2026-W41');
    expect(isoWeek(ny('2027-01-01T12:00:00', -5))).toBe('2026-W53'); // Friday 1 Jan 2027
  });
});

const item = (id: string, over: Partial<CamItem> = {}): CamItem => ({ id, stage: 'not-started', questions: {}, updatedAt: 1, ...over });

describe('supervisionsThisWeek', () => {
  it('counts live items supervised in this ISO week', () => {
    const now = ny('2026-09-30T12:00:00', -4); // Wed, W40
    const s: CambridgeState = {
      ...emptyCambridge(),
      items: {
        a: item('a', { stage: 'supervised', supervisedAt: ny('2026-09-28T18:00:00', -4) }),
        b: item('b', { stage: 'supervised', supervisedAt: ny('2026-09-25T18:00:00', -4) }), // last week
        c: item('c', { stage: 'supervised', supervisedAt: ny('2026-09-29T18:00:00', -4), deleted: true }),
      },
    };
    expect(supervisionsThisWeek(s, now)).toEqual({ held: 1, target: 2, suggested: ['Mon', 'Wed'] });
  });
});

describe('cold timer', () => {
  beforeEach(() => {
    appState.set('cambridge', emptyCambridge() as never);
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('elapsed is read off the clock while running', () => {
    expect(elapsedSec({ q: '1', coldSec: 30, runningSince: 1_000 }, 61_000)).toBe(90);
    expect(elapsedSec({ q: '1', coldSec: 30 }, 61_000)).toBe(30);
  });

  it('survives a reload: the start is persisted and the time keeps counting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T14:00:00Z'));
    const t0 = Date.now();
    startColdTimer('step-1', '3', t0);
    // The store as it is persisted.
    const saved = JSON.stringify(appState.get('cambridge'));

    // Forty minutes later the page reloads: memory is gone, the saved copy is read back.
    vi.advanceTimersByTime(40 * MIN);
    appState.set('cambridge', emptyCambridge() as never);
    appState.set('cambridge', JSON.parse(saved));
    expect(coldSeconds('step-1', '3', Date.now())).toBe(40 * 60);

    vi.advanceTimersByTime(25 * MIN);
    const q = stopColdTimer('step-1', '3', Date.now());
    expect(q.coldSec).toBe(65 * 60);
    expect(q.runningSince).toBeUndefined();
    // Stopped: no more time accrues.
    vi.advanceTimersByTime(10 * MIN);
    expect(coldSeconds('step-1', '3', Date.now())).toBe(65 * 60);
    // Starting moved the item into "attempting".
    expect((appState.get('cambridge') as unknown as CambridgeState).items['step-1']!.stage).toBe('attempting');
  });

  it('a second start does not reset a running timer', () => {
    startColdTimer('x', '1', 1_000);
    startColdTimer('x', '1', 50_000);
    expect(coldSeconds('x', '1', 61_000)).toBe(60);
  });
});

describe('currentItem', () => {
  const step: CatalogEntry[] = [
    { id: 'p0-1', title: 'Assignment 1', phase: '0' },
    { id: 'p0-2', title: 'Assignment 2', phase: '0' },
    { id: 'pa-1', title: 'Assignment 7', phase: 'A' },
  ];
  const courses: CatalogEntry[] = [{ id: 'ia-1', title: 'Groups sheet 1', phase: 'IA' }];
  const now = ny('2026-09-30T12:00:00', -4);

  it('starts with the first item, cold', () => {
    expect(currentItem(emptyCambridge(), step, courses, now)).toMatchObject({ itemId: 'p0-1', step: 'attempt', label: 'Assignment 1: attempt cold' });
  });

  it('walks the loop: write up, then supervision due', () => {
    const s = { ...emptyCambridge(), items: { 'p0-1': item('p0-1', { stage: 'attempting', questions: { 1: { q: '1', coldSec: 3600, status: 'solved' } } }) } };
    expect(currentItem(s, step, courses, now)).toMatchObject({ itemId: 'p0-1', step: 'writeup', label: 'Assignment 1: write up' });
    s.items['p0-1'] = { ...s.items['p0-1']!, stage: 'written-up' };
    expect(currentItem(s, step, courses, now)).toMatchObject({ step: 'supervision', label: 'Supervision due' });
  });

  it('a pending redo comes first, labelled with its Brooklyn deadline', () => {
    const supervisedAt = ny('2026-09-29T18:00:00', -4); // Tue 6 PM
    const s = {
      ...emptyCambridge(),
      items: {
        'p0-1': item('p0-1', { stage: 'supervised', supervisedAt, redoQs: ['2'] }),
        'p0-2': item('p0-2', { stage: 'attempting' }),
      },
    };
    expect(currentItem(s, step, courses, now)).toMatchObject({ itemId: 'p0-1', step: 'redo', label: 'Redo due by Thu 6 PM' });
  });

  it('skips finished items and locked phases', () => {
    const done = {
      'p0-1': item('p0-1', { stage: 'redo-done' }),
      'p0-2': item('p0-2', { stage: 'supervised', supervisedAt: 1 }), // no misses: finished
    };
    const s: CambridgeState = { ...emptyCambridge(), items: done };
    expect(phaseUnlocked(s, 'A')).toBe(false);
    expect(currentItem(s, step, courses, now)).toBeNull();
    const passed: CambridgeState = { ...s, gates: { 0: { phase: '0', passedAt: 5, evidence: {}, updatedAt: 5 } } };
    expect(currentItem(passed, step, courses, now)).toMatchObject({ itemId: 'pa-1', label: 'Assignment 7: attempt cold' });
    // Part IA waits for Phase B's gate, not A's.
    expect(phaseUnlocked(passed, 'IA')).toBe(false);
    const b: CambridgeState = { ...passed, gates: { ...passed.gates, B: { phase: 'B', passedAt: 9, evidence: {}, updatedAt: 9 } } };
    expect(phaseUnlocked(b, 'IA')).toBe(true);
    expect(phaseUnlocked(passed, 'A+')).toBe(false);
  });
});
