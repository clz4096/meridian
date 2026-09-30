/**
 * Stage 4 review fixes on the study item:
 * - An open item never writes its stale copy over another device's newer
 *   write-up (or stalled note) that a sync pull brought in. It saves only what
 *   the owner typed.
 * - Editing the supervision log later keeps the supervision's date, redo
 *   deadline, redo and stage.
 * - The STEP self-mark XP pays only for STEP questions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { StudyItemView } from '@/features/cambridge/StudyItem';
import { commitCambridge, readCambridge } from '@/features/cambridge/store';
import { redoDue } from '@/features/cambridge/schedule';
import { emptyCambridge, type CamItem } from '@/features/cambridge/types';
import { bump } from '@/ui/store';
import { FLUSH_EVENT } from '@/ui/reopen';
import { appState } from '@/app/bootstrap';
import { syncTrackerFromStore, trackerState } from '@/features/studytracker/trackerStore';

const ready = Promise.resolve();
// Mon 28 Sep 2026, noon in Brooklyn.
const T0 = Date.UTC(2026, 8, 28, 16);
let clock = T0;

beforeEach(() => {
  clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  commitCambridge(emptyCambridge(), { system: true });
  appState.set('theorist', { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false } });
  syncTrackerFromStore();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const item = (): CamItem | undefined => readCambridge().items['found-01'];
const renderItem = () => render(<StudyItemView ready={ready} itemId="found-01" />);
const textarea = (c: Element) => c.querySelector('textarea.m-editor-input') as HTMLTextAreaElement;

/** What a sync pull does: the merged store replaces the local one, then views re-render. */
function pull(edit: (it: CamItem) => CamItem, at: number): void {
  const s = readCambridge();
  const prev = s.items['found-01'] ?? { id: 'found-01', stage: 'not-started', questions: {}, updatedAt: 0 };
  act(() => {
    commitCambridge({ ...s, items: { ...s.items, 'found-01': { ...edit(structuredClone(prev)), updatedAt: at } } }, { system: true });
    bump();
  });
}

describe('an open item and a sync pull', () => {
  it('adopts the pulled write-up, and closing without typing keeps it', async () => {
    pull((it) => ({ ...it, stage: 'attempting', writeup: 'A wrote this' }), T0 - 60_000);
    const r = renderItem();
    await r.findByText('Assignment 1');
    expect(textarea(r.container).value).toBe('A wrote this');

    // Another device's newer write-up arrives while the item is open.
    pull((it) => ({ ...it, writeup: 'B edited this later' }), T0 + 1000);
    expect(textarea(r.container).value).toBe('B edited this later');

    clock = T0 + 5000;
    r.unmount(); // Back, without typing
    expect(item()!.writeup).toBe('B edited this later');
    expect(item()!.updatedAt).toBe(T0 + 1000);
  });

  it('never writes on close when nothing was typed, even if the pull landed after the last render', async () => {
    pull((it) => ({ ...it, stage: 'attempting', writeup: 'A wrote this' }), T0 - 60_000);
    const r = renderItem();
    await r.findByText('Assignment 1');
    // The store changes with no re-render at all (the pull's bump has not run yet).
    const s = readCambridge();
    commitCambridge({ ...s, items: { ...s.items, 'found-01': { ...s.items['found-01']!, writeup: 'B edited this later', updatedAt: T0 + 1000 } } }, { system: true });
    r.unmount();
    expect(item()!.writeup).toBe('B edited this later');
  });

  it('typed text is the owner’s edit: it is saved on close, stamped newer than the pull', async () => {
    pull((it) => ({ ...it, stage: 'attempting', writeup: 'A wrote this' }), T0 - 60_000);
    const r = renderItem();
    await r.findByText('Assignment 1');
    fireEvent.input(textarea(r.container), { target: { value: 'A wrote this, and more' } });
    // A pull lands mid-edit: the owner's visible text stays.
    pull((it) => ({ ...it, writeup: 'B edited this later' }), T0 + 1000);
    expect(textarea(r.container).value).toBe('A wrote this, and more');

    clock = T0 + 2000;
    r.unmount(); // closes before the 500 ms autosave
    expect(item()!.writeup).toBe('A wrote this, and more');
    expect(item()!.updatedAt).toBeGreaterThan(T0 + 1000);
  });

  it('typed text autosaves after 500 ms, then later pulls are adopted again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = renderItem();
    await vi.waitFor(() => r.getByText('Assignment 1'));
    fireEvent.input(textarea(r.container), { target: { value: 'first draft' } });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(item()!.writeup).toBe('first draft');

    pull((it) => ({ ...it, writeup: 'fixed on the laptop' }), clock + 10_000);
    expect(textarea(r.container).value).toBe('fixed on the laptop');
    r.unmount();
    expect(item()!.writeup).toBe('fixed on the laptop');
  });

  it('a reload into the screen (Try again) first saves what was just typed', async () => {
    const r = renderItem();
    await r.findByText('Assignment 1');
    fireEvent.input(textarea(r.container), { target: { value: 'typed a moment ago' } });
    expect(item()?.writeup).toBeUndefined(); // inside the 500 ms autosave window
    window.dispatchEvent(new Event(FLUSH_EVENT));
    expect(item()!.writeup).toBe('typed a moment ago');
  });

  it('the "where you stalled" note follows the same rule', async () => {
    pull((it) => ({ ...it, stage: 'attempting', questions: { 'warm-up': { q: 'warm-up', coldSec: 0, status: 'stuck', stalledAt: 'old note' } } }), T0 - 60_000);
    const r = renderItem();
    const input = (await r.findByLabelText('Where you stalled')) as HTMLInputElement;
    expect(input.value).toBe('old note');
    pull((it) => ({ ...it, questions: { 'warm-up': { ...it.questions['warm-up']!, stalledAt: 'newer note' } } }), T0 + 1000);
    expect(input.value).toBe('newer note');
    r.unmount();
    expect(item()!.questions['warm-up']!.stalledAt).toBe('newer note');
  });
});

