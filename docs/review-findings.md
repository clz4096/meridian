# Meridian — Whole-Project Design Review

Lens: APoSD (Ousterhout) + TypeScript quality + global standards. Heuristics, not rules — each finding is tied to a complexity cost. **Report only; no source edits.** `mergeStores.ts` / `SyncEngine.ts` / tombstone / revision logic are flagged, never changed.

Walk order: typed core → adapters → view controllers → legacy.

---

## High

### H1 — Typed schema is narrower than the data the app writes *and reads*
| | |
|---|---|
| **Location** | `types.ts` `LogEntry` (123-129), `KnowledgeState.log` (157); `dataSelectors.ts` `normaliseCore` (141-150) / `normaliseKnowledge` (175-183); `coreSelectors.ts` `streamTotals` (94), `knowledgeSelectors.ts` `studyStreak` (180) / `selectStudyView` (222) |
| **Principle** | information leakage / types don't model the domain / define-errors-out-of-existence (violated) |
| **Problem** | Legacy writes `entries.push({…, status:'solved'\|'attempted', score })` (index.html:980-982) and `KG.log.push({…, at, rating, date, topic })` (index.html:978). `LogEntry` declares only `id/date/stream/source?/xp?`; `KnowledgeState.log` declares only `id/qid/at/rating`. So `status`, `score`, `date`, `topic` exist at runtime but not in the types. Consumers reach them through casts (`(e as { status?: string }).status`, `(entry as { date?: string }).date`). Worse: `normaliseState` — which the import path treats as authoritative — **drops** every undeclared field. |
| **Why it adds complexity** | Unknown-unknowns + change amplification. The module doc for `dataSelectors` promises "round-trip fidelity … byte-for-byte identical," but export→import silently strips `status`/`score` from core entries and `date`/`topic` from the knowledge log. `streamTotals.solved/attempted` and `studyStreak`/`answeredToday` read exactly those dropped fields, so a backup restore quietly zeroes solved/attempted counts and the study streak. A cast is a standing invitation to read a field the type says can't be there. |
| **Direction** | Make the stored types model what is actually persisted (add `status`/`score` to `LogEntry`, `date`/`topic` to the log entry, or an explicit `extra` bag), and have `normalise*` preserve them. Then delete the read-site casts — the type carries the field. |
| **Severity** | **High** (data-fidelity on the export/persistence path) |

### H2 — Two parallel storage stacks straddle the strangler seam
| | |
|---|---|
| **Location** | `index.html` `IDB`/`lsGet`/`wsGet`/`rawGet`/`rawSet` (300-344) vs `browser/adapters.ts` `openIdb` + `BrowserStorageAdapter` (23-113) |
| **Principle** | information leakage / temporal-decomposition residue / duplicated design decision |
| **Problem** | The IndexedDB wrapper, the localStorage wrapper, and the version-stamp (`__v`, newest-wins, heal-the-others) protocol exist twice. They have **diverged**: legacy `rawGet`/`rawSet` handle *three* tiers including `window.storage` (the Claude-account cross-device store); `BrowserStorageAdapter` handles *two* (localStorage + IndexedDB). Reads still come from legacy `rawGet` at boot (index.html:407, 448, 812, 839), but all writes now go through `MC.sync.save()` → `BrowserStorageAdapter`. Consequence: `rawSet` and `wsSet` are now **dead** (zero callers), so the `window.storage` tier is *read but never written* after migration — the zero-config cross-device path silently stopped receiving data, and the two stacks stamp `__v` independently. |
| **Why it adds complexity** | Change amplification + correctness risk on persistence. "How does a byte reach disk?" now has two answers that disagree on tier count and on who owns the version stamp. A user who relied on `window.storage` sync and never configured Supabase loses cross-device sync with no signal. |
| **Direction** | Pick one owner. Either route boot reads through the engine's `StorageAdapter` too and delete legacy `rawGet`/`rawSet`/`IDB`/`ws*`, or, if the `window.storage` tier is still wanted, add it *inside* `BrowserStorageAdapter` so there is a single storage abstraction. Confirm the `window.storage` drop is intentional. |
| **Severity** | **High** |

