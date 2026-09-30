// @vitest-environment jsdom
/**
 * Today's Math card, Cambridge variant: the label for each loop step, the
 * overdue and Sabbath cases, and the counts, pinned at fixed Brooklyn dates.
 */
import { describe, expect, it } from 'vitest';
import { summarize } from '@/features/cambridge/todayCard';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import { catalog, loadCatalog } from '@/features/cambridge/catalog';

await loadCatalog();

const HOUR = 3_600_000;
/** An instant from a Brooklyn wall-clock reading in EDT (UTC-4). */
const edt = (iso: string): number => Date.parse(iso + 'Z') + 4 * HOUR;

// Thursday 1 October 2026, 10 AM in Brooklyn.
const THU = edt('2026-10-01T10:00:00');

function withItems(items: CamItem[], gates: string[] = ['0']): CambridgeState {
  const s = emptyCambridge();
  for (const it of items) s.items[it.id] = it;
  for (const g of gates) s.gates[g] = { phase: g, passedAt: THU - 30 * 24 * HOUR, evidence: {}, updatedAt: 1 };
  return s;
}
const item = (over: Partial<CamItem>): CamItem => ({ id: 'found-07', stage: 'attempting', questions: {}, updatedAt: 1, ...over });

describe('Today Math card (Cambridge)', () => {
  it('nothing started: Start Phase 0, 0 done, and the supervision caption', () => {
    const s = summarize(emptyCambridge(), THU);
    expect(s.id).toBe('math');
    expect(s.title).toBe('Math');
    expect(s.next.label).toBe('Start Phase 0: diagnostic');
    expect(s.progress.done).toBe(0);
    expect(s.progress.total).toBeGreaterThan(0);
    expect(s.progress.caption).toBe('Supervisions this week: 0 of 2');
  });

  it('attempt step: "Assignment 7: attempt cold", with the cold minutes on the running question', () => {
    const s = summarize(
      withItems([item({ questions: { main: { q: 'main', coldSec: 30 * 60, runningSince: THU - 12 * 60_000 } } })]),
      THU,
    );
    expect(s.next.label).toBe('Assignment 7: attempt cold');
    expect(s.next.detail).toBe('42 of 60 min cold on The STEP question');
    expect(s.course).toBe('Phase A · Block 2');
  });

  it('attempt step with no time yet: the step\'s instruction from method.json', () => {
    const s = summarize(withItems([item({})]), THU);
    expect(s.next.label).toBe('Assignment 7: attempt cold');
    expect(s.next.detail).toMatch(/^No looking things up/);
  });

  it('write-up step: every question has a status', () => {
    const s = summarize(
      withItems([item({ questions: { main: { q: 'main', coldSec: 3600, status: 'partial' } } })]),
      THU,
    );
    expect(s.next.label).toBe('Assignment 7: write up');
  });

  it('supervision step: "Supervision due"', () => {
    expect(summarize(withItems([item({ stage: 'written-up' })]), THU).next.label).toBe('Supervision due');
  });

  it('redo step: "Redo due by Thu 6 PM", then overdue after the deadline', () => {
    const due = edt('2026-10-01T18:00:00');
    const sup = item({ stage: 'supervised', supervisedAt: due - 48 * HOUR, redoQs: ['main'], redoDue: due });
    const before = summarize(withItems([sup]), THU);
    expect(before.next.label).toBe('Redo due by Thu 6 PM');
    // Supervised this week (Tuesday), so it counts toward the two.
    expect(before.progress.caption).toBe('Supervisions this week: 1 of 2');
    const after = summarize(withItems([sup]), edt('2026-10-01T19:00:00'));
    expect(after.next.label).toBe('Redo overdue since Thu 6 PM');
  });

  it('Sabbath: "Resumes Sat …" with the next step kept as the detail', () => {
    const fridayNight = edt('2026-10-02T21:00:00');
    const s = summarize(withItems([item({ stage: 'written-up' })]), fridayNight);
    expect(s.next.label).toMatch(/^Resumes Sat \d{1,2}:\d{2} PM$/);
    expect(s.next.detail).toBe('Then: Supervision due');
    // Thursday morning is outside the window.
    expect(summarize(withItems([item({ stage: 'written-up' })]), THU).next.label).toBe('Supervision due');
  });

  it('progress counts finished items in the current phase', () => {
    const a = catalog().phases.get('A')!;
    const done = a.items.slice(0, 3).map((id) => item({ id, stage: 'redo-done' }));
    const s = summarize(withItems([...done, item({})]), THU);
    expect(s.progress).toMatchObject({ done: 3, total: a.items.length });
  });
});
