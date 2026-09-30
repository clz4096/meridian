/**
 * Catalog rules with no curriculum data behind them, shared by the builder
 * (catalogBuild.ts, run at build time) and catalog.ts (the screens). They live
 * apart so catalog.ts can use them without pulling the curriculum JSON into
 * the screens' chunks.
 */

const HINT_KINDS = new Set(['hints', 'solutions', 'answers']);

/** Hints, solutions, answer keys and worked-solution videos give the answer away, so they wait for the cold hour. */
export const isHintLink = (l: { kind: string; role?: string }): boolean =>
  HINT_KINDS.has(l.kind) || l.role === 'worked-solution';

/** The STEP supervisor line of supervisor-prompt.md, replaced for Part IA and CST items. */
export const STEP_ROLE = 'STEP supervisor';
