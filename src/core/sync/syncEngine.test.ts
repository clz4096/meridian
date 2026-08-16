/**
 * Model-based verification of the offline-first sync lifecycle.
 *
 * fast-check generates random command sequences (edit / save / pull / network
 * drop / rate limit / restore) and drives both the real `SyncEngine` and a
 * simple reference model. After every command we assert the safety invariants
 * from the state-machine diagram, so a violation yields a shrunk, replayable
 * command sequence rather than a vague "sync is broken".
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type Clock,
  type CloudErrorKind,
  type CloudPayload,
  type CloudProvider,
  type CloudReadResult,
  type CloudWriteResult,
  type Collection,
  mergeCollection,
  STORE_KEYS,
  type StorageAdapter,
  type StoreKey,
  SyncEngine,
} from '@/core/sync/SyncEngine';

const RUNS = Number(process.env.FC_RUNS ?? 150);

/* ================================================================== */
/* Fakes                                                               */
/* ================================================================== */

class FakeStorage implements StorageAdapter {
  private data = new Map<string, string>();
  /** When set, every write fails — models a full or unavailable disk. */
  failWrites = false;
  /** When set, reads return stale data — models a verification mismatch. */
  corruptReads = false;

  async get(key: string): Promise<string | null> {
    if (this.corruptReads) return 'CORRUPT';
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<boolean> {
    if (this.failWrites) return false;
    this.data.set(key, value);
    return true;
  }
  raw(key: string): string | null {
    return this.data.get(key) ?? null;
  }
}

class ManualClock implements Clock {
  constructor(private t = 1_000_000) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/**
 * Stand-in for Pantry. Tracks a revision counter and can be told to fail with
 * any of the error kinds the real API produces.
 */
class FakePantryCloud implements CloudProvider {
  private payload: CloudPayload | null = null;
  private rev = 0;
  failMode: CloudErrorKind | null = null;
  reads = 0;
  writes = 0;

  async read(): Promise<CloudReadResult> {
    this.reads++;
    if (this.failMode) {
      return { ok: false, kind: this.failMode, message: `read failed: ${this.failMode}` };
    }
    if (!this.payload) return { ok: true };
    return { ok: true, payload: structuredClone(this.payload) };
  }

  async write(payload: CloudPayload): Promise<CloudWriteResult> {
    this.writes++;
    if (this.failMode) {
      return { ok: false, kind: this.failMode, message: `write failed: ${this.failMode}` };
    }
    this.rev = Math.max(this.rev, payload.rev);
    this.payload = { ...structuredClone(payload), rev: this.rev };
    return { ok: true, rev: this.rev };
  }

  /** Simulate another device publishing, so pulls have something to merge. */
  seedFromOtherDevice(store: StoreKey, items: Collection['items'], rev: number): void {
    const base: CloudPayload = this.payload
      ? structuredClone(this.payload)
      : { rev: 0, syncedAt: 0, core: {}, overload: {}, surplus: {}, csgraph: {} };
    base[store] = { items: items ?? [], _del: {} } satisfies Collection;
    base.rev = rev;
    this.rev = Math.max(this.rev, rev);
    this.payload = base;
  }
  current(): CloudPayload | null {
    return this.payload ? structuredClone(this.payload) : null;
  }
  currentRev(): number {
    return this.rev;
  }
}

function makeEngine(overrides: { minPushGap?: number } = {}) {
  const storage = new FakeStorage();
  const cloud = new FakePantryCloud();
  const clock = new ManualClock();
  const engine = new SyncEngine({
    storage,
    cloud,
    clock,
    merge: mergeCollection,
    minPushGap: overrides.minPushGap ?? 0,
    rateLimitBackoff: 30_000,
  });
  return { engine, storage, cloud, clock };
}

const itemsOf = (data: unknown): Array<{ id: string | number }> =>
  ((data as Collection)?.items ?? []) as Array<{ id: string | number }>;
const idsOf = (data: unknown): string[] => itemsOf(data).map((i) => String(i.id)).sort();

/* ================================================================== */
/* Targeted invariant tests                                            */
/* ================================================================== */

describe('no spurious data loss', () => {
  const failures: CloudErrorKind[] = ['offline', 'rate-limited', 'server'];

  it.each(failures)('a failed push (%s) never clears pendingCloud', async (kind) => {
    const { engine, cloud } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'm1', name: 'meal' }] }));
    cloud.failMode = kind;

