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
import { mealActions, knowledgeActions, workoutActions, todosActions, scratchActions, dataActions, restTimer, openSection, goHome, handleBack, todaySession, topicReviewSession, sessionForTopic, REVIEW_PREFIX, hubStats, sg, kg, core, wk } from '@/ui/actions';
import { appState, dstr, sync } from '@/app/bootstrap';
import { host } from '@/ui/host';
import { selectWorkoutView } from '@/features/workout/workoutSelectors';
import defaultWorkout from '@/core/data/defaultWorkout.json';
import { dataRev, sgDate, wkDate, wkDeload, kgTopic, kgItems, kgOverview, currentTab } from '@/ui/store';

const today = dstr();

beforeEach(() => {
  vi.restoreAllMocks();
  // reset the live singleton stores to a clean slate
  Object.assign(sg(), { settings: {}, days: {}, tad: {} });
  Object.assign(kg(), { mastery: {}, srs: {}, log: [], gymDone: {} });
  Object.assign(core(), { schedule: {}, entries: [], todos: [], scratch: [], _del: {} });
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

describe('hubStats knowledge tile — mastery % of the whole curriculum', () => {
  it('a beginner who mastered 1 of 20 curriculum questions reads ~5%, NOT 100%', () => {
    // Reality check: a known beginner state must not read near-full mastery.
    kgItems.value = { algorithms: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, mins: 5 })) as never };
    Object.assign(kg(), { mastery: { q0: 5 }, srs: {}, log: [], gymDone: {} });
    const tile = hubStats().find((s) => s.key === 'knowledge')!;
    expect(tile.value).toBe('5'); // 1 / 20, not 1 / 1 attempted
  });

  it('zero mastered reads 0%', () => {
    kgItems.value = { algorithms: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, mins: 5 })) as never };
    Object.assign(kg(), { mastery: {}, srs: {}, log: [], gymDone: {} });
    expect(hubStats().find((s) => s.key === 'knowledge')!.value).toBe('0');
  });
});

describe('dataActions.resetKnowledge', () => {
  it('zeros csgraph, drops kg-stream XP rows, and force-pushes (not save)', async () => {
    Object.assign(kg(), { mastery: { q1: 5, q2: 4 }, srs: { q1: { due: 'x' } }, log: [{ id: 'l', qid: 'q1', rating: 3 }], gymDone: { g: true } });
    Object.assign(core(), { schedule: {}, entries: [{ id: 'e1', stream: 'kg', xp: 12 }, { id: 'e2', stream: 'overload', xp: 8 }], todos: [], scratch: [], _del: {} });
    vi.spyOn(host, 'confirm').mockReturnValue(true);
    vi.spyOn(host, 'reload').mockImplementation(() => {});
    const force = vi.spyOn(sync, 'forcePush').mockResolvedValue({ cloud: 'synced' });
    const save = vi.spyOn(sync, 'save');

    await dataActions.resetKnowledge();

    expect(kg().mastery).toEqual({});
    expect(kg().srs).toEqual({});
    expect(kg().log).toEqual([]);
    expect(kg().gymDone).toEqual({});
    expect(core().entries).toEqual([{ id: 'e2', stream: 'overload', xp: 8 }]); // kg row gone, others intact
    expect(force).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled(); // must overwrite, not union-merge
  });

  it('does nothing when the confirm is declined', async () => {
    Object.assign(kg(), { mastery: { q1: 5 }, srs: {}, log: [], gymDone: {} });
    vi.spyOn(host, 'confirm').mockReturnValue(false);
    const force = vi.spyOn(sync, 'forcePush').mockResolvedValue({ cloud: 'synced' });

    await dataActions.resetKnowledge();

    expect(kg().mastery).toEqual({ q1: 5 });
    expect(force).not.toHaveBeenCalled();
  });
});

