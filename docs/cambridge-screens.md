# Cambridge Method: screen spec

Implementation agents build to this. It sits under the frozen contract (`docs/cambridge-contract.md`, sections 4 and 5). If this spec and the contract disagree, the contract wins; report the conflict.

Direction: a researcher's instrument, warmed by the palette of *Her* (`design/palette-decision.md`). Swiss grid, hairlines, tabular figures, small-caps labels, plain data, no decoration without information.

## 0. Rules for every screen

- **Tokens only.** No raw color, size, or duration in feature CSS. Every text and background pair must be in `PAIRS` in `scripts/contrastCore.mjs`. Forbidden pairs: `design/token-map.md`.
- **One header language (D28).** Every screen opens with `<PageHead title note />` (`src/ui/components/PageHead.tsx`). Every block below it opens with `.m-section`, holding an `<h2 class="m-title">` or `.m-label` title and a right-aligned `.m-label m-num` note.
- **Warn and danger only for real warnings (D29).** Allowed: an overdue redo, a failed save, an error state. Stuck questions, locked phases, and low marks are facts, so they get ink, not danger.
- **No emoji or decorative icons.** Shapes drawn in CSS (check, dial, ring) are allowed only where they carry state, always next to the word.
- **Plain rows over pills.** Lists are `.m-row` with hairlines. `.m-chip` is only for filters and toggles.
- **Sizes.** Body is 17px (`--fs-body`). Sentences are at least 16px (`--fs-2`). Meta and units are 14px (`--fs-1`). Nothing is smaller. Every target is at least 44px (`--tap`).
- **Layout.** `.appwrap` already supplies the `--gutter` and the safe areas, so screens add no side padding. Max width `--content-max`. Vertical rhythm: `--sp-6` between sections (from `.m-section`), `--sp-3` inside cards, `--sp-2` between a label and its value.
- **Motion.** `--dur-2`/`--ease-standard` for state, `--dur-3`/`--ease-calm` for reveals. No entrance fades on content that may be the LCP (D31). Reduced motion comes from the tokens.
- **Numbers.** Every changing or aligned number gets `.m-num`. Times use `h:mm AM/PM` in America/New_York. Dates use `Thu 2 Oct`.
- **Glossary.** Run every Cambridge string through `<Gloss>`: Today's Math card, the path, the study item, the error log, and the tracker. Headings are the exception: a heading is never a button.

### The four states (every block)

| State | Rendering | Rule |
|---|---|---|
| Loading | `.m-skel` lines inside the block's own box, with `aria-busy="true"` and `aria-label="Loading …"` | The skeleton and the loaded block are the same size, so CLS is 0. Fix the height with a CSS variable, as `.pc` does. |
| Empty | `.m-state data-kind="empty"`: `.m-state-title` states the fact, `.m-state-body` gives the one next action, then one `.m-btn` if there is an action | Never "No data." Say what is empty and what to do. |
| Error | `.m-state data-kind="error" role="alert"`: title "X didn't load." or "Couldn't save X.", body with the cause if known, `<button class="m-btn">Try again</button>` | Scoped to the block (a `useErrorBoundary` guard, like `MathPath.tsx` `Guard`), so one failure never blanks the screen. |
| Offline | Content renders normally from local state. The block head's note becomes `<span class="m-state m-num" data-kind="offline">Offline · Saved 9:14 PM</span>` | The Cambridge store is local-first, so "offline" is never an empty screen. "Saved h:mm" is the time of the last local write. |

---

## New primitives (`src/styles/primitives.css`)

Each block is documented at its top. Examples are at `#/styleguide`, section "Study loop primitives" (`#sg-cambridge`). Screenshot: `design/cambridge/primitives-390.png`.

