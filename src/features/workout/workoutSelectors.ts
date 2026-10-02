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
import exSwapData from '@/core/data/exSwap.json';
import awayStartData from '@/core/data/awayStart.json';

/* ================================================================== */
/* Away-mode swap knowledge — static, so the pure selectors reason     */
/* about substitute identity WITHOUT the transient `overrides.away`.    */
/* ================================================================== */

/*
 * The dumbbell substitutes are build-time data (`exSwap.json`), so the selectors can
 * know them unconditionally. This is what lets a home substitute never leak into the
 * Gym-mode list as its own lift, and lets grading credit a substitute to the gym slot
 * it stands in for — neither of which the per-render `overrides.away` (present only in
 * Away mode) can do on its own.
 */
/** Gym lift → its dumbbell substitute. */
const GYM_TO_SUB: Record<string, string> = exSwapData as Record<string, string>;
/** Dumbbell substitute → the gym lift (slot) it stands in for. */
const SUB_TO_GYM: Record<string, string> = Object.fromEntries(
  Object.entries(GYM_TO_SUB).map(([gym, sub]) => [sub, gym]),
);
/** Every substitute name — filtered out of the forward-looking Gym-mode list. */
export const SUB_NAMES: ReadonlySet<string> = new Set(Object.values(GYM_TO_SUB));
/** Approved starting prescription per substitute (weight/reps/muscle). */
const AWAY_SEED: Record<string, { weight: number; reps: number; muscle?: string }> =
  awayStartData as Record<string, { weight: number; reps: number; muscle?: string }>;

/**
 * The canonical training *slot* for an exercise: a home substitute maps back to the
 * gym lift it stands in for; every other exercise is its own slot. Used by grading so a
 * lower day trained at home (Goblet Squat) satisfies the same slot as a gym day (Leg
 * Press), rather than reading as a skipped staple.
 */
export function canonicalSlot(exercise: string): string {
  return SUB_TO_GYM[exercise] ?? exercise;
}

/** Rep ceiling implied by a muscle alone (used before an exercise has logged history). */
function repCeilingForMuscle(muscle: string | null | undefined, config: ProgressionConfig): number {
  if (muscle === 'cardio') return config.repHigh;
  return muscle != null && config.compoundMuscles.includes(muscle as Muscle)
    ? config.repHighCompound
    : config.repHighIsolation;
}

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

/* ── Per-call history index ──
 * Grading walks every date and, per date, asks history questions (isCardio,
 * splitOfDate) that each rescan every date: O(D^2 * S) in the log length, which
 * took Enter -> Today past 10 s at ~90 days of history. The entry points below
 * build this index once and the history helpers read from it, making each
 * lookup O(1). It lives only for one synchronous call: the stores are mutated
 * in place between calls, so a cache keyed on state identity would go stale. */
interface HistoryIndex {
  state: WorkoutState;
  dead: Set<string>;
  dates: string[];
  byEx: Map<string, Map<string, WorkoutSet[]>>; // exercise -> date -> live sets, dates ascending
  meta: Map<string, { muscle: Muscle | null; group: string | null }>;
  cardio: Map<string, boolean>;
  exSplit: Map<ProgressionConfig, Map<string, Split>>;
  dateSplit: Map<ProgressionConfig, Map<string, Split | null>>;
}

let activeIndex: HistoryIndex | null = null;
let indexEnabled = true;

/** Test hook: run the selectors unindexed so tests can prove both paths agree. */
export function setHistoryIndexEnabled(on: boolean): void {
  indexEnabled = on;
}

function buildIndex(state: WorkoutState): HistoryIndex {
  const dead = tombstoneIds(state);
  const dates = Object.keys(state.days ?? {}).sort();
  const byEx = new Map<string, Map<string, WorkoutSet[]>>();
  for (const date of dates) {
    for (const s of state.days[date] ?? []) {
      if (dead.has(toId(s.id))) continue;
      let perDate = byEx.get(s.ex);
      if (!perDate) byEx.set(s.ex, (perDate = new Map()));
      const sets = perDate.get(date);
      if (sets) sets.push(s);
      else perDate.set(date, [s]);
    }
  }
  return { state, dead, dates, byEx, meta: new Map(), cardio: new Map(), exSplit: new Map(), dateSplit: new Map() };
}

function historyIndex(state: WorkoutState): HistoryIndex | null {
  return activeIndex && activeIndex.state === state ? activeIndex : null;
}

function memo<K, V>(map: Map<K, V>, key: K, compute: () => V): V {
  if (map.has(key)) return map.get(key)!;
  const v = compute();
  map.set(key, v);
  return v;
}