### H3 — "Is there unsaved data?" has two sources of truth
| | |
|---|---|
| **Location** | `index.html` `anyDirty()` (1078) combining `MC.sync.anyDirty()` with legacy `dirty`, `wkDirty`, `sgDirty`, `kgDirtyFlag` (348, 443-446, 810-811, 836-838, 886-887); `SyncEngine` `pendingLocal`/`pendingCloud` (128-129) |
| **Principle** | pull-complexity-downward (not done) / duplicated design decision |
| **Problem** | `SyncEngine` was built specifically to own dirty-tracking (per its header: separate `pendingLocal`/`pendingCloud`, rev-guarded clearing). The legacy layer still maintains four hand-rolled dirty booleans and ORs them with the engine's answer. Two bookkeeping systems for one fact. |
| **Why it adds complexity** | Cognitive load + correctness. To reason about the save-chip / discard-FAB you must hold both systems in your head, and a divergence (engine clean, legacy flag stuck, or vice-versa) mis-reports sync state — the exact "did my data save?" anxiety the engine was meant to end. |
| **Direction** | Let the engine be the single authority. Drive `markDirty()` through `engine.edit(...)` and derive the chip purely from `MC.sync.anyDirty()`/`isDirtyLocal`/`isDirtyCloud`; retire the legacy flags. |
| **Severity** | **High** (sits on the save path) |

---

## Medium

### M1 — Storage-key names duplicated across the seam
| | |
|---|---|
| **Location** | `index.html` `KEYS` (283-288) vs `browser/entry.ts` `STORAGE_KEYS` (169-174) |
| **Principle** | information leakage |
| **Problem** | The four legacy key strings (`meridian-core`, `overload-tracker-state`, `surplus-tracker-state`, `csgraph_profile_v2`) are written out in full in both places. |
| **Why it adds complexity** | Change amplification: renaming or adding a store means editing two files that don't reference each other, and a typo desynchronizes reads from writes. |
| **Direction** | One owner (the typed core exports the map; legacy imports it via the `MeridianCore` global, which it already uses for everything else). |
| **Severity** | **Med** |

### M2 — `StoreKey` union defined twice
| | |
|---|---|
| **Location** | `SyncEngine.ts:21` and `mergeStores.ts:15` (identical `'core' \| 'overload' \| 'surplus' \| 'csgraph'`) |
| **Principle** | information leakage / consistency |
| **Problem** | Same discriminant declared independently in two modules; `entry.ts` imports the `SyncEngine` copy, `mergeStores` uses its own. |
| **Why it adds complexity** | Adding a fifth store requires edits in two type declarations; they can silently drift, and a mismatch only surfaces at the `as never` casts in `mergeStore` (142-146), which would hide it. |
| **Direction** | Declare once (a small shared `storeKeys.ts`, or re-export from one module) and import everywhere. |
| **Severity** | **Med** |

### M3 — Shared view infrastructure parked in a domain module
| | |
|---|---|
| **Location** | `esc` (workoutView.ts:73) and the `ViewHost` port (workoutView.ts:320-334) imported by `mealView.ts`, `knowledgeView.ts`, `dataView.ts` |
| **Principle** | information hiding / module boundaries |
| **Problem** | `ViewHost` is the *shared* contract for all four controllers, and `esc` is generic HTML escaping, yet both live inside the workout-specific module. Every other view depends on `workoutView.ts` for reasons unrelated to workouts. |
| **Why it adds complexity** | Cognitive load + false coupling: a reader can't tell what is workout-specific vs shared, and `workoutView.ts` can't be understood or changed in isolation. |
| **Direction** | Lift `ViewHost` and `esc` (plus `attr`/`domId`) into a `viewHost.ts` / `html.ts` that all four views and the DOM host import. |
| **Severity** | **Med** |

