/**
 * progress — bucketing + per-metric time-series aggregation.
 */
import { describe, expect, it } from 'vitest';
import {
  bucketKey,
  bucketLabel,
  bodyweightSeries,
  bodyweightGoal,
  strengthSeries,
  volumeSeries,
  tonnageSeries,
  trackedLifts,
  calorieSeries,
  proteinSeries,
  calorieTarget,
  proteinTarget,
  xpSeries,
  questionsSolvedSeries,
  masterySeries,
  studyDaysSeries,
  currentStreak,
} from './progress.js';

const day = (d: number) => Date.UTC(2026, 6, d); // millis for 2026-07-0d

describe('bucketKey / bucketLabel', () => {
  it('buckets a date into each period', () => {
    expect(bucketKey('2026-07-15', 'day')).toBe('2026-07-15');
    expect(bucketKey('2026-07-15', 'week')).toBe('2026-07-13'); // Monday of that week
    expect(bucketKey('2026-07-15', 'month')).toBe('2026-07');
    expect(bucketKey('2026-07-15', 'quarter')).toBe('2026-Q3');
    expect(bucketKey('2026-07-15', 'year')).toBe('2026');
  });

  it('groups a whole ISO week under its Monday', () => {
    for (const d of ['2026-07-13', '2026-07-15', '2026-07-19']) expect(bucketKey(d, 'week')).toBe('2026-07-13');
    expect(bucketKey('2026-07-20', 'week')).toBe('2026-07-20'); // next week
  });

  it('labels buckets for the axis', () => {
    expect(bucketLabel('2026-07-15', 'day')).toBe('Jul 15');
    expect(bucketLabel('2026-07', 'month')).toBe("Jul '26");
    expect(bucketLabel('2026-Q3', 'quarter')).toBe("Q3 '26");
    expect(bucketLabel('2026', 'year')).toBe('2026');
  });
});

const wk: any = {
  settings: { bwGoal: 150 },
  days: {
    '2026-07-13': [
      { id: 's1', ex: 'Bench', type: 'warm', weight: 95, reps: 10 },
      { id: 's2', ex: 'Bench', type: 'top', weight: 135, reps: 5 },
      { id: 's3', ex: 'Bench', type: 'back', weight: 115, reps: 8 },
    ],
    '2026-07-15': [
      { id: 's4', ex: 'Bench', type: 'top', weight: 140, reps: 5 },
      { id: 's5', ex: 'Squat', type: 'top', weight: 225, reps: 3 },
    ],
    '2026-07-20': [{ id: 's6', ex: 'Bench', type: 'top', weight: 145, reps: 5 }],
  },
  bw: { '2026-07-13': 130, '2026-07-15': 131, '2026-07-20': 133 },
  _del: {},
};

describe('workout series', () => {
  it('bodyweight averages per week and exposes the goal', () => {
    const s = bodyweightSeries(wk, 'week');
    expect(s.map((p) => [p.key, p.value])).toEqual([
      ['2026-07-13', 130.5], // (130+131)/2
      ['2026-07-20', 133],
    ]);
    expect(bodyweightGoal(wk)).toBe(150);
  });

  it('strength takes the best top set per period for one lift', () => {
    const s = strengthSeries(wk, 'Bench', 'week');
    expect(s.map((p) => p.value)).toEqual([140, 145]); // max(135,140) week1, 145 week2 — warm/back ignored
  });

  it('volume counts working (top+back) sets, excluding warmups', () => {
    const s = volumeSeries(wk, 'week');
    expect(s[0].value).toBe(4); // week1: Jul13 top+back (2) + Jul15 top+top (2); warm excluded
    expect(s[1].value).toBe(1);
  });

  it('tonnage sums weight×reps over working sets', () => {
    const s = tonnageSeries(wk, 'week');
    // week1: Bench top 135*5=675 + back 115*8=920 + top 140*5=700 + Squat 225*3=675 = 2970
    expect(s[0].value).toBe(2970);
    expect(s[1].value).toBe(725); // 145*5
  });

  it('ignores tombstoned sets', () => {
    const dead: any = { ...wk, _del: { s2: Date.now() } };
    expect(strengthSeries(dead, 'Bench', 'week')[0].value).toBe(140); // 135 (s2) dropped
  });

  it('lists tracked lifts (those with a top set)', () => {
    expect(trackedLifts(wk)).toEqual(['Bench', 'Squat']);
  });
});

const sg: any = {
  settings: { maintenance: 2200, surplus: 500, proteinTarget: 150 },
  days: {
    '2026-07-13': [{ id: 'm1', name: 'A', cal: 1000, protein: 60 }, { id: 'm2', name: 'B', cal: 1500, protein: 90 }],
    '2026-07-15': [{ id: 'm3', name: 'C', cal: 2000, protein: 100 }],
  },
};

describe('meal series', () => {
  it('averages daily calories per week', () => {
    const s = calorieSeries(sg, 'week');
    expect(s[0].value).toBe(2250); // (2500 + 2000) / 2 days
  });
  it('averages daily protein per week', () => {
    expect(proteinSeries(sg, 'week')[0].value).toBe(125); // (150 + 100)/2
  });
  it('derives the daily targets', () => {
    expect(calorieTarget(sg)).toBe(2700); // maintenance + surplus
    expect(proteinTarget(sg)).toBe(150);
  });
});

const core: any = {
  entries: [
    { id: 'e1', date: '2026-07-13', stream: 'kg', xp: 16 },
    { id: 'e2', date: '2026-07-15', stream: 'kg', xp: 20 },
    { id: 'e3', date: '2026-07-20', stream: 'kg', xp: 8 },
  ],
};
const kg: any = {
  mastery: {},
  srs: {},
  gymDone: {},
  log: [
    { id: 'l1', qid: 'q1', at: day(13), rating: 3 },
    { id: 'l2', qid: 'q2', at: day(13), rating: 5 },
    { id: 'l3', qid: 'q1', at: day(15), rating: 4 }, // q1 upgraded to mastered
    { id: 'l4', qid: 'q3', at: day(20), rating: 2 },
  ],
};

describe('study series', () => {
  it('sums XP per week', () => {
    const s = xpSeries(core, 'week');
    expect(s.map((p) => p.value)).toEqual([36, 8]); // 16+20, then 8
  });

  it('counts questions solved (rating ≥ 4) per week', () => {
    const s = questionsSolvedSeries(kg, 'week');
    expect(s[0].value).toBe(2); // l2 (5) + l3 (4); l1 (3) not solved
  });

  it('tracks cumulative mastery % over time', () => {
    const s = masterySeries(kg, 'week');
    // week1 (Jul 13+15): q1 3→4, q2 5 → both mastered of 2 = 100%. week2 (Jul 20): +q3=2 → 2 of 3 = 67%.
    expect(s.map((p) => p.value)).toEqual([100, 67]);
  });

  it('counts distinct study days per week', () => {
    const s = studyDaysSeries(kg, 'week');
    expect(s[0].value).toBe(2); // Jul 13 + Jul 15
    expect(s[1].value).toBe(1); // Jul 20
  });

  it('reports the current streak', () => {
    expect(typeof currentStreak(kg, '2026-07-20')).toBe('number');
  });
});
