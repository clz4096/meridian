/**
 * Cambridge XP awards (contract section 3). Each award credits the tracker's
 * day through `creditEvent` with an id namespaced `cam:<kind>:<itemId>[:<q>]`,
 * and records the id in `cambridge.awarded`.
 *
 * Why both: `creditEvent` is idempotent only within a day, because `day.events`
 * is replaced at rollover. `awarded` persists (and merges as a grow-only union),
 * so the same item or question never pays again on a later day.
 *
 * Each award checks the record it pays for, so a caller cannot pay for work
 * the store does not show. Returns true when XP was paid now.
 *
 * Known limit: two devices that award the same id before either has synced
 * both pay once each; the guard converges on the next sync.
 */
import { creditEvent, EVENT_WEIGHTS } from '@/features/studytracker/trackerStore';
import { commitCambridge, readCambridge } from '@/features/cambridge/store';
import { elapsedSec, redoDue, REDO_WINDOW_MS } from '@/features/cambridge/schedule';
import type { CamItem } from '@/features/cambridge/types';

export type CamXpKind = 'coldAttempt' | 'writeup' | 'supervision' | 'redo' | 'stepSelfMark' | 'gatePassed';

/** A cold attempt pays once the question's timer reaches this. */
export const COLD_MIN_SEC = 60 * 60;
/** A STEP question self-marked at or above this pays. */
export const STEP_PASS_MARK = 14;

export const camEventId = (kind: CamXpKind, subject: string, q?: string): string =>
  `cam:${kind}:${subject}` + (q === undefined ? '' : `:${q}`);

/** Pay `kind` once, ever. */
function award(kind: CamXpKind, subject: string, q: string | undefined, now: number): boolean {
  const id = camEventId(kind, subject, q);
  const s = readCambridge();
  if (s.awarded[id] !== undefined) return false;
  // The guard is written first: if anything between the two writes failed, the
  // owner would miss one payout rather than be paid twice.
  commitCambridge({ ...s, awarded: { ...s.awarded, [id]: now } });
  creditEvent(id, EVENT_WEIGHTS[kind]);
  return true;
}

const liveItem = (itemId: string): CamItem | undefined => {
  const it = readCambridge().items[itemId];
  return it && !it.deleted ? it : undefined;
};

/** A question's cold time has reached 60 minutes (running time counts). */
export function awardColdAttempt(itemId: string, q: string, now: number = Date.now()): boolean {
  const question = liveItem(itemId)?.questions[q];
  if (!question || elapsedSec(question, now) < COLD_MIN_SEC) return false;
  return award('coldAttempt', itemId, q, now);
}

/** A full write-up was submitted. */
export function awardWriteup(itemId: string, now: number = Date.now()): boolean {
  if (!liveItem(itemId)?.writeup?.trim()) return false;
  return award('writeup', itemId, undefined, now);
}

/** The supervision was held. */
export function awardSupervision(itemId: string, now: number = Date.now()): boolean {
  if (liveItem(itemId)?.supervisedAt === undefined) return false;
  return award('supervision', itemId, undefined, now);
}

/**
 * The latest a redo can land and still pay: 48 hours after the supervision, or
 * the Sabbath-shifted deadline when that is later, so keeping the Sabbath never
 * costs the redo its XP.
 */
export function redoDeadline(supervisedAt: number): number {
  return Math.max(supervisedAt + REDO_WINDOW_MS, redoDue(supervisedAt));
}

/** The misses were redone within 48 hours of the supervision. */
export function awardRedo(itemId: string, now: number = Date.now()): boolean {
  const it = liveItem(itemId);
  if (!it || it.supervisedAt === undefined || it.redoneAt === undefined) return false;
  if (it.redoneAt > redoDeadline(it.supervisedAt)) return false;
  return award('redo', itemId, undefined, now);
}

/** A STEP question self-marked at least 14/20. */
export function awardStepSelfMark(itemId: string, q: string, now: number = Date.now()): boolean {
  const mark = liveItem(itemId)?.questions[q]?.mark;
  if (mark === undefined || mark < STEP_PASS_MARK) return false;
  return award('stepSelfMark', itemId, q, now);
}

/** A phase gate was passed. */
export function awardGate(phase: string, now: number = Date.now()): boolean {
  if (!readCambridge().gates[phase]?.passedAt) return false;
  return award('gatePassed', phase, undefined, now);
}