function byConfig<V>(outer: Map<ProgressionConfig, Map<string, V>>, config: ProgressionConfig): Map<string, V> {
  return memo(outer, config, () => new Map<string, V>());
}

/**
 * Wrap a selector so one call (and everything it calls) shares a single index.
 * Exported as `withHistoryIndex` for view code that loops history selectors
 * itself (the week strip), which would otherwise rescan the log per call.
 */
export function withHistoryIndex<A extends unknown[], R>(fn: (state: WorkoutState, ...rest: A) => R): (state: WorkoutState, ...rest: A) => R {
  return indexed(fn);
}
function indexed<A extends unknown[], R>(fn: (state: WorkoutState, ...rest: A) => R): (state: WorkoutState, ...rest: A) => R {
  return (state, ...rest) => {
    if (!indexEnabled || historyIndex(state)) return fn(state, ...rest);
    const prev = activeIndex;
    activeIndex = buildIndex(state);
    try {
      return fn(state, ...rest);
    } finally {
      activeIndex = prev;
    }
  };
}

function deadIds(state: WorkoutState): Set<string> {
  return historyIndex(state)?.dead ?? tombstoneIds(state);
}

/** All dates holding at least one set, ascending. */
export function sortedDates(state: WorkoutState): string[] {
  const ix = historyIndex(state);
  if (ix) return ix.dates.slice();
  return Object.keys(state.days ?? {}).sort();
}

/** Sets logged for `exercise` on `date`, tombstoned rows excluded. */
export function setsOn(state: WorkoutState, exercise: string, date: string): WorkoutSet[] {
  const ix = historyIndex(state);
  if (ix) return ix.byEx.get(exercise)?.get(date)?.slice() ?? [];
  const dead = tombstoneIds(state);
  return (state.days?.[date] ?? []).filter(
    (s) => s.ex === exercise && !dead.has(toId(s.id)),
  );
}

/** Dates on which `exercise` was performed, ascending. */
export function exerciseDates(state: WorkoutState, exercise: string): string[] {
  const ix = historyIndex(state);
  if (ix) return [...(ix.byEx.get(exercise)?.keys() ?? [])];
  return sortedDates(state).filter((d) => setsOn(state, exercise, d).length > 0);
}

export function topSetOf(sets: readonly WorkoutSet[]): WorkoutSet | null {
  return sets.find((s) => s.type === 'top') ?? null;
}

/** Heaviest non-cardio set in a session — the top-set stand-in when none was tagged 'top'. */
function heaviestSet(sets: readonly WorkoutSet[]): WorkoutSet | null {
  let best: WorkoutSet | null = null;
  for (const s of sets) {
    if (s.type === 'cardio') continue;
    if (!best || toNum(s.weight) > toNum(best.weight)) best = s;
  }
  return best;
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
  const ix = historyIndex(state);
  if (ix) return { ...memo(ix.meta, exercise, () => exerciseMetaScan(state, exercise)) };
  return exerciseMetaScan(state, exercise);
}

function exerciseMetaScan(state: WorkoutState, exercise: string): { muscle: Muscle | null; group: string | null } {
  const dates = exerciseDates(state, exercise);
  for (let i = dates.length - 1; i >= 0; i--) {
    const set = setsOn(state, exercise, dates[i])[0];
    if (set) return { muscle: set.muscle ?? null, group: set.group ?? null };
  }
  return { muscle: null, group: null };
}

export function isCardio(state: WorkoutState, exercise: string): boolean {
  const ix = historyIndex(state);
  if (ix) return memo(ix.cardio, exercise, () => isCardioScan(state, exercise));
  return isCardioScan(state, exercise);
}

