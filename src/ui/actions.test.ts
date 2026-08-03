/**
 * Action-body tests — the port of app.test.ts's "view actions" block. The old
 * "render gating + mount caching" block is obsolete (that orchestration is gone,
 * replaced by signals + components). Here we drive the real action objects
 * against the real (uninitialised) bootstrap stores and assert the store
 * mutation + dirty-marking + reactive bump. Dirty is asserted via a spy on
 * appState.markXDirty (the flag is a module singleton and would leak between
 * tests otherwise) — mirroring the old suite's vi.fn() markDirty checks.
 *
 * Runs in jsdom (see vitest.config): the bodies call host.setValue/status, which
 * touch document.getElementById — harmlessly no-op when the element is absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mealActions, knowledgeActions, workoutActions, restTimer, sg, kg, core, wk } from '@/ui/actions';
import { appState, dstr } from '@/app/bootstrap';
import { selectWorkoutView } from '@/features/workout/workoutSelectors';
import defaultWorkout from '@/core/data/defaultWorkout.json';
import { dataRev, sgDate, wkDate, wkDeload, kgTopic, kgItems } from '@/ui/store';

const today = dstr();

beforeEach(() => {
  vi.restoreAllMocks();
  // reset the live singleton stores to a clean slate
  Object.assign(sg(), { settings: {}, days: {}, tad: {} });
  Object.assign(kg(), { mastery: {}, srs: {}, log: [], gymDone: {} });
  Object.assign(core(), { schedule: {}, entries: [] });
  Object.assign(wk(), { settings: {}, days: {}, bw: {}, done: {} });
  sgDate.value = null;
  wkDate.value = null;
  kgTopic.value = 'algorithms';
  kgItems.value = {};
});

describe('meal addMeal', () => {
  it('appends to the day, marks the store dirty, and bumps', () => {
    const dirty = vi.spyOn(appState, 'markMealDirty');
    const rev = dataRev.value;
    mealActions.addMeal('Eggs', 200, 20);
    const day = sg().days[today];
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({ name: 'Eggs', cal: 200, protein: 20 });
    expect(dirty).toHaveBeenCalledOnce();
    expect(dataRev.value).toBeGreaterThan(rev);
  });

  it('with an all-empty entry shows a status and does not append or mark dirty', () => {
    const dirty = vi.spyOn(appState, 'markMealDirty');
    mealActions.addMeal('', 0, 0);
    expect(sg().days[today]).toBeUndefined();
    expect(dirty).not.toHaveBeenCalled();
  });
});

describe('knowledge rate', () => {
  it('records mastery + a core kg entry and marks dirty', () => {
    const dirty = vi.spyOn(appState, 'markKnowledgeDirty');
    knowledgeActions.rate('q1', 5);
    expect(kg().mastery['q1']).toBe(5);
    const entry = core().entries.at(-1);
    expect(entry).toMatchObject({ stream: 'kg', status: 'solved', score: 5, xp: 20 });
    expect(dirty).toHaveBeenCalledOnce();
  });

  it('marks a low score as attempted, not solved', () => {
    knowledgeActions.rate('q2', 2);
    expect(kg().mastery['q2']).toBe(2);
    expect(core().entries.at(-1)).toMatchObject({ status: 'attempted', score: 2, xp: 8 });
  });
});

describe('workout logSet', () => {
  it('appends a set on the selected day and marks dirty', () => {
    const dirty = vi.spyOn(appState, 'markWorkoutDirty');
    workoutActions.logSet('Leg Press', 'top', 100, 5);
    const day = wk().days[today];
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({ ex: 'Leg Press', type: 'top', weight: 100, reps: 5 });
    expect(dirty).toHaveBeenCalledOnce();
  });

  it('ignores an incomplete set (missing weight or reps)', () => {
    const dirty = vi.spyOn(appState, 'markWorkoutDirty');
    workoutActions.logSet('Leg Press', 'top', 0, 5);
    expect(wk().days[today]).toBeUndefined();
    expect(dirty).not.toHaveBeenCalled();
  });
});

/**
 * Rest timer: logging a set starts the rest countdown, EXCEPT the last
 * prescribed set of the exercise, which completes it (dismiss, no rest). Seeds
 * the real default workout so an exercise has a multi-set prescription; spies on
 * restTimer so the real interval never runs.
 */
describe('workout logSet → rest timer', () => {
  let ex: string;
  let need: number;

  beforeEach(() => {
    appState.set('overload', JSON.parse(JSON.stringify(defaultWorkout)));
    wkDate.value = today;
    wkDeload.value = {};
    const view = selectWorkoutView(wk(), today, today, { deload: {} });
    const plans = view.plans as Record<string, { cardio?: boolean; warms: unknown[]; backs: unknown[] }>;
    ex = Object.keys(plans).find((e) => {
      const p = plans[e]!;
      return !p.cardio && p.warms.length + 1 + p.backs.length > 1;
    })!;
    need = plans[ex]!.warms.length + 1 + plans[ex]!.backs.length;
  });

  afterEach(() => {
    wkDate.value = null;
    wkDeload.value = {};
  });

  it('finds a multi-set prescription to exercise the branch', () => {
    expect(ex).toBeTruthy();
    expect(need).toBeGreaterThan(1);
  });

  it('starts the rest timer after each set except the last of the exercise', () => {
    const start = vi.spyOn(restTimer, 'start').mockImplementation(() => {});
    const dismiss = vi.spyOn(restTimer, 'dismissFor').mockImplementation(() => {});
    for (let i = 0; i < need; i++) workoutActions.logSet(ex, 'top', 100 + i, 5);
    expect(start).toHaveBeenCalledTimes(need - 1); // every set but the last
    expect(dismiss).toHaveBeenCalledTimes(1); // the last completes the exercise
    expect(dismiss).toHaveBeenLastCalledWith(ex);
  });
});
