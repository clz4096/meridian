/**
 * SaveChip test. The floating "Unsaved" chip must trigger a save when tapped
 * (it previously rendered with no onClick and did nothing). Only renders while
 * the store is dirty/failed, so we drive it via the saveState signal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { SaveChip } from '@/ui/components/Chrome';
import { appState } from '@/app/bootstrap';
import { saveState } from '@/ui/store';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  saveState.value = { dirty: false, failed: false };
});

describe('SaveChip', () => {
  it('renders nothing when the store is clean', () => {
    saveState.value = { dirty: false, failed: false };
    const { container } = render(<SaveChip />);
    expect(container.querySelector('#savechip')).toBeNull();
  });

  it('saves when the unsaved chip is tapped', () => {
    const save = vi.spyOn(appState, 'save').mockImplementation(() => Promise.resolve({ cloud: 'skipped' } as never));
    saveState.value = { dirty: true, failed: false };
    const { container, getByText } = render(<SaveChip />);
    expect(getByText('Unsaved')).toBeTruthy();
    fireEvent.click(container.querySelector('#savechip')!);
    expect(save).toHaveBeenCalledOnce();
  });

  it('retries the save from the failed state', () => {
    const save = vi.spyOn(appState, 'save').mockImplementation(() => Promise.resolve({ cloud: 'skipped' } as never));
    saveState.value = { dirty: false, failed: true };
    const { container, getByText } = render(<SaveChip />);
    expect(getByText('Save failed')).toBeTruthy();
    fireEvent.click(container.querySelector('#savechip')!);
    expect(save).toHaveBeenCalledOnce();
  });
});
