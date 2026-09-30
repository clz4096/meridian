# Cambridge Method: frozen contract (Stages 3 and 4)

Every agent codes against this. Change it only through the orchestrator. Background: `ARCHITECTURE-cambridge.md` (the Massey map) and `DECISIONS.md` C1 onward.

## 1. Storage

### A new synced store, `cambridge`
- **localStorage key:** `meridian-cambridge`.
- **Store wiring:** it is the sixth store, added to every place that fixes the store list:
  - `STORAGE_KEYS` in `src/app/bootstrap.ts`,
  - `SyncEngine.ts`,
  - `mergeStores.ts`,
  - Data export and import (`dataSelectors` normalise, and the export list),
  - the Undo snapshot.
- **Merge semantics** (a new `mergeCambridge`; never `unionById`):
  - Every record carries `updatedAt` (ms), and the newer record wins, per record. That is why an edit to an existing item reaches the other device, unlike the old `core` lists.
  - Deletions are tombstones (`deleted: true`, with `updatedAt`), pruned after 30 days like the other stores.
  - Timer totals take the per-question max, so a device that timed less never lowers them.
- **Old builds:** a device still on the old build pushes the cloud `state.json` without the `cambridge` key, because it only knows five stores.
  - Verify whether `SyncEngine` preserves unknown top-level keys when it pushes. If it doesn't, the new build must treat a missing cloud `cambridge` as "no remote change", never as an empty store that wins.
  - Add a test for this case.

### Shape (`src/features/cambridge/types.ts`)
```ts
type QStatus = 'solved' | 'partial' | 'stuck';
type ItemStage = 'not-started' | 'attempting' | 'written-up' | 'supervised' | 'redo-done';
interface CamQuestion { q: string; status?: QStatus; stalledAt?: string; coldSec: number; runningSince?: number; mark?: number /* 0..20 */ }
interface CamItem { id: string /* step.json / courses.json id */; stage: ItemStage; questions: Record<string, CamQuestion>;
  writeup?: string /* Markdown + $LaTeX$ */; photos?: string[] /* local photo ids, see 1.3 */;
  hintsUnlockedEarly?: boolean; supervisedAt?: number; weakPoints?: string[]; redoQs?: string[];
  redoDue?: number; redoneAt?: number; updatedAt: number; deleted?: boolean }
interface CamError { id: string; itemId: string; q: string; cause: 'concept' | 'algebra slip' | "didn't see the idea" | 'ran out of time';
  topic: string; fix: string; at: number; updatedAt: number; deleted?: boolean }
interface CamGate { phase: string; passedAt: number; evidence: Record<string, string>; updatedAt: number }
interface CamWeek { week: string /* ISO week, e.g. 2026-W40 */; scores: Record<CamWeekItem, 0 | 1 | 2>; updatedAt: number }
interface CambridgeState { v: 1; items: Record<string, CamItem>; errors: Record<string, CamError>; gates: Record<string, CamGate>;
  weeks: Record<string, CamWeek>; awarded: Record<string, number> /* one-time XP guards, key -> ms */; migratedAt?: number }
```

### Photos
Photos stay local-only, in IndexedDB database `meridian_photos`, as compressed JPEG or WebP: the long edge at most 1,600 px, about 150 to 300 KB each. They are not synced (DECISIONS C5). An item stores photo ids. The Data tab shows photo storage used.

## 2. Migration and backup (runs once per device, before any Cambridge write)
1. **Back up first.** Write every Massey key into one dated JSON backup, before any change.
   - Keys: `meridian-theorist`, `meridian.curriculum.v1`, `meridian.papers.v1`, `meridian.proofjournal.v1`, `meridian.tracker.ui.v1`, `meridian.tracker.tab.v1`, `meridian.teach.v1`, `meridian.feed.v2`, the legacy `meridian.tracker.v1`, and the migration markers. The list comes from `ARCHITECTURE-cambridge.md`, section 2.
   - The backup goes to IndexedDB (`meridian_backups`, key `massey-<YYYY-MM-DD>`), plus a copy in localStorage (`meridian.backup.massey.<date>`) if it fits.
   - Data gets a "Download Massey backup" button.
2. **Never delete or rewrite old keys.** Old builds keep working. XP, level, streak, meters, scorecards, blocks and the banked history all stay in `meridian-theorist`, unchanged.
3. **Keep the proof journal readable.** The journal becomes a read-only "Archived journal" entry on the error log screen. Its entries are not converted.
4. **Mark it done.** Set `cambridge.migratedAt`. A test loads a real-shaped old backup, runs the migration, and asserts XP, level and streak are identical and every old key is untouched.

