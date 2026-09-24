/**
 * Study Tracker ("The Princeton Theorist").
 *
 * Ported from ~/Brainstorm/meridian-tabs/princeton-theorist.html. This is a
 * gamified daily-study instrument. Post-Phase-2 the graded 0/1/2 scorecard is
 * the SINGLE daily input: it fills five meters AND earns the day's XP. The
 * schedule blocks are a 0-XP hygiene/timeline checklist (the day's shape); keep
 * a 7-day streak.
 *
 * The signal still speaks the legacy `{ cumXP, logged, day }` shape the view
 * renders, but state is now BACKED by the synced `theorist` store (see
 * {@link TheoristState}) so XP/streak converge across devices like the other
 * four stores. This module is a thin projection over that store: every mutator
 * reads the current `TheoristState` from appState, produces the next one,
 * persists it, and re-projects the signal. `cumXP` is the sum of banked XP and
 * `logged` is the set of real ISO banked dates.
 */
import { signal } from '@preact/signals';
import type { TheoristState } from '@/core/types';
import { appState } from '@/app/bootstrap';

export interface TrackerDay {
  date: string; // ISO yyyy-mm-dd
  blocks: Record<string, boolean>; // schedule id → ticked (0-XP hygiene/timeline)
  scores: Record<string, number>; // score id → 0 | 1 | 2 (the graded, XP-earning log)
  banked: boolean; // today's XP already added to cumXP
  events?: Record<string, number>; // per-day economy credits by event id (Phase 3)
  dayType?: 'full' | 'light'; // whether today is a full or light day
}
export interface TrackerState {
  cumXP: number;
  logged: string[]; // ISO dates whose XP was banked (drives the streak)
  day: TrackerDay;
}

/** Level ladder: [title, cumulative-XP threshold]. */
export const LEVELS: ReadonlyArray<readonly [string, number]> = [
  ['Curious Mind', 0],
  ['Proof Apprentice', 1000],
  ['Problem Solver', 4000],
  ['Theorist in Training', 10000],
  ['Independent', 25000],
  ['Contributor', 50000],
  ['Theory-Group Ready', 100000],
];

export interface Block {
  id: string;
  time: string;
  title: string;
  sub: string;
  xp: number;
  gym?: boolean;
}
/** The day, Eastern Time. Blocks are a 0-XP hygiene/timeline checklist — the
 *  day's shape — not the XP source; XP is earned from the graded scorecard. */
export const SCHEDULE: readonly Block[] = [
  { id: 'b1', time: '9:00 AM', title: 'Wake, water, 10-min move', sub: 'Rested, up without a third alarm', xp: 20 },
  { id: 'b2', time: '9:15 AM', title: 'Morning ritual', sub: '2–3 lines on why it matters; 3 if-then quests', xp: 5 },
  { id: 'b3', time: '9:30 AM', title: 'Breakfast + light review', sub: 'Cleared flashcards / skimmed notes', xp: 5 },
  { id: 'b4', time: '10:00 AM', title: 'Deep Block 1 — proofs & problem set', sub: "The week's pset; reconstruct before you look", xp: 20 },
  { id: 'b5', time: '11:40 AM', title: 'Deep Block 2 — algorithms', sub: 'The algorithm of the day, implemented in C++', xp: 20 },
  { id: 'b6', time: '12:45 PM', title: 'Lunch + a human', sub: 'Ate, and talked with or beside someone', xp: 10 },
  { id: 'b7', time: '1:30 PM', title: 'Deep Block 3 — math, paper & pen', sub: 'Fought a hard problem; reconstructed first', xp: 20 },
  { id: 'b8', time: '3:00 PM', title: 'Gym + light study (2h)', sub: 'Trained + one playlist item', xp: 20, gym: true },
  { id: 'b9', time: '5:00 PM', title: 'Shower, snack, reset', sub: 'Genuinely off for 30 min', xp: 5 },
  { id: 'b10', time: '5:30 PM', title: 'Deep Block 4 — math / reconstruct', sub: 'Re-derived a result, or advanced the course', xp: 20 },
  { id: 'b11', time: '7:00 PM', title: 'Dinner, off-screen', sub: 'Screens down, a real break', xp: 5 },
  { id: 'b12', time: '8:00 PM', title: 'Practice + review', sub: 'Worked a set; upsolved every miss', xp: 20 },
  { id: 'b13', time: '9:30 PM', title: 'Paper pass', sub: "One Keshav pass on the week's paper", xp: 10 },
  { id: 'b14', time: '10:30 PM', title: 'Wind-down + reflection', sub: "Scorecard + tomorrow's quests + one process line", xp: 10 },
  { id: 'b15', time: '11:15 PM', title: 'Off-screen buffer', sub: 'Reading/stretching, no bright screens', xp: 5 },
];

