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

/* ================================================================== */
/* Interview study decks — relevance-first, capped, over the SAME bank */
/* ================================================================== */

/*
 * An interview preset is a named set of card TAGS. Cards already carry interview
 * tags (hft, quant, ml, ml-systems, systems, dsa, embedded, cpp, …), so a preset
 * selects the actual relevant cards across topics — not whole topics. The deck is
 * a filtered VIEW over the same question bank + FSRS/mastery, so grading a card in
 * interview mode updates overall progress (nothing is siloed).
 */
export interface InterviewPreset {
  id: string;
  name: string;
  blurb: string;
  /** card tags (and topic ids) this interview draws from */
  tags: string[];
}

/**
 * The interview presets — editable tag sets. The over-broad generic `systems` tag
 * (it sits on a third of the bank) is deliberately left OUT so a preset stays focused
 * on its interview; the specific tags + topic ids already cover the relevant material.
 */
export const INTERVIEW_PRESETS: InterviewPreset[] = [
  {
    id: 'swe',
    name: 'Software Engineering',
    blurb: 'General SWE — data structures & algorithms, systems design, core CS.',
    tags: ['dsa', 'algorithms', 'graphs', 'graph', 'sysdesign', 'databases', 'networking', 'distributed', 'linux', 'behavioral', 'concurrency'],
  },
  {
    id: 'hft',
    name: 'HFT / Quant',
    blurb: 'Low-latency C++, computer architecture, concurrency, probability.',
    tags: ['hft', 'quant', 'cpp', 'comparch', 'concurrency', 'complexity', 'linux', 'embedded', 'algorithms', 'dsa', 'math', 'probstats'],
  },
  {
    id: 'ml',
    name: 'Machine Learning',
    blurb: 'ML fundamentals, ML systems, the underlying math.',
    tags: ['ml', 'mlsys', 'ml-systems', 'mlfund', 'math', 'probstats', 'gpu', 'distributed', 'algorithms'],
  },
];

export function interviewPreset(id: string): InterviewPreset | undefined {
  return INTERVIEW_PRESETS.find((p) => p.id === id);
}

type Taggable = { id: string; tags?: string[]; topic?: string };

/** How many of the preset's tags a card hits (its topic id counts as a tag too). */
function relevanceMatches(item: Taggable, tagSet: Set<string>): number {
  let n = 0;
  for (const t of item.tags ?? []) if (tagSet.has(t)) n++;
  if (item.topic && tagSet.has(item.topic)) n++;
  return n;
}

/** Every card relevant to a preset (≥1 tag match), unranked. */
export function interviewRelevant<T extends Taggable>(items: readonly T[], presetTags: readonly string[]): T[] {
  const tagSet = new Set(presetTags);
  return items.filter((it) => relevanceMatches(it, tagSet) > 0);
}

/** How urgently a card needs study for this interview: weakest mastery + overdue + relevance. */
function studyScore(it: Taggable, state: KnowledgeState, matches: number, today: string, config: SrsConfig): number {
  const mastery = Math.max(0, Math.min(5, (state.mastery?.[it.id] ?? 0) as number)); // clamp corrupt data
  const weakness = 5 - mastery; // 0..5; unseen/new (0) → 5, the top priority
  const entry = normaliseEntry(state.srs?.[it.id], config);
  const overdue = entry.due === '' ? 0 : Math.max(0, Math.min(14, daysBetween(entry.due, today)));
  return weakness * 3 + matches * 2 + overdue;
}

/**
 * The interview study deck: relevance-first, capped, AND spread across the interview's
 * topics. Keep the preset-relevant cards; within each topic order by how much each NEEDS
 * study (weakest mastery + most overdue + tag-match strength); then round-robin across
 * topics (urgent topic first) so the deck spans the whole interview instead of collapsing
 * onto whichever topic's ids sort first. Pure & deterministic (clock passed as `today`),
 * and it returns the same card ids so the shared FSRS/mastery keeps progress unified.
 */
export function interviewDeck<T extends Taggable>(
  items: readonly T[],
  state: KnowledgeState,
  presetTags: readonly string[],
  today: string,
  cap = 20,
  config: SrsConfig = DEFAULT_SRS,
): T[] {
  const tagSet = new Set(presetTags);
  // Group relevant cards by topic, each scored by study urgency.
  const byTopic = new Map<string, Array<{ it: T; score: number }>>();
  for (const it of items) {
    const matches = relevanceMatches(it, tagSet);
    if (matches === 0) continue; // not relevant to this interview
    const score = studyScore(it, state, matches, today, config);
    const topic = it.topic ?? '';
    (byTopic.get(topic) ?? byTopic.set(topic, []).get(topic)!).push({ it, score });
  }
  // Within a topic: most-urgent first, id as the stable tie-break.
  for (const arr of byTopic.values()) arr.sort((a, b) => b.score - a.score || a.it.id.localeCompare(b.it.id));
  // Topic order: the topic holding the most-urgent card leads; name breaks ties (stable).
  const topics = [...byTopic.keys()].sort((a, b) => {
    const sa = byTopic.get(a)![0]!.score;
    const sb = byTopic.get(b)![0]!.score;
    return sb - sa || a.localeCompare(b);
  });
  // Round-robin across topics so the deck spans them (one from each, then seconds, …).
  const limit = Math.max(0, cap);
  const deck: T[] = [];
  for (let round = 0; deck.length < limit; round++) {
    let progressed = false;
    for (const t of topics) {
      const arr = byTopic.get(t)!;
      if (round < arr.length) {
        deck.push(arr[round]!.it);
        progressed = true;
        if (deck.length >= limit) break;
      }
    }
    if (!progressed) break; // every topic exhausted
  }
  return deck;
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

/** The "am I growing?" readout — retention over a recent window + coverage. */
export interface GrowthReadout {
  retention: number | null; // 0..1 recall success over the window; null if too few reviews
  reviews: number; // reviews inside the window
  solid: number; // questions at mastery >= 4
  seen: number; // questions attempted at least once
}
export function knowledgeGrowth(state: KnowledgeState, today: string, windowDays = 30): GrowthReadout {
  const cutoff = shiftDate(today, -windowDays);
  const log = (state.log ?? []).filter((e) => String((e as { date?: string }).date ?? '') >= cutoff);
  const reviews = log.length;
  const hits = log.filter((e) => Number((e as { rating?: number }).rating ?? 0) >= 4).length;
  const mastery = state.mastery ?? {};
  return {
    retention: reviews >= 5 ? hits / reviews : null,
    reviews,
    solid: Object.values(mastery).filter((m) => Number(m) >= 4).length,
    seen: Object.keys(mastery).length,
  };
}
