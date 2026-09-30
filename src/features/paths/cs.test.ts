/**
 * CS path summary: pins the user-facing numbers for known Cambridge states at a
 * fixed date. The course line and progress follow the CST track; the retired
 * COS/MIT plan must never show.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { summarize, currentSummary, studiedOn, cstProgress, ALGO_MINUTES } from '@/features/paths/cs';
import { pct } from '@/features/paths/types';
import { algoOfDay } from '@/features/studytracker/algorithms';
import { trackerState } from '@/features/studytracker/trackerStore';
import { catItem, loadPath, pathPhases } from '@/features/cambridge/catalog';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import retired from '@data/archive/princeton-curriculum.json';

const NOW = new Date(2026, 8, 29, 9, 0); // Tue Sep 29 2026, local
const ALGO = { name: 'Dijkstra', oneLiner: 'Shortest paths with a heap.' };
const RETIRED = retired.courses.map((c) => c.code);

await loadPath('cst');
const FIRST = pathPhases('cst')[0]!;
const [I0, I1] = FIRST.items as [string, string];
const done = (...ids: string[]): CambridgeState => ({
  ...emptyCambridge(),
  items: Object.fromEntries(ids.map((id): [string, CamItem] => [id, { id, stage: 'redo-done', questions: {}, updatedAt: 1 }])),
});

const savedTracker = trackerState.value;
afterEach(() => {
  trackerState.value = savedTracker;
});

describe('CS summarize', () => {
  it('pins the first CST phase the numbers below assume', () => {
    expect(FIRST.name).toBe('CS-0 Proof');
    expect(FIRST.items).toHaveLength(14);
    expect(catItem(I0)?.title).toBe('TMUA Notes on Logic and Proof');
  });

  it('an empty store: the first CST item, 0 of 14, next is the algorithm of the day', () => {
    const s = summarize(NOW, { cam: emptyCambridge(), algo: ALGO });
    expect(s.id).toBe('cs');
    expect(s.title).toBe('Computer Science');
    expect(s.course).toBe('CS-0 Proof · TMUA Notes on Logic and Proof');
    expect(s.progress).toEqual({ done: 0, total: 14, caption: '14 items left in CS-0 Proof' });
    expect(pct(s.progress.done, s.progress.total)).toBe(0);
    expect(s.next).toEqual({ label: 'Algorithm of the day: Dijkstra', detail: 'Shortest paths with a heap.', minutes: ALGO_MINUTES });
    expect(ALGO_MINUTES).toBe(20);
  });

  it('a finished item counts and the course line moves to the next one', () => {
    const s = summarize(NOW, { cam: done(I0), algo: ALGO });
    expect(s.course).toBe(`CS-0 Proof · ${catItem(I1)!.title}`);
    expect(s.progress).toEqual({ done: 1, total: 14, caption: '13 items left in CS-0 Proof' });
    expect(pct(1, 14)).toBe(7);
  });

  it('one left uses the singular', () => {
    const s = summarize(NOW, { cam: done(...FIRST.items.slice(0, 13)), algo: ALGO });
    expect(s.progress.caption).toBe('1 item left in CS-0 Proof');
  });

  it('studied today changes the caption only', () => {
    const s = summarize(NOW, { cam: done(I0), algo: ALGO, studiedToday: true });
    expect(s.progress).toEqual({ done: 1, total: 14, caption: 'algorithm studied today' });
  });

  it('never shows a retired Princeton or MIT course code', () => {
    for (const cam of [emptyCambridge(), done(I0), done(...FIRST.items)]) {
      const s = summarize(NOW, { cam, algo: ALGO });
      const text = [s.course, s.next.label, s.progress.caption].join(' ');
      for (const code of RETIRED) expect(text).not.toContain(code);
    }
  });

  it('cstProgress ignores deleted items', () => {
    const cam = done(I0);
    cam.items[I0] = { ...cam.items[I0]!, deleted: true };
    expect(cstProgress(cam, NOW.getTime()).done).toBe(0);
  });
});

describe('CS currentSummary', () => {
  it("labels the next action with that date's algorithm", () => {
    const a = algoOfDay(NOW);
    const s = currentSummary(NOW);
    expect(s.next.label).toBe(`Algorithm of the day: ${a.name}`);
    expect(s.next.detail).toBe(a.oneLiner);
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