export interface ScoreItem {
  id: string;
  b: string; // bold lead-in
  t: string; // rest of the line
}
/** The 0/1/2 scorecard. Score the practice, never a grade or exam result. */
export const SCORE: readonly ScoreItem[] = [
  { id: 's1', b: 'Sleep:', t: ' 7–9 hours, no all-nighter' },
  { id: 's2', b: 'Deep work:', t: ' ~3–4 hours single-tasked, protected' },
  { id: 's3', b: 'Core focus:', t: ' real time on the current course / problem set today' },
  { id: 's4', b: 'Reconstructed:', t: ' re-derived a result cold before reading' },
  { id: 's5', b: 'Trusted nothing:', t: ' tried a lower bound or counterexample' },
  { id: 's6', b: 'Problems:', t: ' worked a set and upsolved every miss' },
  { id: 's7', b: 'Gym:', t: ' trained, and used the block for a playlist item' },
  { id: 's8', b: 'Human:', t: ' one real contact with a person' },
  { id: 's9', b: 'Hard stop:', t: ' stopped near 11:45 PM, did not grind past the red line' },
  { id: 's10', b: 'Reflection:', t: " scorecard, tomorrow's quests, one process line" },
];

/** Which score items feed each of the five meters. */
export const METERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Focus', ['s2', 's4', 's5']],
  ['Body', ['s1', 's7']],
  ['Rest', ['s1', 's9']],
  ['Social', ['s8']],
  ['Progress', ['s3', 's6', 's10']],
];

export function todayISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function freshDay(): TrackerDay {
  return { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} };
}

const ISO_DATE = /^\d{4}-\d\d-\d\d$/;
const EMPTY_THEORIST: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false } };

/**
 * Read the live `theorist` store from appState. Defensive: at module-eval time
 * this file can be pulled in through bootstrap's import graph BEFORE bootstrap's
 * `appState` binding is initialised (an import cycle — bootstrap imports
 * `syncTrackerFromStore` from here). Accessing `appState` then throws a TDZ
 * ReferenceError, so we fall back to the empty store and let boot()'s
 * `syncTrackerFromStore()` seed the real value once everything is wired.
 */
function readStore(): TheoristState {
  try {
    const t = appState.get('theorist') as TheoristState | undefined;
    return t && t.banked && t.day ? t : EMPTY_THEORIST;
  } catch {
    return EMPTY_THEORIST;
  }
}

/** Project the synced store into the legacy view shape the signal exposes. */
function project(t: TheoristState): TrackerState {
  const banked = t.banked ?? {};
  let cumXP = 0;
  for (const v of Object.values(banked)) if (typeof v === 'number') cumXP += v;
  const logged = Object.keys(banked).filter((k) => ISO_DATE.test(k));
  // Defensive: an old-shape day (loaded before Phase 2) has no `events`.
  // Normalise it to `{}` so downstream XP math and the view never touch
  // undefined. `dayType` stays undefined when absent.
  const day = t.day ?? freshDay();
  return { cumXP, logged, day: { ...day, events: day.events ?? {} } };
}

export const trackerState = signal<TrackerState>(project(readStore()));

/** Re-project the durable `theorist` store into the signal (boot / pull / discard). */
export function syncTrackerFromStore(): void {
  trackerState.value = project(readStore());
}

/** Persist a next `TheoristState`, re-project the signal, and mark the store dirty. */
function commit(next: TheoristState): void {
  // Default `day.events` to `{}` on every write (leave `dayType` untouched) so
  // the persisted shape is always Phase-2 canonical. Absent-tolerant in merge,
  // so no migration marker is needed.
  const norm: TheoristState = { ...next, day: { ...next.day, events: next.day.events ?? {} } };
  appState.set('theorist', norm as unknown as Record<string, unknown>);
  trackerState.value = project(norm);
  appState.markTheoristDirty();
}

/**
 * Auto Light-Sabbath heuristic: is `d` (LOCAL time) inside the approximate
 * Sabbath window — Friday 6:00 PM through Saturday 8:00 PM local? Sundown is not
 * computed exactly; this is a documented approximation, and a manual Full/Light
 * toggle always overrides it.
 */
