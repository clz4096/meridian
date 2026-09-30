/**
 * Tracker tab wiring (TR-12): the Today / Playbook switch must be a real tab set
 * for screen readers and keyboards, not two buttons that happen to look like one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { StudyTrackerView } from '@/features/studytracker/StudyTracker';
import { setTab } from '@/features/studytracker/uiState';

afterEach(() => {
  cleanup();
  setTab('today');
});

const tabs = (c: Element) => [...c.querySelectorAll<HTMLElement>('[role="tab"]')];

describe('StudyTracker tabs', () => {
  it('links each tab to the one rendered tabpanel', () => {
    setTab('today');
    const { container } = render(<StudyTrackerView />);
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const [today, playbook] = tabs(container);
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(panel).not.toBeNull();
    expect(container.querySelectorAll('[role="tabpanel"]').length).toBe(1);
    for (const t of [today!, playbook!]) expect(t.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(today!.id);
    expect(today!.getAttribute('aria-selected')).toBe('true');
    expect(playbook!.getAttribute('aria-selected')).toBe('false');
    // Roving tabindex: only the selected tab is in the Tab order.
    expect(today!.tabIndex).toBe(0);
    expect(playbook!.tabIndex).toBe(-1);
  });

  it('moves selection and focus with the arrow keys, Home and End', () => {
    setTab('today');
    const { container } = render(<StudyTrackerView />);
    const [today] = tabs(container);
    today!.focus();
    fireEvent.keyDown(today!, { key: 'ArrowRight' });
    let [t0, t1] = tabs(container);
    expect(t1!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(t1);
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(t1!.id);

    fireEvent.keyDown(t1!, { key: 'ArrowRight' }); // wraps
    [t0, t1] = tabs(container);
    expect(t0!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(t0);

    fireEvent.keyDown(t0!, { key: 'End' });
    expect(tabs(container)[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs(container)[1]!, { key: 'Home' });
    expect(tabs(container)[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs(container)[0]!, { key: 'ArrowLeft' }); // wraps backwards
    expect(tabs(container)[1]!.getAttribute('aria-selected')).toBe('true');
  });
});
