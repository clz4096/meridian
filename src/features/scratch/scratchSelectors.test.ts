import { describe, it, expect } from 'vitest';
import { organizeScratch, nextStatus, cardCount } from '@/features/scratch/scratchSelectors';

const core = (scratch: unknown[]): never => ({ scratch }) as never;

const FIXTURE = core([
  { id: 'a', title: 'A', body: '', status: 'idea', created: 1, updated: 10 },
  { id: 'b', title: 'B', body: '', status: 'shipped', created: 2, updated: 30 },
  { id: 'c', title: 'C', body: '', status: 'idea', created: 3, updated: 20 },
]);

describe('organizeScratch', () => {
  it('all cards, newest-updated first', () => {
    expect(organizeScratch(FIXTURE, 'all').map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('filters by status, still newest-updated first', () => {
    expect(organizeScratch(FIXTURE, 'idea').map((c) => c.id)).toEqual(['c', 'a']);
  });

  it('tolerates a missing scratch field', () => {
    expect(organizeScratch({} as never, 'all')).toEqual([]);
    expect(cardCount({} as never)).toBe(0);
  });
});

describe('nextStatus', () => {
  it('cycles idea → trying → shipped → parked → idea', () => {
    expect(nextStatus('idea')).toBe('trying');
    expect(nextStatus('trying')).toBe('shipped');
    expect(nextStatus('shipped')).toBe('parked');
    expect(nextStatus('parked')).toBe('idea');
  });
});