| Class | Use | Not color-only because |
|---|---|---|
| `.m-sr` | Visually hidden text. Put it on a wrapper `<div>`, never on a `<table>` | n/a |
| `.m-stepper` / `.m-step[data-state=done\|current\|todo]` | The 5-step loop from `method.json` | Check, filled number, hollow number; semibold name; `aria-current="step"`; hidden ", done" |
| `.m-timer[data-state=idle\|running\|paused\|reached]` | Cold-attempt clock | State word ("Running", "Paused", "60 minutes reached"); dot only while running |
| `.m-phasemap` / `.m-phase[data-state=passed\|current\|locked]` | Phase list 0 to Part IA | State word ("Passed 14 Sep", "Current", "Locked") and node shape; the gate text is written out |
| `.m-status[data-status=…]` | Item stage (5) and question status (3) | The word always shows; the dial fills in quarters |
| `.m-gloss` | Underlined term, 44px hit area via `::after` | Dotted underline plus `aria-expanded` |
| `.m-popover` (+ `.m-popover-anchor`) | Definition bubble | n/a |
| `.m-editor`, `.m-seg` | Write-up source and preview toggle | `aria-pressed` and weight |
| `.m-thumbs`, `.m-thumb`, `.m-thumb-remove`, `.m-thumb-add` | Photos of paper work | n/a |
| `.m-trend` | Small weekly stacked-bar chart | Key with words, a hidden data table, and a figcaption with the numbers |

---

## (a) Today: the Math card, Cambridge variant

The existing `PathCard` (`src/features/paths/PathCard.tsx`, `pathCard.css`) is reused unchanged: same fixed rows, same height, same skeleton and error. The Cambridge module fills `PathSummary` like this:

| `PathSummary` field | Cambridge value | Example |
|---|---|---|
| `title` | `'Math'` | Math |
| `course` | The current phase and block | Phase A · Block 3 |
| `next.label` | `currentItem(...)` label, verbatim | Assignment 7: attempt cold · Supervision due · Redo due by Thu 6 PM |
| `next.detail` | The step's `do` line from `method.json`, or the cold minutes so far | 42 of 60 min cold on Q3 |
| `next.minutes` | Omitted; the detail carries the time | |
| `progress.done / total` | Items with `redo-done` in the phase / items in the phase | 4 of 12 |
| `progress.caption` | Supervisions this week | Supervisions this week: 1 of 2 |

```
+-----------------------------------------+
| MATH                           4 of 12  |  .pc-top: .m-label + .m-num
| Phase A · Block 3                       |  .pc-course  --fs-4 semibold
| NEXT  Assignment 7: attempt cold        |  .pc-next    --fs-3
| 42 of 60 min cold on Q3                 |  .pc-meta    --fs-2 --ink-3
| ======-------------------------------    |  .m-progress
| 33% · Supervisions this week: 1 of 2    |  .pc-caption --fs-1
+-----------------------------------------+
```

- **Tap:** the card opens the `cambridge` tab.
- **Redo overdue:** the only warning. `next.label` reads "Redo overdue since Thu 6 PM". The implementer may add `data-warn` so that `.pc-next-label` takes `--warn`. `--warn` on `--surface` is in `PAIRS`.
- **Sabbath:** during the window, `next.label` reads "Resumes Sat 7:42 PM". No warning color.
- **Nothing started:** "Start Phase 0: diagnostic", with a count of "0 of N".
- **States:** loading, error, and saved copy are the existing `PathCardSkeleton`, `PathCardError`, and the "Saved copy from" note on "Today's studies". Nothing new.
- **A11y:** the card is one `<button>`. `<Gloss>` must not render nested buttons inside it, so the card passes `plain` to `Gloss`, which renders the term text only. The glossary stays reachable from the path screen.
- **Chunk:** the card reads `currentItem` through a dynamic import (contract section 5: +4 KB gzip gate).

## (b) Cambridge path screen (`cambridge`, and the `math` tab id)

```
The Cambridge Method        PHASE A · 4 OF 12   <- PageHead (h1 + note)
-------------------------------------------------
[ Supervisions this week: 1 of 2 · Mon, Wed ]   <- .m-row-like line, --fs-2
                                                   Glossary · Error log  (m-btn-quiet links)
Phases                                  1 OF 7
-------------------------------------------------
 (v) Phase 0             PASSED 14 SEP          <- .m-phasemap
  |  Diagnostic and gaps
 (O) Phase A                   CURRENT          <- washed row, aria-current
  |  STEP I foundations
  |  Gate: 3 STEP I papers at 60 or more
  |  [ Pass the gate ]                          <- m-btn, only when evidence is possible
 ( )  | Phase A+                LOCKED          <- data-parallel
      | Unlocks when Phase A's gate passes.
 ( ) Phase B                    LOCKED
 ...
Block 3                           2 DUE THIS WEEK
-------------------------------------------------
 Assignment 7          (◔) Attempting      >    <- .m-row button, .m-status
 Assignment 8          ( ) Not started     >
 STEP I 2019 Q3        (v) Redo done       >
```

