# Learn by Teaching — the PhD Teaching Simulator (Stage 0 spec, 2026-09-20)

A feature inside Meridian's Massey Standard instrument. The user teaches the day's curriculum
topic, is graded on the lecture, then defends it in a simulated **office hours** where four AI
students ask probing, content-specific questions. Grounded in the **protégé effect**: you have
not mastered a topic until you can teach it clearly and defend it under questioning.

> **Note on "the daily curriculum topic":** the default topic is the **Massey Standard
> algorithm/concept of the day** (`algoOfDay()` from `src/features/studytracker/algorithms.ts`).
> Everywhere this doc says "Meridian curriculum item" it means the Massey algo-of-the-day.

**Core principle:** force articulation of the generative "why" and retrieval under pressure.
The **office-hours defense is the highest-value component** — build it best. Score the
PRACTICE, never frame as a grade; a low defense score is feedback about what to restudy.

## Curriculum integration
- Default topic = today's Massey algo-of-the-day; pre-load it.
- Generate the lesson FROM MEMORY (generate-then-check): the plan seeds with the topic
  identity only (`topicId`/`topicName`/audience) and leaves objectives/arc/definitions/
  examples/anticipated-question BLANK, so the user retrieves them rather than editing
  pre-supplied text. The item's own material (`idea`, `invariant`, `correctness`,
  `plain[]`, `cpp`/`python`, `pitfalls[]`, `oneLiner`/`category`) is available behind an
  opt-in "Peek at your notes" reveal — visible only when the user chooses to look.
- Teaching the day's topic IS the day's mastery check. Manual topic override allowed.

## The five-stage loop
Designer → Present → Evaluate Lecture → Office Hours → Scorecard. MVP = all five, PRESENT as
typed text, no recording. (Recording is v2; spoken defense is v3.)

## Lecture-grading rubric
AI grades the lecture TRANSCRIPT. Each dimension 0/1/2; total /12. Mandatory transcript-citing
feedback for any score < 2. Never a holistic "rate 1–10".
1. **Correctness** — 2: all definitions/claims/proofs/code precise and error-free (state "no
   errors" or cite each). 1: minor imprecision / one non-fatal error. 0: a definition/proof/
   claim is wrong (cite it).
2. **Explains the why** — 2: every key rule justified from a definition/first principle
   (generative root given). 1: some justification but ≥1 key idea asserted without its why.
   0: rules presented as things to accept.
3. **Clarity for the stated audience** — 2: the target-level person could follow it; every
   acronym/term expanded on first use. 1: mostly clear but ≥1 unexplained jump/undefined term.
   0: assumes knowledge the audience lacks.
4. **Structure / arc** — 2: intuition → formal → application (or a stated arc); motivation
   precedes formalism. 1: has structure but a segment out of order / motivation missing. 0: no
   discernible arc.
5. **Use of examples** — 2: ≥1 concrete worked example (code or worked proof) illustrating the
   abstract idea. 1: example present but underexplained/trivial. 0: none.
6. **Pacing / compression** — 2: fits target length, no bloat, no critical omission. 1: notably
   too long/short or a segment rushed/padded. 0: wildly off or omits core content.

Bands: 11–12 Excellent · 8–10 Solid · 5–7 Developing · <5 Rework.

## AI-student personas (office hours)
Each asks EXACTLY ONE question per round, escalating; all read the user's ACTUAL transcript and
target its specific content.
1. **MAYA — Confused Beginner.** Targets a step the lecture moved through too fast; the
   mechanics of something assumed obvious. Tests re-explaining a fundamental lower.
2. **DEVIN — Sharp Student.** Targets a claim/boundary: "does this still hold if…" probing the
   limits of a stated claim. Tests knowing the scope of one's own claims.
3. **PRIYA — Edge-Case Skeptic (MANDATORY: targets something the lecture did NOT cover).**
   empty input, n=0, tight-vs-loose, a counterexample. Exposes the present-vs-understand gap.
4. **PROFESSOR CHEN — Deep Questioner.** Targets why-is-it-defined-this-way / the generative
   root or deeper theory: "Why is X defined/built this way rather than [alternative]? What
   breaks?"

### Question-generation requirements (make-or-break — enforced in the prompt)
(a) each question must quote/reference a specific part of the user's lecture (or, for Priya, a
    specific thing it OMITTED);
(b) no question may be answerable by simply repeating a sentence from the lecture — it must
    require going beyond what was said;
(c) difficulty escalates Maya → Devin → Priya → Chen.

## Defense-grading rubric (per answer, 0/1/2; mandatory feedback stating what a full answer
would include)
- **2 ADDRESSED:** directly answers the specific question, correct, adds reasoning (not just the
  fact); Priya's edge case handled or honestly reasoned; Chen's "why" engaged.
