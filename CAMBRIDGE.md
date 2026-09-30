# The Cambridge Method

The study path inside Meridian's tracker, rebuilt on 2026-09-30 on branch `cambridge`, cut from `main` @ `593e3e4`. The Massey Standard's STEP-less curriculum is replaced by a Cambridge study path:
- a STEP track, then Cambridge Part IA mathematics,
- a Computer Science Tripos track with its foundations,
- a supervision loop,
- an error log and a glossary.

The game layer stays: XP, level, streak, the five meters, and the daily scorecard.

Nothing is committed: every change is staged, and the commits to run, in order, are in `COMMITS.md`. The preview is the dev server on the branch, http://192.168.1.163:5173/meridian/, reachable on the same Wi-Fi only (DECISIONS C2).

## What changed

### For you, day to day
- **Today:**
  - **The Math card** shows your current Cambridge item and where you are in the loop, e.g. "Assignment 7: attempt cold", "Supervision due", "Redo due by Thu 6 PM". Below it: "Supervisions this week: n of 2".
  - **The CS card** follows the CST track.
  - **The WGU card** follows your 4 enrolled courses: C955 and D326 now, D315 and D279 from Oct 12 (DECISIONS C20). The Learn by Teaching tile is gone; teaching lives in the tracker (C21).
- **The Cambridge path** (tap the Math card): the phase map 0 → A → A+ → B → C → D → Part IA, with locked phases greyed out and their gate text.
  - The current block and every item carry their status: not started, attempting, written up, supervised, or redo done.
  - "Pass gate" asks for your evidence (scores, time), unlocks the next phase, and pays +200 XP.
- **A study item** (an assignment, module, station or example sheet):
  - The loop stepper: Read, Attempt cold, Write up, Supervision, Redo.
  - Links, with the hints hidden until 60 minutes of cold attempt. "Unlock early" asks you to confirm.
  - A cold-attempt timer per question, which survives reloads and offline.
  - Per question: solved, partial or stuck, and where you stalled.
  - A write-up in Markdown with LaTeX (KaTeX, loaded when you first press Preview), plus photos of paper work.
  - "Start supervision" copies the filled supervisor prompt; paste it into Claude. Afterwards you log marks /20, three weak points, and two redo questions.
  - The redo is scheduled 48 hours later and shows on Today.