### DOM
```html
<main aria-labelledby="cam-h">
  <PageHead id="cam-h" title="The Cambridge Method" note="Phase A · 4 of 12" />
  <p class="cam-week m-num">Supervisions this week: 1 of 2 · suggested Mon, Wed</p>
  <nav aria-label="Cambridge tools"> Glossary · Error log (a.m-btn.m-btn-quiet) </nav>

  <section aria-labelledby="cam-phases-h">
    <div class="m-section"><h2 class="m-title" id="cam-phases-h">Phases</h2><span class="m-label m-num">1 of 7 passed</span></div>
    <ol class="m-phasemap" aria-label="Phases"> … </ol>
  </section>

  <section aria-labelledby="cam-block-h">
    <div class="m-section"><h2 class="m-title" id="cam-block-h">Block 3</h2><span class="m-label m-num">2 due this week</span></div>
    <ul class="cam-items">
      <li><button class="m-row cam-item" type="button">
        <span class="cam-item-title">Assignment 7</span>
        <span class="m-status" data-status="attempting"><span class="m-status-mark" aria-hidden="true"></span>Attempting</span>
      </button></li>
    </ul>
  </section>
</main>
```

- **Phase rows.**
  - Passed and current phases wrap their body in `<button class="m-phase-open">`, which opens the gate detail in place and sets `aria-expanded`.
  - Locked phases are not buttons, but their gate text is always visible: "Unlocks when Phase A's gate passes."
  - Locked text uses `--ink-3`, never opacity.
  - A+ carries `data-parallel="true"`, and its title reads "…, alongside B".
- **Item rows.**
  - Full-width `.m-row` buttons (min 44px) that open `cam-item`.
  - The title is `--fs-3`; `.m-status` sits at the right via `margin-left: auto`.
  - A second line (`--fs-1`, `--ink-3`) is shown only when useful: "Redo due Thu 6 PM", or "Supervised Mon". An overdue redo is the one `--warn` line.
- **The 5 statuses** are the `ItemStage` values: Not started / Attempting / Written up / Supervised / Redo done (`.m-status data-status`).

### Pass gate flow
1. **Open the gate detail.** "Pass the gate" (`.m-btn-primary`) shows only on the current phase, when every item in its last block is at least `supervised`. Otherwise the gate text states what is left, for example "2 items still to supervise".
2. **Enter the evidence.** The button opens an inline form inside the phase row, not a modal:
   - A `<fieldset>` with `<legend class="m-label">Evidence</legend>` and one labelled field per gate criterion from the phase data (for example "STEP I 2019 mark /120"). Fields are `.m-editor-input`-style inputs at `--fs-2`, `inputmode="numeric"` for marks.
   - Actions: `Record the pass` (primary) and `Cancel` (quiet).
3. **Validate.** Each field shows its rule under it (`--fs-1`, `--ink-2`), for example "60 or more to pass". An invalid value shows the rule in `--danger`, with `aria-invalid` and `aria-describedby`. That is a real error.
4. **Record.**
   - Write `CamGate { phase, passedAt, evidence }` and credit `gatePassed`.
   - The row becomes "Passed 2 Oct", and the next phase unlocks.
   - A polite live region says "Phase A passed. Phase B is open." Focus moves to the next phase's row.

### States
- **Loading:** a skeleton of PageHead, then 7 phase rows at 64px each, then 4 item rows at 44px each. Same outline as the loaded screen.
- **Empty:** a block with no items shows `.m-state` "No items in Block 3 yet." / "Items come from step.json."
- **Error:** per section guard, with Try again.
- **Offline:** the section notes read "Offline · Saved 9:14 PM".