- **1 PARTIAL:** addresses part, or correct but hand-wavy, or misses a subtlety.
- **0 HAND-WAVED / WRONG / DODGED:** restates the lecture without answering, incorrect, or
  deflects.
Aggregate /8 → feeds the Defense meter.

## Scorecard (reuse Meridian's scorecard/XP/meter/streak)
- **Teaching-Quality meter** = lecture score / 12.
- **Defense meter** = defense score / 8.
- **XP** banked per completed stage (Designer + Present + Evaluate + all 4 answers + reflection),
  via the synced tracker's `creditEvent` (day-scoped, idempotent max-merge). Mapping:
  lecture → `algoStudied` (20); defense (retrieval under pressure) → `retrieval` (50);
  reflection → `journalSave` (10).
- **Streak:** a completed loop lights the day (activity → `todayIsSession`); never punishes;
  recovery counts (same as the Massey instrument).
- **Reflection prompt** ending the loop: *"Which office-hours question exposed a gap I didn't
  know I had?"*
- **Philosophy:** score the PRACTICE, never a grade. A low defense score is feedback about what
  to restudy, not a failure.

## Data model
```
LessonPlan { topicId (FK to algo-of-day id), targetAudience, objectives[], arc[],
             definitions[], examples[], anticipatedHardQuestion }
LecturePresentation { lessonPlanId, transcript }   // typed for MVP; audio+transcript in v2
LectureEvaluation { presentationId, rubricScores[6], perDimensionFeedback[6], total }
OfficeHoursSession { presentationId, questions[4] {persona, text, targetsUncovered:bool},
                     answers[4], answerScores[4], perAnswerFeedback[4] }
TeachingLoopResult { date, teachingScore, defenseScore, xpEarned, reflection }
```

## MVP build order (office hours is the priority)
1. **Lesson Designer** — load the day's topic (or manual override) + target audience → produce
   the structured LessonPlan (objectives, arc, definitions/proofs/code, the pre-planned hardest
   anticipated question).
2. **Present (typed)** → **Lecture Evaluator** (grade the written lecture against the rubric).
3. **AI Office Hours** (4 personas + defense grading) — get probing-question quality right first.
4. **Scorecard + reflection** (Meridian pattern).

## Acceptance test (the gate)
Run the loop on the seed lecture (Big-O, below) and verify: (a) Priya's question targets
something genuinely NOT in the lecture; (b) NO question is generic enough to apply to a different
topic; (c) at least one question cannot be answered by quoting the lecture. If any fail, the core
value is broken — fix before shipping. Because the AI runs through the proxy (creds live only in
the app/localStorage), the live gate is run in-app; a structural test asserts the prompt encodes
requirements (a)–(c) and the persona order/Priya-uncovered flag.

## Seed / test data (Big-O)
- **topic:** "Big-O notation and asymptotic analysis"
- **targetAudience:** "a Princeton CS freshman who can code but has never seen formal asymptotic
  analysis"
- **objectives:** state the formal ∃c,n0 definition; explain WHY each part exists; derive the
  rules (drop constants / lower-order terms) from the definition; prove a simple Big-O claim.
- **arc:** raw runtimes lie → build the definition piece by piece → derive the rules → code
  example (linear vs binary search) → proof exercise (n² is NOT O(n)).
- **definitions:** f(n)=O(g(n)) iff ∃ c>0, n0>0 s.t. f(n) ≤ c·g(n) for all n ≥ n0.
- **examples:** O(2n)=O(n) (c=2,n0=1); 3n²+5n+100=O(n²); linear vs binary search op counts.
- **anticipatedHardQuestion:** "If Big-O is just an upper bound, isn't every algorithm also
  O(n!)? So why is it useful?" (doorway to Big-Theta / tight bounds)

Expected office-hours behavior on the seed:
- MAYA: break down why the constant c can be "any" constant (a step assumed obvious).
- DEVIN: "You proved 3n²+5n+100 is O(n²) — is it also O(n³)? Both? Which is 'right'?"
- PRIYA (must target something NOT covered): what n0 is actually doing / a case where without n0
  the definition fails — OR the tight-vs-loose distinction the lecture didn't state.
- CHEN: "Why define Big-O as an upper bound at all, rather than exact growth? What does that buy
  and cost?" (pushes toward Θ and Ω).

## Not in scope yet
- v2: screen+audio recording with transcript; AI grades the recorded lecture.
- v3: spoken office-hours answers; full Massey-instrument (synced-store) integration.
MVP persists the loop locally (ORDINARY tier, per-day localStorage), banking XP into the synced
tracker via `creditEvent`.
