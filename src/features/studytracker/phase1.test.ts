// @vitest-environment jsdom
/**
 * Study Tracker — Phase 1 (SAFE) reform tests.
 *
 * jsdom is required: the tab signal persists to localStorage, and the schema
 * guard drives the real `appState` singleton (which reads/writes localStorage).
 * The projection and clock helpers are otherwise pure.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TheoristState } from '@/core/types';
import { appState } from '@/app/bootstrap';
import {
  meterPct, scoreTotal, todayISO,
  toggleBlock, setScore, toggleBank,
  type TrackerDay,
} from '@/features/studytracker/trackerStore';
import { activeTab, setTab } from '@/features/studytracker/uiState';
import { currentBlockId, nowMinutesET, parseLabelMinutes } from '@/features/studytracker/now';

/** Minimal schedule fixture mirroring the real ET blocks used by the view. */
const SCHED = [
  { id: 'b1', time: '9:00 AM', title: 'Wake', sub: '', xp: 20 },
  { id: 'b4', time: '10:00 AM', title: 'Deep 1', sub: '', xp: 20 },
  { id: 'b5', time: '11:40 AM', title: 'Deep 2', sub: '', xp: 20 },
  { id: 'b8', time: '3:00 PM', title: 'Gym', sub: '', xp: 20, gym: true },
  { id: 'b14', time: '10:30 PM', title: 'Wind-down', sub: '', xp: 10 },
  { id: 'b15', time: '11:15 PM', title: 'Buffer', sub: '', xp: 5 },
] as const;

const day = (scores: Record<string, number>): TrackerDay => ({
  date: todayISO(), blocks: {}, scores, banked: false,
});

/* ================================================================== */
/* #4 Unrated scorecard projection                                     */
/* ================================================================== */

describe('unrated scorecard projection', () => {
  const FOCUS = ['s2', 's4', 's5'] as const; // a real 3-item meter

  it('an unrated meter (no keys present) reads 0% with an empty denominator', () => {
    expect(meterPct(day({}), FOCUS)).toBe(0);
  });

  it('excludes unrated items from the denominator; an explicit 0 counts', () => {
    // Only s2 rated, and it is a "Missed" (0): denominator is 1, not 3.
    expect(meterPct(day({ s2: 0 }), FOCUS)).toBe(0);
    // s2=0 (counts) + s4=2 (met): rated=2, sum=2 → 2/(2*2)=50%. If unrated items
    // were in the denominator this would be 2/(3*2)=33%.
    expect(meterPct(day({ s2: 0, s4: 2 }), FOCUS)).toBe(50);
    // all three met → 100%
    expect(meterPct(day({ s2: 2, s4: 2, s5: 2 }), FOCUS)).toBe(100);
  });

  it('scoreTotal is the sum of present scores (absent contributes nothing)', () => {
    expect(scoreTotal(day({ s2: 2, s4: 1 }))).toBe(3);
    expect(scoreTotal(day({}))).toBe(0);
  });

  it('the render highlight rule: absent → no segment on; present (incl. 0) → the matching segment', () => {
    // Mirrors StudyTracker's scorecard predicate: `rated && raw === n`.
    const on = (scores: Record<string, number>, id: string, n: number): boolean => {
      const raw = scores[id];
      return raw !== undefined && raw === n;
    };
    // Absent: nothing highlighted across Missed/Partial/Met.
    expect([0, 1, 2].some((n) => on({}, 's1', n))).toBe(false);
    // Explicit 0: only "Missed" (index 0) highlighted.
    expect(on({ s1: 0 }, 's1', 0)).toBe(true);
    expect(on({ s1: 0 }, 's1', 1)).toBe(false);
    expect(on({ s1: 0 }, 's1', 2)).toBe(false);
  });
});

/* ================================================================== */
/* #5 Live "now" schedule highlight                                    */
/* ================================================================== */

describe('now-clock helpers', () => {
  it('parseLabelMinutes reads "h:MM AM/PM" labels (with 12 AM/PM edge cases)', () => {
    expect(parseLabelMinutes('9:00 AM')).toBe(540);
    expect(parseLabelMinutes('3:00 PM')).toBe(900);
    expect(parseLabelMinutes('12:45 PM')).toBe(765);
    expect(parseLabelMinutes('12:00 AM')).toBe(0);
    expect(parseLabelMinutes('11:15 PM')).toBe(1395);
    expect(Number.isNaN(parseLabelMinutes('not a time'))).toBe(true);
  });

  it('nowMinutesET reads the wall clock in America/New_York, not the host zone', () => {
    // January → EST (UTC−5), DST-stable. 15:30Z = 10:30 ET = 630 min.
    expect(nowMinutesET(new Date('2026-01-15T15:30:00Z'))).toBe(630);
  });

  it('currentBlockId picks the block whose window contains the ET clock', () => {
    // 10:30 ET → inside [10:00, 11:40) → b4.
    expect(currentBlockId(SCHED, new Date('2026-01-15T15:30:00Z'))).toBe('b4');
    // 15:30 ET → inside the gym window [15:00, 22:30) → b8.
    expect(currentBlockId(SCHED, new Date('2026-01-15T20:30:00Z'))).toBe('b8');
  });

  it('returns null before wake and after lights-out', () => {
    // 08:00 ET → before the first block.
    expect(currentBlockId(SCHED, new Date('2026-01-15T13:00:00Z'))).toBeNull();
    // 23:50 ET → past the last block's start (no successor to bound it).
    expect(currentBlockId(SCHED, new Date('2026-01-16T04:50:00Z'))).toBeNull();
  });

  it('is sane across midnight (early-morning ET → no block, no throw)', () => {
    // 03:00 ET → 180 min → before the first block → null.
    expect(currentBlockId(SCHED, new Date('2026-01-15T08:00:00Z'))).toBeNull();
  });
});

/* ================================================================== */
/* #1 Sub-tab persistence                                              */
/* ================================================================== */

describe('sub-tab persistence', () => {
  const KEY = 'meridian.tracker.tab.v1';
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('setTab round-trips through localStorage and updates the signal', () => {
    setTab('playbook');
    expect(activeTab.value).toBe('playbook');
    expect(localStorage.getItem(KEY)).toBe('playbook');

    setTab('today');
    expect(activeTab.value).toBe('today');
    expect(localStorage.getItem(KEY)).toBe('today');
  });
});

/* ================================================================== */
/* Schema guard — a Phase-1 session adds NO new TheoristState keys      */
/* ================================================================== */

describe('theorist schema guard', () => {
  const TOP = new Set(['banked', 'day', 'dayTouchedAt', 'resetAt']);
  // Phase 2 adds two ADDITIVE optional day fields: `events` and `dayType`.
  const DAY = new Set(['date', 'blocks', 'scores', 'banked', 'events', 'dayType']);

  it('after a full daily session the serialized state has only known keys', () => {
    const seed: TheoristState = { banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false } };
    appState.set('theorist', seed as unknown as Record<string, unknown>);

    // A representative Phase-1 session: tick a block, score two lines, bank.
    toggleBlock('b1');
    setScore('s2', 2);
    setScore('s4', 0); // explicit "Missed"
    toggleBank();

    const t = appState.get('theorist') as unknown as TheoristState;
    for (const k of Object.keys(t)) expect(TOP.has(k)).toBe(true);
    for (const k of Object.keys(t.day)) expect(DAY.has(k)).toBe(true);
    // scores hold only 0..2 integers keyed by score id — no new sub-shape.
    for (const v of Object.values(t.day.scores)) expect([0, 1, 2]).toContain(v);
  });
});