### A11y and focus order
PageHead, then the week line, then the tool links, then the phase rows top to bottom, then the item rows. The phase list is an `<ol>`, and the current phase has `aria-current="step"`.

### 390px
The phase map is a vertical list, so nothing scrolls sideways. The state word is `flex: none`, so the phase title wraps instead. Item rows wrap the title to 2 lines; the status never wraps (`white-space: nowrap`).

## (c) Study item screen (`cam-item`)

```
< Back (brand row)
Assignment 7                    ATTEMPT · Q3 OF 5   <- PageHead
-------------------------------------------------
(v)----(2)----(3)----(4)----(5)                    <- .m-stepper
Read  Attempt  Write  Supervision  Redo
       cold     up
Step 2 of 5 · No looking things up; at least 60 min per problem.   (--fs-2)

Questions                                 1 SOLVED
-------------------------------------------------
Q1 (v) Solved   61:04
Q2 (◑) Partial  60:12   stalled: "substitution"
Q3 (◔) ...      42:17   <- selected, opens timer
+--------------------------------------------+
| COLD ATTEMPT · Q3                          |   .m-card > .m-timer
| 42:17   of 60:00                           |
| * Running                                  |
| =========================--------          |
| [Pause]  [Hints: unlock early]             |
| Status  (Solved) (Partial) (Stuck)         |   button.m-chip aria-pressed
| Where you stalled [____________________]   |
+--------------------------------------------+

Links                                          
-------------------------------------------------
Assignment PDF                               ->
Hints            Locked for 17:43 more       (--ink-3)
Underground: Quadratics (suggested)          ->

Write-up                          SAVED 9:14 PM
-------------------------------------------------
[Write|Preview]  .m-editor
Photos  .m-thumbs  [+ Add photo]

Supervision                       1 OF 2 THIS WEEK
-------------------------------------------------
[Start supervision]  (copies prompt)
after: marks /20 per question, 3 weak points, 2 redo questions
Redo due Thu 6 PM
```

### Stepper
- An `<ol class="m-stepper" aria-label="Study loop">` built from `method.json` steps, in order. `data-state` comes from `ItemStage`: `not-started` makes Read current, `attempting` makes Attempt current, and so on. `redo-done` marks all five done.
- Under it, one line (`--fs-2`, `--ink-2`): "Step 2 of 5 · {do}".
- The stepper is not interactive.

### Questions
- A `<ul>` of `.m-row` buttons, one per question.
  - Each row shows the question label, the `.m-status`, the cold time (`.m-num`, `mm:ss`), and a `stalledAt` excerpt (`--fs-1`, `--ink-3`, one line, ellipsis).
  - The selected row has `aria-current="true"` (wash).
- The selected question's panel (`.m-card`) holds:
  - **The `.m-timer`.**
    - The value is computed from `coldSec + (now - runningSince)` every second. `mm:ss`, then `h:mm:ss` past 99:59.
    - `role="timer"` with `aria-label="Cold time, question 3"`.
    - A separate `<span class="m-sr" aria-live="polite">` announces only "Timer started", "Timer paused at 42 minutes", and "60 minutes reached. Hints are open." Never every tick.
    - Buttons: `Start` or `Pause` (`.m-btn-primary`, one toggle; its label changes, not `aria-pressed`), and `Hints: unlock early` (`.m-btn-quiet`, before 60 minutes only).
    - `data-state="reached"` when `coldSec` is 3600 or more. The state text turns `--ok`: "60 minutes reached · hints open".
    - Only one question runs at a time. Starting Q3 pauses Q2, and the live region says so.
  - **Status.** A group `role="group" aria-label="Status, question 3"` of three `button.m-chip` with `aria-pressed`: Solved, Partial, Stuck.
  - **Where you stalled.** A `<label>` and `<input>` (`--fs-2`, full width, 44px). It appears for partial and stuck.
  - **Mark /20.** Only after supervision: a numeric input with the `/20` suffix as text.
- **Unlock early confirm.** A non-modal inline confirm replaces the button row. Focus moves to its first button, and Escape cancels back to the trigger:
  - "Open the hints now? The 60-minute cold attempt is the point of this step."
  - `[Open hints]` (plain `.m-btn`, not primary) and `[Keep going]` (`.m-btn-primary`, the default).
  - Opening sets `hintsUnlockedEarly` and logs it. No warning color.