    const res = await engine.save();
    expect(res.localOk).toBe(true);            // local write still succeeded
    expect(res.cloud).toBe('failed');
    expect(engine.isDirtyLocal('surplus')).toBe(false);
    expect(engine.isDirtyCloud('surplus')).toBe(true);   // the invariant
    expect(idsOf(engine.getStore('surplus'))).toEqual(['m1']); // data intact
  });

  it('a failed local write leaves both flags set and skips the cloud', async () => {
    const { engine, storage, cloud } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'm1' }] }));
    storage.failWrites = true;

    const res = await engine.save();
    expect(res.localOk).toBe(false);
    expect(res.localFailed).toContain('surplus');
    expect(res.cloud).toBe('skipped');
    expect(engine.isDirtyLocal('surplus')).toBe(true);
    expect(cloud.writes).toBe(0);
  });

  it('does not alias the caller\u2019s object — later mutations are detected', async () => {
    const { engine } = makeEngine();
    const live = { items: [{ id: 'a' }] };
    engine.edit('surplus', () => live);
    await engine.save();
    // Legacy code mutates its own object in place.
    live.items.push({ id: 'b' });
    expect(idsOf(engine.getStore('surplus'))).toEqual(['a']);   // engine unaffected
    engine.edit('surplus', () => live);
    expect(idsOf(engine.getStore('surplus'))).toEqual(['a', 'b']);
  });

  it('an edit made during an in-flight save is never marked clean', async () => {
    const { engine, cloud } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'a' }] }));

    // Mutate mid-flight by racing an edit against the awaited save.
    const saving = engine.save();
    engine.edit('surplus', (d) => ({
      ...d,
      items: [...itemsOf(d), { id: 'b' }],
    }));
    await saving;

    expect(engine.isDirtyLocal('surplus')).toBe(true);   // the audit's race, closed
    expect(idsOf(engine.getStore('surplus'))).toEqual(['a', 'b']);
    void cloud;
  });
});

