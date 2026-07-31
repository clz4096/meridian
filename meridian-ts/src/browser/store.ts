/**
 * Durable local read store — three backends, newest-version-wins.
 *
 *   · IndexedDB      primary local store (survives iOS eviction, large quota)
 *   · localStorage   synchronous fast copy (survives a hard-kill mid-write)
 *   · window.storage Claude-account store, shared across devices when present
 *
 * Every value has a companion `<key>__v` version stamp. A read returns the
 * newest-versioned copy and heals localStorage + IndexedDB toward it, so a
 * dropped or stale write can never overwrite good data.
 *
 * This is the boot-time loader path. Saves go through the SyncEngine's storage
 * adapter (see adapters.ts); the legacy `rawSet` was dead and is not carried over.
 */

interface AccountStore {
  get(key: string): Promise<{ value?: string | null } | null>;
}

const accountStore: AccountStore | null =
  typeof window !== 'undefined' && (window as unknown as { storage?: AccountStore }).storage?.get
    ? (window as unknown as { storage: AccountStore }).storage
    : null;

/* ---- IndexedDB minimal promise wrapper ---- */
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('meridian_db', 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore('kv'); } catch { /* already exists */ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const t = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      t.onsuccess = () => resolve(t.result == null ? null : (t.result as string));
      t.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function idbSet(key: string, value: string): void {
  void openDb()
    .then((db) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
    })
    .catch(() => { /* fire-and-forget heal */ });
}

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota */ }
}
async function wsGet(key: string): Promise<string | null> {
  if (!accountStore) return null;
  try {
    const r = await accountStore.get(key);
    return r && r.value != null ? r.value : null;
  } catch {
    return null;
  }
}

/** Read a key, returning the newest-versioned value across all backends and healing the local ones. */
export async function storeGet(key: string): Promise<string | null> {
  const vk = key + '__v';
  const lv = lsGet(key);
  const lvv = parseInt(lsGet(vk) || '0', 10) || 0;
  const iv = await idbGet(key);
  const ivv = parseInt((await idbGet(vk)) || '0', 10) || 0;
  let wv: string | null = null;
  let wvv = 0;
  if (accountStore) {
    wv = await wsGet(key);
    wvv = parseInt((await wsGet(vk)) || '0', 10) || 0;
  }

  const raw: Array<[string | null, number]> = [[lv, lvv], [iv, ivv], [wv, wvv]];
  const cands = raw.filter((c) => c[0] != null) as Array<[string, number]>;
  if (!cands.length) return null;

  cands.sort((a, b) => b[1] - a[1]); // newest version first
  const best = cands[0][0];
  const stamp = String(cands[0][1] || Date.now());
  // heal localStorage + IndexedDB toward the newest copy so all backends converge
  lsSet(key, best);
  lsSet(vk, stamp);
  idbSet(key, best);
  idbSet(vk, stamp);
  return best;
}
