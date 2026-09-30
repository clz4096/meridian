/**
 * The study item screen: the persistent cold timer (survives a reload), hints
 * behind the cold hour with an "Unlock early" confirm, question status with
 * auto error-log entries, the write-up with its lazy KaTeX preview, and the
 * supervision log with the redo scheduled by schedule.redoDue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { StudyItemView, loopIndex } from '@/features/cambridge/StudyItem';
import { commitCambridge, readCambridge } from '@/features/cambridge/store';
import { redoDue } from '@/features/cambridge/schedule';
import { emptyCambridge, type CamItem } from '@/features/cambridge/types';

const ready = Promise.resolve();
// Mon 28 Sep 2026, noon in Brooklyn: the 48-hour redo lands on Wednesday, clear of the Sabbath.
const T0 = Date.UTC(2026, 8, 28, 16);
let clock = T0;

beforeEach(() => {
  clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  commitCambridge(emptyCambridge(), { system: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const item = (): CamItem | undefined => readCambridge().items['found-01'];
const renderItem = () => render(<StudyItemView ready={ready} itemId="found-01" />);

describe('StudyItemView', () => {
  it('an unknown id says so and offers the way back', async () => {
    const { findByText, getByText } = render(<StudyItemView ready={ready} itemId="nope" />);
    expect(await findByText("This item isn't in the plan.")).toBeTruthy();
    expect(getByText('Back to the Cambridge path')).toBeTruthy();
  });

  it('shows the loop stepper from method.json with the current step', async () => {
    const { findByText, container } = renderItem();
    await findByText('Assignment 1');
    const steps = [...container.querySelectorAll('.m-stepper .m-step')];
    expect(steps.map((s) => s.querySelector('.m-step-name')?.textContent)).toEqual(['Read', 'Attempt cold', 'Write up', 'Supervision', 'Redo']);
    expect(steps[0]!.getAttribute('aria-current')).toBe('step');
    expect(container.querySelector('.ci-step-line')?.textContent).toMatch(/^Step 1 of 5 · Notes and warm-up/);
  });

  it('the cold timer survives a reload: elapsed time comes from the persisted start', async () => {
    const first = renderItem();
    fireEvent.click(await first.findByText('Start'));
    expect(item()!.questions['warm-up']!.runningSince).toBe(T0);
    expect(item()!.stage).toBe('attempting');
    first.unmount(); // the page closes

    clock = T0 + (42 * 60 + 17) * 1000;
    const second = renderItem();
    await second.findByText('Assignment 1');
    const timer = second.container.querySelector('.m-timer')!;
    expect(timer.querySelector('[role="timer"]')?.textContent).toBe('42:17');
    expect(timer.getAttribute('data-state')).toBe('running');
    expect(second.getByText('Locked for 18 min more')).toBeTruthy();

    fireEvent.click(second.getByText('Pause'));
    expect(item()!.questions['warm-up']).toEqual({ q: 'warm-up', coldSec: 42 * 60 + 17 });
    expect(second.container.querySelector('.ci-root > [aria-live="polite"]')?.textContent).toBe('Timer paused at 42 minutes');
  });

  it('reaching 60 minutes pays the cold attempt once and opens the hints', async () => {
    const r = renderItem();
    fireEvent.click(await r.findByText('Start'));
    clock = T0 + 61 * 60 * 1000;
    fireEvent.click(r.getByText('Pause'));
    expect(readCambridge().awarded['cam:coldAttempt:found-01:warm-up']).toBe(clock);
    expect(r.container.querySelector('.m-timer')?.getAttribute('data-state')).toBe('reached');
    expect(r.getByText(/^Hints file:/)).toBeTruthy();
    expect(r.queryByText('Hints: unlock early')).toBeNull();
  });

  it('starting one question pauses the one that was running', async () => {
    const r = renderItem();
    fireEvent.click(await r.findByText('Start'));
    clock += 5 * 60 * 1000;
    fireEvent.click(r.getByText('Preparation'));
    fireEvent.click(r.getByText('Start'));
    expect(item()!.questions['warm-up']).toEqual({ q: 'warm-up', coldSec: 300 });
    expect(item()!.questions['preparation']!.runningSince).toBe(clock);
    expect(r.container.querySelector('.ci-root > [aria-live="polite"]')?.textContent).toBe('Warm-up paused. Timer started on Preparation.');
  });

  it('hints stay locked until the cold hour, or an explicit early unlock', async () => {
    const r = renderItem();
    await r.findByText('Assignment 1');
    expect(r.queryByText(/^Hints file:/)).toBeNull();
    expect(r.getByText('Locked for 60 min more')).toBeTruthy();

    fireEvent.click(r.getByText('Hints: unlock early'));
    expect(r.getByText(/The 60-minute cold attempt is the point of this step/)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Open hints');
    fireEvent.click(r.getByText('Keep going'));
    expect(r.queryByText(/^Hints file:/)).toBeNull();
    expect(item()?.hintsUnlockedEarly).toBeUndefined();

    fireEvent.click(r.getByText('Hints: unlock early'));
    fireEvent.click(r.getByText('Open hints'));
    expect(item()!.hintsUnlockedEarly).toBe(true);
    expect(r.getByText(/^Hints file:/).closest('a')?.getAttribute('rel')).toContain('noopener');
  });

  it('marking a question stuck asks where, and files an error-log entry once', async () => {
    const r = renderItem();
    await r.findByText('Assignment 1');
    fireEvent.click(r.getByRole('button', { name: 'Stuck' }));
    expect(item()!.questions['warm-up']!.status).toBe('stuck');
    expect(r.getByRole('button', { name: 'Stuck' }).getAttribute('aria-pressed')).toBe('true');
    const errs = Object.values(readCambridge().errors);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ id: 'auto:found-01:warm-up', itemId: 'found-01', q: 'warm-up', topic: 'algebraic manipulation', fix: '' });
    fireEvent.click(r.getByRole('button', { name: 'Stuck' }));
    expect(Object.values(readCambridge().errors)).toHaveLength(1);
    expect(r.getByLabelText('Where you stalled')).toBeTruthy();
  });

  it('the write-up autosaves, previews math with KaTeX, and submits for XP', async () => {
    const r = renderItem();
    await r.findByText('Assignment 1');
    const submit = r.getByText('Submit write-up');
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    fireEvent.input(r.container.querySelector('textarea.m-editor-input')!, { target: { value: 'So $x^2 = 1$ and <b>not html</b>.' } });
    await waitFor(() => expect(item()?.writeup).toBe('So $x^2 = 1$ and <b>not html</b>.'), { timeout: 2000 });

    fireEvent.click(r.getByRole('button', { name: 'Preview' }));
    const preview = await waitFor(() => {
      const el = r.container.querySelector('.m-editor-preview .katex');
      if (!el) throw new Error('KaTeX not rendered yet');
      return el;
    }, { timeout: 5000 });
    expect(preview).toBeTruthy();
    // Owner text is escaped, never parsed as HTML.
    expect(r.container.querySelector('.m-editor-preview b')).toBeNull();
    expect(r.container.querySelector('.m-editor-preview')?.textContent).toContain('<b>not html</b>');

    fireEvent.click(r.getByText('Submit write-up'));
    expect(item()!.stage).toBe('written-up');
    expect(readCambridge().awarded['cam:writeup:found-01']).toBe(clock);
    expect(r.getByText('Write-up submitted.')).toBeTruthy();
  });

  it('Start supervision copies the filled prompt', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const r = renderItem();
    fireEvent.click(await r.findByText('Start supervision'));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('Act as my Cambridge STEP supervisor. Today: Assignment 1.');
    expect(await r.findByText('Prompt copied. Paste it into Claude with your photos.', { selector: 'p' })).toBeTruthy();
  });

  it('when the clipboard fails, the prompt is shown to copy by hand', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
    const r = renderItem();
    fireEvent.click(await r.findByText('Start supervision'));
    const box = (await r.findByLabelText('Copy this prompt into Claude')) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.value).toContain('Assignment 1');
  });

  it('logging the supervision saves marks, weak points and redo, schedules the redo, and files misses', async () => {
    const r = renderItem();
    fireEvent.click(await r.findByText('Log the supervision'));
    fireEvent.input(r.getByLabelText('Warm-up mark'), { target: { value: '25' } });
    fireEvent.click(r.getByText('Save'));
    expect(r.getByLabelText('Warm-up mark').getAttribute('aria-invalid')).toBe('true');
    expect(item()?.supervisedAt).toBeUndefined();

    fireEvent.input(r.getByLabelText('Warm-up mark'), { target: { value: '12' } });
    fireEvent.input(r.getByLabelText('The STEP question mark'), { target: { value: '16' } });
    fireEvent.input(r.getByLabelText('Weak point 1'), { target: { value: 'signs when completing the square' } });
    fireEvent.change(r.getByLabelText('Redo question 1'), { target: { value: 'warm-up' } });
    fireEvent.click(r.getByText('Save'));

    const it = item()!;
    expect(it).toMatchObject({ stage: 'supervised', supervisedAt: T0, weakPoints: ['signs when completing the square'], redoQs: ['warm-up'] });
    expect(it.redoDue).toBe(redoDue(T0));
    expect(it.questions['warm-up']!.mark).toBe(12);
    expect(it.questions['main']!.mark).toBe(16);
    const aw = readCambridge().awarded;
    expect(aw['cam:supervision:found-01']).toBe(T0);
    expect(aw['cam:stepSelfMark:found-01:main']).toBe(T0);
    expect(aw['cam:stepSelfMark:found-01:warm-up']).toBeUndefined();
    expect(Object.keys(readCambridge().errors)).toEqual(['auto:found-01:warm-up']);
    expect(r.container.querySelector('.ci-root > [aria-live="polite"]')?.textContent).toBe('Supervision saved. Redo due Wed 12 PM.');
    expect(r.getByText(/^Redo due Wed 12 PM/)).toBeTruthy();

    clock = T0 + 24 * 3600 * 1000;
    fireEvent.click(r.getByText('Mark redo done'));
    expect(item()).toMatchObject({ stage: 'redo-done', redoneAt: clock });
    expect(readCambridge().awarded['cam:redo:found-01']).toBe(clock);
  });

  it('the marks carry one hint for the group; only a mark that breaks it gets its own line', async () => {
    const r = renderItem();
    fireEvent.click(await r.findByText('Log the supervision'));
    expect(r.getAllByText('Each 0 to 20, or blank if not marked')).toHaveLength(1);
    const warm = r.getByLabelText('Warm-up mark');
    expect(warm.getAttribute('aria-describedby')).toBe('ci-sv-marks-rule');
    expect(r.queryByText('Use 0 to 20, or leave it blank')).toBeNull();
    fireEvent.input(warm, { target: { value: '25' } });
    fireEvent.click(r.getByText('Save'));
    expect(r.getAllByText('Use 0 to 20, or leave it blank')).toHaveLength(1);
    expect(warm.getAttribute('aria-describedby')).toBe('ci-sv-marks-rule ci-sv-warm-up-rule');
    expect(r.getByLabelText('The STEP question mark').getAttribute('aria-describedby')).toBe('ci-sv-marks-rule');
  });

  it('loopIndex follows the item stage', () => {
    const base: CamItem = { id: 'x', stage: 'attempting', questions: {}, updatedAt: 0 };
    expect(loopIndex(undefined, ['a'])).toBe(0);
    expect(loopIndex(base, ['a'])).toBe(1);
    expect(loopIndex({ ...base, questions: { a: { q: 'a', coldSec: 0, status: 'solved' } } }, ['a'])).toBe(2);
    expect(loopIndex({ ...base, stage: 'written-up' }, ['a'])).toBe(3);
    expect(loopIndex({ ...base, stage: 'supervised', redoQs: ['a'] }, ['a'])).toBe(4);
    expect(loopIndex({ ...base, stage: 'supervised' }, ['a'])).toBe(5);
  });
});