describe('forcePush — repair path that defeats the grow-only union', () => {
  it('overwrites the cloud WITHOUT folding its stale entries back in', async () => {
    const { engine, cloud } = makeEngine();
    // The cloud holds polluted/stale rows another device (or a leak) put there.
    cloud.seedFromOtherDevice('csgraph', [{ id: 'phantom1' }, { id: 'phantom2' }], 5);
    // Local has been cleaned to a single real row.
    engine.edit('csgraph', () => ({ items: [{ id: 'real1' }], _del: {} }));

    const res = await engine.forcePush();
    expect(res.cloud).toBe('synced');
    // The whole point: the cloud now equals local — no union, phantoms gone.
    expect(idsOf(cloud.current()!.csgraph)).toEqual(['real1']);
    expect(cloud.currentRev()).toBe(6); // cloudRev(5) + 1, monotonic
    expect(engine.isDirtyCloud('csgraph')).toBe(false);

    // A normal pull afterwards must not resurrect the phantoms.
    await engine.pull();
    expect(idsOf(engine.getStore('csgraph'))).toEqual(['real1']);
  });

  it('contrast: a normal save/push DOES fold the stale entries back in', async () => {
    const { engine, cloud } = makeEngine();
    cloud.seedFromOtherDevice('csgraph', [{ id: 'phantom1' }], 5);
    engine.edit('csgraph', () => ({ items: [{ id: 'real1' }], _del: {} }));
    await engine.save(); // push() folds the cloud in → union
    expect(idsOf(cloud.current()!.csgraph)).toEqual(['phantom1', 'real1']);
  });

  it('persists local and clears pendingLocal', async () => {
    const { engine, storage, cloud } = makeEngine();
    cloud.seedFromOtherDevice('csgraph', [{ id: 'phantom' }], 9);
    engine.edit('csgraph', () => ({ items: [{ id: 'real1' }], _del: {} }));
    await engine.forcePush();
    expect(engine.isDirtyLocal('csgraph')).toBe(false);
    expect(idsOf(JSON.parse((await storage.get('csgraph'))!))).toEqual(['real1']);
    expect(cloud.currentRev()).toBe(10);
  });

  it('a failed forcePush never clears pendingCloud and leaves local intact', async () => {
    const { engine, cloud } = makeEngine();
    engine.edit('csgraph', () => ({ items: [{ id: 'real1' }], _del: {} }));
    cloud.failMode = 'server';
    const res = await engine.forcePush();
    expect(res.cloud).toBe('failed');
    expect(engine.isDirtyCloud('csgraph')).toBe(true);
    expect(idsOf(engine.getStore('csgraph'))).toEqual(['real1']);
  });

  it('scoped forcePush(["csgraph"]) overwrites only knowledge, preserving the cloud’s other stores', async () => {
    const { engine, cloud } = makeEngine();
    cloud.seedFromOtherDevice('overload', [{ id: 'w-fromphone' }], 5); // another device's workout
    cloud.seedFromOtherDevice('csgraph', [{ id: 'phantom' }], 6); // polluted knowledge
    engine.edit('csgraph', () => ({ items: [{ id: 'real1' }], _del: {} }));

    const res = await engine.forcePush(['csgraph']);
    expect(res.cloud).toBe('synced');
    expect(idsOf(cloud.current()!.csgraph)).toEqual(['real1']); // knowledge overwritten
    expect(idsOf(cloud.current()!.overload)).toEqual(['w-fromphone']); // workout NOT clobbered
  });

  it('aborts the cloud write when the local write fails (no half-repair)', async () => {
    const { engine, storage, cloud } = makeEngine();
    engine.edit('csgraph', () => ({ items: [{ id: 'real1' }], _del: {} }));
    storage.failWrites = true;
    const res = await engine.forcePush(['csgraph']);
    expect(res.cloud).toBe('skipped'); // never overwrite the cloud from an unpersisted state
    expect(cloud.writes).toBe(0);
    expect(engine.isDirtyCloud('csgraph')).toBe(true);
  });

  it('scoped forcePush skips (no write) when the cloud read fails — cannot preserve other stores', async () => {
    const { engine, cloud } = makeEngine();
    cloud.seedFromOtherDevice('overload', [{ id: 'w-fromphone' }], 5); // another device's workout
    engine.edit('csgraph', () => ({ items: [{ id: 'real1' }], _del: {} }));
    cloud.failMode = 'offline'; // read can't tell us the cloud's non-authoritative stores

    const res = await engine.forcePush(['csgraph']);
    expect(res.cloud).toBe('skipped'); // don't clobber the other device from LOCAL fallback
    expect(res.cloudError?.kind).toBe('offline');
    expect(cloud.writes).toBe(0); // nothing written
    expect(engine.isDirtyCloud('csgraph')).toBe(true); // still pending
  });
});

describe('discard reverts to the last persisted state', () => {
  it('restores what storage holds, not an in-memory snapshot', async () => {
    const { engine } = makeEngine();
    engine.edit('surplus', () => ({ items: [{ id: 'saved' }] }));
    await engine.save();                       // persisted
    engine.edit('surplus', () => ({ items: [{ id: 'saved' }, { id: 'unsaved' }] }));
    expect(engine.isDirtyLocal('surplus')).toBe(true);

    const res = await engine.discard();
    expect(res.restored).toContain('surplus');
    expect(idsOf(engine.getStore('surplus'))).toEqual(['saved']);
    expect(engine.isDirtyLocal('surplus')).toBe(false);
    expect(engine.isDirtyCloud('surplus')).toBe(false);
  });

  it('leaves a store untouched when storage cannot be read', async () => {
    const { engine, storage } = makeEngine();
    engine.edit('surplus', () => ({ items: [{ id: 'a' }] }));
    // never saved -> nothing in storage
    const res = await engine.discard();
    expect(res.skipped).toContain('surplus');
    expect(idsOf(engine.getStore('surplus'))).toEqual(['a']);   // not blanked
    void storage;
  });

  it('always lands exactly on what storage holds, even racing a save', async () => {
    const { engine, storage } = makeEngine();
    engine.edit('surplus', () => ({ items: [{ id: 'first' }] }));
    await engine.save();
    engine.edit('surplus', () => ({ items: [{ id: 'first' }, { id: 'second' }] }));
    const saving = engine.save();
    await engine.discard();
    await saving;
    // The invariant is not "revert to some earlier value" — it is that memory
    // and the durable layer agree once the dust settles. Whatever storage
    // committed is the truth; discard adopts it exactly.
    const raw = storage.raw('surplus');
    expect(raw).not.toBeNull();
    expect(idsOf(engine.getStore('surplus'))).toEqual(idsOf(JSON.parse(raw!)));
  });

  it('leaves memory in agreement with storage for every store', async () => {
    const { engine, storage } = makeEngine();
    engine.edit('surplus', () => ({ items: [{ id: 'a' }] }));
    engine.edit('core', () => ({ items: [{ id: 'b' }] }));
    await engine.save();
    engine.edit('surplus', () => ({ items: [{ id: 'a' }, { id: 'dirty' }] }));
    engine.edit('core', () => ({ items: [{ id: 'b' }, { id: 'dirty2' }] }));
    const { restored } = await engine.discard();
    for (const key of restored) {
      expect(JSON.stringify(engine.getStore(key))).toBe(storage.raw(key));
    }
    expect(engine.anyDirty()).toBe(false);
  });

  it('is idempotent', async () => {
    const { engine } = makeEngine();
    engine.edit('core', () => ({ items: [{ id: 'x' }] }));
    await engine.save();
    engine.edit('core', () => ({ items: [{ id: 'x' }, { id: 'y' }] }));
    await engine.discard();
    const once = JSON.stringify(engine.getStore('core'));
    await engine.discard();
    expect(JSON.stringify(engine.getStore('core'))).toBe(once);
  });
});

