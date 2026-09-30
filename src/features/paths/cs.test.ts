/**
 * CS path summary: pins the user-facing numbers for known states at fixed dates.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { summarize, currentSummary, studiedOn, ALGO_MINUTES } from '@/features/paths/cs';
import { CS_COURSES } from '@/content/cs';
import { pct } from '@/features/paths/types';
import { algoOfDay } from '@/features/studytracker/algorithms';
import { curriculumChecks } from '@/features/studytracker/curriculum';
import { trackerState } from '@/features/studytracker/trackerStore';

const NOW = new Date(2026, 8, 29, 9, 0); // Tue Sep 29 2026, local
const ALGO = { name: 'Dijkstra', oneLiner: 'Shortest paths with a heap.' };
const done = (...codes: string[]) => Object.fromEntries(codes.map((c) => [c, true]));

const savedChecks = curriculumChecks.value;
const savedTracker = trackerState.value;
afterEach(() => {
  curriculumChecks.value = savedChecks;
  trackerState.value = savedTracker;
});

describe('CS summarize', () => {
  it('pins the plan the numbers below assume', () => {
    expect(CS_COURSES.map((c) => c.code)).toEqual(['COS 226', 'MIT 6.006', 'MIT 6.046J', 'MIT 18.404J', 'COS 522']);
  });

  it('2 of 5 done: current is the first not-done course in plan order', () => {
    const s = summarize(NOW, { checks: done('COS 226', 'MIT 6.006'), algo: ALGO });
    expect(s.id).toBe('cs');
    expect(s.title).toBe('Computer Science');
    expect(s.course).toBe('MIT 6.046J · Design and Analysis of Algorithms');
    expect(s.progress).toEqual({ done: 2, total: 5, caption: '3 courses to go' });
    expect(pct(s.progress.done, s.progress.total)).toBe(40);
    expect(s.next).toEqual({ label: 'Algorithm of the day: Dijkstra', detail: 'Shortest paths with a heap.', minutes: ALGO_MINUTES });
    expect(ALGO_MINUTES).toBe(20);
  });

  it('skips a done course out of order', () => {
    const s = summarize(NOW, { checks: done('MIT 6.006'), algo: ALGO });
    expect(s.course).toBe('COS 226 · Algorithms and Data Structures');
    expect(s.progress.done).toBe(1);
    expect(s.progress.caption).toBe('4 courses to go');
  });

  it('nothing done: 0 of 5, first course current', () => {
    const s = summarize(NOW, { checks: {}, algo: ALGO });
    expect(s.course).toBe('COS 226 · Algorithms and Data Structures');
    expect(s.progress).toEqual({ done: 0, total: 5, caption: '5 courses to go' });
    expect(pct(0, 5)).toBe(0);
  });

  it('one left uses the singular', () => {
    const s = summarize(NOW, { checks: done('COS 226', 'MIT 6.006', 'MIT 6.046J', 'MIT 18.404J'), algo: ALGO });
    expect(s.course).toBe('COS 522 · Computational Complexity Theory');
    expect(s.progress.caption).toBe('1 course to go');
  });

  it('all done: empty course, next is still the algorithm of the day', () => {
    const s = summarize(NOW, { checks: done(...CS_COURSES.map((c) => c.code)), algo: ALGO });
    expect(s.course).toBe('');
    expect(s.progress).toEqual({ done: 5, total: 5, caption: 'all courses done' });
    expect(pct(5, 5)).toBe(100);
    expect(s.next.label).toBe('Algorithm of the day: Dijkstra');
  });

  it('studied today changes the caption only', () => {
    const s = summarize(NOW, { checks: done('COS 226'), algo: ALGO, studiedToday: true });
    expect(s.progress).toEqual({ done: 1, total: 5, caption: 'algorithm studied today' });
  });

  it('a current-course pointer wins while it is not done', () => {
    const s = summarize(NOW, { checks: {}, algo: ALGO, current: 'MIT 18.404J' });
    expect(s.course).toBe('MIT 18.404J · Theory of Computation');
    const after = summarize(NOW, { checks: done('MIT 18.404J'), algo: ALGO, current: 'MIT 18.404J' });
    expect(after.course).toBe('COS 226 · Algorithms and Data Structures');
  });

  it('ignores codes that are not CS courses', () => {
    const s = summarize(NOW, { checks: done('MIT 18.01', 'Stanford Stats'), algo: ALGO });
    expect(s.progress.done).toBe(0);
  });
});

describe('CS currentSummary', () => {
  it("labels the next action with that date's algorithm", () => {
    curriculumChecks.value = done('COS 226', 'MIT 6.006');
    const a = algoOfDay(NOW);
    const s = currentSummary(NOW);
    expect(s.next.label).toBe(`Algorithm of the day: ${a.name}`);
    expect(s.next.detail).toBe(a.oneLiner);
    expect(s.progress.done).toBe(2);
    expect(s.progress.total).toBe(5);
    // A different day rotates to a different algorithm.
    const tomorrow = new Date(2026, 8, 30, 9, 0);
    expect(currentSummary(tomorrow).next.label).toBe(`Algorithm of the day: ${algoOfDay(tomorrow).name}`);
  });

  it("counts 'algo:studied' only when it was credited on today's date", () => {
    const day = { date: '2026-09-29', blocks: {}, scores: {}, banked: false, events: { 'algo:studied': 5 } };
    trackerState.value = { cumXP: 0, logged: [], day };
    expect(studiedOn(NOW)).toBe(true);
    expect(currentSummary(NOW).progress.caption).toBe('algorithm studied today');
    // Yesterday's un-rolled day must not read as studied today.
    trackerState.value = { cumXP: 0, logged: [], day: { ...day, date: '2026-09-28' } };
    expect(studiedOn(NOW)).toBe(false);
    trackerState.value = { cumXP: 0, logged: [], day: { ...day, events: {} } };
    expect(studiedOn(NOW)).toBe(false);
  });
});
