/**
 * Stage 4 review fixes on the error log: the header count agrees with the trend
 * (entries needing a cause are counted on their own), rows name the question by
 * its label, an empty log still says it is offline, the cause form follows a
 * sync pull until edited, and a store that never loads shows a retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { appState } from '@/app/bootstrap';
import { bump } from '@/ui/store';
import { emptyCambridge, type CamError } from '@/features/cambridge/types';
import { readCambridge } from '@/features/cambridge/store';
import { ErrorLogView, questionLabel } from '@/features/cambridge/ErrorLog';

const HOUR = 3_600_000;
// Thursday 1 October 2026, noon in Brooklyn: ISO week 2026-W40.
const NOW = Date.parse('2026-10-01T12:00:00Z') + 4 * HOUR;

const err = (id: string, over: Partial<CamError>): CamError => ({
  id, itemId: 'found-01', q: 'main', cause: 'concept', topic: 'Quadratics', fix: '', at: NOW - HOUR, updatedAt: 1, ...over,
});
function seed(errors: CamError[]): void {
  const s = emptyCambridge();
  for (const e of errors) s.errors[e.id] = e;
  appState.set('cambridge', s as never);
}
const ready = Promise.resolve();
let onLine = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  onLine = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  appState.set('cambridge', emptyCambridge() as never);
});

describe('error log review fixes', () => {
  it('the header counts every entry, names those needing a cause, and says what the trend charts', async () => {
    seed([
      err('e1', { cause: 'concept' }),
      err('e2', { cause: 'algebra slip' }),
      err('auto:found-01:preparation', { q: 'preparation', cause: '' as never }),
    ]);
    const r = render(<ErrorLogView ready={ready} />);
    expect(await r.findByText('3 entries · 1 needs a cause · 2 charted this week')).toBeTruthy();
    expect(r.container.querySelector('.m-trend-cap')!.textContent).toContain('2 this week');
    expect(r.getByText('Entries with a cause')).toBeTruthy();
  });

  it('a log whose only entry needs a cause counts it, and charts nothing yet', async () => {
    seed([err('auto:found-01:preparation', { q: 'preparation', cause: '' as never })]);
    const r = render(<ErrorLogView ready={ready} />);
    expect(await r.findByText('1 entry · 1 needs a cause · 0 charted this week')).toBeTruthy();
    expect(r.container.querySelector('.m-trend-cap')!.textContent).toContain('0 this week');
  });

  it('with every entry caused, the header needs no chart rule', async () => {
    seed([err('e1', { cause: 'concept' })]);
    const r = render(<ErrorLogView ready={ready} />);
    expect(await r.findByText('1 entry · 1 this week')).toBeTruthy();
    expect(r.queryByText('Entries with a cause')).toBeNull();
  });

  it('rows show the question label, not its id', async () => {
    seed([err('e1', { q: 'preparation' }), err('e2', { itemId: 'cst-discmath', q: 'sw1', at: NOW - 2 * HOUR })]);
    expect(questionLabel('found-01', 'preparation')).toBe('Preparation');
    expect(questionLabel('found-01', 'main')).toBe('The STEP question');
    expect(questionLabel('gone-item', 'sw1')).toBe('Sw1');
    const r = render(<ErrorLogView ready={ready} />);
    await r.findByRole('heading', { name: 'Entries' });
    const lines = [...r.container.querySelectorAll('.el-line1')].map((e) => e.textContent);
    expect(lines.some((l) => l!.endsWith('· Assignment 1 · Preparation'))).toBe(true);
    expect(lines.some((l) => l!.endsWith(' · Supervision exercises: Proofs, Numbers, and Sets'))).toBe(true);
    expect(lines.some((l) => /· (preparation|sw1)$/.test(l!))).toBe(false);
  });

  it('an empty log still says it is offline, with the last save time', async () => {
    onLine = false;
    const s = emptyCambridge();
    s.items['found-01'] = { id: 'found-01', stage: 'attempting', questions: {}, updatedAt: NOW - HOUR };
    appState.set('cambridge', s as never);
    const r = render(<ErrorLogView ready={ready} />);
    expect(await r.findByText('No errors logged yet.')).toBeTruthy();
    expect(r.container.querySelector('[data-kind="offline"]')?.textContent).toMatch(/^Offline · Saved \d+:\d\d (AM|PM)$/);
  });

  it('the fix field follows a pull until the owner edits it; Save keeps the pulled fix', async () => {
    seed([err('auto:found-01:main', { cause: '' as never, fix: '' })]);
    const r = render(<ErrorLogView ready={ready} />);
    const fix = (await r.findByLabelText('Fix')) as HTMLInputElement;
    // Another device picked a fix; this form has not been touched.
    act(() => {
      const s = readCambridge();
      appState.set('cambridge', { ...s, errors: { ...s.errors, 'auto:found-01:main': { ...s.errors['auto:found-01:main']!, fix: 'Check the sign.', updatedAt: 50 } } } as never);
      bump();
    });
    expect(fix.value).toBe('Check the sign.');
    fireEvent.change(r.getByLabelText('Cause'), { target: { value: 'algebra slip' } });
    fireEvent.click(r.getByText('Save'));
    expect(readCambridge().errors['auto:found-01:main']).toMatchObject({ cause: 'algebra slip', fix: 'Check the sign.' });
  });

  it('a store that never loads shows the error state after the timeout, with Try again', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = render(<ErrorLogView ready={new Promise(() => {})} />);
    expect(r.container.querySelector('[aria-busy="true"]')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(r.getByText("The error log didn't load.")).toBeTruthy();
    expect(r.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
