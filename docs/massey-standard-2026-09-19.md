# The Massey Standard — Unified Spec (approved 2026-09-19)

Produced by a four-team, three-stage consensus process (Algorithms, Curriculum/Instruction,
Learning-Science, Design — 4 members each; intra-team consensus → cross-team consensus → build).
Approved by the user with two amendments folded in (see **Amendments**). Homage to William A.
Massey (Princeton '77, queueing theorist, first tenured African-American mathematician in the
Ivy League). **NOT affiliated with or endorsed by Princeton University or Professor Massey** —
a visible, persistent disclaimer must state this.

Verification discipline: every course/pset/solution/paper/blog/link in the resource index was
fetched and confirmed live; unverifiable items were excluded and flagged. Team-composed or
unverified content (real-world-application blurbs, the NP-completeness narrative, all numeric
schedule values) ships behind a reusable "unverified-content" caption until a fact-check pass.

## Frozen decisions (binding)
1. **Source rule** — the "solutions" leg is preferred-but-not-gating. 6.042J and CS106B's core
   projects stay as anchors (no public solution keys); gap documented, mitigated by the
   prove-it-yourself feature + matched problems. Rationale: the check-in scores PRACTICE, never
   correctness.
2. **Companion problems** — reference by name+number + a "Search on [platform] →" action; never
   render an unverified LeetCode/Codeforces link as verified. MIT psets + the Codeforces API are
   the verified backbone.
3. **Today-surface order** — the brief's LITERAL 1–6 order; the two reading surfaces LEAD, for
   the morning/commute use-case (read on the commute + optionally watch a lecture clip). The
   design team's "decision-cost" reorder is overridden.

## Amendments (user, 2026-09-19)
- **A1 — Feed taste (surface #1):** community readings target deep systems / distributed-systems
  engineering and applied CS-theory/math-in-production, from sharp individual engineers +
  premium company eng blogs (exemplars: `tj-zhang.com/blog/react-for-systems-engineers`,
  `blog.cloudflare.com/saving-100-tb-of-ram-with-math`). **Drop dev.to**; HN (Algolia API,
  CORS-friendly) is the discovery engine; maintain a **curated, fetch-verified allowlist** of
  Cloudflare-tier eng-blog domains that rank up; optional topic-alignment to the day's
  algorithm/pillar with a why-chosen tie-in line. No fabricated sources.
- **A2 — Elevate Stanford Statistics:** the user is taking Stanford Intro to Statistics NOW to
  pass a WGU stats course. It is a HIGH-PRIORITY CURRENT course featured daily in surface #4;
  do NOT defer its regression/ANOVA modules (the Stage-2 default). Priority sits above the normal
  ungated-spine cadence until the WGU course is passed.

---

## Overview
A single, continuously scrollable **Today surface**, built as a REFORM of the shipping
"Princeton Theorist" tracker (`StudyTracker.tsx` + `studytracker.css`, scoped under `.pt-root`;
the masthead already reads "The Massey Standard"). The internal Today + Library sub-tabs merge
into one scroll of six cards in the literal 1–6 order; the glance strip (XP/level/weekly ring)
sits above card #1; Playbook stays the sole secondary tab. Scores PRACTICE only — the existing
0/1/2 scorecard, five meters, XP/level ladder, and weekly-session ring stay intact, elevated not
replaced. One genuinely new feature: the 3-tier "prove it yourself."

## The six surfaces (literal 1–6 order)
**#1 Community readings** — `FeedSection`. HN-driven per A1 (dev.to dropped, curated allowlist,
taste-ranked, optional topic-alignment). Fully readable in place. Each item's `ReadingCard`
carries one required short-text field (why-chosen / annotation), disabled-until-non-empty
(ProofJournal contract), deferrable within the day, pending↔answered indicator; earns check-in
credit on submission. Topic-agnostic (no unit chip).