function isCardioScan(state: WorkoutState, exercise: string): boolean {
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

/** Recent top-set jumps that inferIncrement learns the step from. */
const INCREMENT_WINDOW = 8;
/** Free weights load in fixed plate steps, so a learned step snaps to 2.5 or 5 lb. */
const FREE_WEIGHT = /dumbbell|barbell|bench press/i;

/**
 * Smallest usable weight step for an exercise.
 *
 * User override wins. Otherwise take the most common positive jump among recent
 * consecutive top sets, but only if it repeats: one big jump (a PR attempt, a
 * different machine) is not a step size. Free weights snap to 2.5 or 5 lb; a
 * machine keeps its consistent stack step. Falls back to the configured default.
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
  const recent = tops.slice(-(INCREMENT_WINDOW + 1));
  const counts = new Map<number, number>();
  for (let i = 1; i < recent.length; i++) {
    // Round to hundredths so float noise (42.5 - 40.0) does not split one step into two.
    const delta = Math.round((recent[i] - recent[i - 1]) * 100) / 100;
    if (delta > 0) counts.set(delta, (counts.get(delta) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 1; // a step must repeat to be learned
  for (const [delta, count] of counts) {
    // Ties go to the smaller step, the conservative progression.
    if (count > bestCount || (count === bestCount && best > 0 && delta < best)) {
      bestCount = count;
      best = delta;
    }
  }
  if (best <= 0) return config.defaultIncrement;
  if (FREE_WEIGHT.test(exercise)) return best <= 2.5 ? 2.5 : 5;
  return best;
}

/**
 * The exercise's typical set structure, derived from recent sessions.
 *
 * Uses the modal warm-up/back-off counts across the last N sessions so one
 * rushed day cannot permanently drop sets from the prescription, and averages
 * each slot's ratio to the top set so the shape scales with the weight.
 * With `before`, only sessions strictly before it count, so a day's own sets
 * never shape the targets it is graded against.
 */
export function setTemplate(
  state: WorkoutState,
  exercise: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
  before?: string,
): { warms: Array<{ ratio: number; reps: number }>; backs: Array<{ ratio: number; reps: number }> } | null {
  const sessions = exerciseDates(state, exercise)
    .filter((date) => before === undefined || date < before)
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
  // Home substitutes aren't in the seed program, so without a baseline they'd have no
  // back-off floor and would erode to a single set after one short day (the reported
  // "missing sets" bug). Give each the structure its Away seed implies — a top set plus
  // three back-offs at the same load (ratio 1). History may still ADD sets; it can't
  // drop a substitute below three back-offs, exactly like the machine lifts above.
  for (const [sub, seed] of Object.entries(AWAY_SEED)) {
    if (out[sub]) continue;
    const reps = toNum(seed.reps);
    out[sub] = { warms: [], backs: [{ ratio: 1, reps }, { ratio: 1, reps }, { ratio: 1, reps }] };
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
export function repsAfterBumpFor(state: WorkoutState, exercise: string, config: ProgressionConfig): number {
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

/**
 * Best top-set weight over the last `recoveryWindow` sessions strictly before
 * `before` — the recovery anchor. This is DERIVED from history (never persisted),
 * so it survives a sync/merge without a schema change. A deload eases off THIS
 * value rather than off the last logged weight, which is what stops the geometric
 * decay (90→81→72…) when a lifter keeps obeying a still-active deload flag, and it
 * caps a recovery bump so a lifter climbs back to their best without overshooting.
 * Returns null when no session in the window has a usable top set.
 */
export function bestRecentTopWeight(
  state: WorkoutState,
  exercise: string,
  before: string,
  config: ProgressionConfig = DEFAULT_CONFIG,
): number | null {
  const recent = exerciseDates(state, exercise)
    .filter((d) => d < before)
    .slice(-config.recoveryWindow);
  const cardio = isCardio(state, exercise);
  let best: number | null = null;
  for (const d of recent) {
    const sets = setsOn(state, exercise, d);
    // Same top-set extraction buildPlan uses: the tagged top set, else the heaviest
    // non-cardio set for a strength lift that logged only back-offs.
    const top = topSetOf(sets) ?? (cardio ? null : heaviestSet(sets));
    if (!top) continue;
    const w = toNum(top.weight, 1) || 1;
    if (best === null || w > best) best = w;
  }
  return best;
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
      // First session has no logged sets, so exerciseMeta can't classify the lift yet;
      // read the class off the Away seed's muscle so a compound sub shows its compound
      // ceiling (6) from the start instead of defaulting to the isolation ceiling (12).
      repHigh: repCeilingForMuscle(seed.muscle, config),
      targetReps: repCeilingForMuscle(seed.muscle, config),
      atMinimum: false,
      incr: step,
      lastTopWeight: seed.weight,
      lastTopReps: seed.reps,
      lastDate: null,
    };
  }

  const repHigh = repCeiling(state, exercise, config);

  // A lift is only "cardio" when it is GENUINELY cardio (muscle/type), never merely
  // because its last session happened to log no set tagged 'top' — otherwise a strength
  // lift (e.g. a Leg Press day with only back-off sets) would render as a time/distance
  // cardio card. For such a strength lift, progress off the heaviest set instead.
  const top = topSetOf(previous.sets) ?? (isCardio(state, exercise) ? null : heaviestSet(previous.sets));
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
      targetReps: repHigh,
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
  // The class reset reps after a bump (compound 3 / isolation 8). Doubles as the
  // rep threshold a recovery session must clear to earn a climb back toward best.
  const repFloor = repsAfterBumpFor(state, exercise, config);

  // The recovery anchor: the best top-set weight over the recent window (derived,
  // never persisted). Deloads ease off THIS, and recovery bumps cap at it.
  const best = bestRecentTopWeight(state, exercise, date, config) ?? lastWeight;
  const belowBest = lastWeight < best - 1e-9;

  // Time off (per lift): only a LONG layoff backs the load off, and only once —
  // moderate gaps no longer suppress a bump.
  const gap = daysSinceLast(state, exercise, date);
  const longLayoff = gap != null && gap > config.gapDeloadDays;

  // Hitting the rep ceiling earns a genuine bump (double progression). Sitting
  // below the recent best while clearing the reset floor earns a recovery climb.
  const normalBump = lastReps >= repHigh;
  const recoveryBump = belowBest && lastReps >= repFloor;

  // Auto-deload: a flat strength stall, or a single cut after a long layoff. Never
  // while recovering (belowBest) — that would fight the climb back to best.
  const stalled = !normalBump && !belowBest && isStalled(state, exercise, date, config);
  const layoffDeload = longLayoff && !belowBest;
  const autoDeload = !normalBump && (stalled || layoffDeload);

  // Manual deload is a ONE-SHOT: honor the flag only until today's top set is logged,
  // so obeying the eased prescription doesn't re-trigger the cut next render.
  const manual =
    overrides.deload?.[exercise] === true &&
    topSetOf(setsOn(state, exercise, date)) === null;
  const deload = manual || autoDeload;
  const bumped = !deload && (normalBump || recoveryBump);

  let atMinimum = false;
  let weight: number;
  let reps: number;
  if (deload) {
    // Anchor the cut on BEST, not lastWeight. This kills the geometric decay
    // (obeying a held deload flag no longer ratchets 90→81→72…) and makes the
    // deload idempotent: repeated obeyed deloads all land on the same floor.
    const target = roundDownTo(best * config.deloadFactor, step);
    // A manual deload fired while below best could otherwise RAISE the bar (best*0.9
    // can exceed the current working weight, e.g. last did 85, best*0.9 = 90). Clamp
    // so a deload never rises above the current working weight, on-grid. No-op for
    // auto-deloads, which only fire when !belowBest (so best ≈ lastWeight).
    const clamped = Math.min(target, roundDownTo(lastWeight, step));
    weight = clamped > 0 ? clamped : lastWeight;
    atMinimum = clamped <= 0; // load already below one increment
    reps = repFloor;
  } else if (bumped) {
    // Snap onto the grid before adding a step, so an off-grid entry (102.5 on a
    // 5 lb step) advances to 105 rather than 107.5→110. A recovery bump caps at
    // best; a genuine ceiling PR climbs past it.
    const stepped = roundDownTo(lastWeight, step) + step;
    weight = belowBest ? Math.min(stepped, best) : stepped;
    // Shed two reps for the heavier load rather than dropping to the floor, so one
    // bump does not throw away most of the reps just earned.
    reps = Math.max(repFloor, lastReps - 2);
  } else {
    weight = lastWeight;
    reps = lastReps;
  }

  const template = setTemplate(state, exercise, config, date);
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
    targetReps: repHigh,
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
 * Lifts retired from the program (grip/forearm finishers). Their logged history
 * stays untouched; they are just never planned, listed for a new session, or graded.
 */
export const RETIRED_EXERCISES: ReadonlySet<string> = new Set([
  'Hammer Curl (Dumbbell)',
  'Wrist Curl (Dumbbell)',
  'Reverse Wrist Curl (Dumbbell)',
]);

export function isRetired(exercise: string): boolean {
  return RETIRED_EXERCISES.has(exercise);
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
  const ix = historyIndex(state);
  if (ix) return memo(byConfig(ix.exSplit, config), exercise, () => exerciseSplitScan(state, exercise, config));
  return exerciseSplitScan(state, exercise, config);
}

function exerciseSplitScan(state: WorkoutState, exercise: string, config: ProgressionConfig): Split {
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
  const ix = historyIndex(state);
  if (ix) return memo(byConfig(ix.dateSplit, config), date, () => splitOfDateScan(state, date, config));
  return splitOfDateScan(state, date, config);
}

function splitOfDateScan(state: WorkoutState, date: string, config: ProgressionConfig): Split | null {
  const dead = deadIds(state);
  const sets = (state.days?.[date] ?? []).filter(
    (s) => s.type !== 'cardio' && !dead.has(toId(s.id)),
  );
  // The session's own label wins when every strength set carries one and they agree
  // ("Life Time - Lower"), since that is the day the lifter planned.
  let gUpper = 0;
  let gLower = 0;
  let gNone = 0;
  const exLower = new Set<string>();
  const exUpper = new Set<string>();
  let lower = 0;
  let upper = 0;
  for (const set of sets) {
    const g = set.group ?? '';
    if (/upper/i.test(g)) gUpper++;
    else if (/lower/i.test(g)) gLower++;
    else gNone++;
    const split = exerciseSplit(state, set.ex, config);
    if (split === 'lower') {
      lower++;
      exLower.add(set.ex);
    } else if (split === 'upper') {
      upper++;
      exUpper.add(set.ex);
    }
  }
  if (lower === 0 && upper === 0) return null;
  if (gNone === 0 && (gUpper === 0) !== (gLower === 0)) return gUpper > 0 ? 'upper' : 'lower';
  // Otherwise the majority of distinct lifts, so a lower day with many short calf
  // sets is not outvoted by one long upper lift. Set count only breaks a tie.
  if (exLower.size !== exUpper.size) return exLower.size > exUpper.size ? 'lower' : 'upper';
  return lower >= upper ? 'lower' : 'upper';
}

/**
 * Which split is due on `date`.
 *
 * If that date already has lifting, report what was actually done. Otherwise
 * alternate away from the most recent prior session. Never reads the clock —
 * this is why navigating dates yields a stable, testable answer.
 */
export const suggestSplit = indexed(function suggestSplit(
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
});

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
  // An explicit Reopen overrides derived (full-set) completion for today, so the card
  // can be reopened without deleting a set. A later explicit Mark-done clears it.
  if ((state.reopened?.[date] ?? []).includes(exercise)) return false;
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
/* Workout score: pure, derived, NEVER persisted                       */
/* ================================================================== */

/*
 * One metric everywhere (Today tile, Workout tab, week trend). Each planned lift
 * scores completion x execution against its planned sets; a day is the mean over
 * its split's planned lifts; a week is the mean of the upper and lower averages.
 * Nothing is stored on the state, so the score can never drift from the log.
 */

export type StrengthGrade = 'weak' | 'moderate' | 'strong';
/** A week with nothing scored yet is `rest`, not a strength grade. */
export type WeekStrength = StrengthGrade | 'rest';

/** Planned sessions per split each week. No setting overrides this yet: the program is 2 upper + 2 lower. */
export const PLANNED_PER_SPLIT = { upper: 2, lower: 2 } as const;
/** Target training days a week (the tile's "n of 4 days"). */
export const WEEK_TRAINING_TARGET = PLANNED_PER_SPLIT.upper + PLANNED_PER_SPLIT.lower;

/** Plate rounding and stack quirks make exact loads noisy, so within 3% of target counts as met. */
const LOAD_MET = 0.97;

/** Band a 0..1 score. The epsilon keeps a float like 0.8499999 from slipping a band. */
export function gradeOf(score: number): StrengthGrade {
  if (score >= 0.85 - 1e-9) return 'strong';
  if (score >= 0.6 - 1e-9) return 'moderate';
  return 'weak';
}

interface Target {
  weight: number;
  reps: number;
}

/** One working set against its target: reps ratio (capped at 1) times load ratio (1 inside the noise band). */
function setScore(weight: number, reps: number, t: Target): number {
  const repPart = t.reps > 0 ? Math.min(1, Math.max(0, reps) / t.reps) : 1;
  const loadPart = t.weight > 0 && weight < LOAD_MET * t.weight ? Math.max(0, weight) / t.weight : 1;
  return repPart * loadPart;
}

/** A slot's split, falling back to its home substitute's muscle when the gym lift has no history. */
function slotSplit(state: WorkoutState, slot: string, config: ProgressionConfig): Split {
  const s = exerciseSplit(state, slot, config);
  const sub = GYM_TO_SUB[slot];
  return s === 'other' && sub ? exerciseSplit(state, sub, config) : s;
}

/**
 * The lifts a `split` day on `date` plans: every non-cardio, non-retired lift of
 * that split first logged on or before `date`, with substitutes folded into the
 * gym slot they stand in for. This matches what the Workout tab lists for the day.
 */
export function plannedSlots(
  state: WorkoutState,
  date: string,
  split: 'upper' | 'lower',
  config: ProgressionConfig = DEFAULT_CONFIG,
): string[] {
  const ix = historyIndex(state);
  const names = ix ? [...ix.byEx.keys()] : allExercises(state);
  const out = new Set<string>();
  for (const ex of names) {
    if (isRetired(ex) || isCardio(state, ex)) continue;
    const first = exerciseDates(state, ex)[0];
    if (first === undefined || first > date) continue;
    const slot = canonicalSlot(ex);
    if (slotSplit(state, slot, config) === split) out.add(slot);
  }
  // Name breaks order ties so the result does not depend on how the names were collected.
  return [...out].sort((a, b) => exerciseOrder(state, a) - exerciseOrder(state, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Targets to grade one exercise's working sets against: the plan's top set and
 * back-offs, with two corrections.
 *
 * A below-best recovery bump only asks you to climb back toward your best, so its
 * reps grade against what you last achieved, not the rep ceiling.
 *
 * When the gym lift's plan auto-deloaded for a layoff but the slot was actually kept
 * trained through its home substitute, the layoff is false: grade against the held
 * (pre-deload) top so a stretch of home training does not make the first gym day easy.
 * A stall reset also sets autoDeload but is a real lower target, so it is left alone.
 */
function gradingTargets(
  state: WorkoutState,
  active: string,
  date: string,
  plan: ExercisePlan,
  config: ProgressionConfig,
): { top: Target; backs: Target[] } {
  const best = bestRecentTopWeight(state, active, date, config) ?? plan.lastTopWeight;
  const belowBest = plan.lastTopWeight < best - 1e-9;
  let top: Target = { weight: plan.top.weight, reps: plan.bumped && belowBest ? plan.lastTopReps : plan.top.reps };
  const sub = GYM_TO_SUB[active];
  if (plan.deload && plan.autoDeload && sub) {
    const gymGap = daysSinceLast(state, active, date) ?? Infinity;
    const subGap = daysSinceLast(state, sub, date) ?? Infinity;
    if (gymGap > config.gapRepeatDays && subGap <= config.gapDeloadDays && subGap < gymGap) {
      top = { weight: plan.lastTopWeight, reps: Math.min(plan.lastTopReps, plan.repHigh) };
    }
  }
  // Back-offs scale with whatever top target won, so they stay in proportion.
  const ratio = plan.top.weight > 0 ? top.weight / plan.top.weight : 1;
  return { top, backs: plan.backs.map((b) => ({ weight: b.weight * ratio, reps: b.reps })) };
}

/**
 * Score one planned slot on one day, 0..1: completion x execution.
 *
 * completion = working sets done / planned working sets (capped at 1; warm-ups
 * excluded; top and back-offs are working sets). execution = mean set score over
 * the done working sets. A skipped planned lift is 0. A slot trained through its
 * home substitute is graded against the substitute's own plan.
 *
 * Returns `null` ("new") when there is no target yet: cardio, or no prior history.
 *
 * `soFar` (today's session in progress): judge only how the logged sets went, not
 * how many are left, since the day isn't over; the caller skips unattempted slots.
 */
export function exerciseScore(
  state: WorkoutState,
  slot: string,
  date: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
  soFar = false,
): number | null {
  if (isCardio(state, slot)) return null;
  const working = (ex: string): WorkoutSet[] => setsOn(state, ex, date).filter((s) => s.type === 'top' || s.type === 'back');
  const sub = GYM_TO_SUB[slot];
  const gymSets = working(slot);
  const subSets = sub ? working(sub) : [];
  const active = gymSets.length > 0 || !sub || subSets.length === 0 ? slot : sub;
  const done = active === slot ? gymSets : subSets;
  // A skipped slot still has a target if either identity has one.
  const plan =
    buildPlan(state, active, date, overrides, config) ??
    (done.length === 0 && sub ? buildPlan(state, sub, date, overrides, config) : null);
  if (!plan || plan.cardio) return null;
  if (done.length === 0) return 0;
  const t = gradingTargets(state, active, date, plan, config);
  let sum = 0;
  let back = 0;
  for (const s of done) {
    // Extra back-offs beyond the plan grade against the top target rather than being dropped.
    const target = s.type === 'back' ? (t.backs[back++] ?? t.top) : t.top;
    sum += setScore(toNum(s.weight), toNum(s.reps), target);
  }
  const completion = soFar ? 1 : Math.min(1, done.length / (1 + plan.backs.length));
  return completion * (sum / done.length);
}

/** Whether a slot (or its home substitute) is marked completed on `date`. */
export function slotCompleted(state: WorkoutState, slot: string, date: string): boolean {
  const done = (state.done?.[date] ?? []) as string[];
  const sub = GYM_TO_SUB[slot];
  return done.includes(slot) || (!!sub && done.includes(sub));
}

/** Whether a slot (or its home substitute) has a working set logged on `date`. */
export function slotAttempted(state: WorkoutState, slot: string, date: string): boolean {
  const worked = (ex: string): boolean => setsOn(state, ex, date).some((s) => s.type === 'top' || s.type === 'back');
  const sub = GYM_TO_SUB[slot];
  return worked(slot) || (!!sub && worked(sub));
}

type Half = 'upper' | 'lower';

export interface DayScore {
  /** The splits trained that day: one for a pure day, both for a mixed day. */
  splits: Half[];
  /** Per split: mean over its planned slots that have a target; null when every one is new. */
  halves: Partial<Record<Half, number | null>>;
  /** Mean of the scored halves; null when every lift was new. */
  score: number | null;
  label: StrengthGrade | 'new';
  exercises: Array<{ slot: string; score: number | null }>;
}

/**
 * Score a training day. Each split present that day (at least one of its planned,
 * non-retired lifts or a substitute logged) scores the mean of `exerciseScore`
 * over that split's planned slots (skips count 0, new lifts are left out). A
 * mixed day is graded as both halves and the day score is their mean, so every
 * lift done counts. `null` when no upper or lower lifting was logged that day.
 */
export const dayScore = indexed(function dayScore(
  state: WorkoutState,
  date: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
  /** Today's session in progress: average only the lifts attempted so far, and grade a
   *  lift that isn't completed yet on how its logged sets went (its sets aren't all in). */
  soFar: boolean = false,
): DayScore | null {
  const present = new Set<Half>();
  for (const ex of loggedExercises(state, date)) {
    if (isRetired(ex) || isCardio(state, ex)) continue;
    const s = slotSplit(state, canonicalSlot(ex), config);
    if (s === 'upper' || s === 'lower') present.add(s);
  }
  // A day of only retired lifts keeps its label split, so it still reads as a session.
  if (present.size === 0) {
    const fallback = splitOfDate(state, date, config);
    if (fallback !== 'upper' && fallback !== 'lower') return null;
    present.add(fallback);
  }
  const splits = (['upper', 'lower'] as const).filter((h) => present.has(h));
  const mean = (xs: number[]): number | null => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const halves: Partial<Record<Half, number | null>> = {};
  const exercises: DayScore['exercises'] = [];
  for (const h of splits) {
    const slots = plannedSlots(state, date, h, config).filter((slot) => !soFar || slotAttempted(state, slot, date));
    const part = slots.map((slot) => ({
      slot,
      score: exerciseScore(state, slot, date, overrides, config, soFar && !slotCompleted(state, slot, date)),
    }));
    exercises.push(...part);
    halves[h] = mean(part.flatMap((e) => (e.score === null ? [] : [e.score])));
  }
  const score = mean(splits.flatMap((h) => (halves[h] == null ? [] : [halves[h]!])));
  return { splits, halves, score, label: score === null ? 'new' : gradeOf(score), exercises };
});

/** Monday of the calendar week holding `date`. The weekday of a calendar date is timezone independent. */
export function mondayOf(date: string): string {
  const dow = (new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay() + 6) % 7; // 0 = Mon
  return shiftDate(date, -dow);
}

export interface WeekScore {
  monday: string;
  upper: number | null;
  lower: number | null;
  score: number | null;
  label: WeekStrength;
  /** The week still has planned sessions to come, so the label is on pace, not final. */
  soFar: boolean;
  sessions: number;
  planned: number;
}

/**
 * Score the calendar week (Monday start) holding `today`, using days up to `today`.
 *
 * Each split's average is the mean of its day scores, plus a 0 for every planned
 * session that can no longer fit this week (the Mon to Fri slots left, counting
 * today if it is still open). Mid-week that is "on pace": sessions not yet missed
 * do not count against you. The week score is the mean of the split averages.
 */
export const weekScore = indexed(function weekScore(
  state: WorkoutState,
  today: string,
  overrides: SessionOverrides = {},
  config: ProgressionConfig = DEFAULT_CONFIG,
): WeekScore {
  const monday = mondayOf(today);
  const scores = { upper: [] as number[], lower: [] as number[] };
  const done = { upper: 0, lower: 0 };
  let days = 0;
  let todayTrained = false;
  for (let i = 0; i < 7; i++) {
    const d = shiftDate(monday, i);
    if (d > today) break;
    const day = dayScore(state, d, overrides, config);
    if (!day) continue;
    days++;
    // A mixed day fills one upper and one lower slot, each with its own half score.
    for (const h of day.splits) {
      done[h]++;
      const v = day.halves[h];
      if (v != null) scores[h].push(v);
    }
    if (d === today) todayTrained = true;
  }
  const todayIx = dayGap(monday, today);
  const open = Math.max(0, 4 - todayIx) + (todayIx <= 4 && !todayTrained ? 1 : 0);
  const avg = (split: 'upper' | 'lower'): number | null => {
    const missed = Math.max(0, PLANNED_PER_SPLIT[split] - done[split] - open);
    const n = scores[split].length + missed;
    return n > 0 ? scores[split].reduce((a, b) => a + b, 0) / n : null;
  };
  const upper = avg('upper');
  const lower = avg('lower');
  const parts = [upper, lower].filter((x): x is number => x !== null);
  const score = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  const owed =
    Math.max(0, PLANNED_PER_SPLIT.upper - done.upper) + Math.max(0, PLANNED_PER_SPLIT.lower - done.lower);
  return {
    monday,
    upper,
    lower,
    score,
    label: score === null ? 'rest' : gradeOf(score),
    soFar: open > 0 && owed > 0,
    sessions: days,
    planned: WEEK_TRAINING_TARGET,
  };
});

/**
 * The last `weeks` week scores, oldest first, the current week scored up to `today`.
 * Weeks that end before the first logged set are `rest` rather than a wall of zeros.
 */
export const weekTrend = indexed(function weekTrend(
  state: WorkoutState,
  today: string,
  weeks: number = 8,
  config: ProgressionConfig = DEFAULT_CONFIG,
): WeekScore[] {
  const first = sortedDates(state)[0];
  const out: WeekScore[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const monday = shiftDate(mondayOf(today), -7 * k);
    const end = k === 0 ? today : shiftDate(monday, 6);
    if (first === undefined || end < first) {
      out.push({ monday, upper: null, lower: null, score: null, label: 'rest', soFar: false, sessions: 0, planned: WEEK_TRAINING_TARGET });
    } else {
      out.push(weekScore(state, end, {}, config));
    }
  }
  return out;
});

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
export const selectWorkoutView = indexed(function selectWorkoutView(
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

  // A substitute accrues its own logged history, so it would otherwise surface in
  // `allExercises` as its own card — but it is only ever meant to appear THROUGH its
  // gym slot. Substitute names are STATIC build-time data, so filter them in BOTH modes
  // (Gym mode was leaking them, e.g. Goblet Squat next to Leg Press). In Away mode also
  // seed the candidate list with the swap KEYS, so a machine whose only history is under
  // its substitute still shows its slot (driven by the sub) rather than vanishing.
  const forwardCandidates = overrides.away
    ? [...new Set([...allExercises(state), ...Object.keys(overrides.away.swap)])]
    : allExercises(state);

  const exercises =
    isPast && performedToday.length > 0
      ? performedToday
      : forwardCandidates
          .filter((ex) => {
            if (SUB_NAMES.has(ex)) return false; // never list a substitute as its own lift
            if (isRetired(ex)) return false; // history stays, but it is no longer planned
            if (split === 'all') return true;
            let s = exerciseSplit(state, ex, config);
            // A gym slot with no logged history classifies as 'other' (null muscle). In
            // Away mode, fall back to its substitute's seed muscle so the slot lands on
            // the right split instead of appearing on every day.
            const seedMuscle = overrides.away && s === 'other' ? AWAY_SEED[GYM_TO_SUB[ex] ?? '']?.muscle : undefined;
            if (seedMuscle) {
              s =
                seedMuscle === 'cardio' ? 'both'
                  : config.lowerMuscles.includes(seedMuscle as Muscle) ? 'lower'
                  : config.upperMuscles.includes(seedMuscle as Muscle) ? 'upper'
                  : 'other';
            }
            // 'other'/unknown-muscle lifts must not be silently hidden on every split.
            return s === split || s === 'both' || s === 'other';
          })
          .sort((a, b) => exerciseOrder(state, a) - exerciseOrder(state, b));

  const plans: Record<string, ExercisePlan | null> = {};
  const performed: Record<string, WorkoutSet[]> = {};
  const completed: Record<string, boolean> = {};
  for (const ex of exercises) {
    // In Away mode the slot's ACTIVE exercise is the dumbbell substitute: its
    // plan/history/completion drive the card, while the slot's list position,
    // split, order and grouping stay keyed by the gym lift `ex` (unchanged). On a PAST
    // day the list already holds the names actually logged, so do NOT swap them — that
    // hid real gym history behind an empty substitute seed card.
    const active = isPast ? ex : (overrides.away?.swap[ex] ?? ex);
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
});
