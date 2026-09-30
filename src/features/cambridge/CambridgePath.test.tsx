/**
 * The Cambridge path screen: loading skeleton, the phase map with locked gate
 * text, the current block's item rows, opening an item (Back returns to the
 * path), and the Pass gate flow with its evidence and +200 XP.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { CambridgePathView } from '@/features/cambridge/CambridgePath';
import { commitCambridge, readCambridge } from '@/features/cambridge/store';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import { bump, camItemId, currentTab } from '@/ui/store';
import { onCamPopNav } from '@/features/cambridge/nav';
import { trackerState } from '@/features/studytracker/trackerStore';

const ready = Promise.resolve();
const T = Date.now();

function seed(fn: (s: CambridgeState) => void = () => {}): void {
  const s = emptyCambridge();
  fn(s);
  commitCambridge(s, { system: true });
}
const item = (id: string, patch: Partial<CamItem> = {}): CamItem => ({ id, stage: 'not-started', questions: {}, updatedAt: T, ...patch });

beforeEach(() => seed());
afterEach(() => {
  cleanup();
  currentTab.value = 'today';
  camItemId.value = null;
});

describe('CambridgePathView', () => {
  it('shows a same-outline skeleton until the store is ready', () => {
    const { container } = render(<CambridgePathView ready={new Promise(() => {})} />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll('.cam-skel-phase')).toHaveLength(7);
    expect(container.querySelectorAll('.cam-skel-row')).toHaveLength(4);
  });

  it('a fresh start: Phase 0 current, the rest locked with their gate written out', async () => {
    const { findByText, container, getByText } = render(<CambridgePathView ready={ready} />);
    await findByText('The Cambridge Method');
    const rows = [...container.querySelectorAll('.m-phasemap > .m-phase')];
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['current', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked']);
    expect(rows[0]!.getAttribute('aria-current')).toBe('step');
    expect(getByText("Unlocks when Phase 0's gate passes.")).toBeTruthy();
    // C and Part IA both wait for B.
    expect(container.querySelectorAll('.m-phase-gate').length).toBe(7);
    expect([...container.querySelectorAll('.m-phase-gate')].filter((n) => n.textContent === "Unlocks when Phase B's gate passes.")).toHaveLength(2);
    // Locked rows are not buttons.
    expect(rows[1]!.querySelector('button')).toBeNull();
    expect(container.querySelector('.m-pagehead .m-label')?.textContent).toBe('Phase 0 · 0 of 1');
    expect(getByText('0 of 7 passed')).toBeTruthy();
  });

  it('lists the current block with stage words, and opens an item with Back to the path', async () => {
    seed((s) => {
      s.gates['0'] = { phase: '0', passedAt: T, evidence: {}, updatedAt: T };
      s.items['found-01'] = item('found-01', { stage: 'redo-done' });
      s.items['found-02'] = item('found-02', { stage: 'attempting' });
    });
    currentTab.value = 'cambridge';
    const { findByText, container } = render(<CambridgePathView ready={ready} />);
    await findByText('Phase A · Block 1');
    const rows = [...container.querySelectorAll('.cam-items .cam-item')];
    expect(rows.map((r) => r.querySelector('.cam-item-title')?.textContent)).toEqual(['Assignment 1', 'Assignment 2', 'Assignment 3', 'Assignment 4']);
    expect(rows[1]!.querySelector('.m-status')?.textContent).toBe('Attempting');
    expect(rows[0]!.querySelector('.m-status')?.getAttribute('data-status')).toBe('redo-done');

    fireEvent.click(rows[1]!);
    expect(currentTab.value).toBe('cam-item');
    expect(camItemId.value).toBe('found-02');
    onCamPopNav(); // the browser Back
    expect(currentTab.value).toBe('cambridge');
  });

  it('an overdue redo is the one warning line', async () => {
    seed((s) => {
      s.gates['0'] = { phase: '0', passedAt: T, evidence: {}, updatedAt: T };
      s.items['found-01'] = item('found-01', { stage: 'supervised', supervisedAt: T - 3 * 864e5, redoQs: ['main'], redoDue: T - 864e5 });
    });
    const { findByText } = render(<CambridgePathView ready={ready} />);
    const line = await findByText(/^Redo overdue since /);
    expect(line.getAttribute('data-warn')).toBe('true');
  });

  it('the gate waits for supervision, then records the pass with evidence and pays 200 XP once', async () => {
    const { findByText, getByText, getByLabelText, container, queryByText } = render(<CambridgePathView ready={ready} />);
    await findByText('The Cambridge Method');
    const open = container.querySelector('.m-phase[data-state="current"] .m-phase-open') as HTMLButtonElement;
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(getByText('1 item still to supervise before the gate.')).toBeTruthy();
    expect(queryByText('Pass the gate')).toBeNull();

    seed((s) => { s.items['found-01'] = item('found-01', { stage: 'supervised' }); });
    bump(); // what every store write does
    fireEvent.click(await findByText('Pass the gate'));

    // Invalid evidence: the rule turns into the error, and nothing is written.
    fireEvent.click(getByText('Record the pass'));
    const unaided = getByLabelText('Warm-up done with no help (yes/no)') as HTMLSelectElement;
    expect(unaided.getAttribute('aria-invalid')).toBe('true');
    expect(readCambridge().gates['0']).toBeUndefined();

    fireEvent.change(unaided, { target: { value: 'yes' } });
    fireEvent.input(getByLabelText('Gaps fixed on the way (topics)'), { target: { value: 'completing the square' } });
    const xpBefore = trackerState.value.day.events?.['cam:gatePassed:0'];
    fireEvent.click(getByText('Record the pass'));

    const gate = readCambridge().gates['0']!;
    expect(gate.evidence).toEqual({ unaided: 'yes', gaps: 'completing the square' });
    expect(readCambridge().awarded['cam:gatePassed:0']).toBeGreaterThan(0);
    expect(xpBefore).toBeUndefined();
    expect(trackerState.value.day.events?.['cam:gatePassed:0']).toBe(200);
    await waitFor(() => expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Phase 0 passed. Phase A is open.'));
    const rows = [...container.querySelectorAll('.m-phasemap > .m-phase')];
    expect(rows[0]!.getAttribute('data-state')).toBe('passed');
    expect(rows[1]!.getAttribute('data-state')).toBe('current');
  });

  it('offline: the section notes say when the work was last saved', async () => {
    seed((s) => { s.items['found-01'] = item('found-01', { stage: 'attempting', updatedAt: Date.UTC(2026, 9, 2, 1, 14) }); });
    const spy = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      const { findAllByText } = render(<CambridgePathView ready={ready} />);
      expect((await findAllByText('Offline · Saved 9:14 PM')).length).toBeGreaterThan(0);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine;
      if (spy) Object.defineProperty(Navigator.prototype, 'onLine', spy);
    }
  });
});

describe('STEP is glossed on the path without a button inside a button', () => {
  it('the gate line sits outside the phase button, so its terms can be glossed', async () => {
    const { glossaryData } = await import('@/features/cambridge/Gloss');
    const glossary = (await import('@data/cambridge/glossary.json')).default;
    glossaryData.value = glossary as never;
    seed((s) => {
      s.gates['0'] = { phase: '0', passedAt: T, evidence: {}, updatedAt: T };
    });
    const { findByText, container } = render(<CambridgePathView ready={ready} />);
    await findByText('The Cambridge Method');
    const a = container.querySelector('#cam-ph-A')!;
    const gate = a.querySelector('.m-phase-gate')!;
    expect(gate.closest('button')).toBeNull();
    expect([...gate.querySelectorAll('button.m-gloss')].map((b) => b.textContent)).toContain('STEP');
    // Nothing interactive inside the phase's own button.
    for (const b of container.querySelectorAll('button.m-phase-open')) expect(b.querySelector('button')).toBeNull();
    glossaryData.value = null;
  });
});
