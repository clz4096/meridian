/**
 * ScratchView component test — render + capture/cycle/remove/filter wiring +
 * reactive update. Cards live nested in core, seeded via appState.set('core', …).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { ScratchView } from '@/features/scratch/ScratchTab';
import { scratchActions } from '@/ui/actions';
import { appState } from '@/app/bootstrap';
import { scratchFilter, scratchOpen } from '@/ui/store';

const emptyCore = () => ({ schedule: {}, entries: [], todos: [], scratch: [] as unknown[], _del: {} });
const seed = (scratch: unknown[]) => appState.set('core', { ...emptyCore(), scratch } as never);
const card = (id: string, status = 'idea', updated = 1) => ({ id, title: id.toUpperCase(), body: '', status, created: 1, updated });

beforeEach(() => appState.set('core', emptyCore() as never));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  scratchFilter.value = 'all';
  scratchOpen.value = null;
  appState.set('core', emptyCore() as never);
});

describe('ScratchView', () => {
  it('shows the empty state when there are no cards', () => {
    const { getByText } = render(<ScratchView />);
    expect(getByText(/No ideas yet/)).toBeTruthy();
  });

  it('wires Capture to scratchActions.add with title + body', () => {
    const spy = vi.spyOn(scratchActions, 'add').mockImplementation(() => {});
    const { container, getByText } = render(<ScratchView />);
    (container.querySelector('#scratch-title') as HTMLInputElement).value = 'CUDA SGEMM';
    (container.querySelector('#scratch-body') as HTMLTextAreaElement).value = 'roofline twist';
    fireEvent.click(getByText('Capture'));
    expect(spy).toHaveBeenCalledWith('CUDA SGEMM', 'roofline twist');
  });

  it('reactively renders a captured card', async () => {
    const { queryByText } = render(<ScratchView />);
    expect(queryByText('minikv')).toBeNull();
    await act(async () => {
      scratchActions.add('minikv', 'replicated KV in Go');
    });
    expect(queryByText('minikv')).toBeTruthy();
  });

  it('wires the status chip to cycleStatus and the × to remove', () => {
    const cycle = vi.spyOn(scratchActions, 'cycleStatus').mockImplementation(() => {});
    const remove = vi.spyOn(scratchActions, 'remove').mockImplementation(() => {});
    seed([card('a')]);
    const { container, getByTitle } = render(<ScratchView />);
    fireEvent.click(container.querySelector('.sstatus')!);
    fireEvent.click(getByTitle('Remove'));
    expect(cycle).toHaveBeenCalledWith('a');
    expect(remove).toHaveBeenCalledWith('a');
  });

  it('filters cards by status chip', () => {
    seed([card('a', 'idea'), card('b', 'shipped')]);
    const { container, queryByText } = render(<ScratchView />);
    expect(queryByText('A')).toBeTruthy();
    expect(queryByText('B')).toBeTruthy();
    // 'Shipped' also appears on the shipped card's status button, so scope to the filter row.
    const filters = container.querySelector('.scratch-filters')!;
    const shippedChip = [...filters.querySelectorAll('button')].find((b) => b.textContent === 'Shipped')!;
    fireEvent.click(shippedChip);
    expect(scratchFilter.value).toBe('shipped');
    expect(queryByText('A')).toBeNull();
    expect(queryByText('B')).toBeTruthy();
  });
});
