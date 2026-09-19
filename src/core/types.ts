/**
 * Meridian — canonical state type definitions.
 *
 * Extracted from the single-file app as step 1 of the strangler-fig migration.
 * These types close the implicit-coercion holes found in the architecture audit:
 *
 *  - `EntityId` is a branded string. Legacy records hold numeric ids, so every
 *    comparison must go through `toId()` / `sameId()` rather than `===`.
 *  - Numeric fields that were previously coerced with `+x || 0` are typed as
 *    `Numeric` (number | string) at the boundary and normalised by `toNum()`.
 *  - Every collection that supports deletion carries a `Tombstones` map so a
 *    removal can propagate across devices instead of resurrecting on merge.
 */

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** ISO calendar date, `YYYY-MM-DD`. Lexicographic order === chronological order. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

/** Record identifier. Always compared as a string — legacy rows stored numbers. */
export type EntityId = string & { readonly __brand: 'EntityId' };

/** A value that may arrive from storage or an <input> as either type. */
export type Numeric = number | string;

/** Epoch milliseconds. */
export type Millis = number;

/** id -> deletion timestamp. Bounded by `pruneTombstones`. */
export type Tombstones = Record<string, Millis>;

/* ------------------------------------------------------------------ */
/* Workout store (localStorage key: overload-tracker-state)            */
/* ------------------------------------------------------------------ */

export type SetType = 'warm' | 'top' | 'back' | 'cardio';

export type Muscle =
  | 'chest' | 'back' | 'biceps' | 'triceps' | 'shoulders' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'hips'
  | 'cardio' | '';

export interface WorkoutSet {
  id: EntityId;
  ex: string;
  type: SetType;
  weight: Numeric;
  reps: Numeric;
  /** Cardio only: duration in minutes. Cardio isn't weight×reps — it logs time/distance. */
  mins?: Numeric;
  /** Cardio only: distance in miles. */
  dist?: Numeric;
  muscle?: Muscle;
  /** Free-text gym/session label, e.g. "Life Time — Lower". */
  group?: string;
}

export interface WorkoutSettings {
  bwCurrent?: Numeric;
  bwGoal?: Numeric;
  benchStart?: Numeric;
  benchGoal?: Numeric;
  volLow?: Numeric;
  volHigh?: Numeric;
  /** Sunday is a rest day by default; when true it becomes a full-body day. */
  sundayFullBody?: boolean;
}

export interface WorkoutState {
  settings: WorkoutSettings;
  /** date -> sets performed that day */
  days: Record<string, WorkoutSet[]>;
  /** date -> bodyweight reading */
  bw: Record<string, Numeric>;
  /** date -> RPE reading */
  rpe: Record<string, Numeric>;
  /** date -> exercises explicitly ticked complete */
  done: Record<string, string[]>;
  /** date -> exercises explicitly RE-opened, overriding derived (full-set) completion */
  reopened?: Record<string, string[]>;
  /** date -> whole session marked complete */
  sessionDone: Record<string, boolean>;
  /** exercise -> smallest weight step available on that machine */
  incr: Record<string, Numeric>;
  _del?: Tombstones;
}

/* ------------------------------------------------------------------ */
/* Meal store (surplus-tracker-state)                                  */
/* ------------------------------------------------------------------ */

export interface Meal {
  id: EntityId;
  name: string;
  cal: Numeric;
  protein: Numeric;
  /** true when the macros came from the AI estimator rather than a label */
  est?: boolean;
}

export interface MealSettings {
  current?: Numeric;
  goal?: Numeric;
  maintenance?: Numeric;
  surplus?: Numeric;
  proteinTarget?: Numeric;
}

export interface MealState {
  settings: MealSettings;
  days: Record<string, Meal[]>;
  /** date -> dose count */
  tad: Record<string, Numeric>;
  _del?: Tombstones;
}

/* ------------------------------------------------------------------ */
/* Schedule / entries store (meridian-core)                            */
/* ------------------------------------------------------------------ */

export interface ScheduleItem {
  id: EntityId;
  label: string;
  start?: string;
  end?: string;
  done?: boolean;
}

