import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { curriculumChecks } from '@/features/studytracker/curriculum';
import { MATH_COURSES } from '@/content/math';
import { todaysMathItem } from './math';
import { MathPathSkeleton, MathPathView } from './MathPath';

const NOW = new Date(2026, 8, 29, 12); // 2026-09-29 local

afterEach(() => {
  cleanup();
  curriculumChecks.value = {};
  localStorage.clear();
});

describe('MathPathView', () => {
  it('shows the current course and pinned progress', () => {
    curriculumChecks.value = { 'Stanford Stats': true };
    const { getByRole, getByText } = render(<MathPathView now={NOW} />);
    getByRole('heading', { level: 1, name: 'Yale CS202 · Notes on Discrete Mathematics' });
    const bar = getByRole('progressbar', { name: 'Math courses done' });
    expect(bar.getAttribute('aria-valuetext')).toBe('1 of 9 courses');
    getByText('1 of 9 courses · 8 courses to go');
  });

  it('locks the answer until an attempt is typed, then reveals it', () => {
    const item = todaysMathItem(NOW)!;
    const { getByRole, getByLabelText, getByText, queryByText } = render(<MathPathView now={NOW} />);
    getByText(item.title, { selector: 'h3' });
    const check = getByRole('button', { name: 'Check answer' }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    getByText('Write an attempt first.');

    // Whitespace alone is not an attempt.
    fireEvent.input(getByLabelText('Your attempt'), { target: { value: '   ' } });
    expect(check.disabled).toBe(true);

    fireEvent.input(getByLabelText('Your attempt'), { target: { value: 'my attempt' } });
    expect(check.disabled).toBe(false);
    const firstLine = item.answer.split('\n')[0]!;
    expect(queryByText(firstLine, { exact: false })).toBeNull();
    fireEvent.click(check);
    getByText(firstLine, { exact: false });
  });

  it('reveals the hint without an attempt', () => {
    const item = todaysMathItem(NOW)!;
    expect(item.hint).toBeTruthy();
    const { getByRole, getByText } = render(<MathPathView now={NOW} />);
    const hint = getByRole('button', { name: 'Show hint' }) as HTMLButtonElement;
    expect(hint.disabled).toBe(false);
    fireEvent.click(hint);
    getByText(item.hint!);
  });

  it('lists the plan in order with a featured badge and toggles done', () => {
    const { container, getByLabelText, getByText, getByRole } = render(<MathPathView now={NOW} />);
    const codes = [...container.querySelectorAll('.mp-course-code')].map((e) => e.textContent);
    expect(codes).toEqual(MATH_COURSES.map((c) => c.code));
    getByText('Featured');
    const box = getByLabelText(/Stanford Stats/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(curriculumChecks.value['Stanford Stats']).toBe(true);
    expect(getByRole('progressbar').getAttribute('aria-valuetext')).toBe('1 of 9 courses');
  });

  it('shows the plan-complete state when every course is done', () => {
    curriculumChecks.value = Object.fromEntries(MATH_COURSES.map((c) => [c.code, true]));
    const { getByRole } = render(<MathPathView now={NOW} />);
    getByRole('heading', { level: 1, name: 'Plan complete' });
  });

  it('renders a loading skeleton', () => {
    const { container } = render(<MathPathSkeleton />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
