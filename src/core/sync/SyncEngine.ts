/**
 * Meridian — offline-first sync engine.
 *
 * Extracted from `saveAll` / `cloudPush` so the sync lifecycle can be verified
 * independently of the browser. Every side effect arrives through an injected
 * port (`StorageAdapter`, `CloudProvider`, `Clock`), so the engine itself is
 * deterministic and can be driven by a model-based test.
 *
 * Two flaws from the architecture audit are fixed structurally here:
 *
 *  1. The silent data-loss window. The original cleared a dirty flag after a
 *     successful write, even if the user had edited again mid-flight. Each
 *     store now carries a monotonic `rev`; the flag is only cleared when the
 *     rev is unchanged from the moment the payload was captured.
 *
 *  2. Conflating local and cloud durability. `pendingLocal` and `pendingCloud`
 *     are tracked separately, so a failed network push can never make the UI
 *     claim the data is synced.
 */

export type StoreKey = 'core' | 'overload' | 'surplus' | 'csgraph';
export const STORE_KEYS: readonly StoreKey[] = ['core', 'overload', 'surplus', 'csgraph'];

/** A store is any JSON-serialisable record; merge semantics are injected. */
export type StoreData = Record<string, unknown>;
export type Snapshot = Record<StoreKey, StoreData>;

export interface CloudPayload {
  rev: number;
  syncedAt: number;
  core: StoreData;
  overload: StoreData;
  surplus: StoreData;
  csgraph: StoreData;
}

export type CloudErrorKind = 'offline' | 'rate-limited' | 'server' | 'not-found' | 'unknown';

export interface CloudReadResult {
  ok: boolean;
  payload?: CloudPayload;
  kind?: CloudErrorKind;
  message?: string;
}

export interface CloudWriteResult {
  ok: boolean;
  rev?: number;
  kind?: CloudErrorKind;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Ports                                                               */
/* ------------------------------------------------------------------ */

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
}

export interface CloudProvider {
  read(): Promise<CloudReadResult>;
  write(payload: CloudPayload): Promise<CloudWriteResult>;
}

export interface Clock {
  now(): number;
}

/** Merge two versions of one store. Must be commutative and idempotent. */
export type MergeFn = (local: StoreData, remote: StoreData, key: StoreKey, localWins: boolean) => StoreData;

/**
 * Runs on each store immediately before it is written. This is where
 * tombstone pruning lives, so the bound is enforced on every save rather than
 * only when a cloud merge happens.
 */
export type SanitizeFn = (key: StoreKey, data: StoreData, now: number) => StoreData;

