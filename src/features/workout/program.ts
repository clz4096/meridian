/**
 * The full-body program (owner, 2026-10-21; docs/workout-audit-design.md 3.0 to 3.1).
 *
 * Sessions on or after PROGRAM_FROM use per-lift rep ranges, fixed warm-up recipes,
 * a fixed set count per lift, and Day A (heavy) / Day B (light) bench. Sessions before
 * it keep the old rules, so past grades never change.
 */
import type { WorkoutSet, WorkoutState } from '@/core/types';
import { toNum } from '@/core/util';

export const PROGRAM_FROM = '2026-10-21';

export function inProgram(date: string): boolean {
  return date >= PROGRAM_FROM;
}

/** Rep range per lift: the low end after a weight increase, the high end earns one. */
export const REP_RANGE: Record<string, { lo: number; hi: number }> = {
  'Bench Press': { lo: 5, hi: 8 },
  'Lat Pulldown': { lo: 8, hi: 12 },
  'Leg Press': { lo: 8, hi: 12 },
  'Leg Extension': { lo: 8, hi: 14 },
  'Tricep Pushdown (Rope)': { lo: 10, hi: 15 },
  'Bicep Curl (Pulley)': { lo: 10, hi: 15 },
  'Bicep Curl (Dumbbell)': { lo: 10, hi: 15 },
  'Calf Raise (Machine)': { lo: 10, hi: 15 },
  'Hip Abduction': { lo: 12, hi: 20 },
  'Hip Adduction': { lo: 12, hi: 20 },
};

/** Day B bench: three straight sets at this share of the last heavy top set. */
export const BENCH_LIGHT = { ratio: 0.85, lo: 8, hi: 10, sets: 3 } as const;

/** The empty Olympic bar. */
export const BAR = 45;

/** Warm-ups as a share of the top-set weight. `bar` means the empty bar. */
export const WARMUPS: Record<string, Array<{ ratio: number; reps: number; bar?: boolean; why: string }>> = {
  'Bench Press': [
    { ratio: 0, reps: 5, bar: true, why: 'empty bar: practice the movement' },
    { ratio: 0.5, reps: 5, why: 'about half your top set: very easy' },
    { ratio: 0.7, reps: 3, why: 'about 70% of your top set: light' },
    { ratio: 0.85, reps: 1, why: 'about 85% of your top set: feel the weight, no strain' },
  ],
  'Leg Press': [
    { ratio: 0.5, reps: 8, why: 'about half your top set: easy' },
    { ratio: 0.75, reps: 4, why: 'about 75% of your top set: light' },
  ],
  'Lat Pulldown': [{ ratio: 0.5, reps: 10, why: 'about half your working weight: easy' }],
  'Leg Extension': [{ ratio: 0.6, reps: 10, why: 'about 60% of your working weight: easy' }],
};

/** Back-off sets after the top set, as a share of the top-set weight. */
export const BACKOFFS: Record<string, number[]> = {
  'Bench Press': [0.9, 0.9],
  'Leg Press': [0.9, 0.9],
  'Leg Extension': [0.9, 0.9],
  'Lat Pulldown': [1, 1],
  'Tricep Pushdown (Rope)': [1, 1],
  'Bicep Curl (Pulley)': [1, 1],
  'Bicep Curl (Dumbbell)': [1],
  'Calf Raise (Machine)': [1, 1],
  'Hip Abduction': [1],
  'Hip Adduction': [1],
};

/** Lifts done back to back as a pair, shown with a superset label. */
export const SUPERSETS: Record<string, string> = {
  'Tricep Pushdown (Rope)': 'Bicep Curl (Pulley)',
  'Bicep Curl (Pulley)': 'Tricep Pushdown (Rope)',
  'Hip Abduction': 'Hip Adduction',
  'Hip Adduction': 'Hip Abduction',
};

/** Form cues shown on the card. */
export const CUES: Record<string, string> = {
  'Leg Extension': 'Hold 2 seconds at the top of every rep.',
};

export type Location = 'Home' | 'Life Time';

export const LOCATION: Record<string, Location> = {
  'Bench Press': 'Home',
  'Tricep Pushdown (Rope)': 'Home',
  'Bicep Curl (Pulley)': 'Home',
  'Bicep Curl (Dumbbell)': 'Home',
  'Lat Pulldown': 'Life Time',
  'Leg Press': 'Life Time',
  'Leg Extension': 'Life Time',
  'Calf Raise (Machine)': 'Life Time',
  'Hip Abduction': 'Life Time',
  'Hip Adduction': 'Life Time',
  Treadmill: 'Life Time',
};

/** Days off a lift beyond which its weight comes down about 10%. */
export const LAYOFF_DAYS = 14;

/** Epley e1RM; only sets of 12 reps or fewer are trusted. */
function e1rmOf(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0 || reps > 12) return 0;
  return weight * (1 + reps / 30);
}

