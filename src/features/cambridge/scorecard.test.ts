// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '@/app/bootstrap';
import { CAM_METERS, METERS, meterPct, type TrackerDay } from '@/features/studytracker/trackerStore';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import { cambridgeMeterInput, overrideWeekScore, weekScorecard } from '@/features/cambridge/scorecard';

const HOUR = 3_600_000;
const ny = (iso: string, offset = -4): number => Date.parse(iso + 'Z') - offset * HOUR;
const now = ny('2026-10-02T12:00:00'); // Friday of 2026-W40
const it_ = (id: string, over: Partial<CamItem>): CamItem => ({ id, stage: 'supervised', questions: {}, updatedAt: 1, ...over });

/** The five meters as the tracker shows them, with the Cambridge input where it applies. */
const meters = (day: TrackerDay, cam: number | null): Record<string, number> =>
  Object.fromEntries(METERS.map(([name, ids]) => [name, meterPct(day, ids, CAM_METERS.has(name) ? cam : null)]));

const day: TrackerDay = {
  date: '2026-10-02', blocks: {}, banked: false, events: {},
  scores: { s1: 2, s2: 2, s3: 2, s4: 2, s5: 0, s6: 1, s7: 1, s8: 0, s9: 2 }, // s10 unrated
};

describe('meters with no Cambridge data', () => {
  it('are pinned to their pre-Cambridge values', () => {
    const pinned = { Focus: 67, Body: 75, Rest: 100, Social: 0, Progress: 75 };
    // The old two-argument call, as StudyTracker makes it today.
    expect(Object.fromEntries(METERS.map(([n, ids]) => [n, meterPct(day, ids)]))).toEqual(pinned);
    // An empty Cambridge store gives no input, so nothing moves.
    const empty = weekScorecard(emptyCambridge(), now);
    expect(empty.hasData).toBe(false);
    expect(cambridgeMeterInput(empty)).toBeNull();
    expect(meters(day, cambridgeMeterInput(empty))).toEqual(pinned);
    // Nor does Cambridge activity from another week.
    const old: CambridgeState = {
      ...emptyCambridge(),
      items: { a: it_('a', { supervisedAt: ny('2026-09-21T18:00:00'), updatedAt: ny('2026-09-21T18:00:00') }) },
      awarded: { 'cam:coldAttempt:a:1': ny('2026-09-20T10:00:00') },
    };
    expect(cambridgeMeterInput(weekScorecard(old, now))).toBeNull();
    expect(meters(day, cambridgeMeterInput(weekScorecard(old, now)))).toEqual(pinned);
    // An unstarted day still reads empty.
    const blank: TrackerDay = { ...day, scores: {} };
    expect(meters(blank, null)).toEqual({ Focus: 0, Body: 0, Rest: 0, Social: 0, Progress: 0 });
  });

  it('with Cambridge data, the week counts as one more rated item on Focus and Progress only', () => {
    // Focus: (2+2+0 + 2*0.8) / (4*2) = 70%. Progress: (2+1 + 1.6) / (3*2) = 77%.
    expect(meters(day, 0.8)).toEqual({ Focus: 70, Body: 75, Rest: 100, Social: 0, Progress: 77 });
    // An unscored day with a full Cambridge week reads the week alone.
    expect(meters({ ...day, scores: {} }, 1)).toMatchObject({ Focus: 100, Progress: 100, Body: 0 });
  });
});

describe('weekScorecard', () => {
  const mon = ny('2026-09-28T18:00:00');
  const wed = ny('2026-09-30T18:00:00');

  it('a full week scores 10', () => {
    const s: CambridgeState = {
      ...emptyCambridge(),
      items: {
        a: it_('a', { supervisedAt: mon, redoQs: ['2'], redoneAt: mon + 30 * HOUR, stage: 'redo-done' }),
        b: it_('b', { supervisedAt: wed }), // no misses: finished at the supervision
      },
      awarded: {
        'cam:coldAttempt:a:1': mon - 4 * HOUR,
        'cam:coldAttempt:b:1': wed - 4 * HOUR,
        'cam:writeup:a': mon - 2 * HOUR,
        'cam:writeup:b': wed - HOUR,
      },
    };
    const card = weekScorecard(s, now);
    expect(card.week).toBe('2026-W40');
    expect(card.auto).toEqual({ cold: 2, writeup: 2, supervisions: 2, redo: 2, pace: 2 });
    expect(card.total).toBe(10);
    expect(cambridgeMeterInput(card)).toBe(1);
  });

  it('a partial week', () => {
    const s: CambridgeState = {
      ...emptyCambridge(),
      items: {
        a: it_('a', { supervisedAt: mon, redoQs: ['2'], redoneAt: mon + 50 * HOUR }), // redo late
        c: it_('c', { stage: 'attempting', updatedAt: mon }),
      },
      awarded: { 'cam:coldAttempt:c:1': mon, 'cam:writeup:a': mon + HOUR }, // written up after
    };
    expect(weekScorecard(s, now).auto).toEqual({ cold: 1, writeup: 0, supervisions: 1, redo: 0, pace: 1 });
  });

  it('a redo not yet due does not count against the week', () => {
    const thu = ny('2026-10-01T09:00:00');
    const s: CambridgeState = { ...emptyCambridge(), items: { a: it_('a', { supervisedAt: thu, redoQs: ['1'] }) } };
    // Due Sat 9 AM, in the Sabbath, so Saturday sunset + 1 h: after `now`.
    expect(weekScorecard(s, now).auto.redo).toBe(2);
  });

  describe('owner override', () => {
    beforeEach(() => {
      localStorage.clear();
      appState.set('cambridge', emptyCambridge() as never);
    });

    it('stores the whole week and wins over the auto values', () => {
      const w = overrideWeekScore('supervisions', 2, now);
      expect(w.week).toBe('2026-W40');
      expect(w.scores).toEqual({ cold: 0, writeup: 0, supervisions: 2, redo: 0, pace: 0 });
      const card = weekScorecard(appState.get('cambridge') as unknown as CambridgeState, now);
      expect(card.overridden).toBe(true);
      expect(card.auto.supervisions).toBe(0);
      expect(card.scores.supervisions).toBe(2);
      expect(card.total).toBe(2);
      expect(card.hasData).toBe(true);
    });
  });
});
