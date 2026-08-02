# Wiring the SyncEngine into index.html

> **Status (2026-07-31):** the app now syncs through **Supabase Storage** (`SupabaseCloudProvider`, reading `meridian_supabase_url` / `meridian_supabase_key`), **not** Pantry — the `getPantryId` / `PantryCloudProvider` references below are historical. The wiring is complete; see [`../docs/cleanup-audit.md`](../docs/cleanup-audit.md) for the current architecture. (Code lives in `meridian-ts/`.)

The build injects `window.MeridianCore` **before** the legacy script, so
`MeridianCore.sync` is available by the time the legacy code runs.

---

## 1. Initialise once, near the other module-level state

Place this **after** `CORE`, `WK`, `SG`, `KG` are declared (they are hoisted
`let`s, so anywhere before `init()` runs is fine):

```js
MeridianCore.sync.create({
  getPantryId: () => cloudId(),
  // Live references to the legacy globals.
  read: (key) => ({ core: CORE, overload: WK, surplus: SG, csgraph: KG })[key],
  // The engine hands back merged results; adopt them.
  write: (key, data) => {
    if (key === 'core')     CORE = data;
    if (key === 'overload') WK   = data;
    if (key === 'surplus')  SG   = data;
    if (key === 'csgraph')  KG   = data;
  },
  onStatus: (r) => {
    const t = document.getElementById('savetxt');
    const c = document.getElementById('savechip');
    if (!t) return;
    if (!r.localOk)                 { t.textContent = 'Save failed: ' + r.localFailed.join(', '); c.className = 'savefab dirty'; }
    else if (r.cloud === 'synced')  { t.textContent = 'All changes saved'; }
    else if (r.cloud === 'noop')    { t.textContent = 'All changes saved · cloud already in sync'; }
    else if (r.cloud === 'throttled'){ t.textContent = 'Saved · cloud sync queued'; }
    else if (r.cloud === 'failed')  { t.textContent = 'Saved here only — cloud failed: ' + (r.cloudError?.message || ''); c.className = 'savefab dirty'; }
    else                            { t.textContent = 'All changes saved'; }
  },
});
```

---

## 2. DELETE these from the legacy script

Remove each block entirely — the engine now owns this behaviour.

| Delete | Lines to search for | Replaced by |
|---|---|---|
| `async function saveAll(silent)` | `const jobs=[` | `MeridianCore.sync.save()` |
| `async function cloudPush(force)` | `function baseRev()` through the end of `cloudPush` | `SyncEngine.push` |
| `async function cloudPull()` | `PANTRY_BASE+'/'` GET | `PantryCloudProvider.read` |
| `async function cloudMerge(d)` | `await ensureAllLoaded();` inside it | `SyncEngine.applyRemote` |
| `mergeWK / mergeSG / mergeCORE / mergeKG` | `function mergeWK(` | `mergeStore` (typed, property-tested) |
| `mergeById / mergeDayMap / mergeScalarMap / mergeListMap` | `function mergeById(` | same, in `mergeStores.ts` |
| `tombSet / tomb / pruneTombs` | `function tombSet(` | `addTombstone` / `pruneTombstones` |
| `hashStr`, `baseRev`, `setBaseRev` | `function hashStr(` | engine-internal fingerprint + rev |
| `MIN_PUSH_GAP`, `lastPushAt`, `pushBackoffUntil` | `const MIN_PUSH_GAP` | engine throttle/backoff |
| `meridian_last_fp`, `meridian_checked_at`, `meridian_local_mtime` reads/writes | `localStorage.setItem('meridian_` | engine state |

Keep: `cloudId()`, `setCloudId()`, `cloudEnabled()`, `rawGet`/`rawSet`
(still used by the question-bank cache and the single-app importer).

---

## 3. Replace the call sites

```js
// Save FAB
document.getElementById('savechip').addEventListener('click', () => MeridianCore.sync.save());

// keyboard shortcut
if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); MeridianCore.sync.save(); }

// 20s safety net
saveTimer = setTimeout(() => MeridianCore.sync.save(), 20000);

// auto-save when a session completes
saveAll(false)            ->  MeridianCore.sync.save()

// Data tab
document.getElementById('d-push').onclick = async () => {
  cmsg('Pushing…');
  const r = await MeridianCore.sync.save();
  cmsg(r.cloud === 'synced' ? '✓ Pushed' : 'Push: ' + r.cloud, r.cloud === 'failed');
};
document.getElementById('d-pull').onclick = async () => {
  cmsg('Pulling…');
  const applied = await MeridianCore.sync.pull();
  cmsg(applied ? '✓ Pulled. Reloading…' : 'Already up to date');
  if (applied) setTimeout(() => location.reload(), 700);
};

// boot: replace the pendingCloud/pendingPush dance
if (cloudEnabled()) { await MeridianCore.sync.pull(); }

// focus sync
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cloudEnabled() && !MeridianCore.sync.anyDirty()) {
    MeridianCore.sync.pull();
  }
});

// paintSaveChip
function anyDirty() { return MeridianCore.sync.anyDirty(); }
```

Deletions record tombstones through the typed helper:

```js
// was: tomb(WK, id)
WK._del = MeridianCore.addTombstone(WK._del, id, Date.now());
```

---

## 4. Tombstone pruning

Nothing to call manually. `sanitizeStore` runs inside the save lifecycle on
every store before it is serialised, so the 500-entry cap is enforced whether
or not the device ever reaches the network — which is exactly the case the old
code missed.

---

## 5. Build

```bash
cd ts && npm run build      # compile + minify + inject
npm run build:check         # CI: fails if index.html is stale
```