export interface LogEntry {
  id: EntityId;
  date: string;
  stream: string;
  source?: string;
  xp?: Numeric;
}

/** A personal reminder. Lives in the core store (nested, not a separate store). */
export interface TodoItem {
  id: EntityId;
  text: string;
  done: boolean;
  /** Optional due date, "YYYY-MM-DD" (local). Items due today or overdue surface on Today. */
  due?: string;
  created: Millis;
}

/** Where a scratchpad idea is in its lifecycle. */
export type ScratchStatus = 'idea' | 'trying' | 'shipped' | 'parked';

/** A brainstorm/idea card. Lives in the core store (nested). */
export interface ScratchCard {
  id: EntityId;
  title: string;
  body: string;
  status: ScratchStatus;
  created: Millis;
  updated: Millis;
}

export interface CoreState {
  schedule: Record<string, ScheduleItem[]>;
  entries: LogEntry[];
  /** Personal todos (nested here rather than a dedicated sync store). */
  todos?: TodoItem[];
  /** Scratchpad idea cards (nested here rather than a dedicated sync store). */
  scratch?: ScratchCard[];
  _del?: Tombstones;
}

/* ------------------------------------------------------------------ */
/* Knowledge store (csgraph_profile_v2)                                */
/* ------------------------------------------------------------------ */

/** Self-rated recall quality, SM-2 style. */
export type Mastery = 1 | 2 | 3 | 4 | 5;

export interface SrsEntry {
  /** next review date */
  due: string;
  /** interval in days */
  ivl: number;
  ease: number;
  /** successful repetitions */
  n: number;
}

/** Persisted shape of a question card (mirrors the feature-layer KnowledgeItem). */
export interface KnowledgeItemLike {
  id: string;
  prompt: string;
  reveal: string;
  mins: number;
  flow: 'flip' | 'full';
  src: { book: string; ref: string; page?: number; anchor?: string; title?: string; url?: string };
  tags?: string[];
  ai?: boolean;
}

export interface KnowledgeState {
  mastery: Record<string, Mastery>;
  srs: Record<string, SrsEntry>;
  log: Array<{ id: EntityId; qid: string; at: Millis; rating: Mastery }>;
  /** "topic|c|3" -> watched/read */
  gymDone: Record<string, boolean>;
  /** AI-generated cards, kept in their own pool (topic id -> cards) — never mixed
   *  into the curated static bank. Studyable + fed into FSRS/mastery like any card. */
  generated?: Record<string, KnowledgeItemLike[]>;
  /** Grow-only tombstone of discarded generated-card ids, so a discard sticks across a
   *  sync merge (knowledge has no per-id tombstones otherwise) instead of resurrecting. */
  genDiscarded?: string[];
  /**
   * Monotonic "reset epoch". Knowledge has no per-id tombstones, so a reset
   * bumps this to `Date.now()` and empties the store; the merge discards any
   * side whose epoch is older than the newest one, letting a reset PROPAGATE
   * and stick across devices instead of being union-resurrected. Absent/0 for
   * a store that has never been reset.
   */
  resetAt?: Millis;
}

/* ------------------------------------------------------------------ */
/* Study Tracker store (localStorage key: meridian-theorist)           */
/* ------------------------------------------------------------------ */

/**
 * The synced backing store for the Study Tracker ("The Princeton Theorist").
 *
 * The feature layer (trackerStore) still speaks the legacy
 * `{ cumXP, logged, day }` shape; this is the CRDT-friendly projection it
 * persists through. Like {@link KnowledgeState} it has no per-id tombstones, so
 * a global reset bumps `resetAt` and empties the store to make the wipe stick
 * across devices.
 *
 * Derivations used by the trackerStore projection:
 *  - `cumXP`  = sum of `banked` values.
 *  - `logged` = keys of `banked` that are real ISO dates (excludes "__carry").
 *  - streak   = derived from `logged`.
 */
