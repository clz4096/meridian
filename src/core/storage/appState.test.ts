/**
 * appState — the save/sync/dirty core. Clock, scheduler, store read, and the
 * SyncEngine facade are all injected, so this covers the loaders' seeding/merge
 * logic and the dirty/autosave/flush/discard lifecycle with plain fakes.
 */
import { describe, expect, it, vi } from 'vitest';
import { createAppState, type SaveResult, type StoreKey } from '@/core/storage/appState';

type Store = Record<string, any>;

function build(opts: { stored?: Partial<Record<StoreKey, string>>; anyDirtyCloud?: () => boolean } = {}) {
  const stored = opts.stored ?? {};
  const keys: Record<StoreKey, string> = {
    core: 'meridian-core',
    overload: 'overload-tracker-state',
    surplus: 'surplus-tracker-state',
    csgraph: 'csgraph_profile_v2',
  };
  const keyToStore: Record<string, StoreKey> = Object.fromEntries(
    (Object.keys(keys) as StoreKey[]).map((k) => [keys[k], k]),
  );

  const stores: Record<StoreKey, Store> = { core: {}, overload: {}, surplus: {}, csgraph: {} };
  const written: Array<{ key: StoreKey; data: Store }> = [];

  const host = { paintSaveChip: vi.fn(), flashSaved: vi.fn() };
  let cloudDirty = opts.anyDirtyCloud ?? (() => false);

  let capturedOnStatus: ((r: SaveResult) => void) | undefined;
  const saveResult: SaveResult = { localOk: true, localFailed: [], cloud: 'synced', cloudError: null };
  const discardResult = { restored: [] as StoreKey[], skipped: [] as StoreKey[] };
  const sync = {
    create: vi.fn((cfg: any) => {
      capturedOnStatus = cfg.onStatus;
      return {};
    }),
    save: vi.fn(async () => saveResult),
    discard: vi.fn(async () => discardResult),
    anyDirty: vi.fn(() => cloudDirty()),
    baseRev: vi.fn(() => 7),
  };

  let timers: Array<() => void> = [];
  const setTimeout = vi.fn((fn: () => void) => {
    timers.push(fn);
    return timers.length;
  });
  const clearTimeout = vi.fn();
  const onExternalChange = vi.fn();
  const markFlush = vi.fn();

  const defaultWorkout: Store = {
    settings: { unit: 'lb' },
    days: { push: [{ id: 'def-dip', ex: 'Dip' }] },
  };

  const appState = createAppState({
    host,
    storeGet: async (k: string) => stored[keyToStore[k]] ?? null,
    sync: sync as any,
    keys,
    defaultWorkout,
    read: (k) => stores[k] || {},
    write: (k, d) => {
      stores[k] = d;
      written.push({ key: k, data: d });
    },
    now: () => 123,
    setTimeout,
    clearTimeout,
    onExternalChange,
    markFlush,
  });
  appState.init(); // wires the sync engine (captures onStatus) — the real boot does this once

  return {
    appState,
    host,
    sync,
    stores,
    written,
    setTimeout,
    clearTimeout,
    onExternalChange,
    markFlush,
    saveResult,
    discardResult,
    runTimers: () => timers.splice(0).forEach((f) => f()),
    setCloudDirty: (fn: () => boolean) => (cloudDirty = fn),
    onStatus: (r: SaveResult) => capturedOnStatus?.(r),
  };
}

