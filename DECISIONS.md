# Redesign decisions

Every decision made during the autonomous redesign run, with the reason. Newest at the bottom of each stage.

## Setup (2026-09-29)

**D1. Mobile updates use a GitHub Pages preview, not a tunnel.**
The owner asked for "a mechanism we have used in the past" instead of the Cloudflare tunnel. That mechanism is a seeded build published at `/meridian/preview/<name>/` (used for the Rail and Knowledge flow previews in August). The redesign preview lives at `https://clz4096.github.io/meridian/preview/redesign/`. Publishing it means committing only `public/preview/redesign/**` (plus the two service-worker exclusions in D3) to `main` and pushing. The app code on `main` does not change. A push notification goes out after each stage.

**D2. The preview runs on demo data only.**
Owner's choice. The preview shares an origin with the live app, so it would otherwise read the real `localStorage`, IndexedDB and Supabase credentials. A demo build (`VITE_DEMO=1`) therefore:
- prefixes every `localStorage` key and uses its own IndexedDB database, so it can never read or write real data,
- turns cloud sync off (no Supabase calls),
- seeds a year of synthetic data on first open (same generator as the perf harness).
No passcode, per the owner.

**D3. The live app's service worker must not swallow the preview.**
Workbox's navigation fallback serves the app's `index.html` for every navigation under `/meridian/`, which would show the live app at the preview URL on a phone that has Meridian installed. The preview commit adds `navigateFallbackDenylist: [/\/preview\//]` and `globIgnores: ['preview/**']` to the Workbox config, so the live app neither intercepts nor precaches preview files.

**D4. Node reinstalled.**
Node and npm had disappeared from this Mac (it worked on 09-24). Installed the official Node 22.23.3 x64 build into `~/.local/node` after verifying its SHA-256 against nodejs.org's `SHASUMS256.txt`. No sudo, no package manager changes.

**D5. Measurements are taken on this machine (Intel i7-8750H).**
The 09-24 baseline in the old checkpoint was on another machine, so it is not comparable. Stage 1 re-measures from scratch; every later number compares against that.

**D6. Publishing the preview is on hold until the owner approves the push.**
Auto mode blocked `git push origin main` as a production deploy (it triggers the Pages workflow). I did not work around it. Updates now go out as a push notification plus a self-contained progress page sent as a file to the chat (`design/progress.html`, screenshots inlined). The publish is ready:
- the `main` worktree at `../meridian-pages` holds one local, unpushed commit, `cb0e018` (service-worker `/preview/` exclusions, D3),
- `node scripts/preview.mjs --publish` adds the preview files and pushes.
To drop the local commit instead, run `git -C ../meridian-pages reset --hard origin/main`.

## Stage 1

**D7. The baseline was re-shot after review.**
The Stage 1 reviewer found four measurement bugs in `perf/routes.mjs`:
- Byte counts missed requests the service worker served.
- Route CLS was always 0, because a tap marks shifts as recent input.
- The INP proxy was read before Event Timing entries arrived.
- Sections were captured mid-scroll.
All four are fixed. The service worker is now bypassed, route CLS counts every shift in the transition window, the script waits 800 ms before reading events, and it scrolls to the top before each capture. Open time now starts at the tap's own event timestamp, and device scale matches `run.mjs` (3x). The baseline is re-measured from a clean worktree of `e7ff8d2` (`../meridian-base`), so Stage 2's uncommitted changes can't leak into it.

**D8. Design exploration overlaps Stage 2, and measurements stay isolated.**
To save wall-clock time while the owner is away, the Stage 3 design agent started while Stage 2 was still measuring. It only creates new files (tokens, fonts, the contrast script, the style guide page) and is barred from launching Chrome, so it can't change Stage 2's numbers. Its output is wired into the app only after Stage 2 is measured and reviewed, so the stage order the brief asked for still holds for everything that ships.

## Stage 2

