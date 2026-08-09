/**
 * Meridian — pure workout selectors.
 *
 * Every function here takes state in and returns plain data out. There is no
 * `document`, no `innerHTML`, no `Date.now()`, and no module-level mutable
 * state, so each one is deterministic and property-testable in isolation.
 *
 * "Today" is always an explicit parameter. Callers pass it; selectors never
 * read the clock. That is what makes date-dependent behaviour (past-session
 * review, split alternation, weekly volume) reproducible under fast-check.
 */

import {
  DEFAULT_CONFIG,
  type ExercisePlan,
  type ExerciseTrend,
  type Muscle,
  type PrescribedSet,
  type ProgressionConfig,
  type SessionEstimate,
  type SessionOverrides,
  type SetType,
  type Split,
  type SplitSuggestion,
  type WorkoutSet,
  type WorkoutState,
  type WorkoutViewModel,
} from '@/core/types';
import { shiftDate, toId, toNum, tombstoneIds } from '@/core/util';
import defaultWorkoutData from '@/core/data/defaultWorkout.json';

/* ================================================================== */
/* Coercion helpers — the audit found `+x || 0` silently zeroing typos */
/* ================================================================== */

/** Round to an arbitrary step (plate or stack increment), never to a hardcoded 5. */
export function roundTo(value: number, step: number): number {
  const s = step > 0 ? step : DEFAULT_CONFIG.defaultIncrement;
  return Math.round(value / s) * s;
}

/**
 * Round DOWN to the step. Used for deloads, which must never round up.
 *
 * Nearest-rounding could push a deload above the previous working weight
 * (a 2.78 lb load on an inferred 5 lb step rounds 2.5 up to 5), which then
 * had to be clamped back to a value that no longer sat on the increment.
 */
export function roundDownTo(value: number, step: number): number {
  const s = step > 0 ? step : DEFAULT_CONFIG.defaultIncrement;
  return Math.floor(value / s) * s;
}

/* ================================================================== */
/* Primitive lookups over WorkoutState                                 */
/* ================================================================== */

/** All dates holding at least one set, ascending. */
export function sortedDates(state: WorkoutState): string[] {
  return Object.keys(state.days ?? {}).sort();
}

/** Sets logged for `exercise` on `date`, tombstoned rows excluded. */
export function setsOn(state: WorkoutState, exercise: string, date: string): WorkoutSet[] {
  const dead = tombstoneIds(state);
  return (state.days?.[date] ?? []).filter(
    (s) => s.ex === exercise && !dead.has(toId(s.id)),
  );
}

/** Dates on which `exercise` was performed, ascending. */
export function exerciseDates(state: WorkoutState, exercise: string): string[] {
  return sortedDates(state).filter((d) => setsOn(state, exercise, d).length > 0);
}

export function topSetOf(sets: readonly WorkoutSet[]): WorkoutSet | null {
  return sets.find((s) => s.type === 'top') ?? null;
}

/** The most recent session for `exercise` strictly before `before`. */
export function lastSession(
  state: WorkoutState,
  exercise: string,
  before: string,
): { date: string; sets: WorkoutSet[] } | null {
  const dates = exerciseDates(state, exercise).filter((d) => d < before);
  if (dates.length === 0) return null;
  const date = dates[dates.length - 1];
  return { date, sets: setsOn(state, exercise, date) };
}

/**
 * Muscle/group metadata for an exercise, taken from its most recent set.
 *
 * Returns `null` muscle when unknown, so callers must decide explicitly.
 * The original returned `''`, which silently fell through to the isolation
 * branch of `restSeconds` for any manually-added exercise.
 */
export function exerciseMeta(
  state: WorkoutState,
  exercise: string,
): { muscle: Muscle | null; group: string | null } {
  const dates = exerciseDates(state, exercise);
  for (let i = dates.length - 1; i >= 0; i--) {
    const set = setsOn(state, exercise, dates[i])[0];
    if (set) return { muscle: set.muscle ?? null, group: set.group ?? null };
  }
  return { muscle: null, group: null };
}

export function isCardio(state: WorkoutState, exercise: string): boolean {
  if (exerciseMeta(state, exercise).muscle === 'cardio') return true;
  return sortedDates(state).some((d) =>
    setsOn(state, exercise, d).some((s) => s.type === 'cardio'),
  );
}

/** Every exercise ever logged, most-recently-performed first. */
export function allExercises(state: WorkoutState): string[] {
  const latest = new Map<string, string>();
  for (const date of sortedDates(state)) {
    const dead = tombstoneIds(state);
    for (const set of state.days[date] ?? []) {
      if (dead.has(toId(set.id))) continue;
      const seen = latest.get(set.ex);
      if (!seen || date > seen) latest.set(set.ex, date);
    }
  }
  return [...latest.keys()].sort((a, b) =>
    (latest.get(b) ?? '') < (latest.get(a) ?? '') ? -1 : 1,
  );
}

/** Distinct exercises logged on one date, in prescribed execution order. */
export function loggedExercises(
  state: WorkoutState,
  date: string,
  order: Record<string, number> = EXERCISE_ORDER,
): string[] {
  const dead = tombstoneIds(state);
  const seen: string[] = [];
  for (const set of state.days?.[date] ?? []) {
    if (dead.has(toId(set.id))) continue;
    if (!seen.includes(set.ex)) seen.push(set.ex);
  }
  return seen.sort(
    (a, b) => exerciseOrder(state, a, order) - exerciseOrder(state, b, order),
  );
}