### M4 — Four view controllers duplicate the repaint boilerplate (and one diverges)
| | |
|---|---|
| **Location** | `repaint()` + delegated `onClick()` in `WorkoutViewController` (workoutView.ts:359-436), `MealViewController` (mealView.ts:119-159), `KnowledgeViewController` (knowledgeView.ts:203-236), `DataViewController` (dataView.ts:116-148) |
| **Principle** | classitis / boilerplate that belongs in a deeper module / consistency |
| **Problem** | All four repeat the same dance: diff `lastHTML`, capture focus id + caret + scroll + typed inputs, swap `innerHTML`, restore. `DataViewController.repaint` **omits** `getScrollY`/`setScrollY` — so the Data tab jumps to the top on any repaint (e.g. after a status message), unlike the other three. |
| **Why it adds complexity** | Change amplification (a fix to the focus-preservation logic must be applied four times) and the divergence is a latent UX bug that the duplication hides. |
| **Direction** | Extract the capture/swap/restore into one `renderInto(host, html, prev)` helper (or a small base class) that every controller calls; the per-view part is just "produce HTML" + "map data-act to an action." |
| **Severity** | **Med** |

### M5 — `ProgressionConfig` conflates workout tunables with tombstone bounds
| | |
|---|---|
| **Location** | `types.ts` `ProgressionConfig.tombstoneMaxAgeDays` / `tombstoneMaxCount` (256-259), `DEFAULT_CONFIG` (278-279); consumed by `mergeStores.ts` `sanitizeStore` (165) and `workoutSelectors.ts` `pruneTombstones` (93-109) |
| **Principle** | information hiding / different-modules-one-decision |
| **Problem** | Sync-layer sanitation depends on a *workout* config object for its size bounds, so `mergeStores` imports `DEFAULT_CONFIG` (a progression tunable) purely to read two tombstone limits. |
| **Why it adds complexity** | Cross-domain coupling: the sync/merge decision leaks into the workout tunables type, and editing rep/rest tunables now sits in the same object the persistence bound is read from. |
| **Direction** | Give tombstone bounds their own small config (owned by the sync/merge layer) and have `sanitizeStore`/`pruneTombstones` take that, not `ProgressionConfig`. |
| **Severity** | **Med** |

### M6 — Dead cloud/merge implementations retained
| | |
|---|---|
| **Location** | `PantryCloudProvider` (adapters.ts:135-181) — never instantiated (`entry.ts:191` wires `SupabaseCloudProvider`). `mergeCollection` + `Collection` (SyncEngine.ts:382-405) — used only by its own test; the real `MergeFn` is `mergeStore`. |
| **Principle** | strategic debt / duplicated knowledge |
| **Problem** | Two unused implementations sit in production modules. `mergeCollection` re-encodes merge policy (union-by-id + tombstones) a second time, next to the code that must not be edited — a prime candidate to drift out of sync with `mergeStores.ts`. |
| **Why it adds complexity** | Cognitive load: a reader must determine which cloud provider and which merge is live. A second merge "reference" implies it is authoritative when it isn't. |
| **Direction** | If `PantryCloudProvider` is a supported backend, wire it behind config and test it; otherwise delete. Move `mergeCollection` to test scaffolding or delete it — the real merge is the reference. (Flag only for the SyncEngine file.) |
| **Severity** | **Med** |

### M7 — Pantry→Supabase migration left stale names/comments/constants
| | |
|---|---|
| **Location** | Legacy: `PANTRY_BASE`/`BASKET` (index.html:358-359), `MIN_PUSH_GAP`/`lastPushAt`/`pushBackoffUntil` (376-377), empty comment blocks describing removed merge/optimistic-concurrency logic (364-378), the "CLOUD BACKEND (Pantry REST store)" block header (353-357) over a `cloudEnabled()` that actually checks Supabase keys (360-362). Typed layer: `DataActions.savePantryId`, `SyncStatus.pantryId` (dataView.ts:14, 34), input id `d-pantry` labeled "Project URL" / anon key (dataView.ts:54). `sw.js` bypasses `getpantry.cloud` and comments "Pantry POSTs" (sw.js:6, 8). |
| **Principle** | names/comments (design) / consistency / tactical residue |
| **Problem** | The backend changed from Pantry to Supabase but the vocabulary didn't. Constants describe throttling that now lives in `SyncEngine`; comments describe a Pantry cloud model that no longer runs; `pantryId` now holds a Supabase Project URL; the service worker's cache-bypass still names Pantry and does **not** cover Supabase (see M8). |
| **Why it adds complexity** | High cognitive load / unknown-unknowns: names actively mislead. A maintainer reading `savePantryId(url, key)` or the Pantry comment block will form the wrong model of what the code does. |
| **Direction** | Rename `pantryId`→`projectUrl` / `savePantryId`→`saveCloudCredentials`, delete the dead Pantry constants and drained comment blocks, and correct the section headers and SW comments to Supabase. |
| **Severity** | **Med** |