- **The error log:** every question marked under 14/20 or "stuck" becomes an entry. You pick a cause (concept, algebra slip, didn't see the idea, ran out of time) and write the fix.
  - Filter by cause and topic, with a weekly trend.
  - Your old proof journal is here too, read-only.
- **The glossary:** searchable. Cambridge and UK terms in the app text are underlined; tap one for its plain meaning and US equivalent.
- **The tracker** is now "The Cambridge Method", with a credit line for the Massey Standard's scoring.
  - The weekly Cambridge scorecard sits beside the daily one: cold attempts, write-ups before supervision, both supervisions, misses redone in 48 hours, and phase pace, each Missed 0 / Partial 1 / Met 2.
  - Deep Blocks 1 and 3 now point at your current Cambridge item.
- **Scheduling:** two supervisions a week (suggested Mon + Wed). Nothing is scheduled from Friday sundown to Saturday sundown. Sunset is computed on the device for Brooklyn, with no network.
- **New XP:**

  | Event | XP |
  |---|---|
  | Cold attempt of 60+ min | +20 |
  | Full write-up | +15 |
  | Supervision held | +25 |
  | Redo within 48 h | +15 |
  | STEP question self-marked 14/20 or more | +10 |
  | Phase gate passed | +200 |

  Each pays once per item, never again on a later day.

### Your data
- **Backup before anything changes.** The first launch of this version writes a dated backup of every Massey Standard key: XP, level, streak history, scorecards, journal entries, block ticks, and everything else the tracker stored. It goes to the device's IndexedDB, plus a localStorage copy. "Download Massey backup" in Data saves it as a JSON file.
- **Nothing old is deleted or rewritten.** The previous build still runs on the same data (tested on a one-year profile: all 12 keys byte-identical, and XP, level, streak and meters identical).
- **Cambridge progress syncs through the cloud copy, in a new store.** Unlike the old lists, an edit made on one device reaches the other: every record carries a timestamp, and the newer copy wins.
- **Photos stay on the device** (DECISIONS C5). The cloud copy is a single public file, so photos there would be large and readable by anyone with the URL.

## Screenshots
- `design/cambridge/before/`: the app before the change (empty and seeded, every screen).
- `design/cambridge/final/`: the same screens after.
- `design/cambridge/after/`: close-ups of the path, a study item, the math preview, gates, the CST track, and the tracker.

All at 390 px wide; the JPEGs are downscaled.

## How to edit the curriculum (data-file guide)
Everything is JSON (or Markdown) under `data/cambridge/`. The screens read these files, so an edit changes the app with no code change. Every file is safe to hand-edit except `link-report.json`, which the link checker writes.

| File | What it holds | Typical edit |
|---|---|---|
| `step.json` | Exam facts, the phases and gates, the 6 Foundation blocks, and every item: assignments with their four parts (warm-up, preparation, STEP question, warm-down), the Extras, 75 Siklos problems, and the STEP 2 and STEP 3 modules, with links and videos | Change a gate's text or pace, reorder topics, add a note to an item |
| `courses.json` | Part IA terms, courses, the suggested order and example sheets; Part IB; past papers 2001 to 2026 | Change the order, mark a course optional, add questions to a sheet |
| `cs.json` | The CST track: CS-0 foundations (proof, maths, OCaml, the pre-arrival checklist), CS-IA courses in suggested order, and CS-IB. Also the Tripos course lists and materials | Reorder courses, change a gate, add supervision work |
| `underground.json` | The 25 Underground Mathematics stations and which block each goes before (labeled "suggested") | Move a station to another block |
| `method.json` | The study loop, the cadence, question statuses and error causes | Rename a loop step, change a cause label |
| `glossary.json` | Terms, their plain meaning, the US equivalent, and which words are underlined | Add a term; set `match` to the words to underline |
| `resources.json` | The reference links and the freshers' pre-reading | Add a resource |
| `supervisor-prompt.md` | The text "Start supervision" copies. `{item title}`, `{marking style}` and `{follow-up source}` are filled in for you | Change how the supervisor behaves |
| `schema/*.schema.json` | The rules the files must follow | Only if you add a new kind of field |

Two scripts support the data:
- **`node scripts/cambridge/scrape.mjs`** refreshes links from the live sites. It keeps your edits: your text stays, and only the scraped links and flags update. An item that disappears upstream is flagged, never deleted. `--offline` just normalizes the files.
- **`node scripts/cambridge/verify-links.mjs`** checks every link. `--update` marks broken ones in the files.

`npm test` validates every file against its schema, so a typo such as an empty gate, a missing block, or exam facts that don't add up fails loudly instead of breaking a screen.

**Retired content** (the old Princeton/MIT curriculum, the old Math daily problems and proofs, and the Princeton Theory group) is kept in `data/archive/`. A test proves it matches what was removed.

## Decisions
All of them, with reasons, are in `DECISIONS.md` under "Cambridge Method" (C1 to C17 and after). The ones you'll notice:
- **C2:** the preview is the LAN dev server, because a Pages preview would touch production.
- **C3, C8:** the backup is taken on the device; old builds drop the new store on push, so the new build re-uploads it.
- **C5:** photos aren't synced.
- **C9:** the JSON is the source of truth.
- **C10:** a pirated-textbook link found on a Cambridge page was removed.
- **C11:** the CST track was added at your request.
- **C12:** the assignment parts follow the site (warm-up, preparation, STEP question, warm-down).
- **C15:** what was retired and archived.

## Performance
Measured on the same Mac. Every before/after comparison was interleaved (A/B, n=5) against `main`, because this machine's background load moves absolute numbers by several points. Raw data: `perf/cambridge-baseline.md` (before) and `perf/cambridge-after.md` (after, with every run).

| Metric | `main` (before) | Cambridge (after) |
|---|---|---|
| Lighthouse mobile Performance (final A/B, 2 runs) | 91 to 95 | 92 to 97 |
| Lighthouse mobile Accessibility | 100 | 100 |
| Lighthouse LCP (final A/B, run 2) | 3,097 to 3,350 ms | 2,416 to 3,281 ms |
| CLS | 0 | 0 |
| Main JS / CSS (gzip) | 73.3 / 15.2 KB | 76.6 / 17.4 KB |
| Tracker opens | 275 ms | 270 ms |
| Cambridge (Math) path opens | 77 ms | 77 ms |
| CS path opens | 127 ms | 137 ms (the new 83-item CST track) |

Verdict: no Lighthouse regression. The ranges overlap in both final A/B runs, and Cambridge's LCP median is lower. Getting there took two fixes:
- **Per-track chunks:** the path screens each load only their own track, instead of the whole 40 KB catalog.
- **Nothing extra before the first paint:** Today starts the path-card downloads only after its first content paints, and the first-run backup no longer holds up the first render (it still completes before any write to a Massey key).

KaTeX (79 KB) and the photo tooling load only when used, never on Today.

## Known issues
1. **Sync bugs from before this work** (unchanged by it): a tick or edit to an item in the older stores (todos, workout and so on) still doesn't reach the other device, and simultaneous pushes can lose one side's edits. The new Cambridge store doesn't have this problem, because it merges per record.
2. **Photo sync** needs a private storage bucket with per-file uploads. That's a Supabase configuration choice for you (C5).
3. **20 links are unverified**, listed in `BUGS.md` under "Cambridge links". 12 need a Cambridge (Raven) or Google login; the rest are broken on the source sites. The 2026-27 CST materials pages are still empty, so CST items use the 2025-26 materials until lecturers post the new ones; re-run the scraper then.
4. **Some Part IA sheets are from 2025-26 or earlier:** DPMMS hides this year's sheets in the page source, and DAMTP files Optimisation and Variational Principles under Part IB. Each course notes which year it uses.
5. **Siklos:** the publisher's page blocks automated checks. The PDF link itself verified.
6. **App-wide, from before:** the service worker takes over only after every tab closes, so a new version needs a second cold launch. A foreground pull right after launch waits until the first background flush.
7. **The CS path** opens about 10 ms slower than on `main`, because it draws the new CST track (83 items) that `main` doesn't have.