describe('appState loaders', () => {
  it('loadCore returns a fresh shape when storage is empty', async () => {
    const t = build();
    expect(await t.appState.loadCore()).toEqual({ schedule: {}, entries: [], todos: [], scratch: [] });
  });

  it('loadCore parses stored JSON and backfills missing fields', async () => {
    const t = build({ stored: { core: JSON.stringify({ entries: [{ id: 'e1' }] }) } });
    const core = await t.appState.loadCore();
    expect(core.entries).toEqual([{ id: 'e1' }]);
    expect(core.schedule).toEqual({}); // backfilled
  });

  it('loadCore recovers from corrupt JSON', async () => {
    const t = build({ stored: { core: '{not json' } });
    expect(await t.appState.loadCore()).toEqual({ schedule: {}, entries: [], todos: [], scratch: [] });
  });

  it('loadWorkout seeds the baked default when storage is empty', async () => {
    const t = build();
    const wk: any = await t.appState.loadWorkout();
    expect(wk.days.push).toEqual([{ id: 'def-dip', ex: 'Dip' }]);
    expect(wk.settings.unit).toBe('lb');
    // deep clone — mutating the result must not touch the injected default
    wk.days.push[0].ex = 'MUTATED';
    const wk2: any = await t.appState.loadWorkout();
    expect(wk2.days.push[0].ex).toBe('Dip');
  });

  it('loadWorkout seeds the default when stored days are empty', async () => {
    const t = build({ stored: { overload: JSON.stringify({ settings: {}, days: {} }) } });
    const wk: any = await t.appState.loadWorkout();
    expect(wk.days.push).toEqual([{ id: 'def-dip', ex: 'Dip' }]);
  });

  it('loadWorkout keeps stored data but merges in unseen default exercises', async () => {
    const stored = { settings: { unit: 'kg' }, days: { mon: [{ id: 'm1', ex: 'Bench' }] } };
    const t = build({ stored: { overload: JSON.stringify(stored) } });
    const wk: any = await t.appState.loadWorkout();
    expect(wk.days.mon).toEqual([{ id: 'm1', ex: 'Bench' }]); // stored preserved
    expect(wk.settings.unit).toBe('kg'); // stored settings win
    expect(wk.days.push).toEqual([{ id: 'def-dip', ex: 'Dip' }]); // Dip merged in (not present in stored)
  });

  it('loadWorkout does NOT merge a default exercise the device already has', async () => {
    const stored = { settings: {}, days: { mon: [{ id: 'x', ex: 'Dip' }] } };
    const t = build({ stored: { overload: JSON.stringify(stored) } });
    const wk: any = await t.appState.loadWorkout();
    expect(wk.days.push).toBeUndefined(); // Dip already present → default push day not added
  });

  it('loadMeal bakes in default settings on a fresh device', async () => {
    const t = build();
    const sg = await t.appState.loadMeal();
    expect(sg.settings).toMatchObject({ current: 120, goal: 147, maintenance: 2200, surplus: 500, proteinTarget: 147 });
    expect(sg.days).toEqual({});
  });

  it('loadMeal keeps stored settings and only backfills the gaps', async () => {
    const t = build({ stored: { surplus: JSON.stringify({ settings: { current: 200 }, days: { d: [] } }) } });
    const sg = await t.appState.loadMeal();
    expect(sg.settings.current).toBe(200); // stored wins
    expect(sg.settings.maintenance).toBe(2200); // gap backfilled
    expect(sg.days).toEqual({ d: [] });
  });

  it('loadKnowledge replaces current only when stored has mastery', async () => {
    const t = build({ stored: { csgraph: JSON.stringify({ mastery: { q1: 5 } }) } });
    const kg = await t.appState.loadKnowledge({ mastery: {}, srs: {}, log: [], gymDone: {} });
    expect(kg.mastery).toEqual({ q1: 5 });
    expect(kg.srs).toEqual({}); // backfilled
  });

  it('loadKnowledge keeps current when stored has no mastery', async () => {
    const t = build({ stored: { csgraph: JSON.stringify({ log: [1] }) } });
    const current = { mastery: { keep: 1 }, srs: {}, log: [], gymDone: {} };
    const kg = await t.appState.loadKnowledge(current);
    expect(kg.mastery).toEqual({ keep: 1 }); // current preserved
  });
});

describe('appState dirty tracking + autosave', () => {
  it('markDirty paints dirty and arms the debounced autosave', () => {
    const t = build();
    t.appState.markDirty();
    expect(t.host.paintSaveChip).toHaveBeenLastCalledWith({ dirty: true, text: undefined, failed: false });
    expect(t.setTimeout).toHaveBeenCalledTimes(1);
    // the armed timer saves
    t.runTimers();
    expect(t.sync.save).toHaveBeenCalledTimes(1);
  });

  it('per-view marks flag dirty and arm the autosave (quiet auto-save status)', () => {
    const t = build();
    t.appState.markWorkoutDirty();
    t.appState.markMealDirty();
    t.appState.markKnowledgeDirty();
    expect(t.host.paintSaveChip).toHaveBeenCalledTimes(3);
    expect(t.setTimeout).toHaveBeenCalled();
    expect(t.appState.anyDirty()).toBe(true);
  });

  it('markDirty clears any prior armed autosave first', () => {
    const t = build();
    t.appState.markDirty();
    t.appState.markDirty();
    expect(t.clearTimeout).toHaveBeenCalled();
  });

  it('anyDirty reflects the cloud engine even when local is clean', () => {
    const t = build({ anyDirtyCloud: () => true });
    expect(t.appState.anyDirty()).toBe(true);
  });
});

