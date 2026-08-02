/**
 * app — the view-mounting orchestration. Driven through a fake AppHost + a fake
 * MeridianCore surface, so routing, the load→mount→repaint gating, and the view
 * action callbacks are covered without a DOM or the real core.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import type { AppHost } from './appHost.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeHost() {
  const panes: Record<string, { innerHTML: string }> = {
    workout: { innerHTML: '' },
    meal: { innerHTML: '' },
    knowledge: { innerHTML: '' },
    data: { innerHTML: '' },
  };
  const values: Record<string, string> = {};
  const status: Record<string, string> = {};
  const host = {
    pane: (t: string) => panes[t],
    showTab: vi.fn(),
    onTabChange: vi.fn(),
    readValue: (id: string) => values[id] ?? '',
    setValue: vi.fn((id: string, v: string) => (values[id] = v)),
    status: (id: string) => ({ set: (text: string) => (status[id] = text) }),
    confirm: vi.fn(() => true),
    prompt: vi.fn(() => '10'),
    copy: vi.fn(async () => true),
    reload: vi.fn(),
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    paintSaveChip: vi.fn(),
    flashSaved: vi.fn(),
    onSave: vi.fn(),
    onDiscard: vi.fn(),
    restBar: { paint: vi.fn(), hide: vi.fn(), onStop: vi.fn() },
    onLifecycle: vi.fn(),
  } as unknown as AppHost;
  return { host, panes, values, status };
}

function fakeAppState() {
  const stores: Record<string, any> = {
    core: { schedule: {}, entries: [] },
    overload: { settings: {}, days: {}, bw: {}, done: {} },
    surplus: { settings: { current: 120 }, days: {}, tad: {} },
    csgraph: { mastery: {}, srs: {}, log: [], gymDone: {} },
  };
  return {
    get: (k: string) => stores[k],
    set: vi.fn((k: string, v: any) => (stores[k] = v)),
    loadWorkout: vi.fn(async () => stores.overload),
    loadMeal: vi.fn(async () => stores.surplus),
    loadKnowledge: vi.fn(async (cur: any) => cur),
    markDirty: vi.fn(),
    markWorkoutDirty: vi.fn(),
    markMealDirty: vi.fn(),
    markKnowledgeDirty: vi.fn(),
    tomb: vi.fn(),
    save: vi.fn(async () => ({})),
    anyDirty: () => false,
    _stores: stores,
  };
}

function fakeMC() {
  const captured: Record<string, any> = {};
  const controller = () => ({ repaint: vi.fn(), clearEdits: vi.fn() });
  return {
    captured,
    data: {
      books: { b1: { t: 'Book', u: 'http://x' } },
      topics: [{ id: 'algorithms', name: 'Algorithms', books: ['b1'] }],
      gym: {},
      targets: ['faang'],
      exVideo: { Bench: 'http://v' },
      defaultWorkout: { settings: {}, days: {} },
    },
    fetchQuestionBank: vi.fn(async () => ({
      manifest: {},
      items: { algorithms: [{ id: 'q1', mins: 5, prompt: 'Prompt one', src: { book: 'b1', ref: '1' } }] },
    })),
    mountWorkoutView: vi.fn((cfg: any) => {
      captured.workout = cfg.actions;
      return controller();
    }),
    mountMealView: vi.fn((_pane: any, actions: any) => {
      captured.meal = actions;
      return controller();
    }),
    mountKnowledgeView: vi.fn((_pane: any, actions: any) => {
      captured.knowledge = actions;
      return controller();
    }),
    mountDataView: vi.fn((_pane: any, actions: any) => {
      captured.data = actions;
      return controller();
    }),
    selectWorkoutView: vi.fn(() => ({ plans: {} })),
    restSeconds: vi.fn(() => 180),
    inferIncrement: vi.fn(() => 5),
    shiftDate: vi.fn((d: string) => d),
    schedule: vi.fn(() => ({ due: 'x', ivl: 1, ease: 2.3, n: 0 })),
    dueCards: vi.fn(() => []),
    aiCall: vi.fn(async () => ({ ok: true, text: 'answer' })),
    estimateMacros: vi.fn(async () => ({ name: 'X', cal: 1, protein: 1 })),
    exportBundle: vi.fn(() => ({ bundle: true })),
    serialise: vi.fn(() => 'SERIALISED'),
    importBundle: vi.fn(() => ({ ok: true, state: {}, warnings: [] })),
    normaliseState: vi.fn((s: any) => s),
    storageMetrics: vi.fn(() => ({ kilobytes: 1, counts: { tombstones: 0 } })),
    sync: { isDirtyCloud: vi.fn(() => false), baseRev: vi.fn(() => 1), save: vi.fn(async () => ({ cloud: 'synced' })), pull: vi.fn(async () => false) },
  };
}

function setup() {
  const h = fakeHost();
  const appState = fakeAppState();
  const MC = fakeMC();
  const app = createApp(h.host, {
    MC: MC as any,
    appState: appState as any,
    keys: { core: 'c', overload: 'o', surplus: 's', csgraph: 'k' },
    uid: (() => {
      let n = 0;
      return () => `id${n++}`;
    })(),
    today: () => '2026-07-31',
    now: () => 1000,
    dateLabel: (d: string) => d,
    cloudEnabled: () => false,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  return { app, ...h, appState, MC, captured: MC.captured };
}

describe('render gating + mount caching', () => {
  it('renderKnowledge shows Loading, then loads, mounts, and repaints', async () => {
    const t = setup();
    t.app.renderKnowledge();
    expect(t.panes.knowledge.innerHTML).toContain('Loading');
    expect(t.MC.fetchQuestionBank).not.toBeUndefined();
    await flush();
    await flush();
    expect(t.MC.fetchQuestionBank).toHaveBeenCalled();
    expect(t.MC.mountKnowledgeView).toHaveBeenCalledTimes(1);
  });

  it('re-rendering a loaded tab does not re-mount the view', async () => {
    const t = setup();
    t.app.renderKnowledge();
    await flush();
    await flush();
    t.app.renderKnowledge();
    t.app.renderKnowledge();
    expect(t.MC.mountKnowledgeView).toHaveBeenCalledTimes(1); // cached
  });

  it('renderWeight loads the meal store then mounts', async () => {
    const t = setup();
    t.app.renderWeight();
    expect(t.panes.meal.innerHTML).toContain('Loading');
    await flush();
    await flush();
    expect(t.appState.loadMeal).toHaveBeenCalled();
    expect(t.MC.mountMealView).toHaveBeenCalledTimes(1);
  });

  it('renderData mounts immediately (no async load gate)', () => {
    const t = setup();
    t.app.renderData();
    expect(t.MC.mountDataView).toHaveBeenCalledTimes(1);
  });

  it('renderAll renders every tab', async () => {
    const t = setup();
    t.app.renderAll();
    await flush();
    await flush();
    expect(t.MC.mountKnowledgeView).toHaveBeenCalled();
    expect(t.MC.mountMealView).toHaveBeenCalled();
    expect(t.MC.mountDataView).toHaveBeenCalled();
  });
});

describe('view actions', () => {
  async function mountAll(t: ReturnType<typeof setup>) {
    t.app.renderKnowledge();
    t.app.renderWeight();
    t.app.renderData();
    t.app.renderWorkout();
    await flush();
    await flush();
  }

  it('meal addMeal appends to the day and marks the store dirty', async () => {
    const t = setup();
    await mountAll(t);
    t.captured.meal.addMeal('Eggs', 300, 20);
    expect(t.appState._stores.surplus.days['2026-07-31']).toHaveLength(1);
    expect(t.appState._stores.surplus.days['2026-07-31'][0]).toMatchObject({ name: 'Eggs', cal: 300, protein: 20 });
    expect(t.appState.markMealDirty).toHaveBeenCalled();
    expect(t.host.setValue).toHaveBeenCalledWith('meal-cal', ''); // form cleared
  });

  it('meal addMeal with all-empty shows a status and does not append', async () => {
    const t = setup();
    await mountAll(t);
    t.captured.meal.addMeal('', '', '');
    expect(t.status['meal-status']).toContain('Enter a meal');
    expect(t.appState._stores.surplus.days['2026-07-31']).toBeUndefined();
    expect(t.appState.markMealDirty).not.toHaveBeenCalled();
  });

  it('knowledge rate records mastery + a core entry and marks dirty', async () => {
    const t = setup();
    await mountAll(t);
    t.captured.knowledge.rate('q1', 4);
    expect(t.appState._stores.csgraph.mastery.q1).toBe(4);
    expect(t.appState._stores.core.entries).toHaveLength(1);
    expect(t.appState._stores.core.entries[0]).toMatchObject({ stream: 'kg', status: 'solved', score: 4 });
    expect(t.appState.markKnowledgeDirty).toHaveBeenCalled();
    expect(t.appState.markDirty).toHaveBeenCalled();
  });

  it('workout logSet appends a set on the selected day and marks dirty', async () => {
    const t = setup();
    await mountAll(t);
    t.captured.workout.logSet('Bench', 'top', 135, 5);
    expect(t.appState._stores.overload.days['2026-07-31']).toHaveLength(1);
    expect(t.appState._stores.overload.days['2026-07-31'][0]).toMatchObject({ ex: 'Bench', weight: 135, reps: 5 });
    expect(t.appState.markWorkoutDirty).toHaveBeenCalled();
  });

  it('data export re-renders first, THEN populates d-io (BUG-3 fix)', async () => {
    const t = setup();
    await mountAll(t);
    t.captured.data.exportAll();
    // the fix orders dmsg (re-render) before setValue so the value survives the repaint
    expect(t.host.setValue).toHaveBeenCalledWith('d-io', 'SERIALISED');
  });

  it('data restoreSnapshot reports gracefully when no snapshot exists (BUG-2 fix)', async () => {
    const t = setup();
    await mountAll(t);
    t.captured.data.restoreSnapshot(); // host.getItem returns null → no throw
    expect(t.status['d-diagout'] ?? '').toBe(''); // no crash; message goes through dmsg, not a throw
    expect(t.host.reload).not.toHaveBeenCalled();
  });
});
