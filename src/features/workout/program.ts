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

/** One speed and incline held for some minutes. */
export interface Pace {
  mins: number;
  mph: number;
  incline: number;
}

/**
 * A treadmill session as the owner runs it: a warm-up, then jogs with a walk break
 * between each pair, then an incline walk. Any block can be 0 minutes.
 */
export interface TreadmillBlocks {
  warm: Pace;
  jogs: number;
  jog: Pace;
  walkBreak: Pace;
  inclineWalk: Pace;
}

export const WARM_UP: Pace = { mins: 5, mph: 2.5, incline: 4 };
export const INCLINE_WALK: Pace = { mins: 10, mph: 3.5, incline: 6 };

/** Jog progression: move up after two sessions at a stage. A walk break sits between jogs. */
export const JOG_STAGES: Array<{ jog: number; walk: number; jogs: number }> = [
  { jog: 1, walk: 1, jogs: 6 },
  { jog: 1.5, walk: 1, jogs: 6 },
  { jog: 2, walk: 1, jogs: 5 },
  { jog: 3, walk: 1, jogs: 4 },
  { jog: 10, walk: 0, jogs: 1 },
];

export const JOG_MPH = 4.5;
export const WALK_BREAK_MPH = 3.5;

/** Which jog stage is due, from how many program jog sessions are already done. */
export function jogStage(jogSessionsDone: number): number {
  return Math.min(JOG_STAGES.length - 1, Math.floor(jogSessionsDone / 2));
}

/** The pre-fill: Day A is the warm-up plus the due jog stage; Day B is the warm-up plus an incline walk. */
export function plannedBlocks(day: 'A' | 'B', stage: number): TreadmillBlocks {
  const s = JOG_STAGES[stage]!;
  return {
    warm: { ...WARM_UP },
    jogs: day === 'A' ? s.jogs : 0,
    jog: { mins: s.jog, mph: JOG_MPH, incline: 1 },
    walkBreak: { mins: s.walk, mph: WALK_BREAK_MPH, incline: 1 },
    inclineWalk: { ...INCLINE_WALK, mins: day === 'A' ? 0 : INCLINE_WALK.mins },
  };
}

/** Walk breaks sit between jogs, so there is one fewer than the jogs. */
export function walkBreaks(b: TreadmillBlocks): number {
  return Math.max(0, b.jogs - 1);
}

