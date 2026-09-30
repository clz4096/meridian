/**
 * Cambridge Method: the shape of the sixth synced store (`meridian-cambridge`).
 * Frozen by docs/cambridge-contract.md section 1. Every editable record carries
 * `updatedAt` (ms) so the merge can pick the newer copy per record; see
 * `mergeCambridge` in src/core/sync/mergeStores.ts.
 */

export type QStatus = 'solved' | 'partial' | 'stuck';
export type ItemStage = 'not-started' | 'attempting' | 'written-up' | 'supervised' | 'redo-done';

export interface CamQuestion {
  q: string;
  status?: QStatus;
  stalledAt?: string;
  /** Banked cold-attempt seconds, not counting a timer that is running now. */
  coldSec: number;
  /** When the running timer started (ms). Persisted so the timer survives a reload. */
  runningSince?: number;
  /** Self-mark or supervisor mark, 0..20. */
  mark?: number;
}

export interface CamItem {
  /** A step.json or courses.json id. */
  id: string;
  stage: ItemStage;
  questions: Record<string, CamQuestion>;
  /** Markdown with $LaTeX$. */
  writeup?: string;
  /** Local photo ids (IndexedDB `meridian_photos`); the photos themselves never sync. */
  photos?: string[];
  hintsUnlockedEarly?: boolean;
  supervisedAt?: number;
  weakPoints?: string[];
  redoQs?: string[];
  redoDue?: number;
  redoneAt?: number;
  updatedAt: number;
  deleted?: boolean;
}

export type ErrorCause = 'concept' | 'algebra slip' | "didn't see the idea" | 'ran out of time';

export interface CamError {
  id: string;
  itemId: string;
  q: string;
  /** '' until the owner picks one: an entry created automatically from a low mark or "stuck". */
  cause: ErrorCause | '';
  topic: string;
  fix: string;
  at: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface CamGate {
  phase: string;
  passedAt: number;
  evidence: Record<string, string>;
  updatedAt: number;
}

/** The five weekly scorecard lines (contract section 3), in display order. */
export type CamWeekItem = 'cold' | 'writeup' | 'supervisions' | 'redo' | 'pace';
export const CAM_WEEK_ITEMS: readonly CamWeekItem[] = ['cold', 'writeup', 'supervisions', 'redo', 'pace'];

export interface CamWeek {
  /** ISO week in America/New_York, e.g. 2026-W40. */
  week: string;
  scores: Record<CamWeekItem, 0 | 1 | 2>;
  updatedAt: number;
}

export interface CambridgeState {
  v: 1;
  items: Record<string, CamItem>;
  errors: Record<string, CamError>;
  gates: Record<string, CamGate>;
  weeks: Record<string, CamWeek>;
  /** One-time XP guards: event id -> ms it was first paid. */
  awarded: Record<string, number>;
  migratedAt?: number;
}

/** A fresh, empty store. A factory, so callers can never share one mutable object. */
export function emptyCambridge(): CambridgeState {
  return { v: 1, items: {}, errors: {}, gates: {}, weeks: {}, awarded: {} };
}