export interface TheoristState {
  /** ISO date (or the reserved "__carry") -> XP banked that day. */
  banked: Record<string, number>;
  /**
   * Today's in-progress scorecard. Post-Phase-2, `blocks` are 0-XP
   * hygiene/timeline ticks (the day's shape); `scores` is the graded day-log
   * that drives XP AND the meters. Two ADDITIVE optional fields:
   *  - `events`: per-day economy credits by event id (wired in Phase 3;
   *    absent ⇒ contributes 0). Merged per-key `max`, absent-safe.
   *  - `dayType`: whether today is a `'full'` or `'light'` day. Merged LWW by
   *    `dayTouchedAt`; on a tie prefer `'light'` (deterministic ⇒ commutative).
   * Both ride with the winning `day` when the two sides carry different dates.
   */
  day: {
    date: string;
    blocks: Record<string, boolean>;
    scores: Record<string, number>;
    banked: boolean;
    events?: Record<string, number>;
    dayType?: 'full' | 'light';
  };
  /** LWW tiebreak for `day` when the two sides carry different dates. */
  dayTouchedAt?: Millis;
  /**
   * Per-topic decaying mastery (Phase 3), keyed by curriculum code. TOP-LEVEL —
   * mastery persists across days, unlike `day`. `level` is the mastery at the
   * moment of `reviewedAt` (epoch ms), clamped to [0,1]; the *current* value is
   * `level * 0.5 ** ((now - reviewedAt)/HALF_LIFE)` (FSRS-style decay). Merged
   * per-topic LWW by the LARGER `reviewedAt` (level rides with the newest
   * review; a `reviewedAt` tie takes the larger `level`, deterministic ⇒
   * commutative). Absent-safe; a `resetAt` wipe clears it (EMPTY carries none).
   */
  mastery?: Record<string, { level: number; reviewedAt: Millis }>;
  /** Monotonic reset epoch (mirrors {@link KnowledgeState.resetAt}). */
  resetAt?: Millis;
}

/* ------------------------------------------------------------------ */
/* Derived shapes returned by the selectors                            */
/* ------------------------------------------------------------------ */

export type Split = 'upper' | 'lower' | 'both' | 'other';

export interface PrescribedSet {
  weight: number;
  reps: number;
}

export interface ExercisePlan {
  exercise: string;
  cardio: boolean;
  warms: PrescribedSet[];
  top: PrescribedSet;
  backs: PrescribedSet[];
  /** true when the last top set hit the rep ceiling and the weight goes up */
  bumped: boolean;
  /** true when a deload applies (user-requested, or auto after a stall) */
  deload: boolean;
  /** true when this deload was triggered automatically (a strength stall or a layoff) */
  autoDeload: boolean;
  /** rep ceiling for this exercise's class (compound vs isolation) */
  repHigh: number;
  /** reps to hit at `top.weight` to earn the next bump (double-progression goal) */
  targetReps: number;
  /**
   * True when the load already sits below one increment, so a deload cannot
   * lower it further without prescribing zero. In this case `top.weight`
   * intentionally holds at `lastTopWeight` and is NOT snapped to `incr`.
   */
  atMinimum: boolean;
  /** smallest weight step for this exercise */
  incr: number;
  lastTopWeight: number;
  lastTopReps: number;
  lastDate: string | null;
}

export interface SessionEstimate {
  minutes: number;
  workingSets: number;
}

export interface SplitSuggestion {
  due: Split;
  /** what was actually performed on the reference date, if anything */
  last: Split | null;
  lastDate: string | null;
  /** true when the requested date itself already has lifting logged */
  logged: boolean;
}

export interface ExerciseTrend {
  exercise: string;
  first: number;
  latest: number;
  delta: number;
}

