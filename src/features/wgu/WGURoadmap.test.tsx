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
    vi.setSystemTime(new Date(2026, 8, 29, 12));
    roadmapChecks.value = { C955: true, D386: true };
    const { getByRole, getByText } = render(<WGURoadmapView />);
    expect(getByText('D324 · Business of IT: Project Management')).toBeTruthy();
    expect(getByText('CompTIA Project+ (Infosec, free)')).toBeTruthy();
    expect(getByText('2 of 13 courses · 25 days to Oct 24')).toBeTruthy();
    const bar = getByRole('progressbar', { name: 'WGU progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
  });

  it('shows the empty state when every course is done', () => {
    roadmapChecks.value = Object.fromEntries(
      ['C955', 'D386', 'D324', 'C963', 'D315', 'D282', 'D336', 'D326', 'D284', 'D480', 'D279', 'D479', 'D424'].map((c) => [c, true]),
    );
    const { getByText } = render(<WGURoadmapView />);
    expect(getByText('Term complete')).toBeTruthy();
  });
});

describe('WGURoadmapView checkboxes', () => {
  it('names every checkbox by course code and name', () => {
    const { getAllByRole } = render(<WGURoadmapView />);
    const boxes = getAllByRole('checkbox') as HTMLInputElement[];
    // 13 in the week cards plus 13 in the Progress list.
    expect(boxes).toHaveLength(26);
    for (const b of boxes) {
      const label = b.labels?.[0]?.textContent?.trim() ?? '';
      expect(label).toMatch(/^[A-Z]\d{3} \S/);
      expect(b.id).not.toBe('');
    }
    expect(new Set(boxes.map((b) => b.id)).size).toBe(26);
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
    expect(getByRole('heading', { level: 1 }).textContent).toBe('13 courses in a 37-day plan');
  });
});
