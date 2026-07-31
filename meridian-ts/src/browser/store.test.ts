/**
 * Tests for the 3-backend read store. `window.storage` is absent in Node (so
 * that backend stays off — as it is outside a Claude artifact); this covers the
 * localStorage + IndexedDB newest-wins reconciliation and healing, which is the
 * behaviour the boot loaders depend on.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { storeGet } from './store.js';

function fakeLs(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0, _map: m,
  };
}

// Seed the same IndexedDB (meridian_db / kv store) that store.ts opens.
async function idbPut(key: string, value: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('meridian_db', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch { /* exists */ } };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  await new Promise<void>((res) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => res();
  });
}
async function idbGet(key: string): Promise<string | null> {
  const db = await new Promise<IDBDatabase>((res) => {
    const r = indexedDB.open('meridian_db', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch { /* exists */ } };
    r.onsuccess = () => res(r.result);
  });
  return await new Promise((res) => {
    const t = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    t.onsuccess = () => res((t.result as string) ?? null);
    t.onerror = () => res(null);
  });
}
const tick = () => new Promise((r) => setTimeout(r, 15)); // let fire-and-forget heals settle

let ls: ReturnType<typeof fakeLs>;
let n = 0;
beforeEach(() => { ls = fakeLs(); vi.stubGlobal('localStorage', ls); });
afterEach(() => vi.unstubAllGlobals());
// distinct key per test — store.ts memoises one shared IndexedDB connection.
const nextKey = () => `k${n++}`;

describe('storeGet', () => {
  it('returns the IndexedDB copy when it carries a newer version', async () => {
    const k = nextKey();
    ls._map.set(k, 'ls-old'); ls._map.set(`${k}__v`, '100');
    await idbPut(k, 'idb-new'); await idbPut(`${k}__v`, '200');
    expect(await storeGet(k)).toBe('idb-new');
  });

  it('returns the localStorage copy when it carries a newer version', async () => {
    const k = nextKey();
    ls._map.set(k, 'ls-new'); ls._map.set(`${k}__v`, '300');
    await idbPut(k, 'idb-old'); await idbPut(`${k}__v`, '100');
    expect(await storeGet(k)).toBe('ls-new');
  });

  it('heals localStorage from an IndexedDB-only value', async () => {
    const k = nextKey();
    await idbPut(k, 'only-idb'); await idbPut(`${k}__v`, '50');
    expect(await storeGet(k)).toBe('only-idb');
    expect(ls._map.get(k)).toBe('only-idb');            // healed synchronously
  });

  it('heals IndexedDB from a localStorage-only value', async () => {
    const k = nextKey();
    ls._map.set(k, 'only-ls'); ls._map.set(`${k}__v`, '50');
    expect(await storeGet(k)).toBe('only-ls');
    await tick();
    expect(await idbGet(k)).toBe('only-ls');            // healed (fire-and-forget)
  });

  it('returns null when no backend has the key', async () => {
    expect(await storeGet(nextKey())).toBeNull();
  });
});
