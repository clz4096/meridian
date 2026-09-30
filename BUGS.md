# Bugs

One list for the redesign, merged from the Stage 5 per-area logs (`design/bugs-app.md`, `design/bugs-tracker.md`, `design/bugs-wgu.md`) plus what the cleanup pass found. R rows come from the Stage 5 review (`perf/results/stage5-review/`).

Severity: P1 blocks use or fails WCAG AA, P2 visible defect, P3 polish. The tracker and WGU logs used High, Medium and Low; they map to P1, P2 and P3.

| ID | Area | Screen | Description | Severity | Status | Fix or note |
|---|---|---|---|---|---|---|
| A1 | App | Todos | Edit, Remove and the edit row's Cancel were `<span onClick>`: no keyboard access, no accessible name. | P1 | Fixed | Real `<button>`s, 44x44, named "Edit …", "Remove …", "Cancel edit". |
| A2 | App | Scratchpad | Card title and × were spans; edit and add fields had no label. | P1 | Fixed | Title is a button with `aria-expanded`, × is a named button, every field has an `aria-label`. |
| A3 | App | Knowledge, Gym | Item checkbox was a 20px `<span onClick>`: not focusable, no state. | P1 | Fixed | `<button class="chk" aria-pressed>`, 22px box inside a 44px target. |
| A4 | App | All app.css screens | Many controls set `outline:none` on `:focus-visible`, so keyboard focus was invisible. | P1 | Fixed | One global `--focus` ring; no rule removes it. The intro's Enter button had the same `outline:none`; see A23. |
| A5 | App | All | `maximum-scale=1` blocked pinch zoom (WCAG 1.4.4). | P1 | Fixed | Every input is 16px or more; `maximum-scale` removed from index.html. |
| A6 | App | Charts | Axis labels 9px, goal label 7px, headline number in the series color (ochre 3.1:1 as text), week labels overlapped. | P1 | Fixed | chart.ts: axis 14px, goal 13px, label count fitted, headline in ink with a color key. |
| A7 | App | Knowledge rail, topic stack | Done and upcoming tiles used opacity .5 to .66, taking text under 4.5:1. | P1 | Fixed | Full opacity; state shown by weight, color token and a dashed edge. |
| A8 | App | Workout, exercise detail | Upcoming sets used opacity .45. | P1 | Fixed | `--ink-3` text instead. |
| A9 | App | Knowledge session | The mastery word took an inline dark-theme hex from `ascent.ts` `MCOLOR` (about 2:1). | P1 | Fixed | CSS set the word to `--ink-2`; A15 then removed the inline color entirely. |
| A10 | App | Todos | Global `button{min-height:44px}` stretched the 22px checkbox to 22x44. | P2 | Fixed | 44x44 target, 22px box in a pseudo-element. |
| A11 | App | Charts | Carousel page dots were 6px buttons. | P2 | Fixed | 44x44 targets, dot drawn inside. |
| A12 | App | Workout, exercise detail | The rest bar covered the last rows and the page couldn't scroll them clear. | P2 | Fixed | Extra bottom padding while resting. |
| A13 | App | Data | Stat tiles had a pointer cursor and hover lift but did nothing. | P2 | Fixed | Plain tiles; only `button.tile` gets hover. |
| A14 | App | Data | Supabase fields, backup textareas and restore select had no label; health table's first header was empty. | P2 | Fixed | `aria-label`s and a visually hidden "Metric" header. |
| A15 | App | Knowledge session | `MCOLOR` held dark-theme hexes and the session appended `66` for a glow. | P2 | Fixed | `MCOLOR` maps to `var(--m-new)` … `var(--m-mastered)`; glow and inline word color dropped, so the `!important` overrides went too. Test pins every value to a token. |
| A16 | App | Knowledge topic card and session | Model answers showed raw Markdown (`**bold**`, backticks). | P2 | Fixed | `ui/components/Markdown.tsx`: bold, italic, inline code, fenced code, line and paragraph breaks, parsed to a token tree and rendered as Preact elements, never `innerHTML`. Tests cover XSS-style input. The topic card's bold first sentence only splits when the cut can't break a Markdown span. |
| A17 | App | Intro (Data, "Play the intro") | The additive-blended graph washed out to near white on cream. | P2 | Fixed | The intro is a night field on `--ink` with nodes and lines in `--accent-2`, `--peach` and `--sand`; overlay text is `--bg` and `--rule`. All pairs added to the contrast gate (7.3:1 or better). The app-background preset keeps the cream colors. |
| A18 | App | Scratchpad (empty data) | Opening Scratchpad recorded CLS 0.08 in `perf/routes.mjs`. | P3 | Fixed | Cause was not missing reserved space: the `paneIn` keyframe animated `transform`, which made the pane the containing block for the fixed FAB, so the FAB rode inside the pane and jumped to the corner when the animation ended. `paneIn` is now opacity only. Re-measured: CLS 0.000 for todos, scratch and workout, empty and seeded. |
| A19 | App | Workout week strip | Upper, lower, rest and logged are shown only by hue and shape. | P3 | Open | Partly fixed: each day's accessible name says it. No visible legend yet. |
| A20 | App | Food & Body composer | Fields wrapped as two uneven pairs at 390px. | P3 | Fixed | Name on its own row; kcal, protein and Add share the second. |
| A21 | App | Knowledge rail | `.rail-root` redefined `--gutter`, shadowing the layout token. | P3 | Fixed | Renamed `--rail-gutter`. |
| A22 | App | Contrast gate | Text pairs in use but missing from `PAIRS`: `--series-2` (the "mastered" word), `--on-accent` on `--ok` (banked button, done step) and on `--danger` (teach badge). | P3 | Fixed | Added to `scripts/contrastCore.mjs`; all pass in both variants (lowest 5.13:1). No other text use of `--series-*`, `--peach` or `--sand` as a foreground. |
| A23 | App | Intro | The Enter button's `:focus-visible` set `outline:none`, and the global blue ring would be too dark on the night field. | P2 | Fixed | Found in cleanup. A 2px `--accent-2` ring (7.3:1 on `--ink`). |
| A24 | App | Shell (FAB and finish-bar screens) | When the save chip lifts above a FAB, the workout finish bar or the rest bar, its top edge (up to 156px) cleared the page's 100px bottom room, so the last row could not scroll out from under it. | P3 | Fixed | Found in cleanup while checking WGU-13. `.appwrap` reserves 168px when the chip shows on those screens. |
| TR-01 | Tracker | Tracker, Teach | Done and locked rows were dimmed with opacity, taking secondary text under 4.5:1. | P1 | Fixed | Color and line-through, never opacity. |
| TR-02 | Tracker | Tracker, CS, Teach | Many tap targets under 44px. | P1 | Fixed | `min-height: var(--tap)`; tick and pass boxes are 44px buttons with a 22px box inside. |
| TR-03 | Tracker | Tracker, CS, Teach | Long-form text under 16px (13 to 13.5px), which also made iOS zoom on focus. | P1 | Fixed | Prose `--fs-body`, secondary `--fs-2`, inputs 16px or more. |
| TR-04 | Tracker | Tracker | Score buttons showed a grey well: the app-wide `.seg` rule leaked in. | P2 | Fixed | `.pt-root .seg` resets it. |
| TR-05 | Tracker | Tracker, CS | Complexity badges with full phrases wrapped into large mono blocks. | P3 | Fixed | Badges in sans at 14px. |
| TR-06 | Tracker | Tracker | "7,448 XP" wrapped mid-value at 390px. | P3 | Fixed | `white-space: nowrap`. |
| TR-07 | Tracker | Tracker | Princeton orange is 2.6 to 3.0:1 on every surface. | P2 | Fixed | Not used; the shield carries the identity (D22). |
| TR-08 | Tracker | Tracker | Raw colors outside tokens. | P2 | Fixed | All removed; unused selectors deleted. |
| TR-09 | Tracker | Tracker | Scorecard groups had `role="group"` with no name. | P2 | Fixed | Labeled with the row name. |
| TR-10 | Tracker | Tracker | Paper byline read "Karp (1972) · 1972". | P3 | Fixed | Display only: `paperByline()` in `papers.ts` drops a trailing "(year)" that repeats `year`; the pills still read "Karp (1972)". Tested across the catalogue. |
| TR-11 | Tracker | Teach | The Teach screen opens with its only section collapsed. | P2 | Fixed | `TeachScreen` renders `TeachSection standalone`, which opens expanded (Stage 4 fix round). |
| TR-12 | Tracker | Tracker | Today and Playbook tabs had no `aria-controls`, no tabpanel and no arrow keys. | P3 | Fixed | Tab ids, `aria-controls`, one `role="tabpanel"` labelled by the active tab, roving `tabIndex`, Left, Right, Home and End with automatic activation. Component test added. |
| TR-13 | Tracker | CS path | `csPath.css` header comment says the algorithm card keeps the tracker's scoped palette; that palette is gone. | P3 | Fixed | Comment updated. |
| TR-14 | Tooling | n/a | `perf/routes.mjs` sometimes times out opening a route: path cards render after home is "ready". | P3 | Fixed | The script waits up to 10 s for a route's own element before calling it missing. |
| TR-15 | Tooling | Tracker | Full-page screenshots repeat content and paint the fixed header mid-page. | P3 | Open | Artifact of `fullPage: true` with fixed elements; element screenshots are correct. |
| TR-16 | Tracker | CS path, Today | `psetOfWeek` counted weeks in UTC, so the problem set turned over mid-evening in the Americas (the bug `paperOfWeek` already had fixed). | P3 | Fixed | Uses `localEpochDay` like `paperOfWeek`; New York test pins the Wednesday 23:30 and Thursday 00:30 cases. |
| WGU-1 | WGU | Roadmap | Body rendered in the old dark palette: `.wgu-root` redefined the tokens. | P1 | Fixed | Local palette deleted; global tokens only. |
| WGU-2 | WGU | Roadmap | Today header used inline style objects. | P3 | Fixed | `.wgu-today-*` classes. |
| WGU-3 | WGU | Roadmap | 26 checkboxes were 24x24. | P1 | Fixed | 44x44 native input over a drawn 22px box. |
| WGU-4 | WGU | Roadmap | Checkboxes had no id or visible label and omitted the course name. | P2 | Fixed | Unique ids and `<label for>` with code and name. |
| WGU-5 | WGU | Roadmap | 19 course links were 17px tall. | P1 | Fixed | `inline-flex`, `min-height: var(--tap)`. |
| WGU-6 | WGU | Roadmap | Long URL labels could overflow 390px. | P2 | Fixed | `overflow-wrap: anywhere`. |
| WGU-7 | WGU | Roadmap | Sentences at 12 to 14px. | P2 | Fixed | 16 to 17px. |
| WGU-8 | WGU | Roadmap | "13 courses, 37 days." contradicted the live countdown. | P2 | Fixed | "13 courses in a 37-day plan". |
| WGU-9 | WGU | Roadmap | Assessment chips used series hues as text (3.2:1). | P2 | Fixed | Ink text, hue as a dot (D23). |
| WGU-10 | WGU | Roadmap | Heading levels skipped. | P3 | Fixed | `h2` callout, `section` per week with an `h3`. |
| WGU-11 | WGU | Roadmap | Stats were bold spans in running text. | P3 | Fixed | A `dl` grid. |
| WGU-12 | WGU | Shell header | The Meridian wordmark rendered pale blue. | P3 | Fixed | Already fixed by the app.css restyle: `.brand` is `--ink` with the final "n" in `--accent-ink`. Confirmed by screenshot at 390px. |
| WGU-13 | WGU | Shell (save chip) | The Saved / Unsaved chip overlapped content at the bottom while scrolling. | P3 | Fixed | The chip stays fixed in the bottom-right corner, inside the safe area, and the page reserves bottom room so any row can scroll clear of it: 100px by default (chip top is 60px), 168px when the chip is lifted (A24). A floating chip still passes over content mid-scroll by design. |
| R1 | App | Data | Export filled `#d-io`, then the status line's re-render remounted the textarea empty (the old node was detached), so Copy copied nothing. Predates the redesign. | P1 | Fixed | The Backup text is state: a `dataIo` signal the textarea renders from and writes back on input. Export sets it, Copy and Import read it; no imperative `setValue` into a node that can be replaced. Test: after Export the textarea holds the JSON and Copy copies it. |
| R2 | App | Knowledge, Gym | Done rows were dimmed with inline `opacity:.5` (3.2:1). | P1 | Fixed | `.goalrow-t.done`: `--ink-3` and a strike, as in A7 and TR-01. Test pins the class and no inline opacity. |
| R3 | App | Knowledge cards and session | Practice, "see also" and source links were 20 to 22px tall at 14px. | P2 | Fixed | `.qpractice-link`, `.qsee a`, `.asc-practice a`, `.asc-see a`, `.qsrc a`, `a.asc-src`: 44px rows at 16px. |
| R4 | App | Workout, exercise detail | The weight and reps inputs were 38px tall. | P2 | Fixed | `.field .fv` has `min-height: var(--tap)`. |
| R5 | Tracker | Algorithm of the day, Prove it yourself | The reconstruction textarea had no label. | P2 | Fixed | `aria-label` naming the algorithm. |
| R6 | App, Tracker, WGU, Math, CS, Today, Intro | Several | Sentences at 14px (12px on the intro tag line): health table cells, `.hp-kv`, `.dadv-btn small`, `.cs-meta`, WGU legend chips, `.wgu-today-cap`, `.mp-muted`, `.asc-meta`, `.td-wx-updated`, `.fine`, `.app-foot`, `#landing .tag`. | P2 | Fixed | 16px. Short small-caps labels, complexity badges (TR-05) and code (D22) stay at 14px. |
| R7 | App | Scratchpad | The pressed "All" chip was 43px wide. | P3 | Fixed | `.mchip` has `min-width: var(--tap)`. |
| R8 | Math, CS | Course plan | Native checkboxes drew 22px targets. | P3 | Fixed | `.m-check` primitive (the WGU pattern): the input covers a 44px cell over a drawn 22px box. |
| R9 | App | Workout, resting | The rest bar floated above the bottom edge, and content showed beneath it. | P3 | Fixed | Anchored to the bottom edge, full width, its padding covering the safe area; the page keeps its 140px reserve while resting. |
| R10 | App | Shell | The sticky brand row stopped at the gutters (351px wide at 390), so content scrolled by at its sides. | P3 | Fixed | The row spans the gutters with negative margins and pads back in. |
| C1 | Tests | n/a | jsdom logged "Not implemented: window.scrollTo" on route changes. | P3 | Fixed | `src/test/setup.ts` stubs `window.scrollTo` as a no-op. |
| C2 | Today | Today, reading card | The quiet "Open paper" button's -16px pull could overflow the card at narrow widths. | P3 | Fixed | Measured: the pull equals the card padding, so the button stays inside the card at 375 and 320px; the longest label wraps inside its 44px button at 320. Documented in `today.css`; no layout change needed. |
| C3 | Docs | Style guide | D11's forced reload on leaving `#/styleguide` outlived its reason (token clash). | P3 | Fixed | Kept the reload for a new reason: the style guide never runs `boot()`, and a reload is the one tested startup path (D26). |