/* ================================================================== */
/* Progression                                                         */
/* ================================================================== */

/**
 * Smallest usable weight step for an exercise.
 *
 * User override wins; otherwise infer the most common positive jump between
 * consecutive top sets. Falls back to the configured default.
 */
export function inferIncrement(
  state: WorkoutState,
  exercise: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): number {
  const override = state.incr?.[exercise];
  if (override !== undefined && toNum(override, 0) > 0) return toNum(override);

  const tops: number[] = [];
  for (const date of exerciseDates(state, exercise)) {
    const top = topSetOf(setsOn(state, exercise, date));
    if (top) tops.push(toNum(top.weight));
  }
  const counts = new Map<number, number>();
  for (let i = 1; i < tops.length; i++) {
    const delta = tops[i] - tops[i - 1];
    if (delta > 0) counts.set(delta, (counts.get(delta) ?? 0) + 1);
  }
  let best = config.defaultIncrement;
  let bestCount = 0;
  for (const [delta, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = delta;
    }
  }
  return best > 0 ? best : config.defaultIncrement;
}

/**
 * The exercise's typical set structure, derived from recent sessions.
 *
 * Uses the modal warm-up/back-off counts across the last N sessions so one
 * rushed day cannot permanently drop sets from the prescription, and averages
 * each slot's ratio to the top set so the shape scales with the weight.
 */
export function setTemplate(
  state: WorkoutState,
  exercise: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): { warms: Array<{ ratio: number; reps: number }>; backs: Array<{ ratio: number; reps: number }> } | null {
  const sessions = exerciseDates(state, exercise)
    .map((date) => ({ date, sets: setsOn(state, exercise, date) }))
    .filter((s) => topSetOf(s.sets) !== null)
    .slice(-config.templateWindow);
  if (sessions.length === 0) return null;

  const modeOf = (counts: Map<number, number>): number => {
    let best = 0;
    let bestCount = -1;
    for (const [value, count] of counts) {
      if (count > bestCount || (count === bestCount && value > best)) {
        bestCount = count;
        best = value;
      }
    }
    return best;
  };
  const countsFor = (type: SetType): Map<number, number> => {
    const m = new Map<number, number>();
    for (const s of sessions) {
      const n = s.sets.filter((x) => x.type === type).length;
      m.set(n, (m.get(n) ?? 0) + 1);
    }
    return m;
  };

  const slotAt = (type: SetType, index: number): { ratio: number; reps: number } | null => {
    let sum = 0;
    let n = 0;
    let reps = 0;
    for (const s of sessions) {
      const top = topSetOf(s.sets);
      const arr = s.sets.filter((x) => x.type === type);
      const set = arr[index];
      if (set && top) {
        const topWeight = toNum(top.weight, 1) || 1;
        sum += toNum(set.weight) / topWeight;
        reps = toNum(set.reps);
        n++;
      }
    }
    return n > 0 ? { ratio: sum / n, reps } : null;
  };

  const warms: Array<{ ratio: number; reps: number }> = [];
  const backs: Array<{ ratio: number; reps: number }> = [];
  for (let i = 0; i < modeOf(countsFor('warm')); i++) {
    const slot = slotAt('warm', i);
    if (slot) warms.push(slot);
  }
  for (let i = 0; i < modeOf(countsFor('back')); i++) {
    const slot = slotAt('back', i);
    if (slot) backs.push(slot);
  }
  return { warms, backs };
}

/**
 * Baseline set STRUCTURE per exercise, read once from the baked-in default
 * workout. `setTemplate` derives the warm/back COUNT from the modal of recent
 * sessions; a run of short (top-set-only) days can therefore erode a lift's
 * back-off sets to zero — and because `logSet` auto-completes an exercise once
 * `warms + 1 + backs` sets are in, that makes the exercise finish right after
 * the top set (the "missing sets" bug). We floor the prescribed warm/back
 * counts at this baseline so a lift never drops below the sets it was designed
 * for. Ratios are relative to the default top set, so they scale to any weight.
 * Only exercises present in the default are floored; anything else is untouched.
 */
type TemplateSlots = Array<{ ratio: number; reps: number }>;
const DEFAULT_TEMPLATES: Record<string, { warms: TemplateSlots; backs: TemplateSlots }> = (() => {
  const days =
    (defaultWorkoutData as { days?: Record<string, Array<{ ex: string; type: string; weight: number; reps: number }>> }).days ?? {};
  const sessionsByEx: Record<string, Array<Array<{ type: string; weight: number; reps: number }>>> = {};
  for (const date of Object.keys(days)) {
    const perEx: Record<string, Array<{ type: string; weight: number; reps: number }>> = {};
    for (const s of days[date]!) (perEx[s.ex] ??= []).push(s);
    for (const ex of Object.keys(perEx)) (sessionsByEx[ex] ??= []).push(perEx[ex]!);
  }
  const out: Record<string, { warms: TemplateSlots; backs: TemplateSlots }> = {};
  for (const ex of Object.keys(sessionsByEx)) {
    // The most complete default session defines the canonical structure.
    const session = sessionsByEx[ex]!.slice().sort((a, b) => b.length - a.length)[0]!;
    const top = session.find((s) => s.type === 'top');
    if (!top) continue;
    const tw = toNum(top.weight, 1) || 1;
    const slots = (type: string): TemplateSlots =>
      session.filter((s) => s.type === type).map((s) => ({ ratio: toNum(s.weight) / tw, reps: toNum(s.reps) }));
    out[ex] = { warms: slots('warm'), backs: slots('back') };
  }
  return out;
})();