export function blocksToSegs(b: TreadmillBlocks): Segment[] {
  const out: Segment[] = [];
  if (b.warm.mins > 0) out.push({ kind: 'walk', ...b.warm });
  if (b.jogs > 0 && b.jog.mins > 0) out.push({ kind: 'jog', ...b.jog, times: b.jogs });
  if (walkBreaks(b) > 0 && b.walkBreak.mins > 0) out.push({ kind: 'walk', ...b.walkBreak, times: walkBreaks(b) });
  if (b.inclineWalk.mins > 0) out.push({ kind: 'walk', ...b.inclineWalk });
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

/* ------------------------------------------------------------------ */
/* Norwegian 4x4 (owner, 2026-10-26)                                   */
/* ------------------------------------------------------------------ */

/**
 * Hard day: the real 4x4 (Helgerud et al. 2007), 4 blocks of 4 minutes at 85 to 95% of max
 * heart rate with a 3 minute recovery walk between them. Until the owner can jog 4 minutes,
 * each block mixes jogging and brisk walking; the walking shrinks stage by stage until it
 * is a full jog, then speed rises. The incline is set once for the main set (4% hard, 1%
 * easy) so only the speed changes mid-block (owner, 2026-10-26). Easy day: 3 blocks, one
 * stage easier but never below stage 1, so every session jogs. Hard falls on bench Day B,
 * easy on Day A, so each training day carries one hard thing.
 */
export type FourKind = 'hard' | 'easy';

/** What a 4x4 session recorded, stored on the treadmill set. */
export interface FourLog {
  kind: FourKind;
  stage: number;
  blocks: number;
  of: number;
  avgHr?: number;
  peakHr?: number;
}

/** Inside each 4 minute block, by stage (0 based). Stage 3 is the full 4 minute jog. */
const FOUR_BLOCKS: Array<Array<{ kind: 'jog' | 'walk'; mins: number }>> = [
  [{ kind: 'jog', mins: 1 }, { kind: 'walk', mins: 1 }, { kind: 'jog', mins: 1 }, { kind: 'walk', mins: 1 }],
  [{ kind: 'jog', mins: 2 }, { kind: 'walk', mins: 1 }, { kind: 'jog', mins: 1 }],
  [{ kind: 'jog', mins: 3 }, { kind: 'walk', mins: 1 }],
  [{ kind: 'jog', mins: 4 }],
];

export const FOUR = {
  warm: { mins: 5, mph: 2.5, incline: 4 },
  ramp: { mins: 5, mph: 3.5, incline: 4 },
  recoveryMins: 3,
  recoveryMph: 3.0,
  cool: { mins: 3, mph: 2.5, incline: 0 },
  /** The one incline for blocks and recoveries. */
  incline: { hard: 4, easy: 1 } as Record<'hard' | 'easy', number>,
  walkMph: 3.5,
  baseMph: 4.5,
  /** Each stage past the full 4 minute jog adds this much speed. */
  stepMph: 0.2,
  hardBlocks: 4,
  easyBlocks: 3,
} as const;

/** Max heart rate estimate (Nes et al. 2013, HUNT): 211 - 0.64 x age. */
export function maxHr(age: number): number {
  return Math.round(211 - 0.64 * age);
}

export function hrZone(age: number, lo: number, hi: number): [number, number] {
  const m = maxHr(age);
  return [Math.round(m * lo), Math.round(m * hi)];
}

/** The owner's age (2026-10-26), for the heart-rate zones. */
export const AGE = 38;

/** Jog speed for a stage: the base until the full 4 minute jog, then +0.2 mph a stage. */
export function fourMph(stage: number): number {
  const last = FOUR_BLOCKS.length - 1;
  return Math.round((FOUR.baseMph + Math.max(0, stage - last) * FOUR.stepMph) * 10) / 10;
}

/** Plain-English text for a block, e.g. "jog 2 · walk 1 · jog 1". */
export function fourBlockText(stage: number): string {
  return FOUR_BLOCKS[Math.min(stage, FOUR_BLOCKS.length - 1)]!.map((g) => `${g.kind} ${g.mins}`).join(' · ');
}

/** The stage a session runs: hard is the current stage, easy is one below, never below stage 1. */
export function fourSessionStage(kind: FourKind, stage: number): number {
  return kind === 'hard' ? stage : Math.max(0, stage - 1);
}

/** One timed step of a session, as the treadmill screen walks through it. */
export interface FourStep {
  /** where in the session, e.g. "Block 2 of 4" */
  where: string;
  /** jog or walk inside a block; easy for warm-up, recovery and cool-down */
  tone: 'jog' | 'walk' | 'easy';
  kind: 'jog' | 'walk';
  mins: number;
  mph: number;
  incline: number;
  /** block index (0 based) for steps inside a block */
  block?: number;
  /** minute within the block where this step starts */
  from?: number;
  /** seconds from the session start */
  start: number;
}

/** The whole session in order. `blocks` caps how many blocks are included (for logging). */
export function fourSteps(kind: FourKind, stage: number, opts: { jogMph?: number; incline?: number; blocks?: number } = {}): FourStep[] {
  const run = fourSessionStage(kind, stage);
  const mph = opts.jogMph ?? fourMph(run);
  const inc = opts.incline ?? FOUR.incline[kind];
  const of = kind === 'hard' ? FOUR.hardBlocks : FOUR.easyBlocks;
  const n = Math.min(of, opts.blocks ?? of);
  const out: Array<Omit<FourStep, 'start'>> = [{ where: 'Warm-up', tone: 'easy', kind: 'walk', ...FOUR.warm }];
  if (kind === 'hard') out.push({ where: 'Warm-up, part 2', tone: 'easy', kind: 'walk', ...FOUR.ramp });
  const parts = FOUR_BLOCKS[Math.min(run, FOUR_BLOCKS.length - 1)]!;
  for (let b = 0; b < n; b++) {
    if (b > 0) out.push({ where: `Recovery ${b} of ${of - 1}`, tone: 'easy', kind: 'walk', mins: FOUR.recoveryMins, mph: FOUR.recoveryMph, incline: inc });
    let minute = 0;
    for (const p of parts) {
      out.push({ where: `Block ${b + 1} of ${of}`, tone: p.kind, kind: p.kind, mins: p.mins, mph: p.kind === 'jog' ? mph : FOUR.walkMph, incline: inc, block: b, from: minute });
      minute += p.mins;
    }
  }
  out.push({ where: 'Cool-down', tone: 'easy', kind: 'walk', ...FOUR.cool });
  let at = 0;
  return out.map((s) => {
    const step = { ...s, start: at };
    at += s.mins * 60;
    return step;
  });
}

/** Segments for a session with `blocks` of its blocks finished. */
export function fourSegs(kind: FourKind, stage: number, blocks: number, jogMph?: number, incline?: number): Segment[] {
  return fourSteps(kind, stage, { jogMph, incline, blocks }).map((s) => ({ kind: s.kind, mins: s.mins, mph: s.mph, incline: s.incline }));
}

/** Blocks whose every step ends at or before `elapsed` seconds. */
export function blocksDoneAt(steps: readonly FourStep[], elapsed: number): number {
  const ends = new Map<number, number>();
  for (const s of steps) if (s.block != null) ends.set(s.block, s.start + s.mins * 60);
  let n = 0;
  for (const end of ends.values()) if (elapsed >= end) n++;
  return n;
}

/** Index of the step running at `elapsed` seconds (the last one once the session is over). */
export function stepAt(steps: readonly FourStep[], elapsed: number): number {
  const i = steps.findIndex((s) => elapsed < s.start + s.mins * 60);
  return i < 0 ? steps.length - 1 : i;
}

/**
 * The current 4x4 stage, from the hard days logged before `date`: two hard days with every
 * block finished at a stage move it up one. A short hard day repeats the stage.
 */
export function fourStage(state: WorkoutState, date: string): number {
  let stage = 0;
  let clean = 0;
  for (const d of Object.keys(state.days ?? {}).sort()) {
    if (d < PROGRAM_FROM || d >= date) continue;
    for (const s of state.days[d] ?? []) {
      const f = s.ex === 'Treadmill' ? s.fx : undefined;
      if (!f || f.kind !== 'hard' || f.stage !== stage) continue;
      if (f.blocks >= f.of) clean++;
      if (clean >= 2) {
        stage++;
        clean = 0;
      }
    }
  }
  return stage;
}