**#2 Princeton theory reading** — `PrincetonGroup` / `princetonTheory.ts` (NOT PapersSection).
The group's current reading, readable in place; same single deferrable ReadingCard field. No unit
chip (content isn't tagged to the 13-topic spine; don't build a sync that doesn't exist).

**#3 Algorithm of the day** — `AlgoOfDay` (flip `defaultOpen` false→true). One card, two zones:
- **Exposition zone** — template parts 1–3: intuition + worked micro-example; formal
  statement/loop-invariant + correctness; real-world applications (TEAM-COMPOSED, captioned).
- **Prove-it zone** — parts 4–5: the fetch-verified 6.046J Lecture-14 five-stage guided-proof
  scaffold; the three prove-it-yourself tiers, inline.
The **optional-watch** lecture segment rides on part 1 (intuition), styled as a verified-resource
pill + media glyph (never the search-action style). A "Currently: … (course)" unit chip sits on
THIS card only, from the topicIndex table. Production-first by design.

**#4 Courses of the day + psets + companion problems** — `CurriculumSection`. Shows the cursor's
current course(s)/pset. Each `CoursePsetRow` gains: (1) a pillar-vs-spine lock badge
(gated/always-on); (2) verified-link vs search-action pill split; (3) a **Tier-C-only**
ProofJournal-variant on the 6.042J and CS106B rows (the no-solutions gap). Companion problems =
name+number + "Search on [platform] →", deduped via the problems-surfaced-today registry.
**Stanford Statistics is pinned high here per A2.**

**#5 Princeton BSE daily schedule** — the schedule Collapsible (renders `SCHEDULE`, b1–b15).
Pure descriptive copy; carries verbatim "stylized cadence, not a verified Princeton artifact" +
the numeric-synthesis disclaimer. Ends the stylized day on light retrieval, never new hard
material.

**#6 The check-in** — the scorecard (0/1/2) + five meters + XP bank + weekly-session ring + level
ladder. Scores PRACTICE only. Unrated ≠ zero (already true in code: absent key = unrated,
explicit 0 = Missed).

The six-surface scroll order is INDEPENDENT of the internal block schedule (surface #5's content)
— the user can read #1/#2 and watch #3's clip on the commute regardless of block timing.

## Curriculum — four pillars + two mandatory parallel spines
- **P1 Math maturity** (Day 1): 6.042J (discrete/proofs) → 18.01 → 18.02 → 6.041 (prob) →
  **Stanford Intro to Statistics**; **18.06 linear algebra in parallel from Day 1**; 18.05 as a
  solutions self-check. Per A2, Stanford Stats is elevated to a current daily priority (full
  course, no deferral).
- **P2 Deep C++** (Day 1): Stanford CS106B (SEE) anchor + CS106L. 6.172 EXCLUDED (its OCW page is
  C, not C++). 6.096 supplement only. Canonical URL = see.stanford.edu.
- **P3 Algorithms-with-proofs** (gates ~wk3 behind 6.042J induction/graphs + CS106B
  pointers/recursion/ADTs): MIT 6.006 → 6.046J, walked in the 13-topic order. COS 423 = proof
  supplement. COS 226 = slides only, never lectures/solutions.
- **P4 Interview drilling** (terminal, wk3+): USACO Guide + Codeforces primary;
  seanprashad/leetcode-patterns is the only verified LeetCode/Grind75 substitute.
- **Spine A — Microsoft Python Developer** (Coursera, 6 courses): 2–3×/week, ungated, from Day 1.
- **Spine B — Stanford Intro to Statistics**: elevated per A2.

**Cursor (new data contract):** `{topicIndex, matchedLecture, courseCode, psetStatus}`, owned/
persisted/advanced by Curriculum (extends the synced `theorist` store). Blocked-then-interleaved
PER COURSE (first cursor touch = scaffolded single-subject pass; later touches interleave-
eligible). The ~wk3 P3 gate is the sole advance-rate control. Algorithms owns the frozen 13-topic
order + a static `topicIndex → {course, matchedLecture, pset}` table; Curriculum's cursor advances
through it but never reorders it. Surface #3 keys off topicIndex; surface #4 off matchedLecture.

## Algorithm-of-the-day
**13-topic spine (frozen order):** 1 Sorting (6.006) · 2 Divide-and-conquer (6.006; stretch
6.046J L2–4) · 3 Hashing (6.006) · 4 Graph search BFS/DFS (6.006) · 5 Shortest paths
Dijkstra/Bellman-Ford (6.006) · 6 Greedy + exchange-argument (6.046J L1) · 7 DP (6.006) · 8 MST
Kruskal/Prim (6.046J L12) · 9 Amortized analysis (6.046J L5) · 10 Randomized (6.046J L6–8) ·
11 Max-flow/min-cut (6.046J L13) · 12 String algorithms: tries/KMP/Rabin-Karp (Coursera Part II —
MIT gap) · 13 NP-completeness / P-vs-NP capstone (Coursera Part II Module 14 narrative; 6.046J L16
rigor).

**5-field template** (plain English, every acronym expanded, freshman-legible): (1) intuition +
worked example [+ optional-watch]; (2) formal statement/loop invariant + correctness (CLRS
Init/Maintenance/Termination — corroborated-not-fetched, label when quoted); (3) real-world
applications (team-composed, captioned, needs fact-check); (4) guided proof path (6.046J L14
scaffold: Understand → Try → Work Out Details → Communicate → Reflect); (5) prove-it-yourself.

**Prove-it-yourself — 3 inline tiers (expand-in-place on the "raised" elevation tier, NEVER a
modal):** A `ProofTierMC` (autogradable flaw-spotting MC); B `ProofTierTrace` (autogradable
predict-then-reveal trace — if client-side trace proves infeasible at build, ESCALATE to
architect, never silently downgrade to C); C `ProofJournal-variant` (self-graded free-text
reveal-and-compare, scores completion only). Tiers A/B are topic-level in AlgoOfDay; only Tier C
also appears on the 6.042J + CS106B course rows. Never marketed as autograded beyond A/B.

## Design system
- **Palette:** adopt `.pt-root` tokens verbatim (studytracker.css L8–30), dual-gated on
  prefers-color-scheme AND `:root[data-theme]`.
- **P0 fixes (ship with any touched component):** (1) focus ring — replace the failing
  `--accent2` ring (~2.5:1, studytracker.css L147) with a dual-tone halo ≥3:1 on any backdrop;
  migrate ProofJournal inputs L298 `:focus`→`:focus-visible`. (2) accent-as-text — add a darker
  "text-safe" orange token for small accent text (current #E77500 ~2.8:1 fails 4.5:1); keep
  #E77500 for large/bold/white-on-accent/dark. --good ~4.69:1 barely passes — don't darken
  --paper without rechecking. Exact hexes need a WebAIM lock.
- **Type:** formalize the serif track (14.5/15/16/18/19/20/24/30/34/44) coexisting with the sans
  scale.
- **Spacing:** partial graft — adopt app.css `--sp/--r` where pt-root already matches (4/8/12/16);
  keep off-scale tuned values (6/9/10/13/14/18/20/22/26) as named supplementary tokens.
- **Motion:** graft app.css `--dur/--ease/--stagger`; adopt app.css's reduced-motion kill-switch
  (nulls animation AND transition) — replacing the pt-root override (L337, transition-only) —
  BEFORE any @keyframes.
- **Elevation:** add a 3-tier shadow ladder (resting/raised/overlay); light tiers as shadows, not
  surface-lightening. Prove-it tiers render on "raised"; "overlay" reserved for page-blocking UI.
- **Danger token:** promote `.band.red` inline #A23B2E/#CE7C6E to named `--danger/--danger-border`
  (Princeton maroon, not app.css --deficit); contrast-check vs card + paper.
- **Components to extract** (wrap existing classes verbatim; only Collapsible.tsx is real today):
  ScoreRow, MeterBar, ScheduleRow, ReadingCard (unify feed-item + ptg-paper + the deferrable
  production field), AlgoCard, CoursePsetRow, ProveItYourself → {ProofTierMC, ProofTierTrace,
  ProofJournal-variant}.
- **States contract** (complete before ship): default/hover/focus-visible/disabled/loading/empty/
  error + pending-vs-answered. Add disabled visuals to ghost/pill/tick/segmented; add hover to
  the Collapsible header; add PapersSection empty state; loading/error on FeedSection only; new
  status regions use `aria-live=polite`.
- **IA:** merge Today + Library into one continuous scroll (literal 1–6); Playbook stays the sole
  secondary tab; every sub-section lives inside one card. Two-column layout above 620px.
- **Verified vs unverified pills must never share a visual class** (enforces frozen decision 2).
  One reusable unverified-content caption component (producing team supplies copy).

## Daily schedule (team synthesis — LABELED, never "the research says X")
~8h, do-heavy (~75–80% active; only ~3–4h near-maximal deliberate practice, calibrated by
Macnamara & Maitra 2019 ~26% variance; no verbatim Ericsson quote in copy). 50–60min blocks +
~10min breaks; proof block ~75min. Warm-up retrieval → B1 algorithm exposition (#3) → B2 (~75)
guided proof + prove-it (#3) → B3 course first-pass + pset (#4) → lunch → interleaved warm-up →
B4 (~90) interleaved cross-subject drill + CF/LC + backlog (#4) → B5 Princeton reading →
hand-derivation (#2) → B6 community readings + written reflection (#1) → B7 (~20) consolidation +
check-in + cold "explain to a beginner" (#6). Blocks 3–4 are pillar-agnostic containers filled by
the cursor. Spaced cadence: expanding intervals (~24–48h → day 6–7 → 2–3wk → 30d → monthly+; needs
an SM-2/Leitner scheduler). Interleaving is WITHIN-block, new material gets one blocked first pass
before entering rotation. Ends on light retrieval before a protected sleep window.

## Check-in
Reuses the shipping check-in (elevated tokens only): 10-item 0/1/2 scorecard (the single daily
input), five meters via `meterPct`, `dayXP` = Σ(score×SCORE_UNIT) + `day.events`, seven-level
ladder, reversible banking, weekly-session ring (WEEKLY_TARGET 4) instead of a punishing streak.
Prove-it Tier A/B (correct) + Tier C (completion) credit an algoStudied-class event; ReadingCard
field fills credit their reading on submission (Tier C never credits correctness). The required
weekly review-only lighter day maps onto the existing Full/Light toggle + auto-Light Sabbath
window (`inSabbathWindow`), and must not collide with the user's standing Sabbath rest window.

## Build plan
**Prereq defect fixes first:** focus ring; accent-as-text token; motion tokens + kill-switch;
elevation ladder; danger token.
**Then:** component extraction + states contract → data-layer tickets (cursor object; SM-2/Leitner
scheduler; problems-surfaced-today registry — none exist today) → new features (prove-it-yourself
3 tiers; ReadingCard production field; feed refinement per A1; surface merge; unit chip;
verified/unverified pill split) → labeling/fact-check pass. Reviewer panel + merge-reviewer +
test-verify per the team protocol. Naming: the merged StudyTracker scroll is the "Standard
surface" internally (disambiguate from app-level `today/TodayTab.tsx`).

## Open items (architect / user; none block starting)
1. WebAIM hex lock for text-safe orange, focus halo, danger maroon.
2. Harvard STAT 110 — durable 403; enrichment-only pending a human browser check; never a graded
   pillar.
3. Real-world-application blurbs + NP narrative — team-composed; stay captioned until a fact-check
   pass; CLRS framing labeled corroborated-not-fetched when quoted.
4. Tier-B client-side trace feasibility — escalate to architect if infeasible.
5. Deferred spine questions: 14th "reductions" day before NP? cite algs4 as a strings backup?
6. 6.042J correctness signal: separate solutions manual vs prove-it + matched problems (frozen
   decision 1 permits the latter).
7. Elevation-ladder audit: confirm no other light-canvas feature already ships one.

## Verified resource index
| Resource | URL | Role (L/P/S = lectures/psets/solutions) |
|---|---|---|
| MIT 6.006 Intro to Algorithms (Spring 2020) | https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/ | P3 + Surface #3 spine, topics 1–7; watch source. L✓P✓S✓ (no strings/MST) |
| MIT 6.046J Design & Analysis (Spring 2015) — assignments | https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2015/pages/assignments/ | P3 + Surface #3, topics 6,8–11,13; 10 psets w/ solutions. L✓P✓S✓ |
| MIT 6.046J Spring 2015 calendar | https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2015/pages/calendar/ | Surface #3 lecture-order (matchedLecture) reference |
| MIT 6.046J Lecture 14 "Interlude: Problem Solving" (Spring 2012 PDF) | https://live.ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2012/16e5c6a1dea0d1c210b3597e2eb4786a_MIT6_046JS12_lec14.pdf | Surface #3 template part 4 scaffold source |
| Coursera Algorithms Part I (Sedgewick & Wayne, Princeton) | https://www.coursera.org/learn/algorithms-part1 | Princeton-homage video + optional-watch; NO official solutions |
| Coursera Algorithms Part II | https://www.coursera.org/learn/algorithms-part2 | Surface #3 SOLE verified source for topic 12 (strings) + topic 13 NP narrative. NO solutions |
| Princeton COS 226 (fall25) | https://www.cs.princeton.edu/courses/archive/fall25/cos226/ | Slides/demos ONLY — never lectures/solutions |
| MIT 6.042J Mathematics for CS (Fall 2010) — assignments | https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-fall-2010/pages/assignments/ | P1 anchor + Surface #4 Tier-C row. L✓P✓S✗ |
| MIT 18.06 Linear Algebra (Spring 2010, Strang) | https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/ | P1 parallel Day 1. L✓P✓S✓ |
| MIT 18.01 Single Variable Calculus (Fall 2006) | https://ocw.mit.edu/courses/18-01-single-variable-calculus-fall-2006/ | P1. L✓P✓S✓ |
| MIT 18.02 Multivariable Calculus (Fall 2007) | https://ocw.mit.edu/courses/18-02-multivariable-calculus-fall-2007/ | P1. L✓P✓S✓ |
| MIT 6.041 Probabilistic Systems (Fall 2010) | https://ocw.mit.edu/courses/6-041-probabilistic-systems-analysis-and-applied-probability-fall-2010/ | P1 probability. L✓P✓S✓ |
| MIT 18.05 Intro Probability & Statistics (Spring 2022) | https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/ | P1 self-check pair for 6.041. L✗P✓S✓ |
| Stanford Intro to Statistics (Coursera, Walther) — MANDATORY, ELEVATED (A2) | https://www.coursera.org/learn/stanford-statistics | P1 capstone + featured daily; 12 modules, 66 videos, 14 graded |
| Stanford CS106B (SEE) | https://see.stanford.edu/Course/CS106B | P2 canonical C++ anchor + Surface #4 Tier-C row. 27 videos; 7 projects (no solutions); practice exams w/ solutions |
| Stanford CS106L | https://web.stanford.edu/class/cs106l/ | P2 modern-C++ supplement (slides + A1–A7) |
| Microsoft Python Developer (Coursera) — MANDATORY | https://www.coursera.org/professional-certificates/microsoft-python-developer | Spine A (2–3×/wk, ungated). 6 courses |
| MIT 6.096 Intro to C++ (IAP 2011) — assignments | https://ocw.mit.edu/courses/6-096-introduction-to-c-january-iap-2011/pages/assignments/ | P2 supplement (no video). L✗P✓S✓ |
| Princeton COS 423 Theory of Algorithms (Spring 2018) | https://www.cs.princeton.edu/courses/archive/spring18/cos423/ | P3 Princeton-branded proof supplement (no video/solutions) |
| Stanford Algorithms Specialization (Coursera, Roughgarden) | https://www.coursera.org/specializations/algorithms | Secondary algorithms video track |
| USACO Guide | https://usaco.guide/ | P4 interview-drill primary (six-tier + solutions) |
| Codeforces | https://codeforces.com/ | P4 daily problems; problems-registry backbone (API reachable); companion = name+number + search only |
| seanprashad/leetcode-patterns (GitHub) | https://github.com/seanprashad/leetcode-patterns | P4 verified LeetCode/Grind75 substitute |
| MIT 6.854J Advanced Algorithms (Fall 2005) | https://ocw.mit.edu/courses/6-854j-advanced-algorithms-fall-2005/ | Optional stretch problem bank |
| MIT 18.404J Theory of Computation (Fall 2020, Sipser) | https://ocw.mit.edu/courses/18-404j-theory-of-computation-fall-2020/ | Playbook enrichment watch |
| Barak, Introduction to Theoretical Computer Science | https://introtcs.org/ | Playbook enrichment reading |

**Surface #1 feed exemplars (A1 taste anchors):** `https://tj-zhang.com/blog/react-for-systems-engineers/`,
`https://blog.cloudflare.com/saving-100-tb-of-ram-with-math/`.