/* ================================================================== */
/* Estimated 1RM, exercise class, effort & stalls                      */
/* ================================================================== */

/** Epley estimated one-rep max — the smoothed strength score. Non-positive input → 0. */
export function e1rm(weight: number, reps: number): number {
  const w = toNum(weight);
  const r = toNum(reps);
  if (w <= 0 || r <= 0) return 0;
  return w * (1 + r / 30);
}

/** True for multi-joint lifts (chest/back/quads/hamstrings/glutes) — they earn the strength ranges. */
export function isCompound(state: WorkoutState, exercise: string, config: ProgressionConfig = DEFAULT_CONFIG): boolean {
  const muscle = exerciseMeta(state, exercise).muscle;
  return muscle !== null && config.compoundMuscles.includes(muscle);
}

/** Rep count at which the top set earns a load increase, by exercise class. */
export function repCeiling(state: WorkoutState, exercise: string, config: ProgressionConfig = DEFAULT_CONFIG): number {
  if (isCardio(state, exercise)) return config.repHigh;
  return isCompound(state, exercise, config) ? config.repHighCompound : config.repHighIsolation;
}
function repsAfterBumpFor(state: WorkoutState, exercise: string, config: ProgressionConfig): number {
  if (isCardio(state, exercise)) return config.repsAfterBump;
  return isCompound(state, exercise, config) ? config.repsAfterBumpCompound : config.repsAfterBumpIsolation;
}

/** Top-set estimated-1RM for each session of `exercise`, ascending by date. */
export function e1rmHistory(state: WorkoutState, exercise: string): Array<{ date: string; e1rm: number }> {
  const out: Array<{ date: string; e1rm: number }> = [];
  for (const date of exerciseDates(state, exercise)) {
    const top = topSetOf(setsOn(state, exercise, date));
    if (top) out.push({ date, e1rm: e1rm(toNum(top.weight), toNum(top.reps)) });
  }
  return out;
}

/**
 * Has the lift's strength stalled on a flat plateau? True when, across the last
 * `stallSessions` transitions, the top-set e1RM made no net progress AND never
 * dropped. The "no drop" clause is what stops a deload spiral: once an auto-deload
 * lowers the load and the lifter obeys, that drop sits in the window and suppresses
 * further deloads until they have `stallSessions` fresh sessions to rebuild from.
 * Only sessions strictly before `before` count, so it stays date-navigable.
 */
export function isStalled(
  state: WorkoutState,
  exercise: string,
  before: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): boolean {
  const k = config.stallSessions;
  if (k <= 0) return false;
  const hist = e1rmHistory(state, exercise).filter((h) => h.date < before);
  if (hist.length <= k) return false; // not enough history to judge a stall
  const window = hist.slice(-(k + 1)).map((h) => h.e1rm);
  if (window[window.length - 1] > window[0] + 1e-9) return false; // net progress → not stalled
  for (let i = 1; i < window.length; i++) {
    if (window[i] < window[i - 1] - 1e-9) return false; // a drop → a deload already happened; rebuilding
  }
  return true; // flat plateau with no recent deload
}