## Cambridge links

Checked 2026-09-30 by `scripts/cambridge/verify-links.mjs` (report: `data/cambridge/link-report.json`): 870 unique URLs, 848 OK, 22 not OK. After the Stage 2 fixes (the pirated link and the Siklos publisher entry removed), a recheck found 868 URLs, 847 OK, 21 not OK. Every not-OK link is kept in the data with `verified: false` and a `reason`, so the UI can show it as unavailable instead of hiding it. None is on the main STEP track: all 166 step.json links and all example sheets verify.

Rechecked 2026-09-30 after the CS track was added to cs.json (`track`: 83 items, 444 links, 378 unique URLs, all on official hosts): 980 unique URLs, 960 OK, 20 not OK, and all 20 were already flagged `verified: false`. Every CS track link verifies; the track leaves out Moodle links and the three CL files that answer 404 (it takes each Part IA course's links from `tripos.parts.IA`, skipping those). ocaml.org answers again and is now verified.

| URL | Status | Where used | What I did |
|---|---|---|---|
| https://www.openbookpublishers.com/books/10.11647/obp.0181 | 429 | resources.json: Siklos publisher page (removed) | Vercel bot checkpoint; opens in a browser. The entry was an extra beyond the brief's nine resources, so it was dropped. The verified Siklos PDF (`books.openbookpublishers.com/10.11647/obp.0181.pdf`) stays. |
| https://www.archim.org.uk/lecturenotes/ia/dynamics.pdf | 404 | courses.json: Dynamics and Relativity, Siklos lecturer's notes (from the Notes Hub) | Kept, unverified. The course still has Dexter Chua's and David Tong's notes. |
| https://www.joh.cam.ac.uk/sites/default/files/2017-11/notes2005.pdf | 404 | courses.json: Vector Calculus, Dorrzapf lecturer's notes (from the Notes Hub) | Kept, unverified. Four other note sets verify. |
| https://www.cl.cam.ac.uk/teaching/2526/Databases/recursive-sql-notes.txt | 404 | cs.json: Databases materials (2025-26) | Kept, unverified (broken on the CL page itself). |
| https://www.cl.cam.ac.uk/teaching/2526/DiscMath/DiscMathRegLanFinAutNotes.pdf | 404 | cs.json: Discrete Mathematics materials (2025-26) | Kept, unverified (broken on the CL page itself). |
| https://www.cl.cam.ac.uk/teaching/2526/DiscMath/DiscMathRegLanFinAutSlides.pdf | 404 | cs.json: Discrete Mathematics materials (2025-26) | Kept, unverified (broken on the CL page itself). |
| https://ocaml.org/docs/install.html | 503, then 200 | cs.json: Foundations of Computer Science materials | Was 503 (transient). The 2026-09-30 CS scrape found it working and set `verified: true`. |
| http://www.siggraph.org/ | 307 | cs.json: Introduction to Graphics materials | Redirect with no usable target from Node; https also fails. Kept, unverified. |
| http://education.siggraph.org/cgsource/category/instructional-techniques | 404 | cs.json: Introduction to Graphics materials | Kept, unverified. |
| https://www.shadertoy.com/ | 403 | cs.json: Introduction to Graphics materials | Blocks scripts; opens in a browser. Kept, unverified. |
| https://docs.google.com/document/d/1UEkCbw_5kIR0OvjsdHs3tmnhlV0KkFyh/edit?... | 401 | cs.json: Interaction Design materials | Needs a Google login. Kept, unverified. |
| https://drive.google.com/drive/folders/13wmsISWw9DTkMHM0jFyEjrix6DJ9g06Q | 200 to a sign-in page | cs.json: Interaction Design materials | Needs a Google login. Kept, unverified. |
| 10 Moodle links: `www.vle.cam.ac.uk/...` (8) and `www.cl.cam.ac.uk/teaching/2526/moodle/{Graphics,IntDesign}` (2) | 200 to the Moodle sign-in page | cs.json: Algorithms 1 and 2, Databases, Digital Electronics, Discrete Mathematics, Hardware Practical Classes, Introduction to Graphics, Interaction Design, OCaml Practical Classes | Raven-only by design. Kept with `kind: "moodle"`, `ravenOnly: true`, `verified: false`. |

Also found while scraping:

- **No `www.step-support.org` hrefs exist today.** The brief expected the Mixed Pure STEP 1 page to link that dead domain. On 2026-09-30 neither that page, the other two Mixed STEP 1 pages, any assignment or module page, nor the Mixed Pure PDFs contain a step-support.org link. Nothing to fix; `scrape.mjs` still watches for such hrefs, stores the step.maths.org same-path copy only if it verifies, and prints the case.
- **www.damtp.cam.ac.uk and www.dpmms.cam.ac.uk send the wrong intermediate certificate** (Let's Encrypt YR1 instead of YR2). Browsers and macOS curl recover by downloading the issuer from the certificate's AIA URL; Node and WebFetch fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. `scripts/cambridge/lib.mjs` now does the same AIA download, checks each downloaded certificate's signature up to a system root, then trusts it for the run. The app is not affected: it only links to these sites.
- **The official CS course page links an unofficial CSAT copy.** www.undergraduate.study.cam.ac.uk/courses/computer-science-ba-hons-meng links "Computer Sciences Aptitude Test (CSAT)" to openclimb.io. The CS track links only Cambridge's own college-assessments page for the CSAT, per docs/cst-track.md.
- **NST Part IA Mathematics example sheets are not public.** The Faculty's NST page says they are handed out in lectures and posted on Moodle (Raven login); the public DAMTP examples index lists only some NST Part IB sheets. The track's NST item says so and points to the Mathematical Tripos IA sheets in courses.json as the nearest public ones.
- **Question-reference conflicts on step.maths.org**, recorded as item notes in step.json: Assignment 14 (the page says 2010 STEP 2 Q3; the video title says Q2) and Assignment 21 (the page says 1999 STEP 1 Q4; the video title says 1991). `scrape.mjs` detects these by comparing the page's question with each worked-solution video title.
- **Pirated textbook link (P2, fixed).** The 2025-26 Databases materials page on www.cl.cam.ac.uk links the course textbook (Lemahieu, vanden Broucke and Baesens, *Principles of Database Management*, Cambridge University Press) as "PDF" through a `www.google.com/url?...` redirect to a z-lib copy hosted at `unidel.edu.ng/focelibrary`. The scrape stored it in cs.json as a Databases exercise. Removed. `scrape.mjs` now skips, and logs, any link to a known piracy host (z-lib, zlibrary, libgen, library.lol, Anna's Archive, Sci-Hub, pdfdrive, 1lib, b-ok, unidel.edu.ng) or through a Google redirect, which hides the real host; `--offline` and every merge drop any such link already in the data (`merge.mjs` `blockedReason`), and a test fails if one is ever stored. Other hosts a course page links (GitHub, judiciary.uk, ocaml.org and so on) are kept: the rule blocks known-bad hosts rather than allowing only university ones.
