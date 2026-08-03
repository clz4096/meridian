/**
 * Hub component test. Replaces the hub coverage that lived in the deleted
 * hubView + app tests. Asserts the four area cards render from hubStats() and
 * that tapping a card opens the matching section.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { Hub } from '@/ui/Hub';
import * as actions from '@/ui/actions';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Hub', () => {
  it('renders one card per tracked area', () => {
    const { getByText, container } = render(<Hub />);
    ['Knowledge', 'Workout', 'Meals', 'Data'].forEach((l) => expect(getByText(l)).toBeTruthy());
    expect(container.querySelectorAll('.hubrow')).toHaveLength(4);
  });

  it('opens a section when its card is tapped', () => {
    const openSpy = vi.spyOn(actions, 'openSection').mockImplementation(() => {});
    const { getByText } = render(<Hub />);
    fireEvent.click(getByText('Workout').closest('.hubrow')!);
    expect(openSpy).toHaveBeenCalledWith('workout');
  });
});
