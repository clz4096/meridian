/**
 * Ascent — pure logic for the guided "Today's path" study session.
 *
 * Kept free of Preact + the store so the mastery-band math and the summit-ledger
 * reducer stay deterministic and unit-testable in the fast node env. The session
 * component (AscentSession.tsx) and actions.ts import these; the FSRS interval
 * previews live in fsrs.ts.
 */
import type { Mastery } from '@/core/types';
import type { Grade } from '@/features/knowledge/fsrs';

/**
 * A grade (Again/Hard/Good/Easy) → the 1–5 mastery the charts + log read. Single
 * source of truth: actions.ts's `rate()` imports this same map, so the receipt
 * "after" band and the value written to the store can never drift apart.
 */
export const GRADE_MASTERY: Record<Grade, Mastery> = { 1: 1, 2: 3, 3: 4, 4: 5 };

/** Mastery value (0 = unseen, else 1–5) → word. Mirrors KnowledgeTab's MASTERY_TEXT. */
export const MWORD: Record<number, string> = { 0: 'new', 1: 'shaky', 2: 'learning', 3: 'learning', 4: 'solid', 5: 'mastered' };
/**
 * Mastery value → dot colour, as CSS custom properties defined in app.css so the
 * dot follows the active palette instead of pinning the old dark theme hexes.
 */
export const MCOLOR: Record<number, string> = {
  0: 'var(--m-new)',
  1: 'var(--m-shaky)',
  2: 'var(--m-learning)',
  3: 'var(--m-learning)',
  4: 'var(--m-solid)',
  5: 'var(--m-mastered)',
};

/**
 * Mastery value → BAND index. The five visible bands are new · shaky · learning ·
 * solid · mastered; mastery 2 and 3 both read as "learning" (the app only ever
 * writes 1/3/4/5), so they collapse to one band. A promotion receipt fires when
 * a grade lifts the item to a HIGHER band — never on a same-band or downward move.
 */
const BAND: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 5: 4 };
export const bandOf = (m: number): number => BAND[m] ?? 0;

/** One graded card in the run — the minimum the summit ledger needs. */
export interface AscentHistory {
  id: string;
  /** band BEFORE the grade was applied (read from the live store before rate()). */
  startBand: number;
  grade: Grade;
}

export interface Ledger {
  /** items whose final mastery is solid+ (≥4). */
  solid: number;
  /** items still shaky/new (≤1) — an Again this session. */
  shaky: number;
  /** items a grade lifted across a band boundary upward. */
  newlyLearned: number;
}

/** Pure summit reducer over the session's grade history. */
export function ascentLedger(history: readonly AscentHistory[]): Ledger {
  let solid = 0;
  let shaky = 0;
  let newlyLearned = 0;
  for (const h of history) {
    const m = GRADE_MASTERY[h.grade];
    if (m >= 4) solid++;
    if (m <= 1) shaky++;
    if (bandOf(m) > h.startBand) newlyLearned++;
  }
  return { solid, shaky, newlyLearned };
}