/** Whole days between two ISO dates (UTC, DST-independent). */
function dayGap(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Days since the exercise was last performed strictly before `date` (null if never). */
export function daysSinceLast(state: WorkoutState, exercise: string, date: string): number | null {
  const prev = lastSession(state, exercise, date);
  return prev ? dayGap(prev.date, date) : null;
}

export type Effort = 'strong' | 'moderate' | 'weak';

/**
 * Grade a session — Strong / Moderate / Weak — from *this* session alone: where
 * each lift's top set landed inside its class rep range [reset … ceiling]. Hitting
 * the ceiling (ready to add load) scores strong; the bottom scores weak; the middle
 * is moderate. Working-set-weighted so compounds count for more. Absolute (no
 * comparison to prior sessions), so exactly repeating no longer reads as "strong".
 * Returns null when the date has no gradable lifting.
 */
export function sessionEffort(
  state: WorkoutState,
  date: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): Effort | null {
  let weighted = 0;
  let total = 0;
  for (const ex of loggedExercises(state, date)) {
    if (isCardio(state, ex)) continue;
    const top = topSetOf(setsOn(state, ex, date));
    if (!top) continue;
    const reps = toNum(top.reps);
    const ceiling = repCeiling(state, ex, config);
    const floor = repsAfterBumpFor(state, ex, config);
    const score = reps >= ceiling ? 1 : reps > floor ? 0.6 : 0.2;
    const w = setsOn(state, ex, date).length || 1;
    weighted += score * w;
    total += w;
  }
  if (total === 0) return null;
  const mean = weighted / total;
  return mean >= config.sessionStrong ? 'strong' : mean <= config.sessionWeak ? 'weak' : 'moderate';
}

/**
 * The prescription for one exercise on one date.
 *
 * Returns `null` when the exercise has no prior history (nothing to progress
 * from). The top set is the single progressing number: hit `repHigh` and the
 * weight advances by that exercise's increment, otherwise it holds.
 */
export function buildPlan(
  state: WorkoutState,
  exercise: string,
  date: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): ExercisePlan | null {
  const previous = lastSession(state, exercise, date);
  if (!previous) {
    // First time on an Away-mode home substitute: no logged history to progress
    // from, but an approved starting weight exists. Seed a full first session —
    // a top set plus three straight back-off sets at the same starting weight, so
    // it's a real 4-set workout (not one lonely set). Once the sub has real logged
    // sets, the normal path below runs and it progresses like any other lift.
    const seed = overrides.away?.start[exercise];
    if (!seed) return null;
    const step = inferIncrement(state, exercise, config);
    return {
      exercise,
      cardio: false,
      warms: [],
      top: { weight: seed.weight, reps: seed.reps },
      backs: [
        { weight: seed.weight, reps: seed.reps },
        { weight: seed.weight, reps: seed.reps },
        { weight: seed.weight, reps: seed.reps },
      ],
      bumped: false,
      deload: false,
      autoDeload: false,
      repHigh: repCeiling(state, exercise, config),
      atMinimum: false,
      incr: step,
      lastTopWeight: seed.weight,
      lastTopReps: seed.reps,
      lastDate: null,
    };
  }

  const repHigh = repCeiling(state, exercise, config);

  const top = topSetOf(previous.sets);
  if (!top) {
    return {
      exercise,
      cardio: true,
      warms: [],
      top: { weight: 0, reps: 0 },
      backs: [],
      bumped: false,
      deload: false,
      autoDeload: false,
      repHigh,
      atMinimum: false,
      incr: inferIncrement(state, exercise, config),
      lastTopWeight: 0,
      lastTopReps: 0,
      lastDate: previous.date,
    };
  }

  const lastWeight = toNum(top.weight, 1) || 1;
  const lastReps = toNum(top.reps);
  const step = inferIncrement(state, exercise, config);

  // Time off (per lift): a short layoff eases you back with a *mild* deload; a
  // longer one detrains more, so it takes the full deload. On a normal 3–4 day
  // split cadence neither fires — the thresholds sit just above it.
  const gap = daysSinceLast(state, exercise, date);
  const longLayoff = gap != null && gap > config.gapDeloadDays;
  const shortLayoff = gap != null && gap > config.gapRepeatDays && !longLayoff;

  let bumped = lastReps >= repHigh && !shortLayoff && !longLayoff;
  const stalled = !bumped && isStalled(state, exercise, date, config);
  // Auto-deload: a strength stall, or any layoff, backs the load off — but only
  // when the lift isn't already about to progress.
  const autoDeload = !bumped && (stalled || shortLayoff || longLayoff);
  const manual = overrides.deload?.[exercise] === true;
  const deload = manual || autoDeload;
  // A short layoff alone eases back mildly; a stall, a long layoff, or a manual
  // deload takes the full step.
  const factor = shortLayoff && !stalled && !manual ? config.layoffMildFactor : config.deloadFactor;

  let atMinimum = false;
  let weight = bumped ? roundTo(lastWeight + step, step) : lastWeight;
  let reps = bumped ? repsAfterBumpFor(state, exercise, config) : lastReps;

  if (deload) {
    // A deload must never out-prescribe the previous session. Applying the
    // factor to an already-bumped weight could exceed `lastWeight` whenever the
    // increment is large relative to the load (e.g. 5 lb top set on a 20 lb
    // stack), so deload always derives from `lastWeight` and is clamped.
    bumped = false;
    const target = roundDownTo(lastWeight * factor, step);
    // target is now guaranteed <= lastWeight and on the increment.
    weight = target > 0 ? target : lastWeight;
    atMinimum = target <= 0;   // load is already below one increment
    reps = Math.max(5, Math.min(lastReps, repHigh - 2));
  }

  const template = setTemplate(state, exercise, config);
  const base = DEFAULT_TEMPLATES[exercise];
  // Floor the BACK-OFF count at the lift's baked-in default. `setTemplate` takes
  // the modal back-off count over recent sessions, so a run of short (top-set-
  // only) days erodes it to zero — and since `logSet` auto-completes an exercise
  // once `warms + 1 + backs` sets are in, the lift then finishes right after the
  // top set (the reported "missing sets" bug). History may still ADD back-off
  // sets; it just can't drop below the designed count. Warm-ups are left to
  // history (skipping them is legitimate and never triggers auto-complete).
  const backSlots = (template?.backs.length ?? 0) >= (base?.backs.length ?? 0) ? template?.backs ?? [] : base!.backs;
  const scale = (slots: Array<{ ratio: number; reps: number }>): PrescribedSet[] =>
    slots.map((s) => ({ weight: roundTo(s.ratio * weight, step), reps: s.reps }));

  return {
    exercise,
    cardio: false,
    warms: scale(template?.warms ?? []),
    top: { weight, reps },
    backs: scale(backSlots),
    bumped,
    deload,
    autoDeload,
    repHigh,
    atMinimum,
    incr: step,
    lastTopWeight: lastWeight,
    lastTopReps: lastReps,
    lastDate: previous.date,
  };
}

/** How many sets the plan prescribes — drives the auto-complete checkbox. */
export function plannedSetCount(
  state: WorkoutState,
  exercise: string,
  date: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): number {
  if (isCardio(state, exercise)) return 1;
  const plan = buildPlan(state, exercise, date, overrides, config);
  if (!plan || plan.cardio) return 1;
  return plan.warms.length + 1 + plan.backs.length;
}

/* ================================================================== */
/* Rest and session length                                             */
/* ================================================================== */

/**
 * Prescribed rest for a set.
 *
 * Heavy compounds need fuller phosphocreatine recovery than isolation work.
 * An exercise with unknown metadata is treated as isolation, but the caller
 * can detect that case via `exerciseMeta(...).muscle === null`.
 */
export function restSeconds(
  state: WorkoutState,
  exercise: string,
  type: SetType,
  config: ProgressionConfig = DEFAULT_CONFIG,
): number {
  const muscle = exerciseMeta(state, exercise).muscle;
  const compound = muscle !== null && config.compoundMuscles.includes(muscle);
  if (type === 'warm') return config.restWarm;
  if (type === 'top') return compound ? config.restTopCompound : config.restTopIsolation;
  return compound ? config.restBackCompound : config.restBackIsolation;
}

/** Estimated wall-clock length of a session, from planned sets plus rest. */
export function estimateSession(
  state: WorkoutState,
  exercises: readonly string[],
  date: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): SessionEstimate {
  let seconds = 0;
  let workingSets = 0;

  for (const exercise of exercises) {
    if (isCardio(state, exercise)) {
      seconds += config.cardioSeconds;
      continue;
    }
    const plan = buildPlan(state, exercise, date, overrides, config);
    if (!plan || plan.cardio) continue;

    const types: SetType[] = [
      ...plan.warms.map((): SetType => 'warm'),
      'top',
      ...plan.backs.map((): SetType => 'back'),
    ];
    for (const type of types) {
      workingSets++;
      seconds += config.secondsPerSet + restSeconds(state, exercise, type, config);
    }
  }
  return { minutes: Math.round(seconds / 60), workingSets };
}

/* ================================================================== */
/* Splits                                                              */
/* ================================================================== */

/** Canonical execution order: compounds first, grip last, cardio after lifting. */
export const EXERCISE_ORDER: Record<string, number> = {
  'Bench Press': 10,
  'Leg Press': 10,
  'Lat Pulldown': 20,
  'Leg Extension': 30,
  'Hip Abduction': 34,
  'Hip Adduction': 36,
  'Tricep Pushdown (Rope)': 40,
  'Bicep Curl (Dumbbell)': 50,
  'Bicep Curl (Pulley)': 52,
  'Hammer Curl (Dumbbell)': 54,
  'Calf Raise (Machine)': 60,
  'Wrist Curl (Dumbbell)': 80,
  'Reverse Wrist Curl (Dumbbell)': 82,
  Treadmill: 90,
};

/**
 * Static per-exercise metadata that is NOT derivable from logged sets.
 *
 * Muscle/group come off the sets themselves (see `exerciseMeta`); this table is
 * the home for exercise-identity facts the log can't tell us. Today that is just
 * `optional` — accessory/grip work that shouldn't count toward strength grading.
 */
export interface ExerciseMetaStatic {
  /** Accessory work (grip/forearm finishers): excluded from strength grading entirely. */
  optional?: boolean;
}

export const EXERCISE_META: Record<string, ExerciseMetaStatic> = {
  'Hammer Curl (Dumbbell)': { optional: true },
  'Wrist Curl (Dumbbell)': { optional: true },
  'Reverse Wrist Curl (Dumbbell)': { optional: true },
};

/** True for accessory lifts excluded from the week strength grade. */
export function isOptional(exercise: string): boolean {
  return EXERCISE_META[exercise]?.optional === true;
}

export function exerciseOrder(
  state: WorkoutState,
  exercise: string,
  order: Record<string, number> = EXERCISE_ORDER,
  config: ProgressionConfig = DEFAULT_CONFIG,
): number {
  const explicit = order[exercise];
  if (explicit !== undefined) return explicit;
  const muscle = exerciseMeta(state, exercise).muscle;
  if (muscle === 'cardio') return 90;
  if (muscle === 'forearms') return 80;
  if (muscle !== null && config.compoundMuscles.includes(muscle)) return 15;
  return 45;
}

export function exerciseSplit(
  state: WorkoutState,
  exercise: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): Split {
  const muscle = exerciseMeta(state, exercise).muscle;
  if (muscle === 'cardio' || isCardio(state, exercise)) return 'both';
  if (muscle !== null && config.lowerMuscles.includes(muscle)) return 'lower';
  if (muscle !== null && config.upperMuscles.includes(muscle)) return 'upper';
  return 'other';
}

/** Which half was trained on a date, or null if no lifting was logged. */
export function splitOfDate(
  state: WorkoutState,
  date: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): Split | null {
  const dead = tombstoneIds(state);
  const sets = (state.days?.[date] ?? []).filter(
    (s) => s.type !== 'cardio' && !dead.has(toId(s.id)),
  );
  let lower = 0;
  let upper = 0;
  for (const set of sets) {
    const split = exerciseSplit(state, set.ex, config);
    if (split === 'lower') lower++;
    else if (split === 'upper') upper++;
  }
  if (lower === 0 && upper === 0) return null;
  return lower >= upper ? 'lower' : 'upper';
}

/**
 * Which split is due on `date`.
 *
 * If that date already has lifting, report what was actually done. Otherwise
 * alternate away from the most recent prior session. Never reads the clock —
 * this is why navigating dates yields a stable, testable answer.
 */
export function suggestSplit(
  state: WorkoutState,
  date: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): SplitSuggestion {
  const own = splitOfDate(state, date, config);
  if (own) return { due: own, last: own, lastDate: date, logged: true };

  const priorDates = sortedDates(state).filter((d) => d < date);
  for (let i = priorDates.length - 1; i >= 0; i--) {
    const split = splitOfDate(state, priorDates[i], config);
    if (split) {
      return {
        due: split === 'lower' ? 'upper' : 'lower',
        last: split,
        lastDate: priorDates[i],
        logged: false,
      };
    }
  }
  return { due: 'upper', last: null, lastDate: null, logged: false };
}

/* ================================================================== */
/* Completion                                                          */
/* ================================================================== */

/**
 * Is this exercise complete on `date`?
 *
 * Explicit ticks win. Otherwise completion is derived: a past date with any
 * logged set counts as done (historical sessions predate the checkbox), while
 * today requires every prescribed set.
 */
export function isExerciseComplete(
  state: WorkoutState,
  exercise: string,
  date: string,
  today: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): boolean {
  if ((state.done?.[date] ?? []).includes(exercise)) return true;
  const logged = setsOn(state, exercise, date).length;
  if (logged === 0) return false;
  if (date < today) return true;
  return logged >= plannedSetCount(state, exercise, date, overrides, config);
}

export function isSessionComplete(
  state: WorkoutState,
  date: string,
  today: string,
): boolean {
  if (state.sessionDone?.[date] === true) return true;
  const dead = tombstoneIds(state);
  const count = (state.days?.[date] ?? []).filter((s) => !dead.has(toId(s.id))).length;
  return date < today && count > 0;
}

/* ================================================================== */
/* Progress metrics                                                    */
/* ================================================================== */

export function latestTopWeight(state: WorkoutState, exercise: string): number | null {
  const dates = exerciseDates(state, exercise);
  for (let i = dates.length - 1; i >= 0; i--) {
    const top = topSetOf(setsOn(state, exercise, dates[i]));
    if (top) return toNum(top.weight);
  }
  return null;
}

export function firstTopWeight(state: WorkoutState, exercise: string): number | null {
  for (const date of exerciseDates(state, exercise)) {
    const top = topSetOf(setsOn(state, exercise, date));
    if (top) return toNum(top.weight);
  }
  return null;
}

export function exerciseTrends(state: WorkoutState): ExerciseTrend[] {
  const out: ExerciseTrend[] = [];
  for (const exercise of allExercises(state)) {
    if (isCardio(state, exercise)) continue;
    const first = firstTopWeight(state, exercise);
    const latest = latestTopWeight(state, exercise);
    if (first === null || latest === null) continue;
    out.push({ exercise, first, latest, delta: latest - first });
  }
  return out;
}

/** Working sets (top + back-off) in the 7 days ending at `today`, inclusive. */
export function weeklyWorkingSets(state: WorkoutState, today: string): number {
  const cutoff = shiftDate(today, -7);
  const dead = tombstoneIds(state);
  let n = 0;
  for (const [date, sets] of Object.entries(state.days ?? {})) {
    if (date <= cutoff || date > today) continue;
    for (const set of sets) {
      if (dead.has(toId(set.id))) continue;
      if (set.type === 'top' || set.type === 'back') n++;
    }
  }
  return n;
}

export function currentBodyweight(state: WorkoutState): number | null {
  const dates = Object.keys(state.bw ?? {}).sort();
  if (dates.length > 0) return toNum(state.bw[dates[dates.length - 1]]);
  const configured = state.settings?.bwCurrent;
  return configured === undefined ? null : toNum(configured);
}

export function bodyweightTrend(state: WorkoutState): number | null {
  const dates = Object.keys(state.bw ?? {}).sort();
  if (dates.length < 2) return null;
  return toNum(state.bw[dates[dates.length - 1]]) - toNum(state.bw[dates[0]]);
}

/* ================================================================== */
/* Week strength grade — pure, derived, NEVER persisted                */
/* ================================================================== */

/*
 * The at-a-glance workout tile grades how the training week actually went,
 * against each lift's own planned target. Everything here is a pure selector
 * over the logged sets + the plan: nothing is stored on the state, so the grade
 * can never drift out of sync with the log (a persisted grade would be a stale
 * cache and a corruption surface). The single source of truth stays the sets.
 */

export type StrengthGrade = 'weak' | 'moderate' | 'strong';
/** A week with zero gradable training is `rest`, not a strength grade. */
export type WeekStrength = StrengthGrade | 'rest';

/** Ordinal value of a grade, for averaging and taking a median. */
const GRADE_VALUE: Record<StrengthGrade, number> = { weak: 1, moderate: 2, strong: 3 };
const GRADE_BY_VALUE: Record<number, StrengthGrade> = { 1: 'weak', 2: 'moderate', 3: 'strong' };

/**
 * Band a continuous 1..3 score into a grade. The partition is total — every
 * value lands in exactly one band:
 *   avg < 1.67 → weak · 1.67 ≤ avg < 2.34 → moderate · avg ≥ 2.34 → strong.
 * Used for a DAY's average of per-lift scores. The WEEK grade takes a median of
 * whole grades instead and rounds it to an ordinal (see `weekStrength`).
 */
export function bandScore(avg: number): StrengthGrade {
  if (avg >= 2.34) return 'strong';
  if (avg >= 1.67) return 'moderate';
  return 'weak';
}

/**
 * Grade one exercise on one day against its planned top set.
 *
 * The target is the plan's prescribed top set for that date — `buildPlan().top`
 * — i.e. the weight×reps the progression expected of you, derived from history
 * strictly before `date`. Then:
 *   - Strong: actual top weight ≥ target weight AND actual reps ≥ target reps
 *   - Weak:   missed both (weight < target AND reps < target)
 *   - Moderate: hit exactly one
 *   - a planned lift with NO logged top set that day → Weak (skipping hurts)
 *
 * Returns `null` when the slot is ungradable — the lift is cardio, or there is
 * no prior history to progress from so there is no target (a first-timer) — so
 * the day average skips it rather than inventing a score.
 */
export function exerciseScore(
  state: WorkoutState,
  exercise: string,
  date: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): StrengthGrade | null {
  if (isCardio(state, exercise)) return null;
  const plan = buildPlan(state, exercise, date, overrides, config);
  if (!plan || plan.cardio) return null; // no target to grade against (first-timer)
  const actual = topSetOf(setsOn(state, exercise, date));
  if (!actual) return 'weak'; // planned but never topped out → a skipped slot
  const hitWeight = toNum(actual.weight) >= plan.top.weight;
  const hitReps = toNum(actual.reps) >= plan.top.reps;
  if (hitWeight && hitReps) return 'strong';
  if (!hitWeight && !hitReps) return 'weak';
  return 'moderate';
}

/** How many recent same-split sessions define a lift's "habitual" status. */
export const STAPLE_WINDOW = 4;

/**
 * The lifter's *habitual* lifts for a date's split — the "staples".
 *
 * The grade must punish skipping a lift you normally do, but must NOT punish
 * not-doing a lift that merely sits in the seeded default program. So the slate
 * is behavioural, not the full roster: a lift is a staple when it appears in at
 * least half of the last `STAPLE_WINDOW` (4) same-split sessions STRICTLY BEFORE
 * `date`. We read the day's split (`splitOfDate`, else the alternation due that
 * day), collect the recent session dates of that same split, and keep the
 * non-optional, non-cardio lifts that clear the ≥50% bar. With no prior
 * same-split history there are no staples (nothing is habitual yet).
 */
export function habitualStaples(
  state: WorkoutState,
  date: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): string[] {
  const daySplit = splitOfDate(state, date, config) ?? suggestSplit(state, date, config).due;
  const priorSameSplit = sortedDates(state)
    .filter((d) => d < date && splitOfDate(state, d, config) === daySplit)
    .slice(-STAPLE_WINDOW);
  const sessions = priorSameSplit.length;
  if (sessions === 0) return [];
  const seen = new Map<string, number>();
  for (const d of priorSameSplit) {
    for (const ex of loggedExercises(state, d)) {
      if (isCardio(state, ex) || isOptional(ex)) continue;
      seen.set(ex, (seen.get(ex) ?? 0) + 1);
    }
  }
  const staples: string[] = [];
  for (const [ex, count] of seen) if (count / sessions >= 0.5) staples.push(ex);
  return staples;
}

/**
 * Grade a whole day.
 *
 * The graded set is the day's staples UNION the non-optional, non-cardio lifts
 * actually topped out that day. Each is scored by `exerciseScore`, so a skipped
 * staple (no top set) is Weak, a hit staple/lift is graded against its target,
 * and a first-timer with no target drops out (null). The day grade is the band
 * of those scores' average.
 *
 * Returns `null` when the day is *ungradable*: it was trained, but its only
 * strength work was first-timers with no target — that day must not be forced
 * to Weak and drag the week down, so the week median simply skips it. A day
 * whose only work is cardio, by contrast, is a genuinely Weak lifting day.
 */
export function dayGrade(
  state: WorkoutState,
  date: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): StrengthGrade | null {
  const dead = tombstoneIds(state);
  const graded = new Set(habitualStaples(state, date, config));
  const logged = loggedExercises(state, date);
  for (const ex of logged) {
    if (isCardio(state, ex) || isOptional(ex)) continue;
    if (topSetOf(setsOn(state, ex, date))) graded.add(ex);
  }

  const scores: number[] = [];
  for (const ex of graded) {
    const s = exerciseScore(state, ex, date, overrides, config);
    if (s) scores.push(GRADE_VALUE[s]);
  }
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return bandScore(avg);
  }

  // Nothing scored. Distinguish "trained but ungradable" from "cardio-only".
  const live = (state.days?.[date] ?? []).some((s) => !dead.has(toId(s.id)));
  if (!live) return null; // not a training day at all
  const hasStrength = logged.some((ex) => !isCardio(state, ex) && !isOptional(ex));
  if (hasStrength) return null; // only first-timers / no targets → ungradable, skip it
  return 'weak'; // cardio-only (or accessory-only) training day is a weak lifting day
}