### M8 — Service worker cache rules not updated for Supabase
| | |
|---|---|
| **Location** | `sw.js` fetch handler (5-22): bypass list covers `getpantry.cloud`/`anthropic.com` (8); everything else GET falls to cache-first (21) |
| **Principle** | consistency / hidden invariant |
| **Problem** | Cross-device correctness now leans entirely on `SupabaseCloudProvider.readUrl`'s `?t=Date.now()` buster (adapters.ts:215-219) to dodge the CDN and the SW. The SW itself has no Supabase carve-out, so the anti-staleness guarantee is split across two files, only one of which was updated. If the `?t=` param is ever dropped, Supabase reads fall into SW cache-first and silently serve stale `state.json` — the precise cross-device bug the adapter comment warns about. Unique `?t=` URLs also accrete in the cache forever. |
| **Why it adds complexity** | Unknown-unknowns: a load-bearing invariant (never cache the cloud read) is enforced in the adapter but silently unenforced in the SW; the two must stay in agreement with nothing linking them. |
| **Direction** | Add a Supabase-host bypass to the SW fetch handler alongside the existing one, so "never cache the sync endpoint" is stated where caching is decided. |
| **Severity** | **Med** |

---

## Low

### L1 — `SyncEngine.push()` noop branch has a vacuous rev-guard *(flag only — no edit)*
| | |
|---|---|
| **Location** | `SyncEngine.ts` push() (251-257) |
| **Principle** | comments/names (design) / misleading code |
| **Problem** | `const revsNow = { ...this.rev }` is captured and then compared `this.rev[key] === revsNow[key]` with no `await` in between, so the condition is always true and `pendingCloud` is cleared unconditionally. It mimics the meaningful capture-before-await / compare-after-await pattern used correctly elsewhere in the file (224, 296), but here there is nothing to race against. |
| **Why it adds complexity** | Cognitive load: a reader assumes the guard is protecting against a concurrent edit and looks for the race that doesn't exist. No behavioral bug (clearing on a confirmed no-op is fine), just dead ceremony. |
| **Direction** | Describe intent in a comment or drop the self-comparison. Report only — do not edit sync logic. |
| **Severity** | **Low** |

### L2 — `importBundle` version guard contains an always-true term
| | |
|---|---|
| **Location** | `dataSelectors.ts` importBundle (228) |
| **Principle** | comments/names / dead sub-expression |
| **Problem** | `obj(b.data) !== undefined` is always true — `obj()` returns `{}` for any non-object — so only the adjacent `b.data !== undefined` does real work. |
| **Why it adds complexity** | Minor cognitive load: implies a check that isn't happening. |
| **Direction** | Drop the `obj(b.data) !== undefined` term. |
| **Severity** | **Low** |

### L3 — Thin pass-through shims with a dead parameter
| | |
|---|---|
| **Location** | `index.html` `saveAll(silent)` (891 — ignores `silent`), `cloudPush` (892), `cloudPull` (893) |
| **Principle** | pass-through method / dead parameter |
| **Problem** | `saveAll`/`cloudPush` forward verbatim to `MC.sync.*`; `saveAll`'s `silent` argument is no longer read yet is still passed by callers (384, 529, 1140). |
| **Why it adds complexity** | Low. Seam shims are defensible while legacy call sites exist, but the dead `silent` param implies behavior that's gone. |
| **Direction** | Keep the shims if they ease the migration; drop `silent` or honor it. |
| **Severity** | **Low** |