describe('editing the supervision log', () => {
  it('keeps the supervision date, redo deadline, redo and stage; only marks, weak points and redo questions change', async () => {
    const r = renderItem();
    fireEvent.click(await r.findByText('Log the supervision'));
    fireEvent.input(r.getByLabelText('Warm-up mark'), { target: { value: '12' } });
    fireEvent.input(r.getByLabelText('Weak point 1'), { target: { value: 'signs' } });
    fireEvent.change(r.getByLabelText('Redo question 1'), { target: { value: 'warm-up' } });
    fireEvent.click(r.getByText('Save'));
    expect(item()).toMatchObject({ stage: 'supervised', supervisedAt: T0, redoDue: redoDue(T0) });

    clock = T0 + 20 * 3600 * 1000;
    fireEvent.click(r.getByText('Mark redo done'));
    expect(item()).toMatchObject({ stage: 'redo-done', redoneAt: clock });
    const redoneAt = clock;

    clock = T0 + 30 * 3600 * 1000;
    fireEvent.click(r.getByText('Edit the supervision log'));
    fireEvent.input(r.getByLabelText('Warm-up mark'), { target: { value: '13' } });
    fireEvent.input(r.getByLabelText('Weak point 2'), { target: { value: 'the discriminant' } });
    fireEvent.click(r.getByText('Save'));

    expect(item()).toMatchObject({
      stage: 'redo-done', supervisedAt: T0, redoDue: redoDue(T0), redoneAt,
      weakPoints: ['signs', 'the discriminant'], redoQs: ['warm-up'],
    });
    expect(item()!.questions['warm-up']!.mark).toBe(13);
    expect(r.container.querySelector('.ci-root > [aria-live="polite"]')?.textContent).toBe('Supervision log updated.');
  });

  it('an open form never puts back weak points another device changed, unless the owner edited them', async () => {
    const r = renderItem();
    fireEvent.click(await r.findByText('Log the supervision'));
    fireEvent.input(r.getByLabelText('Weak point 1'), { target: { value: 'signs' } });
    fireEvent.click(r.getByText('Save'));

    fireEvent.click(r.getByText('Edit the supervision log'));
    pull((it) => ({ ...it, weakPoints: ['signs', 'from the laptop'] }), clock + 1000);
    expect((r.getByLabelText('Weak point 2') as HTMLInputElement).value).toBe('from the laptop');
    fireEvent.input(r.getByLabelText('Warm-up mark'), { target: { value: '15' } });
    fireEvent.click(r.getByText('Save'));
    expect(item()!.weakPoints).toEqual(['signs', 'from the laptop']);
    expect(item()!.questions['warm-up']!.mark).toBe(15);
  });
});

describe('STEP self-mark XP', () => {
  it('Assignment 1: warm-up 18, warm-down 16, the STEP question 15 pays +10 once, for the STEP question only', async () => {
    const r = renderItem();
    fireEvent.click(await r.findByText('Log the supervision'));
    fireEvent.input(r.getByLabelText('Warm-up mark'), { target: { value: '18' } });
    fireEvent.input(r.getByLabelText('Warm-down mark'), { target: { value: '16' } });
    fireEvent.input(r.getByLabelText('The STEP question mark'), { target: { value: '15' } });
    fireEvent.click(r.getByText('Save'));

    const aw = Object.keys(readCambridge().awarded).filter((k) => k.startsWith('cam:stepSelfMark:'));
    expect(aw).toEqual(['cam:stepSelfMark:found-01:main']);
    const events = trackerState.value.day.events ?? {};
    const stepXp = Object.entries(events).filter(([k]) => k.startsWith('cam:stepSelfMark:'));
    expect(stepXp).toEqual([['cam:stepSelfMark:found-01:main', 10]]);
  });

  it('the per-question mark field pays only for the STEP question', async () => {
    pull((it) => ({ ...it, stage: 'supervised', supervisedAt: T0 - 1000 }), T0 - 1000);
    const r = renderItem();
    await r.findByText('Assignment 1');
    // Warm-up is selected first; its mark field is the only "Mark" on screen.
    fireEvent.input(r.getByLabelText('Mark'), { target: { value: '19' } });
    fireEvent.change(r.getByLabelText('Mark'));
    expect(item()!.questions['warm-up']!.mark).toBe(19);
    expect(readCambridge().awarded['cam:stepSelfMark:found-01:warm-up']).toBeUndefined();

    fireEvent.click(r.getByText('The STEP question'));
    fireEvent.input(r.getByLabelText('Mark'), { target: { value: '14' } });
    fireEvent.change(r.getByLabelText('Mark'));
    expect(readCambridge().awarded['cam:stepSelfMark:found-01:main']).toBe(T0);
  });
});
