import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { TeachScreen } from '@/features/today/TeachScreen';
import { sectionOpen, toggleSection } from '@/features/studytracker/uiState';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sectionOpen.value = {};
});

describe('TeachScreen', () => {
  it('opens with the teach section expanded', () => {
    const { container } = render(<TeachScreen />);
    expect(container.querySelector('.collap-head')!.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.collap-body')).toBeTruthy();
  });

  it("stays expanded when the tracker's teach section was collapsed", () => {
    toggleSection('teach', true); // the tracker copy, collapsed
    const { container } = render(<TeachScreen />);
    expect(container.querySelector('.collap-head')!.getAttribute('aria-expanded')).toBe('true');
  });
});