describe('knowledge rate', () => {
  it('maps an Easy grade to mastery 5, records a solved core kg entry, and marks dirty', () => {
    const dirty = vi.spyOn(appState, 'markKnowledgeDirty');
    knowledgeActions.rate('q1', 4); // 4 = Easy
    expect(kg().mastery['q1']).toBe(5);
    const entry = core().entries.at(-1);
    expect(entry).toMatchObject({ stream: 'kg', status: 'solved', score: 5, xp: 20 });
    expect(dirty).toHaveBeenCalledOnce();
  });

  it('maps an Again grade to mastery 1 and marks it attempted, not solved', () => {
    knowledgeActions.rate('q2', 1); // 1 = Again
    expect(kg().mastery['q2']).toBe(1);
    expect(core().entries.at(-1)).toMatchObject({ status: 'attempted', score: 1, xp: 4 });
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

describe('todosActions (nested in core)', () => {
  it('add pushes a todo, marks dirty, and bumps', () => {
    const dirty = vi.spyOn(appState, 'markDirty');
    const rev = dataRev.value;
    todosActions.add('Ship SGEMM worklog', '2026-08-10');
    const t = core().todos;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ text: 'Ship SGEMM worklog', done: false, due: '2026-08-10' });
    expect(dirty).toHaveBeenCalled();
    expect(dataRev.value).toBeGreaterThan(rev);
  });

  it('add ignores empty/whitespace text', () => {
    todosActions.add('   ');
    expect(core().todos).toHaveLength(0);
  });

  it('toggle flips done', () => {
    todosActions.add('x');
    const id = String(core().todos[0].id);
    todosActions.toggle(id);
    expect(core().todos[0].done).toBe(true);
  });

  it('remove tombstones the id and drops the row', () => {
    todosActions.add('x');
    const id = String(core().todos[0].id);
    todosActions.remove(id);
    expect(core().todos).toHaveLength(0);
    expect(core()._del[id]).toBeTruthy();
  });
});

describe('scratchActions (nested in core)', () => {
  it('add captures an idea card in the idea status', () => {
    scratchActions.add('SGEMM', 'reproduce Bohm/Salykov');
    const c = core().scratch;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ title: 'SGEMM', body: 'reproduce Bohm/Salykov', status: 'idea' });
  });

  it('add with both fields empty is a no-op', () => {
    scratchActions.add('  ', '  ');
    expect(core().scratch).toHaveLength(0);
  });

  it('cycleStatus advances idea → trying', () => {
    scratchActions.add('x', '');
    const id = String(core().scratch[0].id);
    scratchActions.cycleStatus(id);
    expect(core().scratch[0].status).toBe('trying');
  });

  it('remove tombstones the id and drops the card', () => {
    scratchActions.add('x', '');
    const id = String(core().scratch[0].id);
    scratchActions.remove(id);
    expect(core().scratch).toHaveLength(0);
    expect(core()._del[id]).toBeTruthy();
  });
});

describe('navigation (Today home + hybrid nav)', () => {
  afterEach(() => {
    currentTab.value = 'today';
  });

  it('openSection drills into a tracker; goHome returns to Today', () => {
    openSection('meal');
    expect(currentTab.value).toBe('meal');
    goHome();
    expect(currentTab.value).toBe('today');
  });

  it('openSection drills into Todos / Scratch (no persistent nav)', () => {
    openSection('todos');
    expect(currentTab.value).toBe('todos');
    openSection('scratch');
    expect(currentTab.value).toBe('scratch');
  });

  it('handleBack returns to Today from a tracker, then reports false at home', () => {
    openSection('workout');
    expect(handleBack()).toBe(true);
    expect(currentTab.value).toBe('today');
    expect(handleBack()).toBe(false);
  });
});

/**
 * todaySession — the frozen daily deck: due reviews take priority up to the cap,
 * fresh questions fill the remaining room, and overflow is the honest backlog
 * left for tomorrow. Seeds a single synthetic topic with N due + M unseen items.
 */
describe('todaySession', () => {
  function seed(dueN: number, freshN: number): void {
    const items: Array<{ id: string; prompt: string; reveal: string; mins: number; flow: 'flip'; src: { book: string; ref: string } }> = [];
    const srs: Record<string, unknown> = {};
    for (let i = 0; i < dueN; i++) {
      const id = 'due' + i;
      items.push({ id, prompt: 'p', reveal: 'r', mins: 5, flow: 'flip', src: { book: 'clrs', ref: 'x' } });
      srs[id] = { due: today, ivl: 1, ease: 2.5, n: 1 }; // due on/before today
    }
    for (let i = 0; i < freshN; i++) {
      const id = 'new' + i;
      items.push({ id, prompt: 'p', reveal: 'r', mins: 5, flow: 'flip', src: { book: 'clrs', ref: 'x' } });
      // no srs, no mastery → unseen
    }
    kgItems.value = { synthetic: items } as never;
    Object.assign(kg(), { mastery: {}, srs, log: [], gymDone: {} });
  }

  it('due fills first, fresh fills the remaining room, total ≤ cap', () => {
    seed(5, 30);
    const s = todaySession(20, 10);
    expect(s.dueN).toBe(5);
    expect(s.newN).toBe(10); // min(newCap 10, room 15)
    expect(s.items).toHaveLength(15);
    // overflow = due beyond cap (0) + fresh not shown (30 - 10 = 20)
    expect(s.overflow).toBe(20);
  });

  it('caps due at the daily cap and pushes the rest to overflow (no room for new)', () => {
    seed(25, 15);
    const s = todaySession(20, 10);
    expect(s.dueN).toBe(20);
    expect(s.newN).toBe(0); // cap exhausted by due
    expect(s.items).toHaveLength(20);
    // overflow = due beyond cap (5) + all fresh (15)
    expect(s.overflow).toBe(20);
  });

  it('at the exact boundary (due === cap) shows 0 new and only fresh overflow', () => {
    seed(20, 4);
    const s = todaySession(20, 10);
    expect(s.dueN).toBe(20);
    expect(s.newN).toBe(0);
    expect(s.overflow).toBe(4); // 0 due-overflow + 4 fresh
  });

  it('an empty bank yields an empty deck and zero overflow', () => {
    seed(0, 0);
    const s = todaySession(20, 10);
    expect(s.items).toHaveLength(0);
    expect(s.overflow).toBe(0);
  });

  it('places every due card before any fresh card in the deck', () => {
    seed(3, 5);
    const s = todaySession(20, 10);
    const dueIdx = s.items.map((it, i) => ({ i, due: it.id.startsWith('due') }));
    const lastDue = Math.max(...dueIdx.filter((x) => x.due).map((x) => x.i));
    const firstFresh = Math.min(...dueIdx.filter((x) => !x.due).map((x) => x.i));
    expect(lastDue).toBeLessThan(firstFresh);
  });
});

