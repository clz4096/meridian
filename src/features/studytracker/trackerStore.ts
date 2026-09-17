/**
 * Study Tracker ("The Princeton Theorist") — ORDINARY-tier local state.
 *
 * Ported from ~/Brainstorm/meridian-tabs/princeton-theorist.html. This is a
 * gamified daily-study instrument: tick schedule blocks to bank XP, score the
 * day 0/1/2 to fill five meters, and keep a 7-day streak. State is a single
 * namespaced localStorage blob (`meridian.tracker.v1`) held in a signal — NOT
 * routed through the CRDT/FSRS/grading kernel (that is CRITICAL tier).
 */
import { signal } from '@preact/signals';

export interface TrackerDay {
  date: string; // ISO yyyy-mm-dd
  blocks: Record<string, boolean>; // schedule id → ticked
  scores: Record<string, number>; // score id → 0 | 1 | 2
  banked: boolean; // today's XP already added to cumXP
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
/** The day, Eastern Time. Ticking a block banks its XP for today. */
export const SCHEDULE: readonly Block[] = [
  { id: 'b1', time: '9:00 AM', title: 'Wake, water, 10-min move', sub: 'Rested, up without a third alarm', xp: 20 },
  { id: 'b2', time: '9:15 AM', title: 'Morning ritual', sub: '2–3 lines on why it matters; 3 if-then quests', xp: 5 },
  { id: 'b3', time: '9:30 AM', title: 'Breakfast + light review', sub: 'Cleared flashcards / skimmed notes', xp: 5 },
  { id: 'b4', time: '10:00 AM', title: 'Deep Block 1 — AWS focus', sub: '90 min single-tasked, phone away', xp: 20 },
  { id: 'b5', time: '11:40 AM', title: 'Deep Block 2 — WGU / AWS', sub: 'One module advanced or a practice set', xp: 20 },
  { id: 'b6', time: '12:45 PM', title: 'Lunch + a human', sub: 'Ate, and talked with or beside someone', xp: 10 },
  { id: 'b7', time: '1:30 PM', title: 'Deep Block 3 — math, paper & pen', sub: 'Fought a hard problem; reconstructed first', xp: 20 },
  { id: 'b8', time: '3:00 PM', title: 'Gym + light study (2h)', sub: 'Trained + one playlist item', xp: 20, gym: true },
  { id: 'b9', time: '5:00 PM', title: 'Shower, snack, reset', sub: 'Genuinely off for 30 min', xp: 5 },
  { id: 'b10', time: '5:30 PM', title: 'Deep Block 4 — math / reconstruct', sub: 'Re-derived a result, or advanced the course', xp: 20 },
  { id: 'b11', time: '7:00 PM', title: 'Dinner, off-screen', sub: 'Screens down, a real break', xp: 5 },
  { id: 'b12', time: '8:00 PM', title: 'Practice + review', sub: 'Worked a set; upsolved every miss', xp: 20 },
  { id: 'b13', time: '9:30 PM', title: 'Lighter study', sub: 'Read ahead, or a technique note', xp: 10 },
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
  { id: 's3', b: 'Phase-1 focus:', t: ' real time on the AWS cert today' },
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

const KEY = 'meridian.tracker.v1';

export function todayISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function freshDay(): TrackerDay {
  return { date: todayISO(), blocks: {}, scores: {}, banked: false };
}

function load(): TrackerState {
  let s: Partial<TrackerState> = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<TrackerState>;
  } catch {
    s = {};
  }
  const state: TrackerState = {
    cumXP: typeof s.cumXP === 'number' ? s.cumXP : 0,
    logged: Array.isArray(s.logged) ? s.logged : [],
    day: s.day && s.day.date === todayISO() ? s.day : freshDay(),
  };
  return state;
}

function persist(next: TrackerState): void {
  trackerState.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — ORDINARY tier, ignore */
  }
}

export const trackerState = signal<TrackerState>(load());

/** Roll the day over if the app has been open past midnight. Safe to call often. */
export function ensureToday(): void {
  if (trackerState.value.day.date !== todayISO()) {
    persist({ ...trackerState.value, day: freshDay() });
  }
}

/* ── pure derivations ── */
export function blockXP(id: string): number {
  const b = SCHEDULE.find((r) => r.id === id);
  return b ? b.xp : 0;
}
export function dayXP(day: TrackerDay): number {
  return Object.keys(day.blocks).reduce((t, id) => (day.blocks[id] ? t + blockXP(id) : t), 0);
}
export function levelIndex(cumXP: number): number {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (cumXP >= LEVELS[i]![1]) idx = i;
  return idx;
}
export function scoreTotal(day: TrackerDay): number {
  return SCORE.reduce((t, s) => t + (day.scores[s.id] || 0), 0);
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

/* ── actions (mutate + persist the signal) ── */
export function toggleBlock(id: string): void {
  const s = trackerState.value;
  persist({ ...s, day: { ...s.day, blocks: { ...s.day.blocks, [id]: !s.day.blocks[id] } } });
}
export function setScore(id: string, val: number): void {
  const s = trackerState.value;
  persist({ ...s, day: { ...s.day, scores: { ...s.day.scores, [id]: val } } });
}
export function bankToday(): void {
  const s = trackerState.value;
  if (s.day.banked) return;
  const today = todayISO();
  const logged = s.logged.indexOf(today) < 0 ? [...s.logged, today] : s.logged;
  persist({ cumXP: s.cumXP + dayXP(s.day), logged, day: { ...s.day, banked: true } });
}
/** Clear today's ticks and scores; banked XP stays (mirrors the source). */
export function resetDay(): void {
  const s = trackerState.value;
  persist({ ...s, day: { date: todayISO(), blocks: {}, scores: {}, banked: s.day.banked } });
}
export function resetAll(): void {
  persist({ cumXP: 0, logged: [], day: freshDay() });
}

/** Glanceable summary for Today's at-a-glance tile. */
export function trackerSummary(): { level: number; todayXP: number; streak: number } {
  const s = trackerState.value;
  return { level: levelIndex(s.cumXP) + 1, todayXP: dayXP(s.day), streak: streakCount(s.logged) };
}
