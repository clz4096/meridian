import { describe, expect, it } from 'vitest';
import { MATH_COURSES, MATH_DAILY, type MathDailyItem } from '@/content/math';
import { FEATURED_CODE, activeFeaturedCode, itemLabel, localDayNumber, summarize, todaysMathItem } from './math';

// Local-time constructors, so the tests mean the same thing in any TZ.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('MATH_DAILY content', () => {
  const codes = new Set(MATH_COURSES.map((c) => c.code));

  it('has at least 16 items with unique ids', () => {
    expect(MATH_DAILY.length).toBeGreaterThanOrEqual(16);
    expect(new Set(MATH_DAILY.map((i) => i.id)).size).toBe(MATH_DAILY.length);
  });

  it.each(MATH_DAILY.map((i) => [i.id, i] as const))('%s is complete and points at a Math course', (_id, i) => {
    expect(i.prompt.trim()).not.toBe('');
    expect(i.answer.trim()).not.toBe('');
    expect(i.title.trim()).not.toBe('');
    expect(i.source.trim()).not.toBe('');
    expect(['proof', 'problem']).toContain(i.kind);
    expect(codes.has(i.courseCode)).toBe(true);
    if (i.hint !== undefined) expect(i.hint.trim()).not.toBe('');
  });

  it('features Stanford Stats with 6+ items and seeds the probability courses', () => {
    expect(FEATURED_CODE).toBe('Stanford Stats');
    expect(MATH_DAILY.filter((i) => i.courseCode === 'Stanford Stats').length).toBeGreaterThanOrEqual(6);
    expect(
      MATH_DAILY.filter((i) => i.courseCode === 'Harvard STAT 110' || i.courseCode === 'MIT 6.041SC').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('uses no em or en dashes', () => {
    for (const i of MATH_DAILY) expect(JSON.stringify(i)).not.toMatch(/[–—]/);
  });
});

describe('todaysMathItem', () => {
  it('is stable across the whole local day', () => {
    const first = todaysMathItem(at(2026, 9, 29, 0, 0));
    for (const h of [0, 6, 12, 19, 20, 23])
      expect(todaysMathItem(at(2026, 9, 29, h, 59))?.id).toBe(first?.id);
  });

  it('changes from one day to the next', () => {
    for (let d = 1; d < 28; d++)
      expect(todaysMathItem(at(2026, 10, d))?.id).not.toBe(todaysMathItem(at(2026, 10, d + 1))?.id);
  });

  it('shows the featured course at least every other day, and other courses too', () => {
    const days = Array.from({ length: 60 }, (_, k) => todaysMathItem(at(2026, 9, 1 + k))!);
    for (let k = 0; k + 1 < days.length; k++) {
      const pair = [days[k]!, days[k + 1]!];
      expect(pair.some((i) => i.courseCode === FEATURED_CODE)).toBe(true);
    }
    const featuredCount = days.filter((i) => i.courseCode === FEATURED_CODE).length;
    expect(featuredCount).toBe(30);
    // Over 60 days every non-featured item comes up (fewer than 30 of them).
    const rest = MATH_DAILY.filter((i) => i.courseCode !== FEATURED_CODE);
    expect(rest.length).toBeLessThanOrEqual(30);
    const seen = new Set(days.map((i) => i.id));
    for (const i of rest) expect(seen.has(i.id)).toBe(true);
  });

  it('pins the rule: even local days featured, odd days the rest', () => {
    const d = at(2026, 9, 29);
    const day = localDayNumber(d);
    expect(day).toBe(20725); // 2026-09-29, days since 1970-01-01
    // 20725 is odd: a non-featured item, index floor(20725/2) mod rest.length.
    const rest = MATH_DAILY.filter((i) => i.courseCode !== FEATURED_CODE);
    expect(todaysMathItem(d)?.id).toBe(rest[Math.floor(day / 2) % rest.length]!.id);
    const feat = MATH_DAILY.filter((i) => i.courseCode === FEATURED_CODE);
    expect(todaysMathItem(at(2026, 9, 30))?.id).toBe(feat[Math.floor((day + 1) / 2) % feat.length]!.id);
  });

  it('falls back to a plain rotation when one list is empty, and undefined when there are no items', () => {
    const only: MathDailyItem[] = MATH_DAILY.filter((i) => i.courseCode === 'MIT 6.042J');
    const a = todaysMathItem(at(2026, 9, 29), only, 'Stanford Stats');
    const b = todaysMathItem(at(2026, 9, 30), only, 'Stanford Stats');
    expect(a && b && a.id !== b.id).toBe(true);
    expect(todaysMathItem(at(2026, 9, 29), [])).toBeUndefined();
  });
});

describe('summarize', () => {
  const now = at(2026, 9, 29);

  it('nothing done: Stanford Stats is current and featured', () => {
    const s = summarize(now, {});
    expect(s.id).toBe('math');
    expect(s.title).toBe('Math');
    expect(s.course).toBe('Stanford Stats · Introduction to Statistics');
    expect(s.progress).toEqual({ done: 0, total: 9, caption: 'Stanford Stats featured' });
  });

  it('1 of 9 done: next course in plan order, CS codes ignored', () => {
    const s = summarize(now, { 'Stanford Stats': true, 'COS 226': true, 'MIT 6.006': true });
    expect(s.progress).toEqual({ done: 1, total: 9, caption: '8 courses to go' });
    expect(s.course).toBe('Yale CS202 · Notes on Discrete Mathematics');
  });

  it('featured course still open keeps the featured caption', () => {
    const s = summarize(now, { 'Yale CS202': true, 'Harvard STAT 110': true });
    expect(s.progress).toEqual({ done: 2, total: 9, caption: 'Stanford Stats featured' });
    expect(s.course).toBe('Stanford Stats · Introduction to Statistics');
  });

  it("next is today's item with a label and 15 to 25 minutes", () => {
    const item = todaysMathItem(now)!;
    const s = summarize(now, {});
    expect(s.next.label).toBe(`${item.kind === 'proof' ? 'Proof' : 'Problem'}: ${item.title}`);
    expect(s.next.detail).toBe(item.source);
    expect(s.next.minutes).toBeGreaterThanOrEqual(15);
    expect(s.next.minutes).toBeLessThanOrEqual(25);
  });

  it('pins known labels on fixed dates', () => {
    const feat = MATH_DAILY.filter((i) => i.courseCode === FEATURED_CODE);
    // Find a date whose item is the z interval, then check the label text exactly.
    const idx = feat.findIndex((i) => i.id === 'stats-z-ci');
    let d = at(2026, 9, 30);
    while (todaysMathItem(d)?.id !== feat[idx]!.id) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2, 12);
    expect(summarize(d, {}).next).toEqual({
      label: 'Problem: 95% confidence interval',
      detail: 'Stanford Intro to Statistics, Module: Confidence intervals',
      minutes: 15,
    });
  });

  it('all done: empty course, still a next action, all-done caption', () => {
    const all = Object.fromEntries(MATH_COURSES.map((c) => [c.code, true]));
    const s = summarize(now, all);
    expect(s.course).toBe('');
    expect(s.progress).toEqual({ done: 9, total: 9, caption: 'all courses done' });
    expect(s.next.label).not.toBe('');
    expect(s.next.detail).toMatch(/^Plan complete/);
  });

  it('stops weighting the featured course once it is done', () => {
    expect(activeFeaturedCode({})).toBe('Stanford Stats');
    expect(activeFeaturedCode({ 'Stanford Stats': true })).toBeNull();
    const done = { 'Stanford Stats': true };
    const days = Array.from({ length: 60 }, (_, k) => at(2026, 9, 1 + k));
    // Plain rotation through every item, one per local day.
    for (const d of days)
      expect(summarize(d, done).next.label).toBe(
        itemLabel(MATH_DAILY[localDayNumber(d) % MATH_DAILY.length]!),
      );
    const stats = days.filter((d) => todaysMathItem(d, MATH_DAILY, null)?.courseCode === FEATURED_CODE);
    expect(stats.length).toBeLessThan(30);
  });

  it('empty plan and no items', () => {
    const s = summarize(now, {}, [], []);
    expect(s.course).toBe('');
    expect(s.progress).toEqual({ done: 0, total: 0, caption: 'no courses planned' });
    expect(s.next.label).toBe('Add a course to the Math plan');
  });
});