export function inSabbathWindow(d: Date = new Date()): boolean {
  const wd = d.getDay(); // 0 Sun … 5 Fri, 6 Sat
  const h = d.getHours();
  if (wd === 5 && h >= 18) return true; // Friday evening
  if (wd === 6 && h < 20) return true;  // Saturday until 8 PM
  return false;
}

/**
 * Roll the day over if the app has been open past midnight, and apply the auto
 * Light-Sabbath: when `dayType` is unset and the local clock is in the Sabbath
 * window, mark today `'light'`. Safe to call often; a set `dayType` (manual or
 * already-auto) is never overwritten. */
export function ensureToday(): void {
  const t = readStore();
  const now = new Date();
  if (t.day.date !== todayISO(now)) {
    const day = freshDay();
    if (inSabbathWindow(now)) day.dayType = 'light';
    commit({ ...t, day, dayTouchedAt: Date.now() });
    return;
  }
  if (t.day.dayType === undefined && inSabbathWindow(now)) {
    commit({ ...t, day: { ...t.day, dayType: 'light' }, dayTouchedAt: Date.now() });
  }
}

/* ── pure derivations ── */

/**
 * Per-SCORE-item XP unit (a TUNABLE default). XP for an item = score × unit,
 * where score ∈ {0,1,2} (Missed/Partial/Met). Deep-work items earn double the
 * routine/logistics items, but routine items still earn (logistics XP is KEPT):
 *  - Deep    (s2,s3,s4,s5,s6): unit 10 → Partial 10, Met 20.
 *  - Routine (s1,s7,s8,s9,s10): unit  5 → Partial  5, Met 10.
 * An item absent from this table earns 0.
 */
export const SCORE_UNIT: Readonly<Record<string, number>> = {
  s2: 10, s3: 10, s4: 10, s5: 10, s6: 10, // deep work
  s1: 5, s7: 5, s8: 5, s9: 5, s10: 5, // routine / logistics
};

/**
 * Phase 3 economy weights (TUNABLE). These ride ON TOP of the per-item
 * scorecard XP (routine items still earn) and flow into `dayXP` through
 * `day.events`. Retrieval is by design the STRICTLY highest-paid event: cold
 * reconstruction from memory is the behaviour worth the most. Every `creditEvent`
 * is max-merged per id, so a same-day repeat can't double-pay.
 */
export const EVENT_WEIGHTS = {
  /** Retrieval / spaced-return reconstruction success — strictly the top payout. */
  retrieval: 50,
  /** Paper pass-3 "reproduce" completed. */
  paperReproduce: 30,
  /** A curriculum topic reviewed / re-derived (pset/course retrieval). */
  topicReview: 25,
  /** Algorithm-of-the-day studied. */
  algoStudied: 20,
  /** A journal entry saved (written, not reconstructed). */
  journalSave: 10,
} as const;

/** Mastery half-life in days (TUNABLE). A reviewed topic decays to level/2 after this long. */
export const HALF_LIFE_DAYS = 30;
const HALF_LIFE = HALF_LIFE_DAYS * 86_400_000; // ms

/** Weekly-session target for the ring (TUNABLE). */
export const WEEKLY_TARGET = 4;

/** Blocks are a 0-XP hygiene/timeline checklist post-Phase-2, never an XP source. */
export function blockXP(_id: string): number {
  return 0;
}

/**
 * Today's XP, now derived from the graded scorecard (the single daily input),
 * not block ticks: Σ over SCORE items of `score × SCORE_UNIT[id]`, plus the
 * face-value sum of `day.events` (wired in Phase 3; default {} ⇒ contributes 0).
 * Historical `banked` days are frozen and never recomputed with this formula.
 */
export function dayXP(day: TrackerDay): number {
  let xp = 0;
  for (const s of SCORE) xp += (day.scores[s.id] || 0) * (SCORE_UNIT[s.id] ?? 0);
  const events = day.events ?? {};
  for (const v of Object.values(events)) if (typeof v === 'number') xp += v;
  return xp;
}
export function levelIndex(cumXP: number): number {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (cumXP >= LEVELS[i]![1]) idx = i;
  return idx;
}
export function scoreTotal(day: TrackerDay): number {
  return SCORE.reduce((t, s) => t + (day.scores[s.id] || 0), 0);
}
/**
 * Meter fill %, 0..100, over the score `ids` feeding it. A score is UNRATED
 * when its key is absent from `day.scores`; unrated items are excluded from the
 * denominator so an unstarted day reads 0% (empty) instead of all-missed. An
 * explicit 0 ("Missed") counts. `pct = round(sum(rated)/(rated*2)*100)`.
 */
