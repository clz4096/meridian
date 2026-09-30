/**
 * CS path screen: the plan renders every CS course in plan order, the checkboxes
 * drive curriculumChecks, the header numbers follow, and the algorithm card mounts
 * inside the tracker's .pt-root scope.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { CSPathView } from '@/features/paths/CSPath';
import { CS_COURSES } from '@/content/cs';
import { curriculumChecks } from '@/features/studytracker/curriculum';
import { algoOfDay } from '@/features/studytracker/algorithms';

const saved = curriculumChecks.value;
afterEach(() => {
  cleanup();
  curriculumChecks.value = saved;
  localStorage.clear();
});

describe('CSPathView', () => {
  it('renders every CS course in plan order with its links', () => {
    curriculumChecks.value = {};
    const { container } = render(<CSPathView />);
    const codes = [...container.querySelectorAll('.cs-plan .cs-code')].map((n) => n.textContent);
    expect(codes).toEqual(CS_COURSES.map((c) => c.code));
    const hrefs = [...container.querySelectorAll('.cs-plan a')].map((a) => a.getAttribute('href'));
    for (const c of CS_COURSES) {
      expect(hrefs).toContain(c.url);
      for (const p of c.psets) expect(hrefs).toContain(p.url);
    }
    expect(container.querySelector('.cs-plan [aria-current="step"] .cs-code')?.textContent).toBe('COS 226');
  });

  it('toggling a course updates curriculumChecks and the header', () => {
    curriculumChecks.value = { 'COS 226': true };
    const { container, getByLabelText, getByText } = render(<CSPathView />);
    expect(getByText('1 of 5 courses')).toBeTruthy();
    const box = getByLabelText(/MIT 6\.006/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(curriculumChecks.value['MIT 6.006']).toBe(true);
    expect(JSON.parse(localStorage.getItem('meridian.curriculum.v1') ?? '{}')['MIT 6.006']).toBe(true);
    expect(getByText('2 of 5 courses')).toBeTruthy();
    expect(container.querySelector('.cs-course')?.textContent).toBe('MIT 6.046J · Design and Analysis of Algorithms');
    fireEvent.click(box);
    expect(curriculumChecks.value['MIT 6.006']).toBe(false);
  });

  it("mounts today's algorithm card inside the tracker scope", () => {
    const { container } = render(<CSPathView />);
    const card = container.querySelector('.pt-root .algo-card');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.algo-name')?.textContent).toBe(algoOfDay().name);
  });

  it('all done shows the finished line, not a course', () => {
    curriculumChecks.value = Object.fromEntries(CS_COURSES.map((c) => [c.code, true]));
    const { getByText, container } = render(<CSPathView />);
    expect(getByText('Every course in the plan is done.')).toBeTruthy();
    expect(getByText('5 of 5 courses')).toBeTruthy();
    expect(container.querySelector('.cs-plan [aria-current]')).toBeNull();
  });
});
