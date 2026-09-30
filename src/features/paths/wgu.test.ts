import { describe, expect, it } from 'vitest';
import { summarize, currentSummary } from '@/features/paths/wgu';
import { pct } from '@/features/paths/types';
import { roadmapChecks, roadmapSummary } from '@/features/wgu/roadmapStore';
import { PROGRESS, WEEKS } from '@/features/wgu/roadmapData';

// Local wall-clock dates, matching dstr(): the app reads the device's calendar day.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const done = (...codes: string[]) => Object.fromEntries(codes.map((c) => [c, true]));
const allDone = () => done(...PROGRESS.map(([c]) => c));

describe('wgu summarize', () => {
  it('pins the user-facing numbers on Wed Sep 30 with nothing done', () => {
    const s = summarize(at(2026, 9, 30), {});
    expect(s.id).toBe('wgu');
    expect(s.title).toBe('WGU');
    // Week 1 lists no due course; the fallback is plan order, so C955 (not D315) leads.
    expect(s.course).toBe('C955 · Applied Probability & Statistics');
    expect(s.next.label).toBe('Intro to Statistics (Stanford), modules 1 to 8');
    expect(s.progress).toEqual({ done: 0, total: 4, caption: '25 days to Oct 25' });
    expect(pct(s.progress.done, s.progress.total)).toBe(0);
  });

  it('pins the numbers for C955 done on Sep 30: D326 is next, 1 of 4, 25%', () => {
    const s = summarize(at(2026, 9, 30), done('C955'));
    expect(s.course).toBe('D326 · Advanced Data Management');
    expect(s.next.label).toBe('Intermediate PostgreSQL for stored procedures');
    expect(s.progress).toEqual({ done: 1, total: 4, caption: '25 days to Oct 25' });
    expect(pct(s.progress.done, s.progress.total)).toBe(25);
  });

  it('plans exactly the four enrolled courses, each once', () => {
    const codes = WEEKS.flatMap((w) => w.courses.map((c) => c.code));
    expect(codes).toEqual(['C955', 'D326', 'D315', 'D279']);
    expect(PROGRESS.map(([c]) => c)).toEqual(codes);
  });

  it('before the plan starts, points at the first course', () => {
    const s = summarize(at(2026, 9, 1), {});
    expect(s.course).toBe('C955 · Applied Probability & Statistics');
    expect(s.progress).toEqual({ done: 0, total: 4, caption: '54 days to Oct 25' });
  });

  it('mid-week picks the first not-done course of that week', () => {
    // Oct 20 is in Week 4; D315 is done, so D279 is next even though C955 is still open.
    const s = summarize(at(2026, 10, 20), done('D315'));
    expect(s.course).toBe('D279 · User Interface Design');
    expect(s.progress.caption).toBe('5 days to Oct 25');
  });

  it('when the current week is fully done, falls back to the first not-done course overall', () => {
    const s = summarize(at(2026, 10, 20), done('D315', 'D279'));
    expect(s.course).toBe('C955 · Applied Probability & Statistics');
    expect(s.progress.done).toBe(2);
  });

  it('uses the local calendar day at the week boundary', () => {
    // Sun Oct 18 is Week 3 (no due course): plan order gives C955. Mon Oct 19 is Week 4.
    expect(summarize(at(2026, 10, 18, 23, 59), done('D315')).course).toMatch(/^C955/);
    expect(summarize(at(2026, 10, 19, 0, 1), done('D315')).course).toMatch(/^D279/);
  });

  it('all done gives the empty state', () => {
    const s = summarize(at(2026, 10, 20), allDone());
    expect(s.course).toBe('');
    expect(s.next.label).toBe('Term complete');
    expect(s.next.detail).toBe('All 4 courses are done.');
    expect(s.progress).toEqual({ done: 4, total: 4, caption: 'all courses done' });
  });

  it('past the target says so and still names the open course', () => {
    const s = summarize(at(2026, 10, 30), done('C955'));
    expect(s.course).toMatch(/^D326/);
    expect(s.progress.caption).toBe('past target (Oct 25)');
  });

  it('on the target day and the day before', () => {
    expect(summarize(at(2026, 10, 25), {}).progress.caption).toBe('target is today, Oct 25');
    expect(summarize(at(2026, 10, 24), {}).progress.caption).toBe('1 day to Oct 25');
  });

  it('ignores stored keys that are not plan courses, including the old 13-course plan', () => {
    const old = done('C955', 'D386', 'D324', 'C963', 'D424');
    expect(summarize(at(2026, 9, 30), { ...old, X999: true }).progress.done).toBe(1);
  });

  it('keeps every label short and loses no text to the split', () => {
    for (const c of WEEKS.flatMap((w) => w.courses)) {
      const s = summarize(at(2026, 9, 1), Object.fromEntries(
        WEEKS.flatMap((w) => w.courses).filter((x) => x !== c).map((x) => [x.code, true]),
      ));
      expect(s.course.startsWith(c.code)).toBe(true);
      expect(s.next.label.length).toBeLessThanOrEqual(90);
      const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      expect(words(s.next.label + ' ' + (s.next.detail ?? ''))).toBe(words(c.doText));
    }
  });

  it('week dates are contiguous and cover the plan', () => {
    expect(WEEKS[0]!.start).toBe('2026-09-28');
    expect(WEEKS.at(-1)!.end).toBe('2026-11-01');
    for (let i = 1; i < WEEKS.length; i++) {
      const prev = new Date(WEEKS[i - 1]!.end + 'T00:00:00Z');
      prev.setUTCDate(prev.getUTCDate() + 1);
      expect(prev.toISOString().slice(0, 10)).toBe(WEEKS[i]!.start);
    }
  });
});

describe('wgu currentSummary', () => {
  it('reads the live checklist', () => {
    const before = roadmapChecks.value;
    roadmapChecks.value = done('C955', 'D326', 'D386');
    try {
      expect(currentSummary(at(2026, 9, 30)).progress.done).toBe(2);
    } finally {
      roadmapChecks.value = before;
    }
  });
});

describe('roadmapSummary (the hub stat)', () => {
  it('counts only the plan courses, so old stored ticks cannot exceed the total', () => {
    const before = roadmapChecks.value;
    roadmapChecks.value = done('C955', 'D386', 'D324', 'C963', 'D282', 'D336');
    try {
      expect(roadmapSummary()).toEqual({ done: 1, total: 4 });
    } finally {
      roadmapChecks.value = before;
    }
  });
});