export interface WorkoutViewModel {
  date: string;
  isPast: boolean;
  split: Split | 'all';
  suggestion: SplitSuggestion;
  exercises: string[];
  plans: Record<string, ExercisePlan | null>;
  /** sets actually logged on `date`, per exercise */
  performed: Record<string, WorkoutSet[]>;
  completed: Record<string, boolean>;
  sessionComplete: boolean;
  estimate: SessionEstimate;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export interface ProgressionConfig {
  /** rep count at which the top set earns a weight increase (fallback / cardio) */
  repHigh: number;
  /** reps prescribed immediately after a weight bump (fallback) */
  repsAfterBump: number;
  /** strength rep ceiling + reset for big compound lifts (bench, row, leg press) */
  repHighCompound: number;
  repsAfterBumpCompound: number;
  /** hypertrophy rep ceiling + reset for isolation lifts (curls, extensions, …) */
  repHighIsolation: number;
  repsAfterBumpIsolation: number;
  /** consecutive sessions without an estimated-1RM improvement before an auto-deload */
  stallSessions: number;
  /** per-lift gap (days) beyond which a long layoff triggers a single deload off best */
  gapRepeatDays: number;
  gapDeloadDays: number;
  /**
   * Reserved (unused by buildPlan). The graduated mild-layoff deload was removed:
   * moderate gaps no longer suppress a bump, so there is no longer a "mild" tier.
   */
  layoffMildFactor: number;
  /** sessions the best-recent recovery anchor looks back over (double-progression cap) */
  recoveryWindow: number;
  /** per-exercise e1RM ratio (actual/prescribed) thresholds for the day's effort grade */
  effortStrong: number;
  effortModerate: number;
  /** working-set-weighted mean thresholds mapping a session to Strong / Weak */
  sessionStrong: number;
  sessionWeak: number;
  /** multiplier applied when the user flags a deload */
  deloadFactor: number;
  defaultIncrement: number;
  /** seconds of work assumed per set when estimating session length */
  secondsPerSet: number;
  cardioSeconds: number;
  restWarm: number;
  restTopCompound: number;
  restTopIsolation: number;
  restBackCompound: number;
  restBackIsolation: number;
  compoundMuscles: readonly Muscle[];
  lowerMuscles: readonly Muscle[];
  upperMuscles: readonly Muscle[];
  /** how many recent sessions define the "typical" set template */
  templateWindow: number;
  /** tombstones older than this are dropped */
  tombstoneMaxAgeDays: number;
  /** hard ceiling on retained tombstones, oldest evicted first */
  tombstoneMaxCount: number;
}

export const DEFAULT_CONFIG: ProgressionConfig = {
  repHigh: 8,
  repsAfterBump: 6,
  repHighCompound: 6,
  repsAfterBumpCompound: 3,
  repHighIsolation: 12,
  repsAfterBumpIsolation: 8,
  stallSessions: 3,
  gapRepeatDays: 4,
  gapDeloadDays: 7,
  layoffMildFactor: 0.95,
  recoveryWindow: 8,
  effortStrong: 1.0,
  effortModerate: 0.95,
  sessionStrong: 0.85,
  sessionWeak: 0.5,
  deloadFactor: 0.9,
  defaultIncrement: 5,
  secondsPerSet: 40,
  cardioSeconds: 15 * 60,
  restWarm: 60,
  restTopCompound: 180,
  restTopIsolation: 120,
  restBackCompound: 120,
  restBackIsolation: 90,
  compoundMuscles: ['chest', 'back', 'quads', 'hamstrings', 'glutes'],
  lowerMuscles: ['quads', 'hamstrings', 'glutes', 'calves', 'hips'],
  upperMuscles: ['chest', 'back', 'biceps', 'triceps', 'shoulders', 'forearms'],
  templateWindow: 6,
  tombstoneMaxAgeDays: 30,
  tombstoneMaxCount: 500,
};

/** Session-scoped flags the UI owns; passed in so selectors stay pure. */
export interface SessionOverrides {
  /** exercises the user flagged as "feel weak" for this session only */
  deload?: Record<string, boolean>;
  /** split the user manually selected, overriding the suggestion */
  split?: Split | 'all';
  /**
   * Away (home) mode: each machine lift's slot is driven by its dumbbell
   * substitute. `swap` maps gym exercise → sub name; `start` holds each sub's
   * approved starting prescription, used to seed a plan the first time the sub
   * is trained (before it has any logged history of its own).
   */
  away?: {
    swap: Record<string, string>;
    start: Record<string, { weight: number; reps: number; muscle?: string }>;
  };
}
