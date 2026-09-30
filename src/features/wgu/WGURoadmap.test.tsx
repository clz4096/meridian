import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WGURoadmapView } from './WGURoadmap';
import { roadmapChecks } from './roadmapStore';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  roadmapChecks.value = {};
});

describe('WGURoadmapView Today header', () => {
  it('shows the current course, next action, and progress', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 12));
    // D386 is a tick from the old 13-course plan: kept in storage, not counted.
    roadmapChecks.value = { C955: true, D386: true };
    const { getByRole, getByText } = render(<WGURoadmapView />);
    expect(getByText('D326 · Advanced Data Management')).toBeTruthy();
    expect(getByText('Intermediate PostgreSQL for stored procedures')).toBeTruthy();
    expect(getByText('1 of 4 courses · 25 days to Oct 25')).toBeTruthy();
    const bar = getByRole('progressbar', { name: 'WGU progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
  });

  it('shows the empty state when every course is done', () => {
    roadmapChecks.value = Object.fromEntries(
      ['C955', 'D326', 'D315', 'D279'].map((c) => [c, true]),
    );
    const { getByText } = render(<WGURoadmapView />);
    expect(getByText('Term complete')).toBeTruthy();
  });
});

describe('WGURoadmapView checkboxes', () => {
  it('names every checkbox by course code and name', () => {
    const { getAllByRole } = render(<WGURoadmapView />);
    const boxes = getAllByRole('checkbox') as HTMLInputElement[];
    // 4 in the week cards plus 4 in the Progress list.
    expect(boxes).toHaveLength(8);
    for (const b of boxes) {
      const label = b.labels?.[0]?.textContent?.trim() ?? '';
      expect(label).toMatch(/^[A-Z]\d{3} \S/);
      expect(b.id).not.toBe('');
    }
    expect(new Set(boxes.map((b) => b.id)).size).toBe(8);
  });

  it('ticking a course in a week card ticks it in the Progress list', () => {
    const { getByLabelText } = render(<WGURoadmapView />);
    const week = getByLabelText('C955 Applied Probability & Statistics') as HTMLInputElement;
    const prog = getByLabelText('C955 Probability & Statistics') as HTMLInputElement;
    expect(prog.checked).toBe(false);
    fireEvent.click(week);
    expect(roadmapChecks.value.C955).toBe(true);
    expect(prog.checked).toBe(true);
  });

  it('describes the plan in the title without a day count that can go stale', () => {
    const { getByRole } = render(<WGURoadmapView />);
    expect(getByRole('heading', { level: 1 }).textContent).toBe('4 courses in a 4-week plan');
  });

  it('shows lead-in and buffer weeks as an admin line with no checkbox', () => {
    const { getByRole } = render(<WGURoadmapView />);
    const wk1 = getByRole('region', { name: 'Week 1' });
    expect(wk1.querySelector('.wgu-courses')).toBeNull();
    expect(wk1.querySelector('.wgu-admin')!.textContent).toContain('C955');
    expect(getByRole('region', { name: 'Week 5' }).querySelector('input')).toBeNull();
  });
});