## 3. XP and scorecards (`trackerStore.ts`)
- **New `EVENT_WEIGHTS`** (keep the existing ones):
  - `coldAttempt: 20` (a question's cold time reaches at least 60 min)
  - `writeup: 15` (full write-up submitted)
  - `supervision: 25` (supervision held)
  - `redo: 15` (redo within 48 h of supervision)
  - `stepSelfMark: 10` (a STEP question self-marked at least 14/20)
  - `gatePassed: 200` (phase gate passed)
- **Crediting:** through `creditEvent` with ids namespaced `cam:<kind>:<itemId>[:<q>]`.
- **One-time guards:** `creditEvent` is day-scoped, so each award also records `cambridge.awarded[<event id>]`. The same item and question can never pay twice on different days.
- **Weekly Cambridge scorecard:** 5 items (Missed 0 / Partial 1 / Met 2, total 10):
  1. cold attempts of 60 minutes or more,
  2. write-ups before supervision,
  3. both supervisions held,
  4. misses redone within 48 hours,
  5. phase pace target hit.
  - Auto-computed from the week's records, and overridable by the owner.
  - It feeds the Focus and Progress meters as an additional input. Document the formula; the existing meters must not move for a user with no Cambridge data (test).
- **Credit line:** "Scoring system adapted from the Massey Standard", in small text on the tracker.

## 4. Scheduling (pure functions, `src/features/cambridge/schedule.ts`, unit-tested)
- **`sunset(date, lat = 40.6782, lon = -73.9442)`:** the NOAA solar-position algorithm, local and offline, returning the America/New_York time. Test it against 3 known dates within ±3 min.
- **`inSabbath(t)`:** Friday sunset to Saturday sunset, computed with `sunset()`. Nothing is scheduled inside that window.
- **`redoDue(supervisedAt)`:** 48 h later. If that falls inside the Sabbath, it moves to Saturday sunset plus 1 h.
- **`supervisionsThisWeek(state, now)`:** returns `{ held, target: 2, suggested: ['Mon', 'Wed'] }`.
- **`currentItem(state, step, courses, now)`:** the item Today shows, and its loop step, labeled like the brief: "Assignment 7: attempt cold", "Supervision due", "Redo due by Thu 6 PM".
- **Phase order:**
  - 0 → A → A+ (runs alongside B) → B → C → D → Part IA.
  - A phase unlocks when the previous gate passes. Part IA unlocks when Phase B's gate passes.

## 5. Routes and screens
- **New tabs in `src/ui/store.ts`**, each a lazy view:
  - `cambridge`: the path screen.
  - `cam-item`: a study item. The id lives in a signal `camItemId`, and history pushes it so Back works.
  - `cam-errors`: the error log.
  - `glossary`.
- **Today's Math path card** opens `cambridge`. It reads through `currentItem`, dynamically imported (main chunk gate: at most +4 KB gzip over 73.3 KB).
- **The `math` tab id** now renders the Cambridge path screen, so old history entries and links still work.
- **Study item:**
  - Links, with hints hidden behind the 60-minute cold timer ("Unlock early" asks for confirmation).
  - A persistent cold-attempt timer per question: `runningSince` is persisted, and the elapsed time is computed from the clock, so it survives reloads and offline.
  - Per-question status and where you stalled.
  - The write-up (Markdown + KaTeX, lazy-loaded) and photos.
  - Supervision: "Start supervision" copies the filled prompt from `supervisor-prompt.md` with `{item title}`. For Part IA it uses "{course} supervisor, example sheet {n}". Afterwards you log marks /20, 3 weak points and 2 redo questions.
  - The redo, scheduled automatically.
  - The loop stepper from `method.json`.
- **Error log:**
  - An entry is created automatically for every question marked under 14/20, or marked stuck.
  - Filter by cause and topic; show a weekly trend chart.
- **Glossary:** searchable. A `<Gloss>` text helper underlines the glossary `match` words in text and shows the plain meaning on tap, as a popover with a 44 px target.
  - `Gloss` wraps the text of the Cambridge screens, the tracker, and the Today Math card. Acronyms (STEP, OCR, CST) match only case-sensitively as whole words.
- **Every block needs four states:** loading, empty, error, and offline. Code-split per route. Design tokens only. Targets of 44 px or more. Body text of 16 px or more.

## 6. Tests required
- Data schema validation.
- XP events, including one-time guards across days.
- Timer persistence across reloads.
- 48-hour redo scheduling, including the Sabbath shift.
- The Sabbath blackout, using `sunset()` with known dates.
- Migration from Massey data: an old backup loads, and XP, level and streak are preserved.
- `mergeCambridge`:
  - LWW per record, tombstones, and the timer max,
  - a missing remote store never wipes local.
