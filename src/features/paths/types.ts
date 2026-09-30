/**
 * The study-path model shared by Today's path cards and the three path screens
 * (WGU, Math, Computer Science). Frozen for Stage 4: docs/redesign-contract.md.
 * Each path's `summarize(now, state)` is pure, so its numbers are testable at fixed dates.
 */
export type PathId = 'wgu' | 'math' | 'cs';

export interface PathSummary {
  id: PathId;
  /** 'WGU', 'Math', 'Computer Science'. */
  title: string;
  /** Current course, e.g. 'C955 · Applied Probability & Statistics'. Empty when the plan is finished. */
  course: string;
  /** The ONE next action. */
  next: { label: string; detail?: string; minutes?: number };
  /** Progress toward the path's goal. `caption` adds context, e.g. 'term ends Oct 24'. */
  progress: { done: number; total: number; caption: string };
}

/** Whole-number percent for a progress bar, clamped to 0..100; 0 when total is 0. */
export function pct(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}
