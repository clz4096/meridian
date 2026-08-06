# Knowledge Engine — Spec

Status: **draft / agreed design**, pre-implementation.
Owner: Albert. Author of record for decisions: this doc.

Companion to `workout-nutrition-engine-spec.md`. This is the technical version —
data model, algorithms, layout, build order.

---

## 1. Purpose & mental model

Today the Knowledge tab is a **flat pile of flashcards**, each scheduled on its
own by an SM-2 scheduler. It protects *recall of individual cards* but is blind to
three things Albert named as the real gaps:

- **No sense of structure** — no concepts, no prerequisites, no order to learn in.
- **No sense of growth** — no answer to "is my knowledge actually progressing?"
- **No way to build forward** — no mechanism to get *new, harder* questions that
  build on what's already mastered; no curriculum, no deliberate practice.

The redesign turns the pile into a **concept graph on top of a state-of-the-art
memory model**, where the path is **guided but never locked**.

North star to optimize: **long-term retention _and_ depth.** Not coverage for its
own sake, not speed — retention (remember it months out) and depth (push each
concept from *recall* → *apply* → *defend*).

Mental model in one line:

> **FSRS keeps knowledge from decaying; the concept graph decides what to learn
> next; the growth queue blends the two into one daily list.**

---

## 2. What exists today (build on it, don't discard)

`KnowledgeState` (the `knowledge` store):

```ts
interface KnowledgeState {
  mastery: Record<string, Mastery>;        // qid -> 1..5 self-rating
  srs:     Record<string, SrsEntry>;        // qid -> { due, ivl, ease, n }  (SM-2)
  log:     Array<{ id; qid; at; rating }>;  // every answer, with a timestamp
  gymDone: Record<string, boolean>;
}
type Mastery = 1 | 2 | 3 | 4 | 5;
```

- `knowledgeSelectors.ts` holds a **pure** SM-2 `schedule(prev, rating, today)` +
  `dueCards`, `studyStreak`, `normaliseEntry` (already tolerant of legacy rows).
- `questionBank.ts` holds the questions. `KnowledgeItem = { id, prompt, reveal,
  mins, flow, src{book,ref,page,title,url}, tags? }`. `KnowledgeTopic = { id, name,
  books[] }`.
- The **`log`** is gold: a full, timestamped answer history. FSRS parameter
  fitting and the retention trend both read it — we already have the raw data.

Keep: the pure-selector discipline (a scheduler is a pure `(prev, grade, now) ->
next` transition, `now` always passed in), the `log`, the question bank, the
mastery/charts scaffolding. Replace: the SM-2 scheduler and the flat UI.

---

## 3. Data model (target)

### 3.1 Concept graph (new static data + one new state field)

A **concept** groups questions and carries soft prerequisite edges. Shipped as
static data alongside the question bank (editable, like `questionBank.ts`):

```ts
interface Concept {
  id: string;
  name: string;
  summary?: string;          // one line, for the card + map tooltip
  books: string[];           // source books/tags this concept draws from
  prereqs: string[];         // soft edges — concept ids that ideally come first
}
```

Each **question** gains two fields (added to `KnowledgeItem`):

```ts
conceptId: string;
depth: 'recall' | 'apply' | 'defend';   // the 3-rung ladder, §6
```

`Concept.prereqs` are **advisory only** — they order recommendations and drive the
map, they never gate access (§5.3).

### 3.2 FSRS card state (replaces SM-2 `SrsEntry`)

```ts
interface FsrsEntry {
  due: string;          // YYYY-MM-DD, next scheduled review
  stability: number;    // S — days until recall prob. hits the retention target
  difficulty: number;   // D — 1..10, how hard this item is for *this* learner
  lastReview: string;   // YYYY-MM-DD of the last grade
  reps: number;         // successful reviews
  lapses: number;       // times it was forgotten (graded Again)
  state: 'new' | 'learning' | 'review' | 'relearning';
}
```