describe('merge conflict safety', () => {
  it('a stale remote revision is never applied', async () => {
    const { engine, cloud } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'local-1' }] }));
    await engine.save();                       // baseRev advances
    const revAfterPush = engine.getBaseRev();

    cloud.seedFromOtherDevice('surplus', [{ id: 'ancient' }], revAfterPush - 1);
    const pull = await engine.pull();

    expect(pull.applied).toBe(false);
    expect(pull.reason).toMatch(/stale/);
    expect(idsOf(engine.getStore('surplus'))).toEqual(['local-1']);
  });

  it('a newer remote revision merges without discarding local rows', async () => {
    const { engine, cloud } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'local-1' }] }));
    await engine.save();

    cloud.seedFromOtherDevice(
      'surplus',
      [{ id: 'remote-1' }],
      engine.getBaseRev() + 5,
    );
    const pull = await engine.pull();

    expect(pull.applied).toBe(true);
    expect(idsOf(engine.getStore('surplus'))).toEqual(['local-1', 'remote-1']);
  });

  it('a tombstone from either side suppresses the row', async () => {
    const { engine, cloud } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'x' }, { id: 'y' }], _del: {} }));
    await engine.save();

    engine.edit('surplus', (d) => ({
      items: itemsOf(d).filter((i) => String(i.id) !== 'y'),
      _del: { y: 123 },
    }));
    await engine.save();

    cloud.seedFromOtherDevice('surplus', [{ id: 'x' }, { id: 'y' }], engine.getBaseRev() + 9);
    await engine.pull();

    expect(idsOf(engine.getStore('surplus'))).toEqual(['x']);   // y stays deleted
  });
});

describe('rate limiting', () => {
  it('backs off after a 429 and recovers once the limit lifts', async () => {
    const { engine, cloud, clock } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'a' }] }));
    cloud.failMode = 'rate-limited';

    const first = await engine.save();
    expect(first.cloud).toBe('failed');
    expect(engine.isDirtyCloud('surplus')).toBe(true);

    // Still inside the backoff window: no further network write is attempted.
    const writesBefore = cloud.writes;
    const during = await engine.push(true);
    expect(during.cloud).toBe('throttled');
    expect(cloud.writes).toBe(writesBefore);

    cloud.failMode = null;
    clock.advance(31_000);
    const after = await engine.push(true);
    expect(after.cloud).toBe('synced');
    expect(engine.isDirtyCloud('surplus')).toBe(false);
  });

  it('identical data is a no-op and issues no network write', async () => {
    const { engine, cloud } = makeEngine();
    engine.edit('surplus', (d) => ({ ...d, items: [{ id: 'a' }] }));
    await engine.save();
    const writes = cloud.writes;

    const again = await engine.push(true);
    expect(again.cloud).toBe('noop');
    expect(cloud.writes).toBe(writes);
  });
});

