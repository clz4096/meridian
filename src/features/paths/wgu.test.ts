import { describe, expect, it } from 'vitest';
import { summarize, currentSummary } from '@/features/paths/wgu';
import { pct } from '@/features/paths/types';
import { roadmapChecks } from '@/features/wgu/roadmapStore';
import { PROGRESS, WEEKS } from '@/features/wgu/roadmapData';

// Local wall-clock dates, matching dstr(): the app reads the device's calendar day.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const done = (...codes: string[]) => Object.fromEntries(codes.map((c) => [c, true]));
const allDone = () => done(...PROGRESS.map(([c]) => c));

describe('wgu summarize', () => {
  it('pins the user-facing numbers for 2 of 13 done on Sep 29', () => {
    const s = summarize(at(2026, 9, 29), done('C955', 'D386'));
    expect(s.id).toBe('wgu');
    expect(s.title).toBe('WGU');
    expect(s.progress).toEqual({ done: 2, total: 13, caption: '25 days to Oct 24' });
    expect(pct(s.progress.done, s.progress.total)).toBe(15);
    // Week 2 (Sep 24 to 30) holds today; its first open course is D324.
    expect(s.course).toBe('D324 · Business of IT: Project Management');
    expect(s.next.label).toBe('CompTIA Project+ (Infosec, free)');
    expect(s.next.detail).toBe(
      'Drill earned-value math and critical path with the Packt PK0-005 spec; take the pre-assessment.',
    );
  });

  it('before the plan starts, points at the first course', () => {
    const s = summarize(at(2026, 9, 1), {});
    expect(s.course).toBe('C955 · Applied Probability & Statistics');
    expect(s.next.label).toBe('Intro to Statistics (Stanford), modules 1 to 8');
    expect(s.progress).toEqual({ done: 0, total: 13, caption: '53 days to Oct 24' });
  });

  it('mid-week picks the first not-done course of that week', () => {
    // Oct 3 is in Week 3; D315 is done, so D282 is next even though Week 1 has open work.
    const s = summarize(at(2026, 10, 3), done('D315'));
    expect(s.course).toBe('D282 · Cloud Foundations');
    expect(s.progress.caption).toBe('21 days to Oct 24');
  });

  it('when the current week is fully done, falls back to the first not-done course overall', () => {
    const s = summarize(at(2026, 9, 29), done('D324', 'C963'));
    expect(s.course).toBe('C955 · Applied Probability & Statistics');
    expect(s.progress.done).toBe(2);
  });

  it('uses the local calendar day at the week boundary', () => {
    expect(summarize(at(2026, 9, 23, 23, 59), {}).course).toMatch(/^C955/);
    expect(summarize(at(2026, 9, 24, 0, 1), {}).course).toMatch(/^D324/);
  });

  it('all done gives the empty state', () => {
    const s = summarize(at(2026, 10, 20), allDone());
    expect(s.course).toBe('');
    expect(s.next.label).toBe('Term complete');
    expect(s.progress).toEqual({ done: 13, total: 13, caption: 'all courses done' });
  });

  it('past the target says so and still names the open course', () => {
    const s = summarize(at(2026, 10, 30), done('C955'));
    expect(s.course).toMatch(/^D386/);
    expect(s.progress.caption).toBe('past target (Oct 24)');
  });

  it('on the target day and the day before', () => {
    expect(summarize(at(2026, 10, 24), {}).progress.caption).toBe('target is today, Oct 24');
    expect(summarize(at(2026, 10, 23), {}).progress.caption).toBe('1 day to Oct 24');
  });

  it('ignores stored keys that are not course codes', () => {
    expect(summarize(at(2026, 9, 29), { ...done('C955'), X999: true }).progress.done).toBe(1);
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
    roadmapChecks.value = done('C955', 'D386', 'D324');
    try {
      expect(currentSummary(at(2026, 9, 29)).progress.done).toBe(3);
    } finally {
      roadmapChecks.value = before;
    }
  });
});
