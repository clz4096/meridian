/**
 * The tracker's Deep Block text for each loop step (cambridge/trackerLink.ts).
 */
import { describe, expect, it } from 'vitest';
import { blockTexts, trackerCambridge } from '@/features/cambridge/trackerLink';
import { fmtDue, type CurrentItem } from '@/features/cambridge/schedule';
import { emptyCambridge } from '@/features/cambridge/types';

const cur = (over: Partial<CurrentItem>): CurrentItem => ({
  itemId: 'x', title: 'Assignment 7', phase: 'A', step: 'attempt', label: '', ...over,
});

describe('blockTexts', () => {
  it('names the item and its loop step in Deep Block 1, and carries it on by hand in Deep Block 3', () => {
    const t = blockTexts(cur({}))!;
    expect(t.b4.title).toBe('Deep Block 1: Assignment 7, attempt cold');
    expect(t.b4.sub).toContain('60 minutes');
    expect(t.b7).toEqual({ title: 'Deep Block 3: Assignment 7, paper and pen', sub: 'Keep going cold on paper; note where you stalled' });
  });

  it('covers every step', () => {
    expect(blockTexts(cur({ step: 'writeup' }))!.b4.title).toBe('Deep Block 1: Assignment 7, write up');
    expect(blockTexts(cur({ step: 'supervision' }))!.b4.title).toBe('Deep Block 1: Assignment 7, supervision');
    expect(blockTexts(cur({ step: 'read' }))!.b4.title).toBe('Deep Block 1: Assignment 7, read the notes');
    const due = Date.parse('2026-10-01T22:00:00Z');
    expect(blockTexts(cur({ step: 'redo', due }))!.b4.title).toBe(`Deep Block 1: Assignment 7, redo by ${fmtDue(due)}`);
    expect(blockTexts(cur({ step: 'redo' }))!.b4.title).toBe('Deep Block 1: Assignment 7, redo');
  });

  it('is null when every phase is done, so the static text shows', () => {
    expect(blockTexts(null)).toBeNull();
  });

  it('never uses an em or en dash', () => {
    for (const step of ['read', 'attempt', 'writeup', 'supervision', 'redo'] as const) {
      const t = blockTexts(cur({ step }))!;
      expect(JSON.stringify(t)).not.toMatch(/[–—]/);
    }
  });
});

describe('trackerCambridge', () => {
  it('an empty store points at the first item and reads the Math card summary', () => {
    const now = Date.parse('2026-09-29T14:00:00Z');
    const t = trackerCambridge(emptyCambridge(), now);
    expect(t.summary.course).toBe('Phase 0 · Gap check');
    expect(t.summary.progress.caption).toBe('Supervisions this week: 0 of 2');
    expect(t.blocks!.b4.title).toBe('Deep Block 1: Assignment 1, attempt cold');
  });
});