/** A session's strength: the best e1RM over its working sets (top or back-off). */
export function sessionE1rm(sets: readonly WorkoutSet[]): number {
  let best = 0;
  for (const s of sets) {
    if (s.type !== 'top' && s.type !== 'back') continue;
    best = Math.max(best, e1rmOf(toNum(s.weight), toNum(s.reps)));
  }
  return best;
}

/** True level: the middle of the last three sessions' e1RMs, so one day can't swing it. */
export function trueLevel(e1rms: number[]): number {
  const recent = e1rms.filter((x) => x > 0).slice(-3);
  if (recent.length === 0) return 0;
  const sorted = [...recent].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/** Weight that allows `reps` with about 2 reps left, from a true level. */
export function weightForReps(level: number, reps: number): number {
  return level / (1 + (reps + 2) / 30);
}

/**
 * Day A or Day B for bench on `date`: program bench sessions alternate A, B, A, B by
 * sessions actually done, so a missed trip never skips a heavy day. A date that already
 * has bench logged keeps the type it was given.
 */
export function benchDay(benchDates: readonly string[], date: string): 'A' | 'B' {
  const prior = benchDates.filter((d) => d >= PROGRAM_FROM && d < date).length;
  return prior % 2 === 0 ? 'A' : 'B';
}

/* ------------------------------------------------------------------ */
/* Treadmill                                                           */
/* ------------------------------------------------------------------ */

export interface Segment {
  kind: 'walk' | 'jog';
  mins: number;
  mph: number;
  incline: number;
  /** how many times this segment repeats (intervals) */
  times?: number;
}

export const PRESETS: Array<{ label: string; seg: Segment }> = [
  { label: 'Warm-up 5 min · 2.5 mph · 4%', seg: { kind: 'walk', mins: 5, mph: 2.5, incline: 4 } },
  { label: 'Incline walk · 3.5 mph · 6%', seg: { kind: 'walk', mins: 10, mph: 3.5, incline: 6 } },
];

/** Jog progression: move up after two sessions at a stage. */
export const JOG_STAGES: Array<{ jog: number; walk: number; times: number }> = [
  { jog: 1, walk: 1.5, times: 6 },
  { jog: 1.5, walk: 1.5, times: 5 },
  { jog: 2, walk: 1, times: 5 },
  { jog: 3, walk: 1, times: 4 },
  { jog: 10, walk: 0, times: 1 },
];

export const JOG_MPH = 4.5;
export const WALK_BREAK_MPH = 3.5;

/** Which jog stage is due, from how many program jog sessions are already done. */
export function jogStage(jogSessionsDone: number): number {
  return Math.min(JOG_STAGES.length - 1, Math.floor(jogSessionsDone / 2));
}

/** Day A pre-fill: the usual warm-up, then the due interval stage at 1% incline. */
export function jogPlan(stage: number): Segment[] {
  const s = JOG_STAGES[stage]!;
  const out: Segment[] = [PRESETS[0]!.seg, { kind: 'jog', mins: s.jog, mph: JOG_MPH, incline: 1, times: s.times }];
  if (s.walk > 0) out.push({ kind: 'walk', mins: s.walk, mph: WALK_BREAK_MPH, incline: 1, times: s.times });
  return out;
}

export function segMinutes(seg: Segment): number {
  return seg.mins * (seg.times ?? 1);
}

export function segMiles(seg: Segment): number {
  return (seg.mph * segMinutes(seg)) / 60;
}

/**
 * Calories for one segment, ACSM metabolic equations: walking below about 3.7 mph,
 * running above. VO2 in ml/kg/min; about 5 kcal per litre of oxygen.
 */
export function segKcal(seg: Segment, bodyweightLb: number): number {
  const s = seg.mph * 26.8224; // metres per minute
  const g = seg.incline / 100;
  const vo2 = seg.kind === 'jog' || seg.mph > 3.7 ? 0.2 * s + 0.9 * s * g + 3.5 : 0.1 * s + 1.8 * s * g + 3.5;
  const kg = bodyweightLb * 0.4536;
  return (vo2 * kg * 5 * segMinutes(seg)) / 1000;
}

export function totals(segs: readonly Segment[], bodyweightLb: number): { mins: number; miles: number; kcal: number } {
  let mins = 0;
  let miles = 0;
  let kcal = 0;
  for (const s of segs) {
    mins += segMinutes(s);
    miles += segMiles(s);
    kcal += segKcal(s, bodyweightLb);
  }
  return { mins: Math.round(mins * 10) / 10, miles: Math.round(miles * 100) / 100, kcal: Math.round(kcal) };
}

/** Program jog sessions logged before `date` (treadmill sets with a jog segment). */
export function jogSessionsBefore(state: WorkoutState, date: string): number {
  let n = 0;
  for (const [d, sets] of Object.entries(state.days ?? {})) {
    if (d < PROGRAM_FROM || d >= date) continue;
    if (sets.some((s) => s.ex === 'Treadmill' && (s.segs ?? []).some((g) => g.kind === 'jog'))) n++;
  }
  return n;
}