/** Days with at least one live (non-tombstoned) set in the 7 days ending at `today`. */
export function trainedDaysInWeek(state: WorkoutState, today: string): string[] {
  const start = shiftDate(today, -6);
  const dead = tombstoneIds(state);
  return sortedDates(state).filter(
    (d) =>
      d >= start &&
      d <= today &&
      (state.days?.[d] ?? []).some((s) => !dead.has(toId(s.id))),
  );
}

function dropBand(g: StrengthGrade): StrengthGrade {
  return g === 'strong' ? 'moderate' : 'weak';
}

/**
 * Median grade VALUE of an ordinal list of grade values (1/2/3).
 *
 * For an even count the two central grades are averaged and a half-step ties
 * DOWN to the lower (more conservative) grade — so [weak, moderate] → weak and
 * [moderate, strong] → moderate, symmetrically. This avoids running a
 * half-integer (1.5, 2.5) through the continuous day-band thresholds, which
 * would band 1.5→weak but 2.5→strong asymmetrically.
 */
function medianGradeValue(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2) return xs[mid]!;
  return Math.floor((xs[mid - 1]! + xs[mid]!) / 2);
}

/** Target training days a week; falling short pulls the week grade down. */
export const WEEK_TRAINING_TARGET = 4;

/**
 * Combine a week's per-day grades into the week grade — the pure median+cap
 * rule, isolated from data access so it can be unit-tested directly.
 *
 * `trainedDays` is the count of training days (ungradable ones included), which
 * drives the frequency cap; `dayGrades` are those days' grades with `null` for
 * ungradable (all-new-lift) days, which are dropped from the median. Median of
 * the remaining grades, then the cap: ≥ 4 trained days keeps the median; 2–3
 * pulls it down one band; ≤ 1 floors at Weak. Nothing gradable → `rest`.
 */