`normaliseEntry` gains a migration path: a legacy `{ ivl, ease, n }` seeds an
`FsrsEntry` by treating `ivl` as the initial stability and mapping `ease`→`D`
(clamped), so no history is lost and no re-learning wall appears on upgrade.

### 3.3 Config

```ts
interface FsrsConfig {
  requestRetention: number;   // target recall prob. — default 0.90
  maximumInterval: number;    // cap, days — default 365
  weights: number[];          // FSRS parameter vector (see §4)
}
```

`KnowledgeState` itself is unchanged except `srs: Record<string, FsrsEntry>`. The
progress readout (§7) is **derived from `log` + `srs` + the concept graph** — no
new persisted denormalized fields, so there's nothing to keep in sync.

---

## 4. FSRS — the memory model

**Adopt FSRS (Free Spaced Repetition Scheduler)** — the current default in Anki —
in place of SM-2. Where SM-2 multiplies an interval by an "ease" number, FSRS
models three real quantities per card:

- **Difficulty `D`** (1–10): how hard the item is for this learner.
- **Stability `S`** (days): how long until recall probability falls to the target.
- **Retrievability `R`** (0–1): probability of recalling it *right now*.

**Forgetting curve** (FSRS-4.5): for `t` days since the last review,

```
R(t) = (1 + F · t / S) ^ (-0.5),     F = 19/81 ≈ 0.2345
```

By construction `R = 0.90` exactly when `t = S`. So **stability is the interval at
which you'd have a 90% chance of recall.**

**Next interval** to land on the target retention `Rd`:

```
I(Rd, S) = (S / F) · (Rd^(-2) − 1)      // = S when Rd = 0.90
```

**On each grade**, FSRS updates `S` and `D` via its standard update functions
(post-recall stability grows with `S`, `R`, and inversely with `D`; a lapse drops
`S` to a post-lapse stability; `D` drifts toward the graded difficulty). We do
**not** re-derive these — we adopt the published FSRS default parameter vector as
`weights`, then optionally **personalize** by fitting `weights` to the user's own
`log` once there's enough history (FSRS supports this; it's a later optimization,
not a blocker).

**Library, not hand-roll.** Per the working agreement (prefer established
libraries), use **`ts-fsrs`** (maintained, deterministic) behind a thin pure
adapter that (a) injects "now" as an explicit argument for testability and (b)
maps our grades. Zero-dep fallback: a ~100-line in-repo FSRS-4.5 if we want no new
dependency — decide at build time. Either way the seam is one pure function:

```ts
schedule(prev: FsrsEntry, grade: Grade, now: string, cfg: FsrsConfig): FsrsEntry
```

**Grade mapping.** FSRS expects 4 grades. Move the rating UI to the native four —
**Again / Hard / Good / Easy** — and derive a display mastery from state. Migrate
the historical 1–5 log: `1→Again, 2→Hard, 3→Good, 4→Good, 5→Easy`.

---

## 5. The growth queue — what to study today

Each session assembles **one list** by blending four streams. This is the heart of
"optimize for growth."

### 5.1 The four streams