### L4 — Repeated recomputation in workout selectors
| | |
|---|---|
| **Location** | `workoutSelectors.ts` `allExercises` recomputes `tombstoneIds(state)` inside the per-date loop (193-194); `selectWorkoutView` (699-743) calls `buildPlan` per exercise, each re-deriving `exerciseDates`→`setsOn`→`tombstoneIds` from the full `days` map |
| **Principle** | efficiency / cognitive load (small N) |
| **Problem** | Tombstone-set construction and full-history scans repeat across the selector tree. At the realistic N for a personal tracker this is not a latency problem — flagged for the constant-factor waste, not an asymptotic claim. |
| **Why it adds complexity** | Minor. The purity is worth more than the recomputation costs; note, don't over-engineer. |
| **Direction** | If a profile ever shows it, hoist `tombstoneIds(state)` once and thread a per-`selectWorkoutView` memo of `exerciseDates`. Otherwise leave it. |
| **Severity** | **Low** |

### L5 — `_del` and a live id can coexist at the type level *(acceptable by design)*
| | |
|---|---|
| **Location** | `types.ts` `Tombstones` + collection types (32, 79, 108, 134) |
| **Principle** | make-illegal-states-unrepresentable |
| **Problem** | Nothing in the types stops an id from being both present in `days`/`entries` and in `_del`. The merge (`unionById`, `mergeStores.ts:34-36`) always filters dead ids, so the ambiguity is resolved *by design* at merge time. |
| **Why it adds complexity** | Low, and the runtime defense is the right call — encoding this in TS would need smart constructors that outweigh the benefit. |
| **Direction** | Leave the representation; add a one-line invariant comment on `Tombstones` ("a tombstoned id is always filtered on read; liveness = present ∧ not in `_del`") so the guarantee is documented, not just implemented. |
| **Severity** | **Low** |

---

## Cross-cutting themes

1. **The strangler migration is unfinished, and the halves disagree.** Storage (H2), dirty-tracking (H3), and cloud constants (M7) each exist in both the legacy inline script and the typed core, with behavioral divergence (tier count, dead `window.storage` writes). The typed core doesn't yet *own* its design decisions — the legacy layer shadows them.
2. **Schema drift: the types are narrower than the data.** `types.ts` omits fields the app actually writes and reads (`status`/`score`/`date`/`topic`), forcing read-site casts and causing `normaliseState` to silently strip them on import (H1). The type system is documenting an aspiration, not the data.
3. **Provider rename never propagated (Pantry → Supabase).** Names, comments, dead constants, the service worker, and a typed public field still say "Pantry" (M6, M7, M8). Every stale name is a wrong mental model waiting to be adopted.
4. **Shared infrastructure lives inside domain modules.** The view port and HTML escaper sit in `workoutView.ts` (M3); tombstone bounds sit in `ProgressionConfig` (M5); cross-cutting primitives (`toId`/`toNum`/`pruneTombstones`) sit in `workoutSelectors.ts`. Boundaries follow history, not information-hiding.
5. **View-controller boilerplate is copy-pasted and has silently diverged.** The focus/scroll-preserving repaint is written four times; the Data tab dropped scroll restoration (M4).

## Prioritized top 10

1. **H1** — schema drift drops live fields on import; breaks round-trip fidelity + post-restore counts/streaks. *(persistence path)*
2. **H2** — dual storage stacks; `window.storage` cross-device tier now write-dead. *(persistence path)*
3. **H3** — two sources of truth for "dirty"; mis-reports save state. *(save path)*
4. **M5** — sync/merge sanitation coupled to the workout config type.
5. **M1** — storage-key names duplicated across the seam.
6. **M2** — `StoreKey` union declared twice; drift hidden by `as never`.
7. **M8** — service worker doesn't bypass Supabase; anti-staleness invariant split across two files.
8. **M6** — dead `PantryCloudProvider` + duplicate `mergeCollection` reference merge.
9. **M4** — repaint boilerplate ×4 with a real scroll-restoration divergence.
10. **M3 / M7** — shared infra in domain modules; Pantry naming still pervasive.