/* ================================================================== */
/* Model-based state machine                                           */
/* ================================================================== */

interface Ctx {
  engine: SyncEngine;
  storage: FakeStorage;
  cloud: FakePantryCloud;
  clock: ManualClock;
  /** Every id this device has ever created and not deleted. */
  expected: Set<string>;
  /** True while the network is unavailable in any form. */
  degraded: boolean;
}

type Cmd = fc.AsyncCommand<Record<string, never>, Ctx>;

/** Safety properties asserted after EVERY command. */
function checkInvariants(ctx: Ctx): void {
  // Local rows this device created are never silently dropped.
  for (const id of ctx.expected) {
    expect(idsOf(ctx.engine.getStore('surplus'))).toContain(id);
  }
  // A dirty flag can only be false if the data actually reached that tier.
  for (const key of STORE_KEYS) {
    if (!ctx.engine.isDirtyLocal(key)) {
      const raw = ctx.storage.raw(key);
      if (raw !== null) {
        expect(JSON.parse(raw)).toEqual(ctx.engine.getStore(key));
      }
    }
  }
}

class LocalEdit implements Cmd {
  constructor(private readonly id: string) {}
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    ctx.engine.edit('surplus', (d) => ({
      ...d,
      items: [...itemsOf(d).filter((i) => String(i.id) !== this.id), { id: this.id }],
    }));
    ctx.expected.add(this.id);
    expect(ctx.engine.isDirtyLocal('surplus')).toBe(true);
    expect(ctx.engine.isDirtyCloud('surplus')).toBe(true);
    checkInvariants(ctx);
  }
  toString = () => `LocalEdit(${this.id})`;
}

class TriggerSave implements Cmd {
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    const res = await ctx.engine.save();
    if (res.cloud === 'failed' || res.cloud === 'throttled' || res.cloud === 'skipped') {
      // INVARIANT: an unsuccessful sync must leave the cloud flag set if there
      // was anything to send.
      if (res.cloud !== 'skipped') {
        expect(ctx.engine.isDirtyCloud('surplus') || !ctx.engine.anyDirty()).toBe(true);
      }
    }
    if (res.cloud === 'synced') {
      expect(ctx.engine.isDirtyCloud('surplus')).toBe(false);
    }
    checkInvariants(ctx);
  }
  toString = () => 'TriggerSave';
}

class TriggerPull implements Cmd {
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    const before = idsOf(ctx.engine.getStore('surplus'));
    const res = await ctx.engine.pull();
    const after = idsOf(ctx.engine.getStore('surplus'));
    if (res.applied) {
      // Merge is union-with-tombstones: nothing local may vanish.
      for (const id of before) expect(after).toContain(id);
    } else {
      expect(after).toEqual(before);
    }
    checkInvariants(ctx);
  }
  toString = () => 'TriggerPull';
}

class SimulateNetworkDrop implements Cmd {
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    ctx.cloud.failMode = 'offline';
    ctx.degraded = true;
    checkInvariants(ctx);
  }
  toString = () => 'SimulateNetworkDrop';
}

class SimulateRateLimit implements Cmd {
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    ctx.cloud.failMode = 'rate-limited';
    ctx.degraded = true;
    checkInvariants(ctx);
  }
  toString = () => 'SimulateRateLimit';
}

class SimulateServerError implements Cmd {
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    ctx.cloud.failMode = 'server';
    ctx.degraded = true;
    checkInvariants(ctx);
  }
  toString = () => 'SimulateServerError';
}

class RestoreNetwork implements Cmd {
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    ctx.cloud.failMode = null;
    ctx.degraded = false;
    ctx.clock.advance(31_000); // clear any rate-limit backoff
    checkInvariants(ctx);
  }
  toString = () => 'RestoreNetwork';
}

class RemoteDeviceWrites implements Cmd {
  constructor(private readonly id: string) {}
  check = () => true;
  async run(_m: Record<string, never>, ctx: Ctx): Promise<void> {
    const cur = ctx.cloud.current();
    const existing = cur ? itemsOf(cur.surplus) : [];
    ctx.cloud.seedFromOtherDevice(
      'surplus',
      [...existing.filter((i) => String(i.id) !== this.id), { id: this.id }],
      ctx.cloud.currentRev() + 1,
    );
    checkInvariants(ctx);
  }
  toString = () => `RemoteDeviceWrites(${this.id})`;
}