export function meterPct(day: TrackerDay, ids: readonly string[]): number {
  const rated = ids.filter((id) => day.scores[id] !== undefined);
  if (!rated.length) return 0;
  const sum = rated.reduce((t, id) => t + (day.scores[id] || 0), 0);
  return Math.round((sum / (rated.length * 2)) * 100);
}
/** Last 7 calendar days (oldest→today) with an on/today flag from `logged`. */
export function streakDays(logged: string[]): Array<{ iso: string; on: boolean; today: boolean }> {
  const out: Array<{ iso: string; on: boolean; today: boolean }> = [];
  const today = todayISO();
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const iso = todayISO(d);
    out.push({ iso, on: logged.indexOf(iso) > -1, today: iso === today });
  }
  return out;
}
export function streakCount(logged: string[]): number {
  return streakDays(logged).filter((d) => d.on).length;
}

/* ── actions (mutate the synced store + re-project the signal) ── */
export function toggleBlock(id: string): void {
  const t = readStore();
  const day = { ...t.day, blocks: { ...t.day.blocks, [id]: !t.day.blocks[id] } };
  commit({ ...t, day, dayTouchedAt: Date.now() });
}
export function setScore(id: string, val: number): void {
  const t = readStore();
  const v = Math.max(0, Math.min(2, Math.round(val))); // scorecard is 0/1/2 only
  const day = { ...t.day, scores: { ...t.day.scores, [id]: v } };
  commit({ ...t, day, dayTouchedAt: Date.now() });
}
export function bankToday(): void {
  const t = readStore();
  if (t.day.banked) return;
  const today = todayISO();
  const banked = { ...t.banked, [today]: Math.max(t.banked[today] ?? 0, dayXP(t.day)) };
  commit({ ...t, banked, day: { ...t.day, banked: true }, dayTouchedAt: Date.now() });
}

/**
 * Toggle today's banking. Banking is not one-way: pressing again un-banks the
 * day (drops today's contribution and re-enables ticking to count), so you can
 * add more blocks and bank again. Note: across devices `banked` merges by
 * per-key max, so an un-bank is authoritative only until a device that still
 * holds today's value syncs; on a single device it behaves as expected.
 */
export function toggleBank(): void {
  const t = readStore();
  // The day being banked, not the wall clock: a day left open past midnight banks
  // under its own date instead of pre-filling the next one.
  const today = t.day.date || todayISO();
  if (t.day.banked) {
    const banked = { ...t.banked };
    delete banked[today];
    commit({ ...t, banked, day: { ...t.day, banked: false }, dayTouchedAt: Date.now() });
  } else {
    const banked = { ...t.banked, [today]: Math.max(t.banked[today] ?? 0, dayXP(t.day)) };
    commit({ ...t, banked, day: { ...t.day, banked: true }, dayTouchedAt: Date.now() });
  }
}
/** Clear today's ticks and scores; banked XP stays (mirrors the source). */
export function resetDay(): void {
  const t = readStore();
  commit({ ...t, day: { date: todayISO(), blocks: {}, scores: {}, banked: t.day.banked }, dayTouchedAt: Date.now() });
}
/** Global reset: wipe banked XP and today, and bump `resetAt` so the wipe
 *  propagates across devices instead of union-resurrecting on the next merge. */
export function resetAll(): void {
  commit({ banked: {}, day: freshDay(), dayTouchedAt: Date.now(), resetAt: Date.now() });
}

/* ── Phase 3: economy, decaying mastery, weekly ring ── */

/**
 * Credit a per-day economy event by id (idempotent, max-merged). Event ids are
 * per-day-scoped by construction — `day.events` resets with the day — and
 * namespaced, so a same-day repeat of the same id can't double-pay: the stored
 * credit is `max(existing, xp)`. Flows into `dayXP` via `day.events`.
 */
export function creditEvent(id: string, xp: number): void {
  const t = readStore();
  const prev = t.day.events?.[id] ?? 0;
  const next = Math.max(prev, xp);
  const events = { ...(t.day.events ?? {}), [id]: next };
  commit({ ...t, day: { ...t.day, events }, dayTouchedAt: Date.now() });
}

/** Set today's day-type (manual Full/Light override). */
export function setDayType(dt: 'full' | 'light'): void {
  const t = readStore();
  commit({ ...t, day: { ...t.day, dayType: dt }, dayTouchedAt: Date.now() });
}

/**
 * Current, decayed mastery for a topic in [0,1]. FSRS-style exponential decay:
 * `level * 0.5 ** ((now - reviewedAt)/HALF_LIFE)`. An absent topic reads 0.
 */
