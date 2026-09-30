/**
 * Error log: filters by cause and topic (list, count and trend follow), the
 * weekly trend and its hidden table, editing a cause (last-writer-wins stamp),
 * delete behind the Undo toast (a tombstone), and the read-only archived journal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { appState } from '@/app/bootstrap';
import { flushPendingDelete } from '@/ui/actions';
import { currentTab, camItemId, undoToast } from '@/ui/store';
import { emptyCambridge, type CamError, type CambridgeState } from '@/features/cambridge/types';
import { readCambridge } from '@/features/cambridge/store';
import { ErrorLogView, lastWeeks, weeklyTrend } from '@/features/cambridge/ErrorLog';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const edt = (iso: string): number => Date.parse(iso + 'Z') + 4 * HOUR;
// Thursday 1 October 2026, noon in Brooklyn: ISO week 2026-W40.
const NOW = edt('2026-10-01T12:00:00');

const err = (id: string, over: Partial<CamError>): CamError => ({
  id, itemId: 'found-07', q: 'main', cause: 'concept', topic: 'Quadratics', fix: 'Check the sign.',
  at: NOW - HOUR, updatedAt: 1, ...over,
});

function seed(errors: CamError[]): CambridgeState {
  const s = emptyCambridge();
  for (const e of errors) s.errors[e.id] = e;
  appState.set('cambridge', s as never);
  return s;
}

const ERRORS = [
  err('e1', { cause: 'concept', topic: 'Quadratics' }),
  err('e2', { cause: 'algebra slip', topic: 'Quadratics', fix: 'Complete the square slowly.' }),
  err('e3', { cause: 'algebra slip', topic: 'Inequalities', at: NOW - 7 * DAY }),
  err('e4', { cause: 'ran out of time', topic: 'Inequalities', at: NOW - 21 * DAY }),
];

const ready = Promise.resolve();
const renderLog = async () => {
  const r = render(<ErrorLogView ready={ready} />);
  await r.findByRole('heading', { name: 'Weekly trend' });
  return r;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  seed(ERRORS);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  flushPendingDelete();
  localStorage.clear();
  appState.set('cambridge', emptyCambridge() as never);
  currentTab.value = 'today';
  camItemId.value = null;
});

describe('weeklyTrend', () => {
  it('covers the last 8 ISO weeks and stacks by cause', () => {
    expect(lastWeeks(NOW)).toEqual(['2026-W33', '2026-W34', '2026-W35', '2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40']);
    const t = weeklyTrend(ERRORS, NOW);
    expect(t.totals).toEqual([0, 0, 0, 0, 1, 0, 1, 2]);
    expect(t.counts[7]).toEqual([1, 1, 0, 0]); // concept, algebra slip, didn't see, ran out
    expect(t.max).toBe(2);
  });
});

describe('ErrorLogView', () => {
  it('shows a skeleton until the store is ready', () => {
    const { container } = render(<ErrorLogView ready={new Promise(() => {})} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('lists entries newest first with date, item, question, cause, topic and fix', async () => {
    const { container, getByText } = await renderLog();
    expect(getByText('4 entries · 2 this week')).toBeTruthy();
    const rows = container.querySelectorAll('.cam-err');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.querySelector('.el-line1')!.textContent).toBe('Thu 1 Oct · Assignment 7 · The STEP question');
    expect(rows[0]!.textContent).toContain('Concept · Quadratics');
    expect(rows[0]!.textContent).toContain('Fix: Check the sign.');
  });

  it('filters by cause: list, count, live region and trend follow', async () => {
    const r = await renderLog();
    fireEvent.click(within(r.getByRole('group', { name: 'Filter by cause' })).getByRole('button', { name: 'Algebra slip' }));
    expect(r.container.querySelectorAll('.cam-err')).toHaveLength(2);
    expect(r.getByText('Showing 2')).toBeTruthy();
    expect(r.container.querySelector('p[aria-live="polite"]')!.textContent).toBe('Showing 2 entries');
    // One series under a cause filter; its hidden table has one cause column.
    expect(r.container.querySelectorAll('.m-trend-key li')).toHaveLength(1);
    expect(r.container.querySelectorAll('.m-sr table thead th')).toHaveLength(3);
    const bars = r.getByRole('img');
    expect(bars.getAttribute('aria-label')).toBe('Errors per week, last 8 weeks: W33 0, W34 0, W35 0, W36 0, W37 0, W38 0, W39 1, W40 1');
  });

  it('filters by topic, and combined filters can empty the list with a Clear filters action', async () => {
    const r = await renderLog();
    fireEvent.change(r.getByLabelText('Topic'), { target: { value: 'Inequalities' } });
    expect(r.container.querySelectorAll('.cam-err')).toHaveLength(2);
    fireEvent.click(r.getByRole('button', { name: 'Concept' }));
    expect(r.getByText('No entries for Concept in Inequalities.')).toBeTruthy();
    fireEvent.click(r.getByRole('button', { name: 'Clear filters' }));
    expect(r.container.querySelectorAll('.cam-err')).toHaveLength(4);
  });

  it('trend: current week marked, and a hidden table with the same numbers', async () => {
    const { container } = await renderLog();
    const cols = container.querySelectorAll('.m-trend-col');
    expect(cols).toHaveLength(8);
    expect(cols[7]!.getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('.m-trend-key')!.getAttribute('aria-hidden')).toBe('true');
    const rows = container.querySelectorAll('.m-sr table tbody tr');
    expect(rows[7]!.textContent).toBe('2026-W40' + '1100' + '2');
    expect(container.querySelector('.m-trend-cap')!.textContent).toContain('2 this week · 1 last');
  });

  it('an entry without a cause asks for one; saving stamps a newer updatedAt', async () => {
    seed([err('e9', { cause: '' as never, fix: '' })]);
    const r = await renderLog();
    expect(r.getByText('Needs a cause')).toBeTruthy();
    fireEvent.change(r.getByLabelText('Cause'), { target: { value: "didn't see the idea" } });
    fireEvent.input(r.getByLabelText('Fix'), { target: { value: 'Try a substitution first.' } });
    fireEvent.click(r.getByRole('button', { name: 'Save' }));
    const saved = readCambridge().errors.e9!;
    expect(saved.cause).toBe("didn't see the idea");
    expect(saved.fix).toBe('Try a substitution first.');
    expect(saved.updatedAt).toBeGreaterThan(1);
    await waitFor(() => expect(r.queryByText('Needs a cause')).toBeNull());
  });

  it('edit changes an existing cause', async () => {
    const r = await renderLog();
    const row = r.container.querySelectorAll<HTMLElement>('.cam-err')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByLabelText('Cause'), { target: { value: 'ran out of time' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(readCambridge().errors.e1!.cause).toBe('ran out of time');
  });

  it('delete hides the row behind Undo, then writes a tombstone', async () => {
    const r = await renderLog();
    const row = r.container.querySelectorAll<HTMLElement>('.cam-err')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(undoToast.value).toBe('Error log entry deleted');
    await waitFor(() => expect(r.container.querySelectorAll('.cam-err')).toHaveLength(3));
    expect(readCambridge().errors.e1!.deleted).toBeUndefined();
    flushPendingDelete();
    expect(readCambridge().errors.e1!.deleted).toBe(true);
  });

  it('opens the study item', async () => {
    const r = await renderLog();
    const row = r.container.querySelectorAll<HTMLElement>('.cam-err')[0]!;
    fireEvent.click(within(row).getByRole('button', { name: 'Open Assignment 7' }));
    expect(currentTab.value).toBe('cam-item');
    expect(camItemId.value).toBe('found-07');
  });

  it('empty: says what fills the log', async () => {
    seed([]);
    const r = render(<ErrorLogView ready={ready} />);
    expect(await r.findByText('No errors logged yet.')).toBeTruthy();
  });

  it('archived journal: the old proof journal, read-only', async () => {
    localStorage.setItem(
      'meridian.proofjournal.v1',
      JSON.stringify([
        { id: 'j1', at: edt('2026-09-10T20:00:00'), title: 'Root 2 is irrational', body: 'Suppose p/q in lowest terms.' },
        { id: 'j2', at: edt('2026-09-12T20:00:00'), title: 'AM-GM', body: 'Square the difference.' },
      ]),
    );
    const r = await renderLog();
    const section = r.getByRole('heading', { name: 'Archived journal' }).closest('section')!;
    expect(section.textContent).toContain('Read-only');
    expect(section.querySelector('details summary')!.textContent).toContain('2 entries');
    const titles = [...section.querySelectorAll('.el-journal-title')].map((n) => n.textContent);
    expect(titles).toEqual(['AM-GM', 'Root 2 is irrational']);
    expect(section.querySelector('button, input, textarea')).toBeNull();
  });

  it('archived journal: empty on a device that never had one', async () => {
    const r = await renderLog();
    expect(r.getByText('No archived journal on this device.')).toBeTruthy();
  });

  it('offline: the entries note shows the last save time', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    seed([err('e1', { updatedAt: edt('2026-10-01T09:14:00') })]);
    const r = await renderLog();
    expect(r.getByText('Offline · Saved 9:14 AM')).toBeTruthy();
    vi.restoreAllMocks();
  });
});
