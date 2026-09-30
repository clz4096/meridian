/**
 * CS path screen: the header follows the CST track, the algorithm card and the
 * paper of the week mount inside the tracker's .pt-root scope, and the retired
 * COS/MIT course plan is gone (its checkbox key stays untouched).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { CSPathView } from '@/features/paths/CSPath';
import { algoOfDay } from '@/features/studytracker/algorithms';
import retired from '@data/archive/princeton-curriculum.json';

const never = new Promise<void>(() => {});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('CSPathView', () => {
  it('heads the screen with the CST track, not the retired course plan', () => {
    const { container, getByText } = render(<CSPathView camReady={never} />);
    expect(getByText('0 of 14 items')).toBeTruthy();
    expect(container.querySelector('.cs-course')?.textContent).toBe('CS-0 Proof · TMUA Notes on Logic and Proof');
    expect(container.querySelector('.cs-plan')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    // The algorithm card cites its lecture video by course ("MIT 6.006"): a source, not the retired plan.
    const copy = container.cloneNode(true) as Element;
    copy.querySelectorAll('.algo-card').forEach((n) => n.remove());
    for (const c of retired.courses) expect(copy.textContent).not.toContain(c.code);
  });

  it('leaves the old course checkboxes in storage untouched', () => {
    const old = JSON.stringify({ 'COS 226': true });
    localStorage.setItem('meridian.curriculum.v1', old);
    render(<CSPathView camReady={never} />);
    expect(localStorage.getItem('meridian.curriculum.v1')).toBe(old);
  });

  it("mounts today's algorithm and the paper of the week inside the tracker scope", () => {
    const { container } = render(<CSPathView camReady={never} />);
    const card = container.querySelector('.pt-root .algo-card');
    expect(card).toBeTruthy();
    expect(card?.querySelector('.algo-name')?.textContent).toBe(algoOfDay().name);
    expect(container.querySelector('.pt-root')?.textContent).toContain('Paper of the week');
  });
});