### Links
- `.m-row` anchors (`target="_blank" rel="noopener"`) for the source PDF and the matching Underground stations. Stations carry a "(suggested)" `--ink-3` suffix, per `underground.json` `mapping.label`.
- A station with `has.introducing: false` shows its note: "Start with Developing."
- **Hints row.** Locked: a non-link row "Hints · Locked for 17:43 more" (`--ink-3`, `.m-num`, updates each minute, not live). Open: a normal link row.

### Write-up
- `.m-section` "Write-up", with the note "Saved 9:14 PM" (or "Offline · Saved 9:14 PM").
- `.m-editor` with `.m-seg` Write/Preview (`aria-pressed`). The textarea autosaves on input, debounced to 500 ms.
- The preview renders Markdown plus KaTeX, lazy-loaded when Preview is first pressed. While it loads, the preview box shows `.m-skel` lines at the same `--m-editor-h`.
- Empty preview: `data-empty="true"` with "Nothing written yet."
- Photos: `.m-thumbs` under the editor.
  - The add tile opens `<input type="file" accept="image/*" capture="environment">`.
  - A tile shows `data-state="loading"` while compressing.
  - Remove asks nothing and offers an Undo toast, which is the app pattern.
  - `alt` is "Page n of the write-up".
- "Submit write-up" (`.m-btn-primary`) sets the stage to `written-up` and credits `writeup`. It is disabled with `aria-disabled` and a reason line until text or a photo exists.

### Supervision
- **Before.**
  - `Start supervision` (`.m-btn-primary`) copies the filled `supervisor-prompt.md` to the clipboard.
  - A polite status line confirms: "Prompt copied. Paste it into Claude with your photos." If the clipboard fails, the prompt appears in a read-only `.m-editor-input` with "Select all" (error text only if even that fails).
  - Note line: "Supervisions this week: 1 of 2".
- **After** (a "Log the supervision" button opens an inline `<form>`):
  - Per question: "Q1 mark" numeric 0 to 20, with the suffix "/ 20". Invalid input gets `aria-invalid` and a `--danger` hint.
  - "3 weak points": three labelled single-line inputs, "Weak point 1" to "Weak point 3".
  - "2 redo questions": two `<select>`s of the item's questions.
  - `Save` (primary). On save:
    - Set `supervisedAt`, the marks, `weakPoints`, `redoQs`, and `redoDue = redoDue(supervisedAt)`.
    - Auto-create error-log entries for marks under 14 and for stuck questions (cause picked later, in the log).
    - Announce politely: "Supervision saved. Redo due Thu 6 PM."
- **Redo.** A line "Redo due Thu 6 PM" (`.m-num`); if Sabbath-shifted, "Sat 8:42 PM, after the Sabbath". "Mark redo done" sets `redoneAt`. Overdue text is `--warn` (a real warning).

### States
- **Loading:** a skeleton for the whole screen, including the stepper outline, 5 rows, and the timer card at its fixed height.
- **Unknown item id:** `.m-state` error, "This item isn't in the plan.", with a "Back to the Cambridge path" button.
- **Errors:** each section has its own guard.
- **Offline:** the timer keeps running (clock-derived), and the notes say "Offline · Saved h:mm".

### Focus order
PageHead, stepper (not focusable), question rows, timer controls, status chips, stalled input, links, editor toggle, textarea, photos, supervision actions.

### 390px
- The stepper fits: columns size to the longest word, and "Attempt cold" and "Write up" wrap.
- Timer digits are 44px.
- Question rows put the cold time at the right, and the stalled excerpt on a second line.

## (d) Error log (`cam-errors`)