export function currentMastery(topicId: string, now: number = Date.now()): number {
  const m = readStore().mastery?.[topicId];
  // A record missing/garbage `level` or `reviewedAt` would make the decay NaN
  // (and NaN survives both clamps → a NaN-width meter bar); treat it as 0.
  if (!m || !Number.isFinite(m.level) || !Number.isFinite(m.reviewedAt)) return 0;
  const decayed = m.level * Math.pow(0.5, (now - m.reviewedAt) / HALF_LIFE);
  return decayed < 0 ? 0 : decayed > 1 ? 1 : decayed;
}

/**
 * Mastery-only update: reset a topic to a full level 1 at now. Persists + marks
 * dirty via `commit`, but credits NO economy event. This is the primitive the
 * spaced-return path uses so it can pay the single top retrieval event (50)
 * WITHOUT also stacking the topic-review credit — keeping retrieval the strictly
 * highest single payout.
 */
export function markTopicReviewed(topicId: string): void {
  const t = readStore();
  const mastery = { ...(t.mastery ?? {}), [topicId]: { level: 1, reviewedAt: Date.now() } };
  commit({ ...t, mastery, dayTouchedAt: Date.now() });
}

/**
 * Mark a topic reviewed / re-derived from the Curriculum list: reset its mastery
 * to a full level 1 at now, and credit the topic-review event (25). Persists +
 * marks dirty via `commit`; both changes land in a single write.
 */
export function reviewTopic(topicId: string): void {
  const t = readStore();
  const now = Date.now();
  const mastery = { ...(t.mastery ?? {}), [topicId]: { level: 1, reviewedAt: now } };
  const eid = 'topic:' + topicId;
  const prev = t.day.events?.[eid] ?? 0;
  const events = { ...(t.day.events ?? {}), [eid]: Math.max(prev, EVENT_WEIGHTS.topicReview) };
  commit({ ...t, mastery, day: { ...t.day, events }, dayTouchedAt: now });
}

/**
 * The stalest reviewed topic: the one with the LOWEST current (decayed) mastery
 * that has fallen below 0.5 ("no longer reconstructable"). Returns null when no
 * tracked topic has gone stale. Only topics with a mastery record are
 * considered — a never-reviewed topic isn't "going stale".
 */
export function stalestTopic(now: number = Date.now()): { id: string; level: number } | null {
  const m = readStore().mastery ?? {};
  let best: { id: string; level: number } | null = null;
  for (const id of Object.keys(m)) {
    const level = currentMastery(id, now);
    // `level > 0` excludes never-reviewed / migrated-unchecked (seeded level 0)
    // topics — you can't "reconstruct from memory" something never studied, and
    // a level-0 entry would otherwise always win. Only once-reviewed topics that
    // have decayed below the reconstructable line surface here.
    if (level > 0 && level < 0.5 && (best === null || level < best.level)) best = { id, level };
  }
  return best;
}

/** Does today qualify as a weekly session? A light day clears a lower bar. */
function todayIsSession(day: TrackerDay): boolean {
  const hasScore = Object.keys(day.scores ?? {}).length > 0;
  const hasEvent = Object.values(day.events ?? {}).some((v) => typeof v === 'number' && v > 0);
  if (day.dayType === 'light') {
    const hasBlock = Object.values(day.blocks ?? {}).some(Boolean);
    return hasScore || hasEvent || hasBlock;
  }
  return hasScore || hasEvent;
}

/**
 * Weekly sessions: how many of the trailing 7 local days (including today) count
 * as a study session. A past day counts when it was banked (a real ISO key in
 * `banked`). Today also counts when it clears the session bar even before it is
 * banked — a light/Sabbath day clears a lower bar (any score, event, or block).
 */
export function weeklySessions(now: number = Date.now()): number {
  const t = readStore();
  const banked = t.banked ?? {};
  const todayIso = todayISO(new Date(now));
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const iso = todayISO(d);
    if (!ISO_DATE.test(iso)) continue;
    if (iso in banked) { count++; continue; }
    if (iso === todayIso && t.day.date === todayIso && todayIsSession(t.day)) count++;
  }
  return count;
}

/** Glanceable summary for Today's at-a-glance tile. */
export function trackerSummary(): { level: number; todayXP: number; streak: number } {
  const s = trackerState.value;
  return { level: levelIndex(s.cumXP) + 1, todayXP: dayXP(s.day), streak: streakCount(s.logged) };
}