export function weekGrade(
  dayGrades: ReadonlyArray<StrengthGrade | null>,
  trainedDays: number,
): WeekStrength {
  if (trainedDays <= 0) return 'rest';
  const graded = dayGrades.filter((g): g is StrengthGrade => g !== null);
  // ≤ 1 training day floors at Weak; a lone ungradable day has no grade → rest.
  if (trainedDays === 1) return graded.length === 0 ? 'rest' : 'weak';
  if (graded.length === 0) return 'rest';
  const base = GRADE_BY_VALUE[medianGradeValue(graded.map((g) => GRADE_VALUE[g]))]!;
  return trainedDays < WEEK_TRAINING_TARGET ? dropBand(base) : base;
}

/**
 * The at-a-glance week strength grade over the 7 days ending at `today`.
 *
 * Grades each training day, then folds them with `weekGrade`. Ungradable days (a
 * legitimate all-new-lift session) are excluded from the median but still count
 * as training days for the frequency cap. Zero trained days, or a week with
 * nothing gradable, is `rest`.
 */
export function weekStrength(
  state: WorkoutState,
  today: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): WeekStrength {
  const days = trainedDaysInWeek(state, today);
  const n = days.length;
  if (n === 0) return 'rest';
  // ≤ 1 training day floors before touching the median (see weekGrade).
  if (n === 1) return dayGrade(state, days[0]!, overrides, config) === null ? 'rest' : 'weak';
  return weekGrade(
    days.map((d) => dayGrade(state, d, overrides, config)),
    n,
  );
}