export interface SyncEngineOptions {
  storage: StorageAdapter;
  cloud: CloudProvider;
  clock: Clock;
  merge: MergeFn;
  sanitize?: SanitizeFn;
  /** Minimum gap between network writes, ms. */
  minPushGap?: number;
  /** How long to back off after a rate-limit response, ms. */
  rateLimitBackoff?: number;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface SaveResult {
  localOk: boolean;
  /** stores that failed to write or verify locally */
  localFailed: StoreKey[];
  cloud: 'skipped' | 'synced' | 'noop' | 'throttled' | 'failed';
  cloudError?: { kind: CloudErrorKind; message: string };
}

export interface PullResult {
  ok: boolean;
  applied: boolean;
  reason?: string;
  kind?: CloudErrorKind;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export class SyncEngine {
  private readonly storage: StorageAdapter;
  private readonly cloud: CloudProvider;
  private readonly clock: Clock;
  private readonly merge: MergeFn;
  private readonly sanitize: SanitizeFn;
  private readonly minPushGap: number;
  private readonly rateLimitBackoff: number;

  private stores: Snapshot;
  /** Monotonic mutation counter per store — the fix for the mid-save race. */
  private rev: Record<StoreKey, number>;
  private pendingLocal: Record<StoreKey, boolean>;
  private pendingCloud: Record<StoreKey, boolean>;

  private baseRev = 0;
  private lastFingerprint: string | null = null;
  private lastPushAt = 0;
  private backoffUntil = 0;

  constructor(opts: SyncEngineOptions, initial?: Partial<Snapshot>) {
    this.storage = opts.storage;
    this.cloud = opts.cloud;
    this.clock = opts.clock;
    this.merge = opts.merge;
    this.sanitize = opts.sanitize ?? ((_k, d) => d);
    this.minPushGap = opts.minPushGap ?? 0;
    this.rateLimitBackoff = opts.rateLimitBackoff ?? 30_000;

    this.stores = {
      core: initial?.core ?? {},
      overload: initial?.overload ?? {},
      surplus: initial?.surplus ?? {},
      csgraph: initial?.csgraph ?? {},
    };
    this.rev = { core: 0, overload: 0, surplus: 0, csgraph: 0 };
    this.pendingLocal = { core: false, overload: false, surplus: false, csgraph: false };
    this.pendingCloud = { core: false, overload: false, surplus: false, csgraph: false };
  }

  /* ---------------- state access ---------------- */

  /** A defensive copy. Callers must not be able to mutate engine state. */
  getStore(key: StoreKey): StoreData {
    return structuredClone(this.stores[key]);
  }
  snapshot(): Snapshot {
    return structuredClone(this.stores);
  }
  isDirtyLocal(key: StoreKey): boolean {
    return this.pendingLocal[key];
  }
  isDirtyCloud(key: StoreKey): boolean {
    return this.pendingCloud[key];
  }
  anyDirty(): boolean {
    return STORE_KEYS.some((k) => this.pendingLocal[k] || this.pendingCloud[k]);
  }
  getBaseRev(): number {
    return this.baseRev;
  }

  /** Apply a local edit. Bumps the store rev so an in-flight save cannot clear it. */
  edit(key: StoreKey, mutate: (data: StoreData) => StoreData): void {
    // Clone BOTH ways. Storing the caller's object by reference meant later
    // in-place mutations by legacy code were invisible to change detection —
    // the engine compared the object to itself and concluded nothing changed.
    this.stores[key] = structuredClone(mutate(structuredClone(this.stores[key])));
    this.rev[key]++;
    this.pendingLocal[key] = true;
    this.pendingCloud[key] = true;
  }

  /* ---------------- save ---------------- */

  /**
   * Persist locally, then publish to the cloud.
   *
   * Local and cloud outcomes are independent: a cloud failure leaves
   * `pendingCloud` set so the UI can honestly report "saved here, not synced".
   */
  async save(): Promise<SaveResult> {
    const localFailed: StoreKey[] = [];

    for (const key of STORE_KEYS) {
      if (!this.pendingLocal[key]) continue;
      const revAtCapture = this.rev[key];
      // Bound tombstones (and anything else the host wants trimmed) before the
      // bytes are written, so the leak cannot reach storage or the cloud.
      this.stores[key] = this.sanitize(key, this.stores[key], this.clock.now());
      const payload = JSON.stringify(this.stores[key]);

      let wrote = false;
      try {
        wrote = await this.storage.set(key, payload);
      } catch {
        wrote = false;
      }
      let verified = false;
      if (wrote) {
        try {
          verified = (await this.storage.get(key)) === payload;
        } catch {
          verified = false;
        }
      }

      // Only clear if the store did not change while the write was in flight.
      if (verified && this.rev[key] === revAtCapture) {
        this.pendingLocal[key] = false;
      } else if (!verified) {
        localFailed.push(key);
      }
    }

    const localOk = localFailed.length === 0;
    if (!localOk) return { localOk, localFailed, cloud: 'skipped' };

    const push = await this.push();
    return { localOk, localFailed, cloud: push.cloud, cloudError: push.cloudError };
  }

  /* ---------------- push ---------------- */

  async push(force = false): Promise<{ cloud: SaveResult['cloud']; cloudError?: SaveResult['cloudError'] }> {
    const now = this.clock.now();
    if (now < this.backoffUntil) {
      return { cloud: 'throttled', cloudError: { kind: 'rate-limited', message: 'backing off' } };
    }
    if (!force && this.minPushGap > 0 && now - this.lastPushAt < this.minPushGap) {
      return { cloud: 'throttled', cloudError: { kind: 'unknown', message: 'throttled' } };
    }

    // Cheap exit before touching the network: nothing has changed since the
    // last successful write.
    if (JSON.stringify(this.stores) === this.lastFingerprint && this.baseRev > 0) {
      const revsNow: Record<StoreKey, number> = { ...this.rev };
      for (const key of STORE_KEYS) {
        if (this.rev[key] === revsNow[key]) this.pendingCloud[key] = false;
      }
      return { cloud: 'noop' };
    }

    // Fold in anything the cloud has that we do not, so a push never conflicts.
    const read = await this.cloud.read();
    if (read.ok && read.payload && read.payload.rev > this.baseRev) {
      this.applyRemote(read.payload);
    } else if (!read.ok && read.kind === 'rate-limited') {
      this.backoffUntil = now + this.rateLimitBackoff;
      return { cloud: 'failed', cloudError: { kind: 'rate-limited', message: read.message ?? 'rate limited' } };
    }

    // Capture revs AFTER the merge and immediately before serialising, so the
    // payload and the captured revisions describe the same state. Capturing
    // earlier left pendingCloud stuck true whenever a push also merged.
    for (const key of STORE_KEYS) {
      this.stores[key] = this.sanitize(key, this.stores[key], now);
    }
    const revsAtCapture: Record<StoreKey, number> = { ...this.rev };

    const payload: CloudPayload = {
      rev: (read.ok && read.payload ? read.payload.rev : this.baseRev) + 1,
      syncedAt: now,
      core: this.stores.core,
      overload: this.stores.overload,
      surplus: this.stores.surplus,
      csgraph: this.stores.csgraph,
    };

    const write = await this.cloud.write(payload);
    if (!write.ok) {
      if (write.kind === 'rate-limited') this.backoffUntil = now + this.rateLimitBackoff;
      // INVARIANT: a failed push must never clear pendingCloud.
      return { cloud: 'failed', cloudError: { kind: write.kind ?? 'unknown', message: write.message ?? 'push failed' } };
    }

    this.baseRev = write.rev ?? payload.rev;
    this.lastPushAt = now;
    this.lastFingerprint = JSON.stringify(this.stores);
    for (const key of STORE_KEYS) {
      if (this.rev[key] === revsAtCapture[key]) this.pendingCloud[key] = false;
    }
    return { cloud: 'synced' };
  }

  /* ---------------- forcePush (repair / overwrite) ---------------- */

  /**
   * Overwrite the cloud with THIS device's local state, bypassing the fold-in
   * merge that `push()` performs.
   *
   * `push()` reads the cloud and merges it into local before writing, and the
   * reference merge is grow-only for stores without tombstones (knowledge:
   * `mastery`/`srs`/`log` union and can never lose a key). So a cleaned-up local
   * state can never be made to stick through the normal path — the cloud's stale
   * entries fold right back in. `forcePush` is the deliberate escape hatch: it
   * reads the cloud SOLELY to learn its current rev (to write `rev + 1` and stay
   * monotonic), and writes local wholesale WITHOUT merging. This makes the
   * calling device authoritative — callers must warn the user that other devices
   * will be replaced on their next sync.
   *
   * Same write-path invariants as `push()`: sanitize before serialising; a
   * failed cloud write never clears `pendingCloud`.
   */
  async forcePush(only: readonly StoreKey[] = STORE_KEYS): Promise<{ cloud: SaveResult['cloud']; cloudError?: SaveResult['cloudError'] }> {
    const now = this.clock.now();
    if (now < this.backoffUntil) {
      return { cloud: 'throttled', cloudError: { kind: 'rate-limited', message: 'backing off' } };
    }
    const authoritative = new Set(only);

    // Persist local first (only the stores we're overwriting), so the durable
    // local copy matches what we publish.
    const localFailed: StoreKey[] = [];
    for (const key of only) {
      const revAtCapture = this.rev[key];
      this.stores[key] = this.sanitize(key, this.stores[key], now);
      const payload = JSON.stringify(this.stores[key]);
      let verified = false;
      try {
        if (await this.storage.set(key, payload)) verified = (await this.storage.get(key)) === payload;
      } catch {
        verified = false;
      }
      if (verified && this.rev[key] === revAtCapture) this.pendingLocal[key] = false;
      else if (!verified) localFailed.push(key);
    }
    // Never overwrite the cloud with state we could not durably persist locally —
    // otherwise a reboot reads the stale local copy and the union folds the old
    // data straight back into the "clean" cloud. Same guard `save()` uses.
    if (localFailed.length) {
      return { cloud: 'skipped', cloudError: { kind: 'unknown', message: 'local write failed: ' + localFailed.join(', ') } };
    }

    // Read the cloud for its rev AND to preserve the stores we are NOT overwriting
    // — a scoped forcePush (e.g. knowledge-only reset) must not clobber another
    // device's workout/meal edits. Never fold the remote into local.
    const read = await this.cloud.read();
    if (!read.ok && read.kind === 'rate-limited') {
      this.backoffUntil = now + this.rateLimitBackoff;
      return { cloud: 'failed', cloudError: { kind: 'rate-limited', message: read.message ?? 'rate limited' } };
    }
    // A scoped forcePush reads the cloud to PRESERVE the stores it is not
    // authoritative for. If that read failed we have no remote copy of them, and
    // `pick` below would fall back to LOCAL state — overwriting another device's
    // edits to those stores. Skip rather than clobber. Only a FULL overwrite
    // (every store authoritative, a deliberate whole-state replace) may proceed
    // on a failed read, since it writes nothing it needed to preserve.
    if (!read.ok && only.length < STORE_KEYS.length) {
      return { cloud: 'skipped', cloudError: { kind: read.kind ?? 'unknown', message: read.message ?? 'cloud read failed' } };
    }
    const remote = read.ok && read.payload ? read.payload : null;
    const cloudRev = remote ? remote.rev : this.baseRev;
    const pick = (key: StoreKey): StoreData =>
      authoritative.has(key) ? this.stores[key] : (remote?.[key] ?? this.stores[key]);

    const revsAtCapture: Record<StoreKey, number> = { ...this.rev };
    const payload: CloudPayload = {
      rev: cloudRev + 1,
      syncedAt: now,
      core: pick('core'),
      overload: pick('overload'),
      surplus: pick('surplus'),
      csgraph: pick('csgraph'),
    };

    const write = await this.cloud.write(payload);
    if (!write.ok) {
      if (write.kind === 'rate-limited') this.backoffUntil = now + this.rateLimitBackoff;
      // INVARIANT: a failed push must never clear pendingCloud.
      return { cloud: 'failed', cloudError: { kind: write.kind ?? 'unknown', message: write.message ?? 'push failed' } };
    }

    this.baseRev = write.rev ?? payload.rev;
    this.lastPushAt = now;
    this.lastFingerprint = JSON.stringify(this.stores);
    for (const key of only) {
      if (this.rev[key] === revsAtCapture[key]) this.pendingCloud[key] = false;
    }
    return { cloud: 'synced' };
  }

  /* ---------------- discard ---------------- */

  /**
   * Revert every store to its last PERSISTED state.
   *
   * Reading from the StorageAdapter rather than an in-memory snapshot matters:
   * an in-memory copy can drift from what was actually written (a partially
   * failed save, or a merge applied after the snapshot was taken), so undoing
   * to it would reintroduce state the durable layer never saw. Anything that
   * cannot be read back is left untouched rather than blanked.
   *
   * Dirty flags are cleared only for stores that were genuinely restored, so
   * a store whose read failed keeps its pending status instead of silently
   * claiming to be clean.
   */
  async discard(): Promise<{ restored: StoreKey[]; skipped: StoreKey[] }> {
    const restored: StoreKey[] = [];
    const skipped: StoreKey[] = [];
    for (const key of STORE_KEYS) {
      let raw: string | null = null;
      try { raw = await this.storage.get(key); } catch { raw = null; }
      if (raw === null) { skipped.push(key); continue; }
      let parsed: StoreData;
      try { parsed = JSON.parse(raw) as StoreData; } catch { skipped.push(key); continue; }
      this.stores[key] = parsed;
      // Bump the rev so any save already in flight cannot mark this clean on
      // the strength of the pre-discard payload it captured.
      this.rev[key]++;
      this.pendingLocal[key] = false;
      this.pendingCloud[key] = false;
      restored.push(key);
    }
    return { restored, skipped };
  }

  /* ---------------- pull ---------------- */

  /**
   * Fetch and merge. A stale remote revision is ignored rather than applied,
   * and merging never discards local rows — union semantics come from `merge`.
   */
  async pull(): Promise<PullResult> {
    const read = await this.cloud.read();
    if (!read.ok) {
      if (read.kind === 'rate-limited') this.backoffUntil = this.clock.now() + this.rateLimitBackoff;
      return { ok: false, applied: false, reason: read.message ?? 'read failed', kind: read.kind };
    }
    if (!read.payload) return { ok: true, applied: false, reason: 'cloud empty' };

    if (read.payload.rev < this.baseRev) {
      // INVARIANT: never let an older revision overwrite newer local state.
      return { ok: true, applied: false, reason: 'remote revision is stale' };
    }
    this.applyRemote(read.payload);
    return { ok: true, applied: true };
  }

  /** Merge a remote payload into local state. Local edits are preserved. */
  private applyRemote(payload: CloudPayload): void {
    for (const key of STORE_KEYS) {
      const remote = payload[key];
      if (remote === undefined || remote === null) continue;
      const localNewer = this.pendingCloud[key];
      const merged = this.merge(this.stores[key], remote as StoreData, key, localNewer);
      if (JSON.stringify(merged) !== JSON.stringify(this.stores[key])) {
        this.stores[key] = merged;
        this.rev[key]++;
        this.pendingLocal[key] = true;
        this.pendingCloud[key] = true;
      }
    }
    this.baseRev = Math.max(this.baseRev, payload.rev);
    this.lastFingerprint = null; // state changed; force the next push to write
    this.backoffUntil = 0;       // a successful read proves the limit lifted
  }
}

/* ------------------------------------------------------------------ */
/* Reference merge: id-union with tombstones (grow-only set + LWW)      */
/* ------------------------------------------------------------------ */

export interface Collection extends StoreData {
  items?: Array<{ id: string | number; [k: string]: unknown }>;
  _del?: Record<string, number>;
}

/**
 * Union by id, minus anything either side has tombstoned.
 * Commutative and idempotent, which is what makes convergence provable.
 */
export const mergeCollection: MergeFn = (local, remote) => {
  const l = local as Collection;
  const r = remote as Collection;
  const dead = { ...(r._del ?? {}), ...(l._del ?? {}) };
  const deadIds = new Set(Object.keys(dead).map(String));

  const byId = new Map<string, { id: string | number; [k: string]: unknown }>();
  for (const item of [...(r.items ?? []), ...(l.items ?? [])]) {
    const id = String(item.id);
    if (deadIds.has(id)) continue;
    byId.set(id, item);
  }
  return { items: [...byId.values()], _del: dead } satisfies Collection;
};