/**
 * topicReviewSession — the focused-review deck: ONE topic's due items only, capped
 * at min(due, 10). sessionForTopic routes a `__review__:<id>` kgTopic to it, and
 * everything else to the interleaved todaySession — one engine, one query, scoped.
 */
describe('topicReviewSession / sessionForTopic', () => {
  function seedTopic(topic: string, dueN: number): void {
    const items: Array<{ id: string; prompt: string; reveal: string; mins: number; flow: 'flip'; src: { book: string; ref: string } }> = [];
    const srs: Record<string, unknown> = {};
    for (let i = 0; i < dueN; i++) {
      const id = topic + '-due' + i;
      items.push({ id, prompt: 'p', reveal: 'r', mins: 5, flow: 'flip', src: { book: 'clrs', ref: 'x' } });
      srs[id] = { due: today, ivl: 1, ease: 2.5, n: 1 };
    }
    const map = { ...kgItems.value } as Record<string, unknown>;
    map[topic] = items;
    kgItems.value = map as never;
    Object.assign(kg(), { mastery: {}, srs, log: [], gymDone: {} });
  }

  it('caps the deck at min(due, 10) and scopes it to the topic, with the rest as overflow', () => {
    kgItems.value = {};
    seedTopic('algorithms', 13);
    const s = topicReviewSession('algorithms', 10);
    expect(s.items).toHaveLength(10); // min(13, 10)
    expect(s.dueN).toBe(10);
    expect(s.newN).toBe(0); // a review deck carries no fresh cards
    expect(s.overflow).toBe(3);
    expect(s.items.every((it) => it.id.startsWith('algorithms-'))).toBe(true); // topic-scoped
  });

  it('returns only the topic’s own due items even when other topics are due', () => {
    kgItems.value = {};
    seedTopic('algorithms', 2);
    seedTopic('graph', 4); // seedTopic replaces the srs, so re-add algorithms dues
    Object.assign(kg(), {
      mastery: {},
      srs: { 'algorithms-due0': { due: today }, 'algorithms-due1': { due: today }, 'graph-due0': { due: today }, 'graph-due1': { due: today }, 'graph-due2': { due: today }, 'graph-due3': { due: today } },
      log: [],
      gymDone: {},
    });
    const s = topicReviewSession('graph', 10);
    expect(s.items).toHaveLength(4);
    expect(s.items.every((it) => it.id.startsWith('graph-'))).toBe(true);
  });

  it('sessionForTopic routes a __review__:<id> sentinel to the capped topic deck', () => {
    kgItems.value = {};
    seedTopic('algorithms', 5);
    kgTopic.value = REVIEW_PREFIX + 'algorithms';
    const s = sessionForTopic();
    expect(s.items).toHaveLength(5);
    expect(s.newN).toBe(0);
  });

  it('exitSession returns a review to its TOPIC, and Today’s path to the Rail', () => {
    kgOverview.value = false;
    kgTopic.value = REVIEW_PREFIX + 'algorithms';
    knowledgeActions.exitSession();
    expect(kgTopic.value).toBe('algorithms'); // sentinel stripped → the topic screen
    expect(kgOverview.value).toBe(false);
    kgOverview.value = false;
    kgTopic.value = '__today__';
    knowledgeActions.exitSession();
    expect(kgOverview.value).toBe(true); // Today’s path → the Rail
  });

  it('hardware/browser Back from a focused review returns to its TOPIC, not the Rail (BUG-1)', () => {
    currentTab.value = 'knowledge';
    kgOverview.value = false;
    kgTopic.value = REVIEW_PREFIX + 'algorithms';
    expect(handleBack()).toBe(true);
    expect(kgTopic.value).toBe('algorithms'); // back landed on the topic
    expect(kgOverview.value).toBe(false); // NOT collapsed to the Rail
    currentTab.value = 'today';
  });
});