/* ================================================================== */
/* Date arithmetic — pure, no Date.now()                               */
/* ================================================================== */

/** Shift an ISO date by whole days. UTC-based so it is DST-independent. */
/* ================================================================== */
/* The view model — everything renderWorkout needs, as plain data      */
/* ================================================================== */

/**
 * Compute the entire workout view for a date.
 *
 * This is the seam that replaces `renderWorkout`'s derivation half: the UI
 * layer becomes a pure function of this object, so it can be snapshot-tested
 * and this can be property-tested, independently.
 */
export function selectWorkoutView(
  state: WorkoutState,
  date: string,
  today: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): WorkoutViewModel {
  const suggestion = suggestSplit(state, date, config);
  const split = overrides.split ?? suggestion.due;
  const isPast = date < today;
  const performedToday = loggedExercises(state, date);

  // In Away mode a substitute accrues its own logged history, so it would
  // otherwise surface in `allExercises` as its own card — but it is only ever
  // meant to appear THROUGH its gym slot. Drop substitute names from the
  // forward-looking list; the gym lift's slot carries them.
  const subNames = overrides.away ? new Set(Object.values(overrides.away.swap)) : null;

  const exercises =
    isPast && performedToday.length > 0
      ? performedToday
      : allExercises(state)
          .filter((ex) => {
            if (subNames?.has(ex)) return false;
            if (split === 'all') return true;
            const s = exerciseSplit(state, ex, config);
            return s === split || s === 'both';
          })
          .sort((a, b) => exerciseOrder(state, a) - exerciseOrder(state, b));

  const plans: Record<string, ExercisePlan | null> = {};
  const performed: Record<string, WorkoutSet[]> = {};
  const completed: Record<string, boolean> = {};
  for (const ex of exercises) {
    // In Away mode the slot's ACTIVE exercise is the dumbbell substitute: its
    // plan/history/completion drive the card, while the slot's list position,
    // split, order and grouping stay keyed by the gym lift `ex` (unchanged).
    const active = overrides.away?.swap[ex] ?? ex;
    plans[ex] = buildPlan(state, active, date, overrides, config);
    performed[ex] = setsOn(state, active, date);
    completed[ex] = isExerciseComplete(state, active, date, today, overrides, config);
  }

  return {
    date,
    isPast,
    split,
    suggestion,
    exercises,
    plans,
    performed,
    completed,
    sessionComplete: isSessionComplete(state, date, today),
    estimate: estimateSession(state, exercises, date, overrides, config),
  };
}