```
Error log                    31 ENTRIES · 3 THIS WEEK
-------------------------------------------------
Cause  [All] [Concept] [Algebra slip] [Didn't see…] [Ran out…]   button.m-chip aria-pressed, wraps
Topic  [ All topics            v ]                              <select>, 44px
+-------------------------------------------+
| ERRORS PER WEEK       2 this week · 2 last|  .m-card > .m-trend (8 weeks, stacked by cause)
| ||  ||| ||| |||  ||  |   .   .            |
| W33 ... W40                               |
| # Concept # Algebra slip # Didn't see ... |
+-------------------------------------------+
Entries                                 SHOWING 12
-------------------------------------------------
Thu 2 Oct · Assignment 7 · Q3                         <- .m-row, column layout
Algebra slip · Quadratics
Fix: check the sign when completing the square.
...
Archived journal                        READ-ONLY
-------------------------------------------------
(the old proof journal, collapsed <details>, plain text)
```

- **DOM:**
  - `<main>` with PageHead.
  - A filter `<div role="group" aria-label="Filter by cause">` of chips.
  - `<label for>` plus `<select>` for the topic.
  - `<section>` "Weekly trend" with `.m-trend`.
  - `<section>` "Entries" with a `<ul>` of `<li class="m-row cam-err">`.
  - `<section>` "Archived journal" with a `<details>` (summary 44px).
- **Filters.**
  - Filters apply instantly; the trend and the list both follow them.
  - The entry count note updates, and a polite `.m-sr` live region announces it: "Showing 12 entries".
  - Filters are held in component state; they are not synced.
- **Entry row:**
  - Line 1: date, item, and question (`--fs-2`, `.m-num`).
  - Line 2: cause and topic (`--fs-2`, `--ink-2`).
  - Line 3: "Fix:" with the fix (`--fs-3`).
  - An entry without a cause (auto-created) shows an inline cause `<select>` and a fix input. The label "Needs a cause" is `--accent-ink`, not warn.
- **Trend.**
  - `.m-trend` covers the last 8 ISO weeks, with one segment per cause in `errorCauses` order mapped to `--series-1..4`. The current week is `aria-current="true"`.
  - The `<ol>` has `role="img"` and an `aria-label` with totals.
  - The per-cause table is inside `<div class="m-sr">`. The key is `aria-hidden`, because the table carries the same data.
  - Under a cause filter, show one series with its color.
- **States:**
  - Loading: skeleton filter row, a 96px trend box, and 4 rows.
  - Empty: "No errors logged yet." / "Entries appear when a question is marked under 14 or stuck."
  - Empty after filtering: "No entries for Concept." / `[Clear filters]`.
  - Error: guard with Try again.
  - Offline: "Offline · Saved h:mm".
- **390px:** the chips wrap to 2 lines, and the long cause label keeps its full text. The trend columns are about 36px each; week labels stay `W40` (the year is dropped).

## (e) Glossary screen and popover

```
Glossary                               24 TERMS
-------------------------------------------------
[ Search terms            ]   <input type="search">, 44px, label "Search the glossary"
Tripos                                          <- <dl>: <dt> --fs-4 semibold
Name of a Cambridge degree program ...          <- <dd> --fs-3
US  Degree program + finals                     <- <dd> .m-label + --ink-2
-------------------------------------------------
Part IA / IB / II / III
...
```

- **DOM:** `<main>`, PageHead, a search `<label>` and `<input type="search">`, then `<dl class="cam-gloss">`. Each term is a `<div id="g-{id}">` holding `<dt>`, `<dd>` (meaning), and `<dd>` (US). Hairline between terms.
- **Search.**
  - Matches the term, the meaning, `us`, and `match`, case-insensitively.
  - The note becomes "3 of 24 terms". A polite live region announces the count.
  - Empty result: `.m-state` "No term matches 'tripo'." / `[Clear search]`.
- **Deep link.** `#/glossary?t=tripos` scrolls to `#g-tripos`, focuses its `<dt>` (`tabindex="-1"`), and gives it a `--accent-wash` background for `--dur-3`.

### `<Gloss>` and the popover
- **Markup.**
  - `<span class="m-popover-anchor"><button class="m-gloss" aria-expanded aria-controls>` holds the term.
  - When open, it is followed by `<span class="m-popover" role="dialog" aria-label="{term}">` containing the term, meaning, "US …", and an "Open glossary" link. Full markup is at the top of the `.m-popover` block.