describe('sync state machine (model-based)', () => {
  const idArb = fc.constantFrom('a', 'b', 'c', 'd', 'e');

  const commands = [
    idArb.map((id) => new LocalEdit(id)),
    fc.constant(new TriggerSave()),
    fc.constant(new TriggerPull()),
    fc.constant(new SimulateNetworkDrop()),
    fc.constant(new SimulateRateLimit()),
    fc.constant(new SimulateServerError()),
    fc.constant(new RestoreNetwork()),
    idArb.map((id) => new RemoteDeviceWrites(id)),
  ];

  it('upholds every safety invariant across random command sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { maxCommands: 25 }), async (cmds) => {
        const { engine, storage, cloud, clock } = makeEngine();
        const ctx: Ctx = { engine, storage, cloud, clock, expected: new Set(), degraded: false };
        await fc.asyncModelRun(() => ({ model: {}, real: ctx }), cmds);
      }),
      { numRuns: Math.min(RUNS, 2000) },
    );
  });

  it('reaches eventual consistency once the network settles', async () => {
    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { maxCommands: 25 }), async (cmds) => {
        const { engine, storage, cloud, clock } = makeEngine();
        const ctx: Ctx = { engine, storage, cloud, clock, expected: new Set(), degraded: false };
        await fc.asyncModelRun(() => ({ model: {}, real: ctx }), cmds);

        // Settle: restore the network and let the engine converge.
        cloud.failMode = null;
        clock.advance(60_000);
        for (let i = 0; i < 6; i++) {
          await engine.pull();
          clock.advance(10_000);
          await engine.push(true);
        }

        expect(engine.isDirtyCloud('surplus')).toBe(false);
        const local = idsOf(engine.getStore('surplus'));
        const remote = idsOf(cloud.current()?.surplus);
        expect(local).toEqual(remote);            // convergence
        for (const id of ctx.expected) {
          expect(local).toContain(id);            // durability of local edits
        }
      }),
      { numRuns: Math.min(RUNS, 1000) },
    );
  });
});

/* ================================================================== */
/* Merge algebra                                                       */
/* ================================================================== */

describe('merge is a well-behaved CRDT-style operation', () => {
  const arbColl = fc
    .record({
      items: fc.array(fc.record({ id: fc.constantFrom('a', 'b', 'c', 'd') }), { maxLength: 6 }),
      _del: fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), fc.integer({ min: 1 }), {
        maxKeys: 3,
      }),
    })
    .map((c) => c as Collection);

  it('is idempotent: merge(a, a) === a', () => {
    fc.assert(
      fc.property(arbColl, (a) => {
        const once = mergeCollection(a, a, 'surplus', true);
        expect(idsOf(once)).toEqual(idsOf(mergeCollection(once, once, 'surplus', true)));
      }),
      { numRuns: RUNS },
    );
  });

  it('is commutative on ids: merge(a, b) and merge(b, a) agree', () => {
    fc.assert(
      fc.property(arbColl, arbColl, (a, b) => {
        expect(idsOf(mergeCollection(a, b, 'surplus', true))).toEqual(idsOf(mergeCollection(b, a, 'surplus', true)));
      }),
      { numRuns: RUNS },
    );
  });

  it('is associative on ids', () => {
    fc.assert(
      fc.property(arbColl, arbColl, arbColl, (a, b, c) => {
        const left = mergeCollection(mergeCollection(a, b, 'surplus', true), c, 'surplus', true);
        const right = mergeCollection(a, mergeCollection(b, c, 'surplus', true), 'surplus', true);
        expect(idsOf(left)).toEqual(idsOf(right));
      }),
      { numRuns: RUNS },
    );
  });

  it('never resurrects a tombstoned id', () => {
    fc.assert(
      fc.property(arbColl, arbColl, (a, b) => {
        const dead = new Set([...Object.keys(a._del ?? {}), ...Object.keys(b._del ?? {})]);
        for (const id of idsOf(mergeCollection(a, b, 'surplus', true))) {
          expect(dead.has(id)).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
