# Cambridge Method: architecture map of the Massey Standard (Stage 1)

Mapper output for branch `cambridge`. Every claim cites `file:line` at the time of writing. Paths are relative to the repo root. UI strings that contain an em dash in the source are quoted here with the dash replaced by a colon.

Verdict key: **KEEP** (game layer, algorithm of the day, paper of the week, teaching), **REPLACE** (Princeton study path), **RENAME** (keep the mechanism, change the Princeton/Massey wording).

---

## 1. Component map of the tracker screen

Route: tab `tracker` lazy-loads `StudyTrackerView` (`src/ui/App.tsx:80`). The view calls `ensureToday()` on mount (`src/features/studytracker/StudyTracker.tsx:88-90`) and starts a 45 s clock (`StudyTracker.tsx:91`, `now.ts:21-35`). Two sub-tabs, `today` and `playbook` (`StudyTracker.tsx:49-52`), persisted in `meridian.tracker.tab.v1` (`uiState.ts:46-69`). Only the active tab renders.

### Header and glance strip (both tabs)

| # | Section | Where | Reads / writes | Verdict |
|---|---|---|---|---|
| 0a | Masthead: Princeton crest, "The Massey Standard", About | `StudyTracker.tsx:151-166`, crest `princeton-shield.png` (`:37`) | static | RENAME |
| 0b | Glance: XP today, level + cumulative XP bar, weekly-session ring (sessions/4), "Light day" chip | `StudyTracker.tsx:169-200` | reads `trackerState` (`dayXP`, `levelIndex`, `LEVELS`), `weeklySessions()`, `journalEntries` (subscribe only, `:102`) | KEEP |
| 0c | Sub-tab control | `StudyTracker.tsx:202-219` | writes `meridian.tracker.tab.v1` | KEEP |

Note: the glance shows a **weekly-session ring**, not the 7-day streak (`StudyTracker.tsx:99-101`). The 7-day streak (`streakCount`) is still computed for the hub tile only (`trackerStore.ts:472-475`, `src/ui/actions.ts:1349,1355`).

### Today tab, in render order

