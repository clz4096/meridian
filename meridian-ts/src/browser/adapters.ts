/**
 * Production adapters for the SyncEngine ports.
 *
 * These are the only places in the sync path that touch the browser or the
 * network. Everything above them was proven with fakes.
 */

import type {
  Clock, CloudErrorKind, CloudPayload, CloudProvider, CloudReadResult,
  CloudWriteResult, StorageAdapter,
} from '../SyncEngine.js';

/* ================================================================== */
/* Storage: IndexedDB (durable) + localStorage (synchronous backstop)  */
/* ================================================================== */

interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
}

/** Minimal promise wrapper over IndexedDB. Fails soft to null/false. */
function openIdb(dbName = 'meridian_db', storeName = 'kv'): KvStore {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          try { req.result.createObjectStore(storeName); } catch { /* exists */ }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e as Error); }
    });
    return dbp;
  };
  return {
    async get(key) {
      try {
        const db = await open();
        return await new Promise<string | null>((resolve) => {
          const r = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          r.onsuccess = () => resolve((r.result as string | undefined) ?? null);
          r.onerror = () => resolve(null);
        });
      } catch { return null; }
    },
    async set(key, value) {
      try {
        const db = await open();
        return await new Promise<boolean>((resolve) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(value, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      } catch { return false; }
    },
  };
}

/**
 * Writes to localStorage synchronously first (so a hard app-kill cannot lose
 * the newest bytes), then to IndexedDB. Reads take whichever copy carries the
 * newer version stamp and heal the other, so the two tiers converge.
 */
export class BrowserStorageAdapter implements StorageAdapter {
  private readonly idb: KvStore;

  constructor(
    private readonly prefixMap: Record<string, string>,
    idb: KvStore = openIdb(),
  ) {
    this.idb = idb;
  }

  private realKey(key: string): string {
    return this.prefixMap[key] ?? key;
  }

  private lsGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  private lsSet(key: string, value: string): boolean {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }

  async get(key: string): Promise<string | null> {
    const k = this.realKey(key);
    const vk = `${k}__v`;
    const lv = this.lsGet(k);
    const lvv = Number(this.lsGet(vk) ?? 0) || 0;
    const iv = await this.idb.get(k);
    const ivv = Number((await this.idb.get(vk)) ?? 0) || 0;

    if (lv !== null && iv !== null) return lvv >= ivv ? lv : iv;
    if (lv !== null) { void this.idb.set(k, lv); return lv; }
    if (iv !== null) { this.lsSet(k, iv); this.lsSet(vk, String(ivv || Date.now())); return iv; }
    return null;
  }

  async set(key: string, value: string): Promise<boolean> {
    const k = this.realKey(key);
    const stamp = String(Date.now());
    const sync = this.lsSet(k, value);
    this.lsSet(`${k}__v`, stamp);
    const durable = await this.idb.set(k, value);
    void this.idb.set(`${k}__v`, stamp);
    return sync || durable;          // one tier surviving is enough
  }
}

/* ================================================================== */
/* Cloud: Pantry                                                       */
/* ================================================================== */

const PANTRY_BASE = 'https://getpantry.cloud/apiv1/pantry';

function classify(status: number): CloudErrorKind {
  if (status === 429) return 'rate-limited';
  if (status === 404 || status === 400) return 'not-found';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * Pantry-backed CloudProvider.
 *
 * Payload stores are nested objects rather than JSON strings — the old
 * double-encoding inflated every quote and cost ~15% of the size budget on a
 * service whose free tier is measured in kilobytes.
 */
export class PantryCloudProvider implements CloudProvider {
  constructor(
    private readonly getPantryId: () => string,
    private readonly basket = 'meridian',
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  private url(): string {
    return `${PANTRY_BASE}/${encodeURIComponent(this.getPantryId())}/basket/${this.basket}`;
  }

  async read(): Promise<CloudReadResult> {
    const id = this.getPantryId();
    if (!id) return { ok: false, kind: 'not-found', message: 'no Pantry ID configured' };
    try {
      const res = await this.fetchImpl(this.url());
      if (res.status === 429) return { ok: false, kind: 'rate-limited', message: 'Pantry rate limit (429) on read' };
      if (!res.ok) return { ok: false, kind: classify(res.status), message: `HTTP ${res.status} from Pantry` };
      const body = (await res.json()) as Record<string, unknown>;
      if (!body || typeof body !== 'object') return { ok: true };
      return { ok: true, payload: coercePayload(body) };
    } catch (e) {
      return { ok: false, kind: 'offline', message: (e as Error)?.message || 'network error' };
    }
  }

  async write(payload: CloudPayload): Promise<CloudWriteResult> {
    const id = this.getPantryId();
    if (!id) return { ok: false, kind: 'not-found', message: 'no Pantry ID configured' };
    try {
      const res = await this.fetchImpl(this.url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) return { ok: false, kind: 'rate-limited', message: 'Pantry rate limit (429) — backing off' };
      if (res.status === 413) {
        const kb = (JSON.stringify(payload).length / 1024).toFixed(0);
        return { ok: false, kind: 'server', message: `payload too large for Pantry (${kb}KB)` };
      }
      if (!res.ok) return { ok: false, kind: classify(res.status), message: `HTTP ${res.status} from Pantry` };
      return { ok: true, rev: payload.rev };
    } catch (e) {
      return { ok: false, kind: 'offline', message: (e as Error)?.message || 'network error' };
    }
  }
}

/* ================================================================== */
/* Cloud: Backblaze B2 (Native API)                                    */
/* ================================================================== */

const B2_API_BASE = 'https://api.backblazeb2.com/b2api/v2';

/**
 * Backblaze B2 CloudProvider using the Native API with Basic Auth.
 *
 * No AWS Signature V4 needed — just Base64(keyId:applicationKey).
 * CORS must be enabled on the bucket for the download URL.
 */
export class BackblazeCloudProvider implements CloudProvider {
  constructor(
    private readonly getCredentials: () => { keyId: string; applicationKey: string } | null,
    private readonly bucketName = 'meridian-sync',
    private readonly fileName = 'state.json',
  ) {}

  private authHeader(): string | null {
    const creds = this.getCredentials();
    if (!creds) return null;
    return `Basic ${btoa(`${creds.keyId}:${creds.applicationKey}`)}`;
  }

  private downloadUrl(): string {
    // B2 download URL pattern: https://f<account>.<region>.backblazeb2.com/file/<bucket>/<file>
    // We get this from the bucket's Upload/Download page
    return `https://f005.backblazeb2.com/file/${this.bucketName}/${this.fileName}`;
  }

  async read(): Promise<CloudReadResult> {
    const auth = this.authHeader();
    if (!auth) return { ok: false, kind: 'not-found', message: 'no Backblaze key configured' };
    try {
      const res = await fetch(this.downloadUrl(), {
        headers: { 'Authorization': auth },
      });
      if (res.status === 404) return { ok: true }; // no data yet
      if (res.status === 429) return { ok: false, kind: 'rate-limited', message: 'B2 rate limit (429)' };
      if (!res.ok) return { ok: false, kind: classify(res.status), message: `HTTP ${res.status} from B2` };
      const body = (await res.json()) as Record<string, unknown>;
      if (!body || typeof body !== 'object') return { ok: true };
      return { ok: true, payload: body as CloudPayload };
    } catch (e) {
      return { ok: false, kind: 'offline', message: (e as Error)?.message || 'network error' };
    }
  }

  async write(payload: CloudPayload): Promise<CloudWriteResult> {
    const auth = this.authHeader();
    if (!auth) return { ok: false, kind: 'not-found', message: 'no Backblaze key configured' };

    // Step 1: Get upload URL
    try {
      const urlRes = await fetch(`${B2_API_BASE}/b2_get_upload_url`, {
        method: 'POST',
        headers: { 'Authorization': auth },
        body: JSON.stringify({ bucketId: await this.getBucketId(auth) }),
      });
      if (!urlRes.ok) {
        return { ok: false, kind: classify(urlRes.status), message: `B2 upload URL: HTTP ${urlRes.status}` };
      }
      const { uploadUrl, uploadAuthToken } = (await urlRes.json()) as {
        uploadUrl: string;
        uploadAuthToken: string;
      };

      // Step 2: Upload the file
      const body = JSON.stringify(payload);
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': uploadAuthToken,
          'Content-Type': 'application/json',
          'X-Bz-File-Name': this.fileName,
          'X-Bz-Content-Sha1': 'do_not_verify',
        },
        body,
      });
      if (uploadRes.status === 429) {
        return { ok: false, kind: 'rate-limited', message: 'B2 rate limit (429)' };
      }
      if (!uploadRes.ok) {
        return { ok: false, kind: classify(uploadRes.status), message: `B2 upload: HTTP ${uploadRes.status}` };
      }
      return { ok: true, rev: payload.rev };
    } catch (e) {
      return { ok: false, kind: 'offline', message: (e as Error)?.message || 'network error' };
    }
  }

  private bucketIdCache: string | null = null;
  private async getBucketId(auth: string): Promise<string> {
    if (this.bucketIdCache) return this.bucketIdCache;
    const res = await fetch(`${B2_API_BASE}/b2_list_buckets`, {
      method: 'POST',
      headers: { 'Authorization': auth },
      body: JSON.stringify({ accountId: 'me' }),
    });
    if (!res.ok) throw new Error(`B2 list buckets: HTTP ${res.status}`);
    const data = (await res.json()) as { buckets: Array<{ bucketName: string; bucketId: string }> };
    const bucket = data.buckets.find((b) => b.bucketName === this.bucketName);
    if (!bucket) throw new Error(`Bucket "${this.bucketName}" not found`);
    this.bucketIdCache = bucket.bucketId;
    return bucket.bucketId;
  }
}

/** Accept both the nested-object format and the legacy stringified one. */
function coercePayload(body: Record<string, unknown>): CloudPayload {
  const parse = (v: unknown): Record<string, unknown> => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    if (typeof v === 'string') { try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; } }
    return {};
  };
  return {
    rev: Number(body.rev ?? 0) || 0,
    syncedAt: Number(body.syncedAt ?? 0) || 0,
    core: parse(body.core),
    overload: parse(body.overload),
    surplus: parse(body.surplus),
    csgraph: parse(body.csgraph),
  };
}

/* ================================================================== */
/* Clock                                                               */
/* ================================================================== */

export const systemClock: Clock = { now: () => Date.now() };