1. **Due reviews** — cards whose `R` has fallen below `requestRetention` (FSRS
   says they're slipping). Protects **retention**. Highest priority, but **capped**
   (§5.2) so reviews never crowd out all growth — except *critically overdue* cards,
   which are always included.
2. **Frontier concepts** — concepts you haven't started whose prereqs are
   sufficiently met (§5.3). Introduces their **recall** questions. Drives
   progression. Ordered by prereq-readiness, then by **unlock centrality** (how
   many downstream concepts this one gates — learn the load-bearing ones first).
3. **Depth-ups** — concepts already *solid* at their current rung get the next
   rung's questions (recall→apply→defend). This is **depth**, and in Phase 3 it's
   where AI-generated questions enter (§9).
4. **Weak spots** — low-stability or recently-lapsed cards get extra, deliberate
   reps (optionally reworded). Targeted practice on what's shaky.

### 5.2 Session assembly (pure, testable)

```
budget      = session size (time via item.mins, or a card count)
reviewCap   = 0.60 * budget            // reviews get at most 60%, tunable
growthMix   = { frontier: .5, depth: .3, weak: .2 }   // split of the rest

due      = dueCards(state, today) sorted by urgency (overdueDays / S)
critical = due where overdueDays is large           // always included
queue    = critical ++ take(due − critical, reviewCap − |critical|)

remaining = budget − |queue|
frontier  = recallQs(frontierConcepts) ordered by readiness, then centrality
depthUps  = nextRungQs(conceptsSolidAtCurrentRung)
weak      = lowStabilityOrLapsedCards()
queue    += fill(remaining, growthMix, {frontier, depthUps, weak})

return interleave(queue)   // reviews seeded through, not a wall up front
```

Every item carries a **reason tag** for the UI: `review`, `new · builds on X`,
`go deeper`, `weak spot`.

### 5.3 Guided, never locked (Albert's hard requirement)

Prerequisites **only** (a) order frontier recommendations and (b) show a soft note
("builds on *X*, which is shaky"). **Nothing is ever locked.** A concept is on the
frontier when its prereqs are ≥ *recall-solid*, but a below-frontier concept is
still fully reachable on demand.

**Cram / interview mode** is a first-class entry: pick any concept, topic, or book
and it assembles a focused session **right now** — that concept's questions across
all rungs, plus a quick check of its immediate prereqs — ignoring the normal queue
entirely. This is the "I have an interview tomorrow on X" path, and it never cares
what's "unlocked."

---

## 6. Concept mastery & the depth ladder

**Depth ladder (interview-anchored, 3 rungs):**

| Rung | Question asks | "Solid" means |
|---|---|---|
| **Recall** | State / define it | you reliably reproduce it |
| **Apply** | Use it to solve a concrete problem | you can wield it |
| **Defend** | Explain the tradeoffs, hold up under follow-ups | interview-grade |

**Question "retained":** `R_q ≥ requestRetention` **and** `S_q ≥ 7d` (past the
learning hump), from its `FsrsEntry`.

**Concept rung "solid":** ≥ 80% of that concept's questions *at that rung* are
retained (fraction, not all, so one stubborn card doesn't block a concept).

**Concept status** = highest solid rung:
`not-started → learning → recall → apply → defended`.

**Prereqs "met"** for frontier purposes: every prereq concept is ≥ `recall`. (Soft
— see §5.3.)

### 6.1 Deriving the graph (AI drafts, you correct)

One-time build step, re-runnable: an AI pass (Opus via the existing OpenRouter
proxy) reads the 10 books / question tags and proposes (a) a concept list, (b)
prereq edges, and (c) a `conceptId` + `depth` for each existing question. Output is
a reviewable data file (`conceptMap.ts`) that Albert corrects by hand. The map
ships static and stays editable; it is **not** regenerated at runtime.

---

## 7. Progress readout — "am I actually growing?"

The gap Albert cared about most. A compact header on the list view, all **derived**
from `log` + `srs` + graph:

- **Stable knowledge** (the headline): `Σ_concepts statusWeight(c) · retentionFactor(c)`
  with `statusWeight = {learning:0, recall:1, apply:2, defended:3}`. One number
  that should climb week over week. Trended from `log` (recompute historical
  states by replaying the log, or snapshot daily).
- **Retention** (are you remembering?): rolling actual success rate (grade ≥ Good)
  over the last N reviews vs `requestRetention`. Above the line = healthy.
- **Coverage**: concept counts by status (not-started / learning / solid), as a bar.
- **Depth ladder**: how many concepts sit at recall vs apply vs defended.
- **This week**: `+N concepts advanced`, `+X stable-knowledge`, `streak`.

These make "is progress happening?" answerable at a glance — the thing that does
not exist today.

---

## 8. Layout & accessibility

**Primary — "Today's path" list** (the daily driver):

- The growth queue as a clean, keyboard-navigable list. Each row: concept name,
  rung, the **reason tag** (`review` / `new · builds on X` / `go deeper` / `weak
  spot`), est. minutes. Reveal → answer → rate with the four grades.
- The progress readout (§7) as a compact header.
- A **Cram / study-a-specific-topic** entry (search or picker) → §5.3.
- Semantic list markup, real buttons, `aria-pressed` on the grade controls, visible
  focus rings, ≥44px targets, status encoded by **label + shape, not color alone**.

**Secondary — concept map** (orientation, behind a toggle/tab):

- Nodes = concepts colored *and labeled* by status; edges = prereqs; the frontier
  highlighted. Tap a node → its questions + status → can start/cram from there.
- Read-only for learning flow; **every action reachable from the list too**. The
  map has a text/list fallback so nothing is map-only (accessibility).

---

## 9. Phase 3 — generative curriculum (the "build forward" gap)

Once the foundation ships, the AI **grows the curriculum**:

- When a concept goes *solid* at a rung, generate the **next-rung** question that
  builds on it (recall→apply→defend), and occasionally a **cross-link** question
  joining two mastered concepts.
- Generated questions enter the bank tagged `conceptId` + `depth` + `generated:
  true`, flow into the depth-up stream (§5.1), and are FSRS-scheduled like any
  other. Deliberate practice + a curriculum that expands with the learner instead
  of a fixed 99.
- Opus via the OpenRouter proxy; generation is on-demand at the frontier, not a
  background firehose. Guardrails: dedupe against existing prompts, keep the source
  citation, let Albert reject a bad generation (it's removed + not regenerated).

---

## 10. Build order

1. **Phase 1 — Memory model.** Swap SM-2 → FSRS behind the pure `schedule` seam;
   migrate `SrsEntry`→`FsrsEntry` (lossless); move the rating UI to 4 grades. The
   current flat UI keeps working. *Immediate retention win, fully unit-testable.*
2. **Phase 2 — Graph & growth.** Ship `conceptMap.ts` (AI-drafted, human-corrected)
   + question `conceptId`/`depth`; concept-mastery selectors; the four-stream growth
   queue + guided-not-locked + cram mode; the progress readout; the list-primary
   layout + secondary map.
3. **Phase 3 — Generative curriculum.** AI depth-up + cross-link question
   generation (§9).

Phases 1 and 2 are the "optimize for growth" foundation; Phase 3 is the
build-forward layer Albert flagged as the next priority after it.

---

## 11. Testing

- **Pure functions, property-tested** (fast-check), the house style: `schedule`
  (monotonic intervals on repeated Good; lapse resets; `now` always injected),
  concept-mastery aggregation, queue assembly (respects caps + mix; critical
  overdue always present; frontier respects readiness ordering; nothing "locked").
- **Migration**: legacy `{ivl,ease,n}` rows and 1–5 log entries survive the upgrade
  with sane FSRS state (no re-learning wall).
- **FSRS adapter**: golden-vector tests against `ts-fsrs` (or the in-repo impl) for
  a fixed grade sequence + fixed dates.
- **Determinism**: no `Date.now()` inside selectors — `today`/`now` is a parameter,
  same as the existing scheduler.

---

## 12. Open questions / risks

- **`ts-fsrs` vs in-repo FSRS** — decide at Phase 1 start. Library aligns with the
  working agreement; the in-repo option keeps zero deps and total control. Default:
  `ts-fsrs` behind the pure adapter.
- **Concept granularity** — too fine (every fact a concept) makes the graph noisy;
  too coarse hides the depth ladder. The AI draft + human correction pass is where
  this gets tuned; expect a round or two.
- **Stable-knowledge history** — replay-the-log vs daily-snapshot for the trend.
  Replay is exact but O(log); a small daily snapshot is cheaper. Start with replay
  (the log is small), optimize only if needed.
- **Generated-question quality (Phase 3)** — needs the reject path and dedupe from
  day one, or the bank fills with near-duplicates.