describe('appState save / flush / discard', () => {
  it('save delegates to the engine', async () => {
    const t = build();
    await t.appState.save();
    expect(t.sync.save).toHaveBeenCalledTimes(1);
  });

  it('flush saves and records the marker with the reason', () => {
    const t = build();
    t.appState.flush('pagehide');
    expect(t.sync.save).toHaveBeenCalledTimes(1);
    expect(t.markFlush).toHaveBeenCalledWith('pagehide');
  });

  it('discard with nothing restored returns false and leaves dirty state', async () => {
    const t = build();
    t.appState.markDirty();
    const ok = await t.appState.discard();
    expect(ok).toBe(false);
    expect(t.onExternalChange).not.toHaveBeenCalled();
    expect(t.appState.anyDirty()).toBe(true); // still dirty
  });

  it('discard that restores clears local dirty, repaints, and re-renders (BUG-1 fix)', async () => {
    const t = build();
    t.discardResult.restored = ['surplus'];
    t.appState.markMealDirty();
    expect(t.appState.anyDirty()).toBe(true);
    const ok = await t.appState.discard();
    expect(ok).toBe(true);
    expect(t.appState.anyDirty()).toBe(false); // dirty flag cleared after a successful revert
    expect(t.onExternalChange).toHaveBeenCalledTimes(1);
    expect(t.host.paintSaveChip).toHaveBeenLastCalledWith({ dirty: false, text: undefined, failed: false });
  });

  it('baseRev delegates to the engine', () => {
    expect(build().appState.baseRev()).toBe(7);
  });
});

describe('appState onStatus chip messaging', () => {
  const cases: Array<[Partial<SaveResult>, string, boolean]> = [
    [{ localOk: false, localFailed: ['core', 'surplus'] }, 'Save failed: core, surplus', true],
    [{ cloud: 'synced' }, 'All changes saved', false],
    [{ cloud: 'noop' }, 'All changes saved · cloud already in sync', false],
    [{ cloud: 'throttled' }, 'Saved · cloud sync queued', false],
    // Local write ok + cloud failed = data-safe → not flagged failed (cloud retries; Data tab shows it).
    [{ cloud: 'failed', cloudError: { message: 'boom' } }, 'Saved here only — cloud: boom', false],
  ];
  it.each(cases)('maps %o to the right chip', (partial, text, failed) => {
    const t = build();
    t.appState.markDirty(); // set local dirty first
    t.onStatus({ localOk: true, localFailed: [], cloud: 'synced', cloudError: null, ...partial });
    // onStatus resets local dirty and the fake cloud is clean, so `dirty` is false;
    // the `failed` flag is what drives the dirty *styling* in the host.
    expect(t.host.paintSaveChip).toHaveBeenLastCalledWith({ dirty: false, text, failed });
  });

  it('onStatus resets the local dirty flag', () => {
    const t = build();
    t.appState.markDirty();
    expect(t.appState.anyDirty()).toBe(true);
    t.onStatus({ localOk: true, localFailed: [], cloud: 'synced', cloudError: null });
    expect(t.appState.anyDirty()).toBe(false);
  });
});

describe('appState store bridge', () => {
  it('init wires the sync engine with the read/write bridge', () => {
    const t = build(); // build() already calls init() once
    expect(t.sync.create).toHaveBeenCalledTimes(1);
    expect(t.sync.create).toHaveBeenCalledWith(
      expect.objectContaining({ read: expect.any(Function), write: expect.any(Function), onStatus: expect.any(Function) }),
    );
  });

  it('get reads and set writes through the bridge', () => {
    const t = build();
    t.appState.set('overload', { days: { a: 1 } });
    expect(t.stores.overload).toEqual({ days: { a: 1 } });
    expect(t.appState.get('overload')).toEqual({ days: { a: 1 } });
    expect(t.written).toContainEqual({ key: 'overload', data: { days: { a: 1 } } });
  });
});