**D14. The five changes follow the audit ranking, with two declines.**
`perf/stage2.md` has the details. Declined:
- Moving `ts-fsrs` out of the main chunk: Today's mastery % needs it.
- Moving `dataSelectors` out: the Data tile's size figure needs it.
- Removing `maximum-scale=1`: inputs are under 16 px and iOS would zoom on focus. Revisit once the design system sets inputs to 16 px or more.

**D15. Lighthouse LCP got worse on paper, and the fix is deferred.**
LCP went from 1.7 s to 2.9 s because Lighthouse now scores Today (rendered by JS) instead of the static landing. Performance is still 95, above the 90 target. A prerendered static shell for Today (date, weather skeleton, section frames in `index.html`) would bring LCP back. It is scheduled with the Today rebuild in Stage 4, where the shell's markup is being designed anyway.

**D16. A failed lazy chunk now recovers by reloading into that screen.**
Found by the Stage 2 reviewer. Chrome caches a failed module import for the life of the page, so retrying `import()` could never succeed. That meant one failed idle prefetch broke that screen for the whole session. "Try again" now stores the tab in `sessionStorage`, reloads, and reopens it. Verified by blocking the Knowledge chunk during prefetch, then unblocking: the tap shows the error, and Try again lands on a working Knowledge screen. The intro also got a focus trap (Tab stays on Enter under `aria-modal`), and replaying it during its 550 ms fade-out now works instead of being ignored.

## Stage 3

**D9. Fonts: Source Sans 3 and Source Code Pro.**
Both are variable (weights 200 to 900), latin subset, OFL, from @fontsource-variable 5.3.0. They come to 2 files, 50.8 KB total. The runners-up were IBM Plex (86 KB) and Fira (89 KB).
- Source Sans digits line up in columns by default, and the mono was drawn as its companion.
- Its x-height is small, so body text is 17px.
- None of the subsets include real small-caps glyphs, so labels use browser-synthesized small caps.
Details: `design/palette-decision.md`, `src/assets/fonts/README.md`.

**D10. Palette A, "Cream and Coral", is the default.**
Variant B, "Ember", stays on `/styleguide`. A wins 6 of the 8 stated criteria, ties 1, and loses only on warmth. The criteria that decided it:
- Weakest text pair: 4.89:1 (A) vs 4.54:1 (B).
- Background calm: Lab chroma 3.4 vs 7.0.
- Chart series under simulated deuteranopia: minimum color distance 18.0 vs 6.4.
- Glare simulation: A holds up better.
All 41 pairs per variant pass WCAG AA (`design/contrast.md`; `scripts/contrast.mjs`, enforced by a vitest test).

**D11. `#/styleguide` is a full page load until Stage 5.**
`tokens.css` reuses names the old dark `:root` also defines (`--bg`, `--surface-2`, `--ok`), so loading both in one page lets whichever loads last win. Until Stage 5 retires the old tokens, `main.tsx` renders the style guide on its own when the page opens at `#/styleguide`, and reloads when you leave it. The reason changed in Stage 5; see D26.

## Stage 4 (planning)

**D12. New screens use only the new tokens; the old dark tokens are retired in Stage 5.**
From Stage 4 on, `tokens.css` and `primitives.css` load globally, after `app.css`. The new Today and path screens use only the new tokens. Until Stage 5 remaps the old tokens (`design/token-map.md`), the untouched tabs look mixed, with a cream background under dark cards. That is acceptable on the branch because nothing is published or merged between the two stages, and it keeps the new screens from depending on tokens that are about to disappear. D11's full-page style guide becomes unnecessary once Stage 5 lands.

**D13. Path content loads lazily from Today.**
The algorithm catalog, papers, and curriculum live in the tracker chunk (about 58 KB gzip). Today's reading and path cards import them lazily behind a skeleton, and they are prefetched at idle. This keeps the main chunk within 8 KB of the Stage 2 size (a contract gate).

**D17. The Stage 3 review overlaps the start of Stage 4.**
The Stage 3 reviewer checks tokens, fonts and the style guide while the four Stage 4 agents build (Today + weather, WGU, Math, CS). They own disjoint files per `docs/redesign-contract.md`, so they can run at once. If the review changes a token's value, the Stage 4 screens pick it up automatically, because they use token names and never raw colors. A renamed token would need a follow-up pass, and none is planned.

