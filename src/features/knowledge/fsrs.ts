/**
 * FSRS memory model (Free Spaced Repetition Scheduler) — a thin, PURE wrapper
 * around the `ts-fsrs` library. Replaces the old SM-2 scheduler.
 *
 * `ts-fsrs` works in mutable `Card` objects and real `Date`s; this module keeps
 * a small serialisable `FsrsEntry` in the store and injects "now" as an explicit
 * argument, so scheduling stays a pure `(prev, grade, now) -> next` transition —
 * testable and deterministic, the same discipline the SM-2 code followed.
 *
 * Grades are the four native FSRS ratings: 1 Again · 2 Hard · 3 Good · 4 Easy.
 * `enable_short_term: false` keeps intervals at day granularity (no intra-day
 * learning steps), which matches our YYYY-MM-DD storage and a study-not-cram use.
 */
import { fsrs, createEmptyCard, type Card } from 'ts-fsrs';
import { toNum } from '@/core/util';

export type Grade = 1 | 2 | 3 | 4; // Again · Hard · Good · Easy

/** Serialisable card state kept in `KnowledgeState.srs`. */
export interface FsrsEntry {
  due: string; // YYYY-MM-DD, next review; '' = unseen
  stability: number; // S — days until recall prob. hits the retention target
  difficulty: number; // D — 1..10
  reps: number; // successful reviews
  lapses: number; // times forgotten (graded Again)
  state: number; // 0 New · 1 Learning · 2 Review · 3 Relearning
  lastReview: string; // YYYY-MM-DD or ''
}

export const REQUEST_RETENTION = 0.9;
const F = fsrs({ request_retention: REQUEST_RETENTION, enable_fuzz: false, enable_short_term: false });

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round = (n: number): number => Math.round(n * 1e4) / 1e4;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const parse = (s: string): Date => new Date(s + 'T00:00:00Z');
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Read a stored entry into a clean `FsrsEntry`, migrating legacy SM-2 rows
 * (`{ivl, ease, n}`) so no history is lost and no re-learning wall appears:
 * the old interval seeds stability and the old ease maps to difficulty.
 */
export function readFsrs(raw: unknown): FsrsEntry {
  const e = (raw ?? {}) as Record<string, unknown>;
  const due = isDate(e.due) ? (e.due as string) : '';

  // Already an FSRS entry.
  if (typeof e.stability === 'number' && (e.stability as number) > 0) {
    const st = Math.round(Number(e.state));
    return {
      due,
      stability: round(toNum(e.stability as never, 0)),
      difficulty: clamp(toNum(e.difficulty as never, 5), 1, 10),
      reps: Math.max(0, Math.round(toNum(e.reps as never, 0))),
      lapses: Math.max(0, Math.round(toNum(e.lapses as never, 0))),
      state: st >= 0 && st <= 3 ? st : 2,
      lastReview: isDate(e.lastReview) ? (e.lastReview as string) : '',
    };
  }

  // Legacy SM-2 `{ivl, ease, n}` with real history → seed FSRS.
  const ivl = toNum((e.ivl ?? e.interval) as never, 0);
  const n = Math.max(0, Math.round(toNum((e.n ?? e.reps) as never, 0)));
  if (n > 0 && due) {
    const ease = clamp(toNum(e.ease as never, 2.5), 1.3, 3.0);
    return {
      due,
      stability: Math.max(0.5, ivl || 1),
      difficulty: round(clamp(11 - ((ease - 1.3) / 1.7) * 9, 1, 10)), // higher ease → easier → lower D
      reps: n,
      lapses: 0,
      state: 2, // Review
      lastReview: '',
    };
  }

  // Unseen / empty.
  return { due, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, lastReview: '' };
}

function toCard(e: FsrsEntry | undefined, now: Date): Card {
  const base = createEmptyCard(now);
  if (!e || !e.due || !(e.stability > 0)) return base; // new / unseen
  return {
    ...base,
    due: parse(e.due),
    stability: e.stability,
    difficulty: e.difficulty,
    reps: e.reps,
    lapses: e.lapses,
    state: e.state as Card['state'],
    last_review: e.lastReview ? parse(e.lastReview) : undefined,
  };
}

function fromCard(c: Card): FsrsEntry {
  return {
    due: iso(c.due),
    stability: round(c.stability),
    difficulty: round(c.difficulty),
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ? iso(c.last_review) : '',
  };
}

/** Pure transition: schedule the next review for a grade at `now`. */
export function scheduleFsrs(prev: FsrsEntry | undefined, grade: Grade, now: Date): FsrsEntry {
  const rec = F.next(toCard(prev, now), now, grade as never);
  return fromCard(rec.card);
}

/** A fresh card queued to come up on `date` (used by "add to review"). */
export function queuedEntry(date: string): FsrsEntry {
  return { due: date, stability: 0.5, difficulty: 5, reps: 0, lapses: 0, state: 1, lastReview: '' };
}

/** Current recall probability (0..1) for an entry as of `today` — FSRS forgetting curve. */
export function retrievability(raw: unknown, today: string): number {
  const e = readFsrs(raw);
  if (!(e.stability > 0) || !e.lastReview) return e.due && e.due <= today ? 0 : 1;
  const t = Math.max(0, (parse(today).getTime() - parse(e.lastReview).getTime()) / 86_400_000);
  return Math.pow(1 + (19 / 81) * (t / e.stability), -0.5);
}