| # | Section (Collapsible id) | Component file | Reads / writes | Verdict |
|---|---|---|---|---|
| 1 | "Today's reading" (`feed`, closed) | `FeedSection.tsx:16-24` | `loadDailyFeed` reads/writes `meridian.feed.v2` (`feedSources.ts:40,167-229`); network: HN Algolia | KEEP (feed) |
| 1a | Princeton theory group (inside #1) | `PrincetonGroup.tsx:8-31`, data `princetonTheory.ts:15-65` | static | REPLACE |
| 1b | Reading takeaway note (inside #1) | `ReadingNote.tsx:14-49` | writes journal entry `addEntry` (`:23`) + event `read:feed` = 10 (`:24`) | KEEP (journal target may change) |
| 2 | "Algorithm of the day" (`algo`, open) | `AlgoOfDay.tsx:15-128`; content `algorithms.ts:42`, rotation `algorithms.ts:1120-1124`, sources `ALGO_SOURCE` `:1144` | reads `day.events['algo:studied']` (`:21`); writes event `algo:studied` = 20 (`:120`) | KEEP |
| 2a | "Prove it yourself" (inside #2) | `ProveItYourself.tsx:21-126`, `algoProveIt.ts`, `algoProofs.ts`, `GatedReveal.tsx` | events `algo:flaw:<id>` = 20 (`:40`), `algo:proveit:<id>` = 20 (`:49`); writes journal entry (`:48`) | KEEP |
| 3 | "Teach today's topic" (`teach`, closed) | `src/features/teaching/TeachSection.tsx:64,139-143` | `meridian.teach.v1`; events `teach:*` (see 2.3) | KEEP |
| 4 | "The theory track" (`curriculum`, closed): problem set of the week + course ladder by track with decaying mastery bars | `CurriculumSection.tsx:22-94`; data `curriculum.ts:17-66` | reads `theorist.mastery` via `currentMastery` (`:25`); writes `reviewTopic` (mastery + event `topic:<code>` = 25) (`:71`) | REPLACE |
| 5 | "The day" schedule (`schedule`, open): 15 tickable blocks, ET "now" highlight | `StudyTracker.tsx:239-256`; data `SCHEDULE` `trackerStore.ts:57-73`; `currentBlockId` `now.ts:71-82` | reads/writes `theorist.day.blocks` via `toggleBlock` (`trackerStore.ts:304-308`) | KEEP mechanism, RENAME block text |
| 6a | Day type Full/Light toggle | `StudyTracker.tsx:261-266` | writes `day.dayType` via `setDayType` (`trackerStore.ts:372-375`) | KEEP |
| 6b | Spaced return "Reconstruct from memory" | `StudyTracker.tsx:109-134,268-275` | reads `stalestTopic()` (course label looked up in `CURRICULUM`, `:113-114`) or the oldest un-reconstructed journal entry >14 d; writes `markTopicReviewed` + event `retrieval` = 50, or `toggleReconstructed` + `journal:retrieval:<id>` = 50 | KEEP (label lookup must change, see Risk R7) |
| 6c | Scorecard (`scorecard`, open): 10 items, Missed/Partial/Met, total /20, band | `StudyTracker.tsx:277-305`; `SCORE` `trackerStore.ts:81-92` | `day.scores` via `setScore` (`:309-314`) | KEEP (s3/s4/s5/s6 wording may RENAME) |
| 6d | Five meters | `StudyTracker.tsx:307-321`; `METERS` `trackerStore.ts:95-101` | derived from `day.scores` | KEEP |
| 6e | Bank button | `StudyTracker.tsx:323-328` | `toggleBank` (`trackerStore.ts:330-343`) | KEEP |
| 7 | "Paper of the week" (`papers`, closed) | `PapersSection.tsx:11-74`; data `papers.ts:28-140` | `meridian.papers.v1` via `togglePass` (`papers.ts:173-185`); event `paper:reproduce` = 30 on pass 3 false to true (`PapersSection.tsx:58`) | KEEP |
| 8 | "Proof & derivation journal" (`journal`, closed) | `ProofJournal.tsx:15-95`; store `proofJournalStore.ts` | `meridian.proofjournal.v1`; events `journal:save` = 10, `journal:retrieval:<id>` = 50 (`:28-31`) | REPLACE per brief (see Risk R5: the journal is also the sink for reading notes, proof attempts, and spaced return) |

### Playbook tab, in render order (all static `<details>`)

| Section | Where | Verdict |
|---|---|---|
| "The path, in three climbs" (Foundations / Algorithms / Theory + boss battles) | `StudyTracker.tsx:339-349` | REPLACE |
| Gym playlist (18.06, 18.404, AWS, Barak) | `StudyTracker.tsx:351-361` | REPLACE or RENAME |
| Study shelf (Stanford Algorithms, Barak, COS 521, COS 445) | `StudyTracker.tsx:363-375` | REPLACE |
| House rules & traps | `StudyTracker.tsx:377-390` | KEEP |
| Words & sources (morning / evening words, evidence) | `StudyTracker.tsx:392-399` | KEEP (source line names Princeton, RENAME) |
| Reset today / Reset everything | `StudyTracker.tsx:401-411` | KEEP |
| Footer "The Massey Standard" | `StudyTracker.tsx:415-417` | RENAME |

### Daily blocks and how they link to curriculum

Blocks are a static array `SCHEDULE` in `src/features/studytracker/trackerStore.ts:57-73`. Each is `{ id, time, title, sub, xp, gym? }` (`trackerStore.ts:47-54`). They are **0-XP** (`blockXP` returns 0, `:249-251`; `xp` field is unused by `dayXP`, `:259-265`).

| id | time (ET) | title | sub |
|---|---|---|---|
| b4 | 10:00 AM | Deep Block 1: proofs & problem set | "The week's pset; reconstruct before you look" |
| b5 | 11:40 AM | Deep Block 2: algorithms | "The algorithm of the day, implemented in C++" |
| b7 | 1:30 PM | Deep Block 3: math, paper & pen | "Fought a hard problem; reconstructed first" |
| b10 | 5:30 PM | Deep Block 4: math / reconstruct | "Re-derived a result, or advanced the course" |
| b12 | 8:00 PM | Practice + review | "Worked a set; upsolved every miss" |
| b13 | 9:30 PM | Paper pass | "One Keshav pass on the week's paper" |

The link to curriculum is **text only**. No code joins a block to `psetOfWeek`, `CURRICULUM`, or the Math path; the only glue is the hint string "The focus blocks point at the theory track: proofs and problem sets..." (`StudyTracker.tsx:241`). The persisted key is the block `id` (`day.blocks[id]`, `StudyTracker.tsx:244-247`). Renaming titles is safe; renumbering ids only orphans today's ticks (0 XP, but they count toward a Light-day session, `trackerStore.ts:442-444`).

---

## 2. Data model

### 2.1 Synced CRDT stores

`STORAGE_KEYS` (`src/app/bootstrap.ts:17-23`): `core`=`meridian-core`, `overload`=`overload-tracker-state`, `surplus`=`surplus-tracker-state`, `csgraph`=`csgraph_profile_v2`, `theorist`=`meridian-theorist`. `StoreKey` is a closed union in three places: `SyncEngine.ts:21-22`, `mergeStores.ts:15`, and the cloud blob `CloudPayload` has one field per store (`SyncEngine.ts:28-36`). Local persistence is localStorage plus IndexedDB, newest by a `<key>__v` stamp (`src/core/storage/adapters.ts:69-99`). Cloud is one Supabase blob holding all five stores (`adapters.ts:201`, `SyncEngine.ts:28-36`); pull merges each store via `mergeStore` (`SyncEngine.ts:515-521`).

Only `theorist` is used by the tracker.

**`meridian-theorist`** (`TheoristState`, `src/core/types.ts:241-276`)

```ts
interface TheoristState {
  banked: Record<string, number>;       // ISO date or "__carry" -> XP banked
  day: { date: string; blocks: Record<string, boolean>; scores: Record<string, number>;
         banked: boolean; events?: Record<string, number>; dayType?: 'full' | 'light' };
  dayTouchedAt?: Millis;                // LWW tiebreak for day
  mastery?: Record<string, { level: number; reviewedAt: Millis }>; // keyed by course code
  resetAt?: Millis;                     // reset epoch
}
```

- Writers: every mutator in `trackerStore.ts` through `commit` (`:156-164`): `ensureToday`, `toggleBlock`, `setScore`, `bankToday`, `toggleBank`, `resetDay`, `resetAll`, `creditEvent`, `setDayType`, `markTopicReviewed`, `reviewTopic` (`:185-416`). Boot load and two one-shot folds in `loadTheorist` (`src/core/storage/appState.ts:417-521`). Data import (`src/ui/actions.ts:1083,1111`) and snapshot restore (`actions.ts:1133`).
- View projection: `cumXP` = sum of `banked`, `logged` = ISO keys of `banked` (`trackerStore.ts:132-142`).
- Merge (`mergeTheorist`, `src/core/sync/mergeStores.ts:187-296`):
  - Reset epoch: a side with a lower `resetAt` is replaced by EMPTY (`:188-192`).
  - `banked`: per-key union, `Math.max` (`:195-200`). Grow-only.
  - `day`, same date: `blocks` OR, `scores` per-key max, `banked` OR, `events` per-key max, `dayType` LWW by `dayTouchedAt` with tie to `'light'` (`:210-253`).
  - `day`, different dates: `''` loses; else later `dayTouchedAt` wins wholesale; tie goes to later date (`:254-269`).
  - `mastery`: per-key LWW by larger `reviewedAt`, tie to larger `level` (`:276-287`).
  - **Output contains only these five top-level keys** (`:289-295`). Any other field is dropped.
- `sanitizeStore` skips `theorist` (`mergeStores.ts:327`).
- Export/import: included. `exportAll` exports all five stores (`actions.ts:1065-1073`); `normaliseTheorist` (`src/features/data/dataSelectors.ts:261-315`) keeps `banked`, `day` (with `events`, `dayType`), `dayTouchedAt`, `mastery`, `resetAt` and **drops any other key**. Import replaces the store after `takeSnapshot` (`actions.ts:1074-1092`). The snapshot `meridian_prev_snapshot` holds only the five stores (`actions.ts:1013-1031`).

### 2.2 Local-only keys (not synced, not in Data export, not in the snapshot)

| Key | Shape (file:line) | Writers | Readers |
|---|---|---|---|
| `meridian.curriculum.v1` | `Record<code, boolean>` (`curriculum.ts:69-70`) | `toggleCourse` (`curriculum.ts:84-92`) from `MathPath.tsx:172`, `CSPath.tsx:77` | `curriculumChecks` signal: `paths/math.ts:111`, `paths/cs.ts:78`, `MathPath.tsx:96`, `CSPath.tsx:20`; one-shot fold into `mastery` (`appState.ts:490-519`) |
| `meridian.papers.v1` | `Record<paperTitle, [bool,bool,bool]>` (`papers.ts:143-144`) | `togglePass` (`papers.ts:173-185`) from `PapersSection.tsx:56` and Today's ReadingBlock | `PapersSection.tsx:12`, `ReadingBlock.tsx:36` |
| `meridian.proofjournal.v1` | `JournalEntry[]` `{id, at, title, body, reconstructed?}` (`proofJournalStore.ts:9-19`) | `addEntry`/`deleteEntry`/`toggleReconstructed` (`:48-66`); callers `ProofJournal.tsx:22`, `ReadingNote.tsx:23`, `ProveItYourself.tsx:48`, `StudyTracker.tsx:131` | `journalEntries` (`StudyTracker.tsx:102`, `ProofJournal.tsx:16`) |
| `meridian.teach.v1` | `TeachLoop` (`teachingStore.ts:25-35`; nested types `teachingTypes.ts:8-57`) | every action in `teachingStore.ts:105-215` | `TeachSection.tsx:65`. Today only; a new day overwrites it (`teachingStore.ts:76-87`), no history |
| `meridian.tracker.ui.v1` | `Record<collapsibleId, boolean>` (`uiState.ts:8-9`) | `toggleSection` (`uiState.ts:29-37`) | `Collapsible.tsx:17-19` |
| `meridian.tracker.tab.v1` | `'today' \| 'playbook'` (legacy `'library'` maps to today) (`uiState.ts:46-58`) | `setTab` (`:62-69`) | `StudyTracker.tsx:85` |
| `meridian.feed.v2` | `{date, items: FeedItem[], fetchedAt?, shown?}` (`feedSources.ts:25-31,160-165`) | `loadDailyFeed` (`:203`) | same |
| `meridian.today.saved.<key>` | `{at, value}` (`today/lazyContent.ts:54-78`); keys `path.wgu`, `path.math`, `path.cs` (`TodayTab.tsx:86,90`), `reading` (`ReadingBlock.tsx:19`) | `useSaveOnChange` | offline fallback cards |
| `meridian.tracker.v1` | legacy pre-sync `{cumXP, logged, day}` (`appState.ts:403,444`) | nothing now | one-shot fold (`appState.ts:436-482`); never deleted |
| `meridian.theorist.migrated`, `meridian.mastery.migrated` | ISO timestamp markers (`appState.ts:404,409`) | `loadTheorist` (`:481,518`) | same |
| `meridian_prev_snapshot` | `{at, <store>: jsonString}` (`actions.ts:1013-1031`) | import / pull / reset | Undo |

Out of scope but adjacent: `meridian.roadmap.v1` (WGU, `src/features/wgu/roadmapStore.ts:9`).

### 2.3 Event ids written into `day.events`

| Event id | XP | Writer |
|---|---|---|
| `retrieval` | 50 | spaced return, topic branch (`StudyTracker.tsx:120`) |
| `journal:retrieval:<entryId>` | 50 | spaced return journal branch (`StudyTracker.tsx:131`), journal save with "reconstructed" (`ProofJournal.tsx:31`) |
| `paper:reproduce` | 30 | `PapersSection.tsx:58` |
| `topic:<courseCode>` | 25 | `reviewTopic` (`trackerStore.ts:412-414`) |
| `algo:studied`, `algo:flaw:<id>`, `algo:proveit:<id>` | 20 each | `AlgoOfDay.tsx:120`, `ProveItYourself.tsx:40,49` |
| `teach:lecture` 20, `teach:defense` 50, `teach:reflection` 10 | | `teachingStore.ts:174,194,209` |
| `journal:save`, `read:feed` | 10 each | `ProofJournal.tsx:28`, `ReadingNote.tsx:24` |

---

## 3. Game layer mechanics (`src/features/studytracker/trackerStore.ts`)

- **Level ladder** `LEVELS` (`:37-45`): Curious Mind 0, Proof Apprentice 1,000, Problem Solver 4,000, Theorist in Training 10,000, Independent 25,000, Contributor 50,000, Theory-Group Ready 100,000. `levelIndex` = last threshold <= cumXP (`:266-270`). Titles are Princeton-flavoured: RENAME candidates; thresholds should stay so the owner's level does not move.
- **Scorecard XP**: `dayXP = sum(score * SCORE_UNIT[id]) + sum(day.events)` (`:259-265`). `SCORE_UNIT`: deep s2..s6 = 10, routine s1,s7..s10 = 5 (`:216-219`). Max scorecard XP = 150 (pinned, `trackerStore.test.ts:334`). `scoreTotal` = raw sum /20 (`:271-273`); bands: >=18 Excellent, >=14 Solid, >=9 Drifting, else Diagnose (`StudyTracker.tsx:137-138`).
- **Meters** (`:95-101`, `meterPct` `:280-285`): Focus s2,s4,s5; Body s1,s7; Rest s1,s9; Social s8; Progress s3,s6,s10. Unrated items are excluded from the denominator.
- **EVENT_WEIGHTS** (`:228-239`): retrieval 50, paperReproduce 30, topicReview 25, algoStudied 20, journalSave 10. Retrieval is strictly highest (pinned, `trackerStore.test.ts:603`).
- **creditEvent** (`:363-369`): `events[id] = max(prev, xp)`. Idempotent per id within a day because `events` lives in `day` and is replaced by `freshDay()` at rollover (`:107-109`). Cross-device, same-date merge is also per-key max (`mergeStores.ts:224-232`).
- **Banking**: `toggleBank` (`:330-343`) banks `max(banked[day.date], dayXP)` under the day's own date, or un-banks by deleting the key. `bankToday` (`:315-321`) is the one-way variant (unused by the view). Un-bank is not authoritative across devices: per-key max merge restores it (`:326-328`).
- **Rollover / auto-bank** (`ensureToday`, `:185-204`): when `day.date != todayISO(now)`, bank the old day's XP if it beats the stored value, start `freshDay()`, set `dayType='light'` if in the Sabbath window, commit as a system write. Called by the view mount, boot (`bootstrap.ts:14`), TeachScreen (`today/TeachScreen.tsx:8`), CS path (`CSPath.tsx:21`).
- **Streak** (`streakDays`/`streakCount`, `:287-301`): count of banked ISO dates among the last 7 local days (not consecutive). Only the hub tile shows it ("Lv N · k/7", `actions.ts:1355`).
- **Weekly sessions** (`:439-469`): trailing 7 local days; a banked day counts; today counts if unbanked but has a score or a positive event, or on a Light day also any ticked block. `WEEKLY_TARGET = 4` (`:246`).
- **Mastery decay** (`:381-388`): `level * 0.5^((now - reviewedAt) / 30 d)`. `stalestTopic` picks the lowest level in (0, 0.5) (`:424-436`).
- **Full / Light day**: `day.dayType`, manual `setDayType` (`:372-375`); auto only when unset (`:201-203`).
- **Sabbath window** `inSabbathWindow` (`:172-178`): Friday 18:00 through Saturday 19:59 in the **device's local time zone** (`getDay`/`getHours`). No sundown computation, documented approximation.
- **Time-zone assumptions** (mixed):
  - Day boundary `todayISO` uses device local date (`:103-105`); `algoOfDay`, `paperOfWeek`, `psetOfWeek`, `todaysMathItem` use local epoch day (`src/core/util.ts:95-97`, `algorithms.ts:1120-1124`, `papers.ts:135-140`, `curriculum.ts:60-66`, `paths/math.ts:23-25`). Weeks start Thursday (`papers.ts:131-133`).
  - The schedule "now" highlight uses America/New_York regardless of device zone (`now.ts:37-53`).

---

## 4. Today and the path cards

- Today (`src/features/today/TodayTab.tsx:54-62`) renders Weather, Reading, Studies, Your day, Elsewhere.
- **Studies** (`:94-129`) lazy-imports three modules (`PATH_MODS`, `:28-32`) and calls each `currentSummary(now)` returning `PathSummary` (`src/features/paths/types.ts:8-18`). A throw or failed chunk falls back to `meridian.today.saved.path.<id>` (`:71-92`). A static skeleton for the Math card is also in `index.html:67`.
- **Math card** (`src/features/paths/math.ts`): `currentSummary` = `summarize(now, curriculumChecks.value)` (`:110-112`). `summarize` (`:73-107`) counts done `MATH_COURSES` from the **local** checkbox map, picks the current course, and sets `next` to today's `MATH_DAILY` item (`todaysMathItem`, `:49-61`: even local days featured course, odd days the rest). `FEATURED_CODE` = Stanford Stats (`:16`, `src/content/math.ts:14,25`).
- **Content**: `MATH_COURSES` 9 courses (`src/content/math.ts:9-131`), `MathDailyItem` type (`:139-150`), `MATH_DAILY` 21 items (`:156+`). `CS_COURSES` 5 courses and `CS_CURRENT = null` (`src/content/cs.ts:9,83`). `Course` type (`src/content/courseTypes.ts:9-24`) has a closed `school` union (Princeton/MIT/Yale/Harvard/Stanford) and `track` union (Algorithms/Theory/Math/Systems), so Cambridge courses need a type change.
- **CS card** (`src/features/paths/cs.ts:75-82`): checks from `curriculumChecks`, next = algorithm of the day, caption flips on `algo:studied` credited today (`studiedOn`, `:69-72`).
- **Tracker curriculum** unifies both lists: `CURRICULUM = orderCourses(ORDER, [...MATH_COURSES, ...CS_COURSES])` (`curriculum.ts:17-45`).
- **Math path screen** `MathPathView` (`src/features/paths/MathPath.tsx:94-199`, route `App.tsx:84`): PageHead + progress bar from `summarize`; Today's item with attempt textarea (component state only, not persisted, `:48`) and `GatedReveal` hint/answer (`:74-89`); ordered course plan with checkboxes writing `meridian.curriculum.v1` (`:159-195`). No XP is credited anywhere on this screen.
- **Two sources of truth for "done"**: path screens and cards use local `curriculumChecks`; the tracker ladder uses synced `theorist.mastery` (seeded once from checks, `appState.ts:490-519`, then diverges).
- Hub/nav labels: Today tile "Massey Standard / Princeton tracker" (`TodayTab.tsx:38`); hub stat "Princeton Roadmap / Theory study roadmap" (`actions.ts:1355`); ReadingBlock empty state "Open the Massey Standard" (`ReadingBlock.tsx:89-91`); teaching `DEFAULT_AUDIENCE` "a Princeton CS freshman..." (`teachingStore.ts:38`). All RENAME.

---

## 5. Tests that pin current behaviour

| File | Pins | Migration impact |
|---|---|---|
| `src/features/studytracker/trackerStore.test.ts` | `mergeTheorist` algebra, events/dayType/mastery merge (`:86-331`); dayXP formula and 150 max (`:333-420`); legacy and mastery folds (`:423-572`); projection level/streak/todayXP (`:575`); weights, creditEvent idempotence (`:602-651`); decay, reviewTopic, stalestTopic (`:653-751`); weekly sessions incl. Sabbath (`:753-797`); score clamp (`:799`); STORE_KEYS + cloud round-trip (`:817-848`); auto-bank (`:850-881`) | Keep green. Any new theorist field needs new merge tests here |
| `src/features/studytracker/phase1.test.ts` | unrated meters, now-clock ET helpers, tab persistence, **theorist schema guard**: top keys limited to `banked, day, dayTouchedAt, resetAt`, day keys to the six known (`:138-159`) | Must be consciously updated if a new field is added |
| `src/features/studytracker/curriculum.test.ts` | the Massey curriculum is byte-identical to a fixture (`curriculum.fixture.json`), one content file per course, `orderCourses` | Will break on REPLACE; update or retire |
| `src/features/studytracker/psetOfWeek.test.ts` | pset rotation turns over at local midnight Thursday | REPLACE target |
| `src/features/studytracker/papers.test.ts` | paperOfWeek local week, `paperByline` | KEEP |
| `src/features/studytracker/algorithms.test.ts` | algoOfDay local midnight, DST | KEEP |
| `src/features/studytracker/feedSources.test.ts` | feed cache, 7-day recency, 14-day history, offline fallback | KEEP |
| `src/features/studytracker/StudyTracker.test.tsx` | tab ARIA wiring and arrow-key navigation | KEEP |
| `src/features/teaching/teachingStore.test.ts` | blank plan seeding, `DEFAULT_AUDIENCE` equality, bands, teach XP idempotence (20/50/10), persistence, day rollover | KEEP; DEFAULT_AUDIENCE text change is fine (tests compare to the constant) |
| `src/features/paths/math.test.ts` | MATH_DAILY >=16 unique ids, Stanford Stats featured 6+ items, no em/en dashes, rotation rule, `summarize` pinned numbers and labels on fixed dates | Changes if Math path is re-pointed at Part IA |
| `src/features/paths/MathPath.test.tsx` | current course, progress, gated answer, plan order + featured badge + toggle, plan complete, skeleton | same |
| `src/features/paths/cs.test.ts`, `CSPath.test.tsx` | CS summarize (5-course plan), `studiedOn`, toggles `curriculumChecks`, AlgoOfDay mounted in tracker scope | KEEP if CS path stays |
| `src/features/today/TodayTab.test.tsx` | five blocks, tiles per screen, path card numbers/empty/error/offline, lazy load | Update if tile names or path ids change |
| `src/features/today/ReadingBlock.test.tsx`, `TeachScreen.test.tsx` | paper next pass, offline copy; teach section expanded standalone | KEEP |
| `src/features/data/dataSelectors.test.ts` | theorist `events`/`dayType`/`mastery` survive export/import (`:123`), mastery sanitising (`:150`), round-trip identity and idempotence (`:168-246`) | Add a case for any new field |
| `src/core/sync/mergeStores.test.ts`, `src/core/sync/syncEngine.test.ts`, `src/core/storage/appState.test.ts`, `src/ui/actions.test.ts` | general merge algebra, engine lifecycle, loaders, hub stats, routing | KEEP |

---

## 6. Risks and recommended approach

**R1. New fields are silently dropped by merge and import.** `mergeTheorist` rebuilds the object from five known keys (`mergeStores.ts:289-295`) and `normaliseTheorist` does the same (`dataSelectors.ts:308-314`). A new top-level field (say `cambridge`) disappears on the first cloud pull or backup restore unless both functions are extended.

**R2. Mixed-version devices.** A phone still on the old build merges with the old `mergeTheorist`, strips any new top-level field, and pushes the stripped blob. The new-build device keeps its copy only because merge is absent-safe on its side; a fresh device would see nothing. Arbitrary keys inside existing maps survive old builds: `mastery` (per-key LWW) and `day.events` (per-key max) and `banked` (per-key max). So progress that fits those maps (for example mastery keyed `cam:<course>`) is safe across versions; anything else needs every device updated first.

**R3. A new sync store is a wide change.** `StoreKey` is closed in `SyncEngine.ts:21-22` and `mergeStores.ts:15`; the cloud blob has fixed fields (`SyncEngine.ts:28-36`); `STORAGE_KEYS`, `stores`, load gate (`bootstrap.ts:17-49`); export, import, snapshot, DataTab (`actions.ts:1019-1116`, `DataTab.tsx:18-21`, `dataSelectors.ts:317-380`). The load gate blocks sync until every store has loaded (`bootstrap.ts:34-49`), so a new store must be loaded or it stalls all sync.

**R4. Merge semantics that do not propagate "downward" edits.** In theorist: lowering a score (per-key max), un-ticking a block (OR), un-banking (max), and `resetDay` all get undone by a same-date merge with another device (`mergeStores.ts:210-232`; `trackerStore.ts:326-328`). In `core`: `unionById` lets local win on an id collision with no per-item timestamp (`mergeStores.ts:31-38`), so an edit to an existing item on one device does not reach a device that already holds the item. **Do not store editable Cambridge records (supervision notes, STEP attempts) as id-keyed arrays under this merge**; use per-item LWW with an `updatedAt` stamp, like `mastery`.

**R5. Local-only Massey data is not backed up anywhere.** `meridian.curriculum.v1`, `meridian.papers.v1`, `meridian.proofjournal.v1`, `meridian.teach.v1` are not synced, not in Data export (`actions.ts:1065-1073`), and not in `meridian_prev_snapshot` (`actions.ts:1021`). The proof journal holds free text the owner wrote (reading takeaways, proof attempts). Deleting the Proof Journal UI must not delete the key, and spaced return still reads it (`StudyTracker.tsx:123-133`).

**R6. Two "done" sources.** Path screens use local checks; the tracker ladder uses synced mastery (section 4). A Cambridge course list should pick one. Old Princeton codes remain in `mastery` forever (grow-only per key).

**R7. Orphaned mastery surfaces in spaced return.** `stalestTopic` iterates every mastery key (`trackerStore.ts:424-436`) and the label is looked up only in `CURRICULUM` (`StudyTracker.tsx:113-114`). After REPLACE, decayed Princeton codes like `MIT 18.06` still surface, shown as a raw id. Filter by the active course set or keep a label table for retired codes.

**R8. XP totals must not move.** `banked` is frozen history (`trackerStore.test.ts:374`). Do not recompute or rescale; keep `LEVELS` thresholds and `SCORE_UNIT` so the owner's level and today's XP are unchanged.

**R9. `resetAll` wipes mastery everywhere** via `resetAt` (`trackerStore.ts:351-353`, `mergeStores.ts:188-192`); any Cambridge progress stored in theorist would be wiped by the existing "Reset everything" button too. Make that explicit in the copy.

**R10. Migration markers.** The mastery fold runs once, guarded by `meridian.mastery.migrated` (`appState.ts:490-519`). A new Cambridge fold needs its own marker with the same order (write durably, then set the marker).

### Recommended safe approach

1. **Backup first (C3 in DECISIONS.md:202).** On first launch of the new build, before any write, save one dated JSON of every Massey key to a new local key (for example `meridian.cambridge.backup.<ISO date>`) and offer it as a download in Data: `meridian-theorist` (plus `__v`), `meridian.curriculum.v1`, `meridian.papers.v1`, `meridian.proofjournal.v1`, `meridian.teach.v1`, `meridian.tracker.ui.v1`, `meridian.tracker.tab.v1`, `meridian.tracker.v1`, both migration markers. Write it once, guarded by a marker.
2. **Additive only.** Never delete or rewrite the old keys or the Princeton content arrays' ids. Leave `meridian.curriculum.v1` and existing `mastery` entries in place so a rollback to the previous build still works.
3. **Store Cambridge state without new top-level theorist fields where possible.** Course/topic progress: `mastery` with namespaced keys (`cam:...`), which old builds already merge correctly. Daily credit: new `day.events` ids through `creditEvent`. Longer-lived editable records (STEP attempts, supervision log): a new local key first (same tier as `meridian.proofjournal.v1`), and include it in the backup/export. If they must sync, add a dedicated merge with per-item `updatedAt` LWW, plus `normaliseTheorist`, schema-guard, and round-trip tests, and ship only once every device runs the new build.
4. **Keep the game layer untouched**: `LEVELS` thresholds, `SCORE_UNIT`, `EVENT_WEIGHTS`, `creditEvent`, `ensureToday`, banking, Sabbath logic. Rename text only.
5. **Blocks**: keep ids `b1..b15`, change `title`/`sub` text; if a block should point at Cambridge work, link by content (as today), not by id.
6. **Tests**: keep section 5 green; consciously update `curriculum.test.ts` (fixture), `psetOfWeek.test.ts`, `math.test.ts`, `MathPath.test.tsx`, `TodayTab.test.tsx` labels, and extend the `phase1.test.ts` schema guard only if a new field is truly added.
