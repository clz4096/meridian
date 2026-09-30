import { describe, expect, it } from 'vitest';
import { normaliseCambridge } from '@/features/data/dataSelectors';

describe('normaliseCambridge: error cause', () => {
  const entry = (cause: unknown) => ({
    v: 1, items: {}, gates: {}, weeks: {}, awarded: {},
    errors: { e1: { id: 'e1', itemId: 'found-07', q: 'main', cause, topic: 'Graphs', fix: '', at: 1, updatedAt: 1 } },
  });
  it("keeps '' (needs a cause) through a reload instead of turning it into 'concept'", () => {
    expect(normaliseCambridge(entry('')).errors.e1!.cause).toBe('');
  });
  it('keeps a known cause and falls back to concept for an unknown one', () => {
    expect(normaliseCambridge(entry('algebra slip')).errors.e1!.cause).toBe('algebra slip');
    expect(normaliseCambridge(entry('typo')).errors.e1!.cause).toBe('concept');
  });
});
