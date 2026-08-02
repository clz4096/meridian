/**
 * Meridian — pure knowledge & spaced-repetition selectors.
 *
 * Ports the SM-2 scheduler out of the Study tab. The original mutated
 * `KG.srs` in place and read the clock inside the function, which made its
 * behaviour untestable and its output dependent on when it ran. Here
 * `schedule` is a pure transition: (previous entry, rating, today) -> new entry.
 */

import type { KnowledgeState, Mastery, SrsEntry } from '@/core/types';
import { shiftDate, toNum } from '@/core/util';

export interface SrsConfig {
  /** rating at or below which the card lapses */
  lapseThreshold: number;
  /** interval after a lapse, days */
  lapseInterval: number;
  /** interval after the first successful review */
  firstInterval: number;
  /** interval after the second successful review */
  secondInterval: number;
  minEase: number;
  maxEase: number;
  startingEase: number;
  /** hard ceiling so an interval cannot run away to decades */
  maxInterval: number;
}

export const DEFAULT_SRS: SrsConfig = {
  lapseThreshold: 1,
  lapseInterval: 1,
  firstInterval: 1,
  secondInterval: 3,
  minEase: 1.3,
  maxEase: 3.0,
  startingEase: 2.5,
  maxInterval: 365,
};

export interface KnowledgeItemRef {
  id: string;
  topic: string;
  mins: number;
  tags?: string[];
}

export interface ReviewCard {
  id: string;
  due: string;
  interval: number;
  ease: number;
  reps: number;
  mastery: Mastery | 0;
  /** days overdue as of `today`; negative means not yet due */
  overdueDays: number;
}

export interface StudyViewModel {
  today: string;
  due: ReviewCard[];
  upcoming: ReviewCard[];
  unseen: string[];
  masteredCount: number;
  learningCount: number;
  shakyCount: number;
  /** items answered today, from the log */
  answeredToday: number;
  streakDays: number;
}

/* ================================================================== */
/* Scheduling                                                          */
/* ================================================================== */

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A safe, finite SRS entry from any input — legacy rows used `interval`. */
export function normaliseEntry(raw: unknown, config: SrsConfig = DEFAULT_SRS): SrsEntry {
  const e = (raw ?? {}) as Record<string, unknown>;
  // The shipped app wrote `interval`; the newer shape uses `ivl`. Accept both.
  const rawIvl = e.ivl !== undefined ? e.ivl : e.interval;
  const interval = clamp(Math.round(toNum(rawIvl as never, 0)), 0, config.maxInterval);
  const reps = Math.max(0, Math.round(toNum((e.n ?? e.reps) as never, 0)));
  const ease = clamp(toNum(e.ease as never, config.startingEase), config.minEase, config.maxEase);
  const due = typeof e.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.due) ? e.due : '';
  return { due, ivl: interval, ease, n: reps };
}

/**
 * SM-2 transition. Pure: no clock, no mutation.
 *
 * A rating at or below `lapseThreshold` resets the card to the floor interval
 * and zeroes the streak. Any pass advances 1 -> 3 -> interval x ease, with
 * ease adjusted by the SM-2 formula and clamped so it can neither collapse
 * below `minEase` nor grow without bound.
 */
export function schedule(
  previous: SrsEntry | undefined,
  rating: Mastery,
  today: string,
  config: SrsConfig = DEFAULT_SRS,
): SrsEntry {
  const prev = normaliseEntry(previous, config);
  const r = clamp(Math.round(toNum(rating as never, 1)), 1, 5);

  if (r <= config.lapseThreshold) {
    return {
      ivl: config.lapseInterval,
      ease: clamp(prev.ease, config.minEase, config.maxEase),
      n: 0,
      due: shiftDate(today, config.lapseInterval),
    };
  }

  let interval: number;
  if (prev.n === 0) interval = config.firstInterval;
  else if (prev.n === 1) interval = config.secondInterval;
  else interval = Math.round(prev.ivl * prev.ease);

  // SM-2 ease adjustment, clamped at both ends.
  const delta = 0.1 - (5 - r) * (0.08 + (5 - r) * 0.02);
  const ease = clamp(prev.ease + delta, config.minEase, config.maxEase);
  interval = clamp(Math.max(1, interval), 1, config.maxInterval);

  return { ivl: interval, ease, n: prev.n + 1, due: shiftDate(today, interval) };
}

/* ================================================================== */
/* Queries                                                             */
/* ================================================================== */

export function isDue(entry: SrsEntry | undefined, today: string): boolean {
  const e = normaliseEntry(entry);
  return e.due !== '' && e.due <= today;
}

export function toCard(
  id: string,
  state: KnowledgeState,
  today: string,
  config: SrsConfig = DEFAULT_SRS,
): ReviewCard {
  const e = normaliseEntry(state.srs?.[id], config);
  return {
    id,
    due: e.due,
    interval: e.ivl,
    ease: e.ease,
    reps: e.n,
    mastery: (state.mastery?.[id] ?? 0) as Mastery | 0,
    overdueDays: e.due === '' ? -Infinity : daysBetween(e.due, today),
  };
}

/** Whole days from `from` to `to`; positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const parse = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Cards due on or before `today`, most overdue first. */
export function dueCards(
  ids: readonly string[],
  state: KnowledgeState,
  today: string,
  config: SrsConfig = DEFAULT_SRS,
): ReviewCard[] {
  return ids
    .filter((id) => isDue(state.srs?.[id], today))
    .map((id) => toCard(id, state, today, config))
    .sort((a, b) => b.overdueDays - a.overdueDays);
}

/** Consecutive days ending at `today` on which at least one item was answered. */
export function studyStreak(state: KnowledgeState, today: string): number {
  const dates = new Set(
    (state.log ?? []).map((entry) => String((entry as { date?: string }).date ?? '')),
  );
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    if (!dates.has(shiftDate(today, -i))) break;
    streak++;
  }
  return streak;
}

export function selectStudyView(
  ids: readonly string[],
  state: KnowledgeState,
  today: string,
  config: SrsConfig = DEFAULT_SRS,
): StudyViewModel {
  const due: ReviewCard[] = [];
  const upcoming: ReviewCard[] = [];
  const unseen: string[] = [];
  let mastered = 0;
  let learning = 0;
  let shaky = 0;

  for (const id of ids) {
    const seen = state.srs?.[id] !== undefined || state.mastery?.[id] !== undefined;
    if (!seen) {
      unseen.push(id);
      continue;
    }
    const card = toCard(id, state, today, config);
    if (card.due !== '' && card.due <= today) due.push(card);
    else if (card.due !== '') upcoming.push(card);

    const m = card.mastery;
    if (m >= 5) mastered++;
    else if (m >= 3) learning++;
    else if (m >= 1) shaky++;
  }

  due.sort((a, b) => b.overdueDays - a.overdueDays);
  upcoming.sort((a, b) => a.due.localeCompare(b.due));

  const answeredToday = (state.log ?? []).filter(
    (e) => String((e as { date?: string }).date ?? '') === today,
  ).length;

  return {
    today,
    due,
    upcoming,
    unseen,
    masteredCount: mastered,
    learningCount: learning,
    shakyCount: shaky,
    answeredToday,
    streakDays: studyStreak(state, today),
  };
}

export const MASTERY_LABEL: Record<number, string> = {
  0: 'new', 1: 'shaky', 2: 'learning', 3: 'learning', 4: 'solid', 5: 'mastered',
};
