/**
 * Scratchpad read-model. Idea cards live nested in the core store; these pure
 * helpers filter/sort them and drive the status lifecycle. No DOM, no signals.
 */
import type { CoreState, ScratchCard, ScratchStatus } from '@/core/types';

/** Lifecycle order — also the cycle order for the status chip. */
export const SCRATCH_STATUSES: readonly ScratchStatus[] = ['idea', 'trying', 'shipped', 'parked'];

export const STATUS_LABEL: Record<ScratchStatus, string> = {
  idea: 'Idea',
  trying: 'Trying',
  shipped: 'Shipped',
  parked: 'Parked',
};

type CoreScratch = Pick<CoreState, 'scratch'>;

/** Next status in the cycle (idea → trying → shipped → parked → idea). */
export function nextStatus(s: ScratchStatus): ScratchStatus {
  const i = SCRATCH_STATUSES.indexOf(s);
  return SCRATCH_STATUSES[(i + 1) % SCRATCH_STATUSES.length]!;
}

/** Filter by status (or 'all'), newest-updated first. */
export function organizeScratch(core: CoreScratch, filter: ScratchStatus | 'all'): ScratchCard[] {
  const all = core.scratch ?? [];
  const shown = filter === 'all' ? all : all.filter((c) => c.status === filter);
  return [...shown].sort((a, b) => b.updated - a.updated);
}

/** Total idea-card count. */
export function cardCount(core: CoreScratch): number {
  return (core.scratch ?? []).length;
}
