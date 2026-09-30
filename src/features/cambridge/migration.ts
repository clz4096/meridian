/**
 * Cambridge migration (contract section 2, DECISIONS C3).
 *
 * On a device's first run of the Cambridge build, before any Cambridge write,
 * copy every Massey key into one dated JSON backup: IndexedDB `meridian_backups`
 * under `massey-YYYY-MM-DD`, plus localStorage `meridian.backup.massey.<date>`
 * when it fits. Then set `cambridge.migratedAt`.
 *
 * The migration is additive. It only reads the old keys; it never deletes or
 * rewrites them, so XP, level, streak, meters, scorecards and the banked history
 * stay exactly where the old build left them, and a rollback still works.
 *
 * Lazy module: loaded by bootstrap only when `migratedAt` is unset, and by the
 * Data tab's download button.
 */
import type { CambridgeState } from '@/features/cambridge/types';

export { MASSEY_KEYS } from '@/features/cambridge/masseyKeys';
import { snapshotMassey } from '@/features/cambridge/masseyKeys';

export const BACKUP_DB = 'meridian_backups';
const BACKUP_STORE = 'kv';
export const LS_BACKUP_PREFIX = 'meridian.backup.massey.';
const IDB_TIMEOUT_MS = 5_000;
const LS_BACKUP_MAX_CHARS = 512 * 1024;

export interface MasseyBackup {
  kind: 'meridian-massey-backup';
  v: 1;
  /** The device's local date the backup was taken, YYYY-MM-DD. */
  date: string;
  takenAt: string;
  /** Raw localStorage strings, byte for byte; null when the key was absent. */
  keys: Record<string, string | null>;
  /**
   * The tracker store as the app loaded it. Usually the same as the raw
   * `meridian-theorist` string, but the app loads the newest of localStorage and
   * IndexedDB, so this still holds the data if the localStorage copy was evicted.
   */
  theoristLoaded?: unknown;
}

export interface MigrationDeps {
  now: number;
  /** The loaded tracker store, kept in the backup as a second copy. */
  theorist?: unknown;
  storage?: Storage;
  idb?: IDBFactory;
  /** The Massey keys as read at the very start of boot (`snapshotMassey`); used instead of reading them now. */
  snapshot?: Record<string, string | null>;
}

export interface MigrationResult {
  state: CambridgeState;
  /** YYYY-MM-DD of the backup taken now, if any. */
  date?: string;
  idbOk: boolean;
  localOk: boolean;
}

const localDate = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const lsOf = (deps: { storage?: Storage }): Storage | null =>
  deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
const idbOf = (deps: { idb?: IDBFactory }): IDBFactory | null =>
  deps.idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);

/** Snapshot the Massey keys. Reads only. */
export function buildMasseyBackup(
  now: number, storage: Storage | null, theorist?: unknown, snapshot?: Record<string, string | null>,
): MasseyBackup {
  const keys = snapshot ?? snapshotMassey(storage);
  return {
    kind: 'meridian-massey-backup',
    v: 1,
    date: localDate(now),
    takenAt: new Date(now).toISOString(),
    keys,
    ...(theorist !== undefined ? { theoristLoaded: structuredClone(theorist) } : {}),
  };
}

/* ── a minimal IndexedDB key-value wrapper, time-boxed so a blocked open can't stall boot ── */

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), IDB_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function openBackups(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(BACKUP_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(BACKUP_STORE)) req.result.createObjectStore(BACKUP_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(idb: IDBFactory, key: string, value: string): Promise<boolean> {
  const db = await openBackups(idb);
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(BACKUP_STORE, 'readwrite');
      tx.objectStore(BACKUP_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

/** The newest `massey-*` backup in IndexedDB, as its JSON text. */
async function idbLatest(idb: IDBFactory): Promise<string | null> {
  const db = await openBackups(idb);
  try {
    return await new Promise<string | null>((resolve) => {
      const store = db.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE);
      const keysReq = store.getAllKeys();
      keysReq.onerror = () => resolve(null);
      keysReq.onsuccess = () => {
        const latest = (keysReq.result as IDBValidKey[]).map(String).filter((k) => k.startsWith('massey-')).sort().pop();
        if (!latest) return resolve(null);
        const get = store.get(latest);
        get.onsuccess = () => resolve(typeof get.result === 'string' ? get.result : null);
        get.onerror = () => resolve(null);
      };
    });
  } finally {
    db.close();
  }
}

/** Read one backup key from IndexedDB (tests and restore tooling). */
export async function readIdbBackup(date: string, idb: IDBFactory | null = idbOf({})): Promise<string | null> {
  if (!idb) return null;
  const db = await openBackups(idb);
  try {
    return await new Promise<string | null>((resolve) => {
      const r = db.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE).get('massey-' + date);
      r.onsuccess = () => resolve(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

/**
 * Back up, then mark migrated. Idempotent: a state that already has
 * `migratedAt` is returned as is, with no new backup. When neither copy could
 * be written, the state is returned unmarked so the next launch tries again.
 */
export async function runMigration(state: CambridgeState, deps: MigrationDeps): Promise<MigrationResult> {
  if (state.migratedAt) return { state, idbOk: false, localOk: false };
  const storage = lsOf(deps);
  const backup = buildMasseyBackup(deps.now, storage, deps.theorist, deps.snapshot);
  const text = JSON.stringify(backup);

  const idb = idbOf(deps);
  const idbOk = idb ? await withTimeout(idbPut(idb, 'massey-' + backup.date, text), false) : false;

  let localOk = false;
  const lsKey = LS_BACKUP_PREFIX + backup.date;
  // Only if it fits, and only if it is small: localStorage has about 5 MB per
  // origin, and a large copy could leave the live stores no room to save.
  if (text.length <= LS_BACKUP_MAX_CHARS) {
    try {
      storage?.setItem(lsKey, text);
      localOk = storage?.getItem(lsKey) === text;
    } catch {
      try { storage?.removeItem(lsKey); } catch { /* blocked storage */ }
    }
  }

  if (!idbOk && !localOk) return { state, date: backup.date, idbOk, localOk };
  return { state: { ...state, migratedAt: deps.now }, date: backup.date, idbOk, localOk };
}

/**
 * The backup to hand the owner: the newest stored one (IndexedDB, then
 * localStorage), or a fresh snapshot if this device has none.
 */
export async function latestMasseyBackup(deps: { now?: number; storage?: Storage; idb?: IDBFactory } = {}): Promise<MasseyBackup> {
  const idb = idbOf(deps);
  const fromIdb = idb ? await withTimeout(idbLatest(idb), null) : null;
  if (fromIdb) return JSON.parse(fromIdb) as MasseyBackup;
  const storage = lsOf(deps);
  if (storage) {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(LS_BACKUP_PREFIX)) keys.push(k);
    }
    const newest = keys.sort().pop();
    const text = newest ? storage.getItem(newest) : null;
    if (text) return JSON.parse(text) as MasseyBackup;
  }
  return buildMasseyBackup(deps.now ?? Date.now(), storage);
}

export const backupFileName = (date: string): string => `meridian-massey-backup-${date}.json`;

/** Save the backup as a JSON file through a temporary download link. */
export async function downloadMasseyBackup(): Promise<void> {
  const backup = await latestMasseyBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(backup.date);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a later task: some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