**D20. Stage 3 review fixes.**
- The html root font size is back to 100%: the old `app.css` 15px root put body text at 15.9px and meta text at 13px. This also enlarges the old tabs' rem-based text by 1/15; Stage 5 restyles them.
- Progress fills now draw (`display: block`; they were inline spans).
- `--rule-strong` is darker (A #948272, B #98786A), so hover and state borders pass 3:1 on `--surface-2` too, and that pair is now in the gate.
- Rows are inset.
- The unused `--focus-ring` token is gone.
- Pairs that fail AA but aren't used are listed as forbidden in `design/token-map.md`.
Deferred to Stage 5: inputs to 16px or more, then remove `maximum-scale=1` (which also blocks pinch zoom, WCAG 1.4.4). Design critique items (chip pressed state, swatch grid orphans, spacing rhythm) go to the Stage 5 visual QA list.

## Stage 4

**D18. Math daily items gain a `title` field (contract extension).**
The frozen item shape couldn't produce labels like "Proof: √2 is irrational". Items rotate at local midnight, alternating Stanford Stats (even days) with the other Math courses (odd days), so the course the owner is taking now appears every other day. There are 20 items: 8 statistics, 3 probability, 9 proofs. The Stage 4 reviewer checks every answer.

**D19. CS and WGU paths follow the contract's `summarize(now, state)` shape.**
- The CS `state` also carries the algorithm and whether it was studied today.
- `CS_CURRENT` in `src/content/cs.ts` can pin the current course; left null, the current course is the first one not done.
- The WGU weeks gain machine-readable `start` and `end` dates plus `TERM_END`, so the logic never parses display strings like "Sep 17 to 23".
- The algorithm card on the CS screen reuses the Massey `AlgoOfDay` component, and keeps the tracker's dark palette until Stage 5.

**D21. The Stage 4 review fix round runs alongside Stage 5.**
Two independent reviewers found:
- no wrong math across the 21 items,
- three P1s: the CS algorithm rolled over at 8 pm (UTC day), path screens opened mid-scroll, and the Lighthouse harness couldn't finish with the new Today,
- several P2 and P3 items.

One fix agent handles all of them in the Today, paths, weather, logic and harness files. At the same time, three Stage 5 restyle agents work in disjoint files, split by stylesheet: `app.css`; `studytracker.css`; and `wgu.css` with the WGU markup. Findings that land in a Stage 5 file go to that stage's agents: the dark palette on the CS algorithm card and WGU body, WGU targets under 44 px, the 15 px body text in `app.css`, and `maximum-scale`.

Measured at this point:
- Lighthouse mobile: Performance 92, Accessibility 94 (the only failing audit is `meta-viewport`, which Stage 5 removes).
- Main JS gzip: 72.7 KB (+2.8 KB over Stage 2).
- Weather states and offline routes pass. No NaN or undefined text on any screen.

## Stage 5

**D22. Princeton orange is retired as a color. The shield keeps the identity.**
#E77500 measures 2.6 to 3.0:1 on every light surface, which fails even the 3:1 floor for non-text, so no AA-passing use exists. The coral tokens take the accent role, and the Princeton shield image stays as the tracker's identity mark. Code blocks stay plain text: there is no highlighter, and ink on `--surface-2` is 13.4:1. Code keeps 14px mono, a deliberate exception to the 16px floor, because code isn't running prose and wider lines matter more there.

**D23. The WGU assessment chips show dark text with a colored dot.**
The data-series colors pass 3:1 as graphics but not 4.5:1 as text. The static title now reads "13 courses in a 37-day plan", so it no longer contradicts the live "25 days to Oct 24".

**D24. Stage 4 review fixes.**
- All three days roll over at local midnight: `algoOfDay` and `paperOfWeek` use `localEpochDay`, shared with Math.
- Screens open at the top, and Back restores Today's scroll position.
- `perf/run.mjs` uses the new selectors.
- Seeded home render: about 100 ms → about 50 ms (4x throttle). The cause was the first `toLocaleString` call loading ICU data (72 ms). The Food tile now formats with `groupThousands`, which a property test checks against `toLocaleString`.
- "Saved ✓" only shows after a user edit.
- Weather says "Offline" only when the device is. A forecast from an earlier day is labeled with its date.
- Main JS: 73.2 KB gzip (+3.2 KB over Stage 2).

**D25. Old token names survive only as aliases.**
The `app.css` restyle mapped every old token to the new system. The old names stay as aliases, because `landing.css`, `studytracker.css`, `wgu.css` and `ui/host.ts` still read some of them. Delete each alias once nothing reads it. No raw colors remain in `app.css`. Stage 5 also:
- removed `maximum-scale=1` (all inputs are now 16 px or more),
- made span click targets into real buttons,
- put every control at 44 px or more.

**D26. `#/styleguide` keeps its separate render and its reload on leave.**
Since D25 the old dark tokens are aliases of the new ones, so the style guide and the app no longer fight over `--bg` and friends, and D11's original reason is gone. The reload stays for a different reason: the style guide skips `boot()`, sync, telemetry and the external-link handler, so rendering `<App/>` in place would need a second, lazy boot path that a normal launch never exercises. A reload runs the one tested startup path, and the style guide is a design tool, not a user route, so the extra load costs nothing that matters.

**D27. Stage 5 review: behavior is unchanged, and the fix round is about consistency and performance margin.**
The reviewer compared the same seeded flows on the baseline and current builds. Stored state matched, and Data export was identical across 20,163 JSON nodes, with timestamps and ids masked. No failing text contrast on any screen. Lighthouse mobile: Accessibility 100, Performance 89 to 92.

The fix round:
- **Export shows an empty box.** A pre-existing bug: the textarea remounts after export, so Copy copied nothing.
- **Remaining opacity fade.** One Knowledge row still dimmed with opacity, failing contrast.
- **Small targets and text.** The remaining targets under 44 px and 14 px sentences.
- **One design language.** The Today section headers and one gutter everywhere. Warn and danger colors only for real warnings. No emoji or chart-colored decoration.
- **Performance margin.** Lighthouse LCP is the lazily loaded reading title. Candidates: render it in the first paint, preload fonts, split critical CSS. Each is kept only if measured.

**D28. Every screen opens with the Today section header.**
`ui/components/PageHead.tsx` renders a screen title in Today's section language: the heading, a hairline, and a small-caps note with the key figures as plain tabular data ("40 open · 2 due today"). It replaces the boxed hero numbers on Todos, Scratchpad, Data and Knowledge progress, and the page-size H1s on Knowledge, CS, Math and WGU. Food & Body and Workout gained the same head, so every screen opens with its title. The Massey Standard keeps its own eyebrow-over-title section heads inside the tracker. `.m-title` and `.m-pagehead` live in `primitives.css`. The path screens also dropped their own side padding, since `.appwrap` already supplies the gutter, so every screen uses the one `--gutter`. `SecHero.tsx` is now unused; it is left in place for the owner to delete.

**D29. Warn and danger mean a real warning.**
Normal states take ink or the accent. The mastery words are ink, and their dots use `--series-1` (shaky) and `--series-3` (learning) instead of `--danger` and `--warn`. The Food ring and protein bar are the accent until the target is met, then `--ok`. The calorie number turns `--warn` only when over. A todo due today is accent text; only overdue is `--danger`. Kept as warnings: overdue todos, weight trending down on a gaining plan, a Weak week, failed saves, and the Again grade.

**D30. The Knowledge session sits under the app's brand row.**
The session covered the whole screen with its own Back buttons. It now starts below the brand row (`--brandrow-h`), so Back and Home match every other screen. Behavior is unchanged: both of the session's Back buttons and the brand row's Back call `window.history.back()`, so the session's own were removed.

**D31. Stage 5 performance: one fade was holding back LCP.**
`perf/stage5-perf.md` has each run. The reading and path cards faded in from opacity 0, which kept Chrome from counting the reading title as painted until well after the forecast call and the idle prefetch had started; Lighthouse charged both to LCP. Without the fade, and with the two fonts preloaded, Performance is 96 and LCP 2.76 s (was 91 and 3.47 s in the same session). A static `papers.ts`, a prefetch gate and an open-meteo preconnect were measured and reverted; the CSS split was not attempted (cascade order, see the perf note).

## Stage 6

**D32. The two sync failures are reported, not fixed.**
The Stage 6 verifier tested two-device sync against a local mock (never the real cloud). Two checks fail, identically on the baseline build:
- An edit to an existing item never reaches the other device. `unionById` keeps the local copy on an id collision.
- Two devices pushing at the same moment lose one device's edits. The upsert has no compare-and-swap on `rev`.

The sync code is byte-identical to `e7ff8d2`, so neither is a redesign regression. This is the sync redesign already open as an owner decision (checkpoint item 1: the engine owns the stores, or a three-way merge). Changing merge semantics is outside a visual and IA redesign, and needs the owner's call.

**D33. Stage 6 regressions against Stage 2 go to a fix round before sign-off.**
The brief requires no regression against Stage 2. The fix round covers:
- Todos opens slower (129 → about 220 ms seeded).
- The seeded JS heap after the tab tour is larger (13.3 → 19.0 MB, still under the 50 MB limit).
- A font-swap shift of 0.017 appears in the prerendered shell on slow networks.
- The test suite exits 1 on a stray autosave timer (the baseline also did).
All targets were already met: Lighthouse mobile Performance 96 and Accessibility 100; offline, empty-data and iPhone-width tests pass.

**D34. The preview is published.**
Approved by the owner in chat on 2026-09-29. `main` now has `cb0e018` (the service-worker `/preview/` exclusions, D3) and `e17faa2` (the preview files under `public/preview/redesign/`). Its app code is unchanged. Checked in headless Chrome after the deploy: it renders Today with live Brooklyn weather, logs no page errors, and contacts only github.io and Open-Meteo.


---

# Cambridge Method (run started 2026-09-30)

**C1. Branch from `main`.** The brief says to branch from `redesign` if it exists. It was merged into `main` and deleted on 09-29, so `main` @ `593e3e4` already contains it.

**C2. The preview is the LAN dev server, not Pages.**
The repo's preview method publishes a demo build under `/preview/` on GitHub Pages. That requires a push to `main`, which runs the production deploy workflow, and the brief excludes touching production. So the preview is the dev server on the branch, bound to 0.0.0.0: http://192.168.1.163:5173/meridian/. It is reachable only from the same network. `ipconfig getifaddr en0` returns nothing on this Mac; the LAN address is on `en9`.

**C3. The data backup runs on the device that holds the data.**
The owner's Massey data lives in the browsers where the app runs (and their Supabase copy), not on this Mac. The dev origin here has its own, separate storage. So the backup the brief asks for is built into the migration itself: the first launch of the new version writes a dated JSON backup of every Massey key before it changes anything, keeps it on the device, and offers it as a download in Data. The migration is also additive (old keys are read, never deleted or rewritten), so a rollback to the previous build still finds the old data intact. I did not read the owner's production browser storage or their Supabase data directly: that would mean handling their credentials.

**C4. Cambridge progress lives in a new, sixth synced store with per-record last-writer-wins merge.**
The Massey map found two traps:
- The tracker's synced store (`meridian-theorist`) rebuilds itself from known fields, so a device still on the old build would strip any new top-level field and push the stripped copy.
- The `core` lists merge with `unionById`, which keeps the local copy on an id collision, so an edit never reaches the other device.

So Cambridge records go in a new `cambridge` store. Every record carries `updatedAt`, and the newer copy wins per record, so edits do propagate. Deletions are tombstones, and timers take the max. The game layer stays in `meridian-theorist`, unchanged. Contract: `docs/cambridge-contract.md`.

**C5. Photos of paper work stay on the device and are not synced.**
The brief asks for photos "synced like other data", but sync is a single `state.json` in a public Supabase Storage bucket, read without auth. Embedding photos there would make every sync push megabytes, and would make the owner's handwritten work publicly readable by URL. So photos are stored compressed in IndexedDB, local-first, and the write-up text syncs. Syncing photos properly needs a private bucket with per-object uploads: a Supabase configuration change the owner should decide on. It is listed as a known issue.

**C6. The proof journal is kept read-only, not converted.**
The brief folds the journal into the supervision write-up and error log. The old entries are free text with no question or cause attached, so converting them would invent structure. They stay readable as an "Archived journal" on the error log screen. Nothing is deleted.

**C7. The Sabbath window for Cambridge scheduling is computed from real sunsets.**
The brief asks for Friday sundown to Saturday sundown in Brooklyn, computed locally, with no network. The existing tracker window is a fixed Friday 18:00 to Saturday 20:00. That window stays as it is, because the brief says the streak rules stay; the new Cambridge scheduler uses NOAA sunset times, computed offline.

**C8. Stage 3: old builds drop the new store on push, so the new build re-uploads it.**
The Stage 3 agent confirmed that a device on the old build writes the cloud file from its five stores only, which drops `cambridge`. The new build treats a missing cloud `cambridge` as "no remote change": it keeps local data and re-uploads it on the next save (4 tests).
- The first run of the new build takes the Massey backup before the tracker's day rollover writes anything.
- Main JS grew +1.8 KB of the 4 KB budget.
- The sunset tests were pinned to reference values fetched from api.sunrise-sunset.org for Brooklyn: 20:31:58, 16:33:15 and 19:09:06. The agent's first values were recalled from memory, and its comment wrongly said they came from almanac tables; I fixed both.

**C9. JSON is the source of truth for the curriculum.**
The Stage 2 review found that the scraper rebuilt `step.json`, `courses.json` and `cs.json` from scratch, so the owner's hand edits would vanish on the next scrape, and curriculum text lived in a JavaScript file. That contradicts "edit the curriculum without code changes". Now:
- The scraper merges: owner text is kept from the existing JSON, and only scraped links and flags refresh.
- Items that disappear upstream are flagged, never deleted.
- `verify-links --update` marks links that break.

**C10. A copied piracy link was removed, and the scraper now screens hosts.**
A Cambridge CL materials page links, through a google.com redirect, to a pirated copy of a copyrighted textbook. The scraper had copied it and marked it verified. It is removed, and the scraper now skips redirect wrappers and known piracy hosts, logging what it skips.

**C11. The owner asked for a CST track and its foundations mid-run (2026-09-30).**
`cs.json` grows from a course list into a track with the same shape as `step.json`:
- a foundations phase, built from what Cambridge itself says CS applicants and freshers should prepare (researched and verified),
- CST Part IA courses (supervision exercises from the course materials, past papers by topic),
- then Part IB.
It uses the same study loop, supervision prompt (worded for the Computer Science Tripos), XP and error log. The algorithm of the day and the paper of the week stay on the CS path.

**C12. Foundation assignments use the site's own four parts.**
All 25 assignment PDFs are structured as warm-up, preparation, the STEP question, and warm-down. The question ids follow the site (`warm-up`, `preparation`, `main`, `warm-down`) rather than the brief's "final question", so per-question marking matches what's on the page. Assignment 20 also carries a second STEP question. Module question counts use the site's stated count, or the PDF's where the site states none.

**C13. Stage 2 is closed.**
- The owner's curriculum text now lives in the JSON (`owner.mjs` is deleted). The scraper merges, `--offline` normalizes without network, and `verify-links --update` marks broken links in place.
- 868 URLs checked: 847 OK, 21 flagged unverified in `BUGS.md`.
- Every `data/cambridge/*.json` is safe to hand-edit except `link-report.json`, which the link check writes.

**C14. Stage 4 screens.**
- **Catalog:** one catalog adapter turns `step.json`, `courses.json` and the `cs.json` track into the same phases and items, so a single path screen and study-item screen serve all three tracks.
- **Size:** main JS is 75.95 KB gzip, under the 77.3 KB gate. KaTeX (79 KB) loads only when Preview is first pressed, and its fonts are cached the first time for offline use.
- **Back:** Back from a study item returns to the screen it was opened from.
- **CS-0 gates:** its four blocks each carry their own gate, and CS-IA unlocks when all four pass.
- **Supervisor prompt numbering:** the CST prompt names the supervision work by its own number (`sw2` gives 2), and drops that clause when a course has no public supervision work.
- **Uncategorized errors:** an error created automatically from a low mark or "stuck" now keeps an empty cause ("Needs a cause") through reloads. Before, the loader turned it into "concept", inventing a cause the owner never chose. Entries without a cause are left out of the trend chart until the owner picks one.

**C15. Stage 5: retire, archive, rename.**
- **Retired UI:** the three climbs, the curriculum track and problem set of the week, the proof journal panel, the Princeton Theory group, the COS/MAT course list, and the old Math path with its daily items.
- **Archived:** their content is in `data/archive/` (`princeton-curriculum.json`, `math-daily.json`, `princeton-theory.json`). `archive.test.ts` checks each against the pre-removal fixture, so no verified content is lost. No storage key was touched.
- **Blocks:** b4 and b7 name the current Cambridge item and loop step. Their ids are unchanged, so stored ticks stay valid.
- **Weekly scorecard:** it sits beside the daily one and feeds Focus and Progress. With no Cambridge data, the meters are unchanged (pinned by a test).
- **Rename:** the surface is "The Cambridge Method" everywhere, with the credit line "Scoring system adapted from the Massey Standard".
- **Kept on purpose:** the Algorithm of the day still cites its MIT 6.006 video source, and teaching's default audience still says "Princeton". Both describe real sources and audiences, not the retired product name.

**C16. Stage 4 review fixes.**
- **Editors never write stale text:** every Cambridge text field follows a pulled change until the owner types in it, and closing without typing never writes. This fixed a data-loss bug where an open item overwrote another device's newer write-up.
- **Editing a supervision log keeps its dates:** only the first save sets the supervision date and redo deadline.
- **STEP XP:** only questions carrying a STEP reference pay the self-mark XP.
- **Retry:** every Cambridge load error recovers by reloading into the same screen.
- **Today's card is lighter:** it reads a 9.9 KB catalog index instead of the 40 KB catalog, and loads after first paint. As a result the Cambridge screens now load on first open, not at startup.
- **Error-log counts:** the header counts only entries with a cause, so it matches the chart, and adds "N needs a cause".
- **Prompts:** Part IA and CST supervisor prompts say "Tripos-style" and name their own past papers, through two new placeholders in `supervisor-prompt.md`.
- **Lighthouse:** absolute scores on this busy machine read 93 to 94. In the same session, the pre-Cambridge build scored within a point when run alternately. The Stage 6 A/B against `main` decides whether there is a regression.

**C17. Stage 6 review: all eight checks pass. Two slower screens and three small issues go to a fix round.**
Results:
- **Migration** on a realistic one-year profile: all 12 Massey keys backed up byte-identical, the XP, level, streak, meters and ring UI identical, and a rollback to the old build works.
- **Offline, iPhone widths, two-device sync** (local mock, including the stale-editor case) **and empty data:** all pass.
- **Lighthouse A/B at matching load:** 93 vs `main` 93. Accessibility 100.
- **Bundle:** main JS +2.8 KB, CSS +2.2 KB.

Going to the fix round:
- The CS path opens about 70 ms slower than on `main` (rank-clear), and the Math path about 45 ms slower, because each loads the full catalog.
- 14 px helper text on the study item.
- A confusing error-log header.
- The Today cache keys shared with the old build.
The two main-branch issues the reviewer noted (service worker waits for all tabs; the foreground pull gated on dirty state) predate this work and are recorded as known issues, not fixed here.

**C18. Stage 6 fix round: the path screens load only their own track.**
The catalog is emitted as a lazy chunk per track (step, courses, cst), plus a small index for Today and the error log. The Cambridge path opens level with `main` (77 vs 77 ms). The CS path opens about 10 ms slower (137 vs 127 ms), because it draws the new CST track that `main` doesn't have; that is accepted as the cost of the content the owner asked for. Also fixed:
- Helper text is 16 px.
- The error-log header counts every entry: "1 entry · 1 needs a cause · 0 charted this week".
- Today's Cambridge cards save under new cache keys (`path.cam`, `path.cst`), so the old build's keys are never written.

**C19. Nothing extra before the first paint, and the backup snapshot is taken at boot.**
An interleaved A/B after C18 showed LCP about 180 ms worse than `main`, rank-clear. Lighthouse counts every request that finishes before the LCP paint, and on a fresh profile two Cambridge things landed there:
- the path-card downloads,
- a boot re-render held back until the first-run backup finished.

Now Today starts those downloads only after the reading title paints, and boot publishes the loaded stores before the backup finishes. In two A/B runs afterwards the ranges overlap with `main`, and the LCP median is lower. No regression.

Moving the backup off the render path opened a small window where a tap (a paper pass) could change a Massey key before the lazy backup ran. So boot now reads every Massey key synchronously as its first step, before the first render, and the migration backs up that snapshot. A test proves a change made after boot doesn't reach the backup, and the live key is left alone. Main JS: 76.6 KB gzip.

**C20. The WGU plan covers only the 4 enrolled courses.**
The owner is enrolled in C955, D326, D315 and D279, and is working on C955 and D326 now. They first wrote D955, then confirmed C955 (Applied Probability & Statistics). `roadmapData.ts` now plans those 4 over five weeks: Week 1 (Sep 28 to Oct 4) C955 and D326 underway; Week 2 (Oct 5 to 11) both due; Week 3 (Oct 12 to 18) D315 and D279 start; Week 4 (Oct 19 to 25) both due; Week 5 (Oct 26 to Nov 1) buffer. Target Oct 25.
- Each course is listed once, in the week it is due, so it has one checkbox. Weeks 1, 3 and 5 carry an admin line instead. On a week with no due course, the card falls back to the first open course in plan order, so on Sep 30 it shows C955, not D315.
- The full 13-course plan is archived in `data/archive/wgu-plan-2026-09.json`.
- `meridian.roadmap.v1` keeps every old tick. The Today card, the WGU screen and the hub stat count only the 4 plan courses (`roadmapSummary()` used to count every stored key, so old ticks could read 6/4).

**C21. The standalone Learn by Teaching tab is gone.**
Teaching lives only in the Cambridge Method tracker, where `TeachSection` already renders. Today loses its tile, and `TeachScreen.tsx` and its test are deleted. The `teach` tab id stays as an alias of `tracker` (same lazy loader, same pane), so old history entries and reopen targets land on the screen that holds the teaching section. It does not auto-expand the section: that would mean writing the owner's saved section layout (`meridian.tracker.ui.v1`). `meridian.teach.v1` is untouched. `perf/routes.mjs` and `perf/run.mjs` no longer time a teach route.


**C22. University of Cambridge arms and the Pembroke College badge (2026-09-30, owner request).**
The images are the owner's own files from Downloads. They are not redrawn: each is resized to its display size and saved as WebP. The Cambridge SVG goes from 172 KB to 10.9 KB, and the Pembroke PNG from 19 KB to 4.8 KB.
- **Placement:**
  - The Cambridge arms sit beside the date at the top of Today and beside the title on the tracker, where they replace the Princeton shield.
  - The arms and the Pembroke badge sit together on the Cambridge path header, like a student card.
  - Pembroke alone sits on the study item's Supervision heading, because colleges run supervisions.
- **The Princeton shield** stays in "About the scoring" as the Massey credit, and the disclaimer now also names Pembroke College.
- **Accessibility:** emblems inside headings are decorative (empty alt), so the heading names stay "The Cambridge Method" and "Supervision".
- **Layout:** every image has fixed width and height, so the layout never shifts. The Pembroke badge is clipped to its circle so its white corners don't show on the cream page.
- **The wordmark is unchanged:** the owner reviewed the M-tilde, R-hat and I-bar mocks and chose to keep the current logo.
