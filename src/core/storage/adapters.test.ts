/**
 * Tests for the production sync adapters — the only code in the sync path that
 * touches the browser or network. Focus: the storage newest-wins reconciliation
 * and the Supabase URL logic whose own comments document past cross-device
 * data-loss bugs (400 laundered into "empty", missing cache-buster).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BrowserStorageAdapter, SupabaseCloudProvider, PantryCloudProvider, systemClock } from '@/core/storage/adapters';

/* ---- fakes ---- */
function fakeLs() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
    _map: m,
  };
}
function fakeKv() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => Promise.resolve(m.has(k) ? m.get(k)! : null),
    set: (k: string, v: string) => { m.set(k, v); return Promise.resolve(true); },
    _map: m,
  };
}
function resp(status: number, body: unknown = {}) {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

/* ================================================================== */
describe('BrowserStorageAdapter', () => {
  let ls: ReturnType<typeof fakeLs>;
  beforeEach(() => { ls = fakeLs(); vi.stubGlobal('localStorage', ls); });
  afterEach(() => vi.unstubAllGlobals());

  it('maps a store key to its real localStorage key via prefixMap', async () => {
    const kv = fakeKv();
    const a = new BrowserStorageAdapter({ core: 'meridian-core' }, kv);
    await a.set('core', 'X');
    expect(ls._map.get('meridian-core')).toBe('X');   // real key, not 'core'
  });

  it('set stamps a version and writes both tiers', async () => {
    const kv = fakeKv();
    const a = new BrowserStorageAdapter({}, kv);
    const before = Date.now();
    expect(await a.set('k', 'v')).toBe(true);
    expect(ls._map.get('k')).toBe('v');
    expect(kv._map.get('k')).toBe('v');
    expect(Number(ls._map.get('k__v'))).toBeGreaterThanOrEqual(before);
    expect(kv._map.get('k__v')).toBe(ls._map.get('k__v'));
  });

  it('read returns the tier with the newer version stamp', async () => {
    const kv = fakeKv();
    const a = new BrowserStorageAdapter({}, kv);
    // localStorage older, IndexedDB newer
    ls._map.set('k', 'old'); ls._map.set('k__v', '100');
    kv._map.set('k', 'new'); kv._map.set('k__v', '200');
    expect(await a.get('k')).toBe('new');
    // flip it
    ls._map.set('k__v', '300');
    expect(await a.get('k')).toBe('old');   // ls now newer
  });

  it('ties go to localStorage (lvv >= ivv)', async () => {
    const kv = fakeKv();
    const a = new BrowserStorageAdapter({}, kv);
    ls._map.set('k', 'ls'); ls._map.set('k__v', '100');
    kv._map.set('k', 'idb'); kv._map.set('k__v', '100');
    expect(await a.get('k')).toBe('ls');
  });

  it('heals the missing tier: localStorage-only read backfills IndexedDB', async () => {
    const kv = fakeKv();
    const a = new BrowserStorageAdapter({}, kv);
    ls._map.set('k', 'only-ls'); ls._map.set('k__v', '5');
    expect(await a.get('k')).toBe('only-ls');
    await Promise.resolve();
    expect(kv._map.get('k')).toBe('only-ls');    // backfilled
  });

  it('heals the missing tier: IndexedDB-only read backfills localStorage', async () => {
    const kv = fakeKv();
    const a = new BrowserStorageAdapter({}, kv);
    kv._map.set('k', 'only-idb'); kv._map.set('k__v', '5');
    expect(await a.get('k')).toBe('only-idb');
    expect(ls._map.get('k')).toBe('only-idb');   // backfilled synchronously
  });

  it('returns null when neither tier has the key', async () => {
    const a = new BrowserStorageAdapter({}, fakeKv());
    expect(await a.get('missing')).toBeNull();
  });
});

/* ================================================================== */
describe('SupabaseCloudProvider', () => {
  const creds = { projectUrl: 'https://proj.supabase.co', anonKey: 'anon-123' };
  afterEach(() => vi.unstubAllGlobals());

  it('reads through the PUBLIC object path with a cache-buster (the cross-device fix)', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { rev: 1, syncedAt: 0 }));
    vi.stubGlobal('fetch', f);
    await new SupabaseCloudProvider(() => creds).read();
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain('/storage/v1/object/public/meridian-sync/state.json');
    expect(url).toMatch(/\?t=\d+/);                       // load-bearing CDN cache-buster
    expect(f.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('does NOT launder a 400 into "empty" (would silently no-op cross-device pull)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(400)));
    const r = await new SupabaseCloudProvider(() => creds).read();
    expect(r.ok).toBe(false);                             // a real error, not {ok:true}
    if (!r.ok) expect(r.kind).toBe('not-found');
  });

  it('treats ONLY 404 as a genuinely empty cloud (first-ever sync)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(404)));
    const r = await new SupabaseCloudProvider(() => creds).read();
    expect(r).toEqual({ ok: true });                     // empty, no payload
  });

  it('surfaces a 429 as rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(429)));
    const r = await new SupabaseCloudProvider(() => creds).read();
    expect(r).toMatchObject({ ok: false, kind: 'rate-limited' });
  });

  it('returns a payload on a 200 read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, { rev: 7 })));
    const r = await new SupabaseCloudProvider(() => creds).read();
    expect(r).toMatchObject({ ok: true, payload: { rev: 7 } });
  });

  it('writes through the AUTHENTICATED path with upsert + bearer auth', async () => {
    const f = vi.fn().mockResolvedValue(resp(200));
    vi.stubGlobal('fetch', f);
    await new SupabaseCloudProvider(() => creds).write({ rev: 3 } as never);
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/storage/v1/object/meridian-sync/state.json'); // not /public/
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-upsert']).toBe('true');
    expect(opts.headers.Authorization).toBe('Bearer anon-123');
  });

  it('adds https:// to a bare project URL', async () => {
    const f = vi.fn().mockResolvedValue(resp(404));
    vi.stubGlobal('fetch', f);
    await new SupabaseCloudProvider(() => ({ projectUrl: 'proj.supabase.co', anonKey: 'a' })).read();
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/proj\.supabase\.co/);
  });

  it('fails cleanly with no credentials — never hits the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await new SupabaseCloudProvider(() => null).read();
    expect(r).toMatchObject({ ok: false, kind: 'not-found' });
    expect(f).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
describe('PantryCloudProvider', () => {
  it('guards a missing Pantry ID without hitting the network', async () => {
    const f = vi.fn();
    const r = await new PantryCloudProvider(() => '', 'meridian', f as never).read();
    expect(r).toMatchObject({ ok: false, kind: 'not-found' });
    expect(f).not.toHaveBeenCalled();
  });

  it('reports an over-quota write (413) as a server error with a size hint', async () => {
    const f = vi.fn().mockResolvedValue(resp(413));
    const r = await new PantryCloudProvider(() => 'id', 'meridian', f as never).write({ rev: 1 } as never);
    expect(r).toMatchObject({ ok: false, kind: 'server' });
    if (!r.ok) expect(r.message).toMatch(/too large/);
  });
});

/* ================================================================== */
describe('systemClock', () => {
  it('reads the wall clock', () => {
    const t = systemClock.now();
    expect(typeof t).toBe('number');
    expect(t).toBeGreaterThan(0);
  });
});
