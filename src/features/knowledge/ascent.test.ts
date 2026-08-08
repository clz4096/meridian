/**
 * Ascent pure logic — mastery bands + the summit-ledger reducer. These are the
 * bits the session leans on for promotion receipts and the summit readout, kept
 * store-free so they stay deterministic.
 */
import { describe, it, expect } from 'vitest';
import { bandOf, ascentLedger, GRADE_MASTERY, type AscentHistory } from './ascent';

describe('ascent · bandOf', () => {
  it('collapses the two learning masteries (2,3) into one band, else strictly rising', () => {
    expect(bandOf(0)).toBe(0); // new
    expect(bandOf(1)).toBe(1); // shaky
    expect(bandOf(2)).toBe(2); // learning
    expect(bandOf(3)).toBe(2); // learning (same band)
    expect(bandOf(4)).toBe(3); // solid
    expect(bandOf(5)).toBe(4); // mastered
  });

  it('maps each grade→mastery to the expected band crossing from `new`', () => {
    // From new (band 0): Again→1 (band1), Hard→3 (band2), Good→4 (band3), Easy→5 (band4)
    expect(bandOf(GRADE_MASTERY[1])).toBe(1);
    expect(bandOf(GRADE_MASTERY[2])).toBe(2);
    expect(bandOf(GRADE_MASTERY[3])).toBe(3);
    expect(bandOf(GRADE_MASTERY[4])).toBe(4);
  });
});

describe('ascent · ascentLedger', () => {
  it('counts solid (≥4), shaky (≤1), and newly-learned (band crossed upward)', () => {
    const history: AscentHistory[] = [
      { id: 'a', startBand: 0, grade: 3 }, // new → solid(4): promo + solid
      { id: 'b', startBand: 2, grade: 4 }, // learning → mastered(5): promo + solid
      { id: 'c', startBand: 3, grade: 3 }, // solid → solid(4): NOT a promo, but solid
      { id: 'd', startBand: 1, grade: 1 }, // shaky → shaky(1): shaky, no promo
    ];
    expect(ascentLedger(history)).toEqual({ solid: 3, shaky: 1, newlyLearned: 2 });
  });

  it('a Hard within the learning band is not a promotion', () => {
    // startBand 2 (learning), Hard→mastery3→band2: no crossing.
    expect(ascentLedger([{ id: 'x', startBand: 2, grade: 2 }])).toEqual({ solid: 0, shaky: 0, newlyLearned: 0 });
  });

  it('an empty run yields a zeroed ledger', () => {
    expect(ascentLedger([])).toEqual({ solid: 0, shaky: 0, newlyLearned: 0 });
  });
});