- **Matching** (contract section 5):
  - Whole words only.
  - Acronyms are case-sensitive (STEP, OCR, CST); other words are case-insensitive.
  - Only the first occurrence per text block is wrapped, so a paragraph isn't striped with underlines.
  - Never inside headings, links, or buttons. Inside a button-card, use `plain`.
- **Behavior.**
  - A tap or Enter/Space toggles it.
  - Only one popover is open at a time.
  - Focus stays on the term, and Tab moves into the bubble's link.
  - It closes on Escape (focus returns to the term), a pointerdown outside the anchor, focus leaving both the term and the bubble, or route change.
  - Positioning, in `useLayoutEffect` after open:
    - Measure the bubble.
    - Shift `--m-pop-x` by `dx` to stay within the page gutters, and set `--m-pop-arrow` to `calc(50% - dx)` so the arrow stays on the term.
    - Set `data-side="top"` when the bottom would pass the viewport and there is room above.
  - The reference implementation is `GlossDemo` in `Styleguide.tsx`.
- **Hit area.** `.m-gloss::after` is a centered 44 by 44 minimum, so a term never changes the line height. Verified: 26.35px line, same with and without the term.
- **Screen readers.** The term button reads "supervision, collapsed, button". The dialog is labelled with the term. It is non-modal, so there is no focus trap.

## (f) Tracker changes (`StudyTracker.tsx`, `studytracker.css`)

- **Product name.** The `<h1>` "The Massey Standard" becomes "The Cambridge Method". Update the footer line "The Massey Standard · a personal daily instrument" to "The Cambridge Method · …". The Princeton crest and the homage paragraph stay (the history of the rubric), but under a `<details>` "About the scoring".
- **Credit line.** Directly under the `<h1>`: `<p class="fine">Scoring system adapted from the Massey Standard</p>` (`--fs-1`, `--ink-3` on the tracker surface; that pair is in `PAIRS`).
- **Weekly Cambridge scorecard.**
  - A new `Collapsible id="cam-week" eyebrow="This week" title="Cambridge: missed, partial, met"` directly after the daily `scorecard` Collapsible, defaultOpen.
  - The same `.sc` / `.scrow` / `.seg` markup as the daily card, so it reads as its sibling. Five rows (contract section 3):
    1. Cold attempts of 60 min or more
    2. Write-ups before supervision
    3. Both supervisions held
    4. Misses redone within 48 hours
    5. Phase pace target hit
  - Each row shows the auto value's reason under the label (`--fs-1`, `--ink-2`, `.m-num`), for example "4 of 5 questions".
  - A manual override is the same segmented control. An overridden row shows "Set by you · Reset" (quiet button, 44px) so the auto value can return.
  - Footer: `<span class="tot m-num">7 / 10</span>` and the ISO week label "2026-W40".
  - On wide screens (48rem or more), the daily and weekly cards sit side by side in a 2-column grid. On phones they stack, weekly under daily.
- **Meters** are unchanged in position. The weekly input is documented in the tracker hint text.
- **States.** The weekly card follows the four states:
  - Loading: skeleton rows at the `.scrow` height.
  - Empty, before any Cambridge data: rows show "No Cambridge work logged this week" and stay unrated. An unrated row never counts against the week.
  - Error: guard with Try again.
  - Offline: "Offline · Saved h:mm" in the footer.
- **Gloss.** The Cambridge row labels go through `<Gloss>` ("supervisions").

## Contrast pairs added (`scripts/contrastCore.mjs`)

| Pair | Min | Use |
|---|---|---|
| `--ink-2` on `--accent-wash` | 4.5 | Current phase title and gate |
| `--accent` on `--accent-wash` | 3 | Current phase node |
| `--rule-strong` on `--accent-wash` | 3 | Parallel phase rule on the current row |
| `--focus` on `--accent-wash` | 3 | Focus ring on the current phase and an open term |
| `--ok` on `--bg`, `--surface` | 3 | Done step, passed phase, solved mark |
| `--on-accent` on `--accent` | 3 | Current step number (already 4.5 as text) |
| `--accent` on `--surface-2` | 3 | Status dial in a well |

The editor placeholder is `--ink-3` on `--surface`, which is already listed. `node scripts/contrast.mjs` passes both palettes.
