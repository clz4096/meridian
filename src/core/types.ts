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

export interface KnowledgeState {
  mastery: Record<string, Mastery>;
  srs: Record<string, SrsEntry>;
  log: Array<{ id: EntityId; qid: string; at: Millis; rating: Mastery }>;
  /** "topic|c|3" -> watched/read */
  gymDone: Record<string, boolean>;
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
  /** true when the last top set hit REP_HI and the weight goes up */
  bumped: boolean;
  /** true when a deload was requested for this session */
  deload: boolean;
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
  /** rep count at which the top set earns a weight increase */
  repHigh: number;
  /** reps prescribed immediately after a weight bump */
  repsAfterBump: number;
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
}
