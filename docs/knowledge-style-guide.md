# Meridian Question Style Guide

The standard that governs how every study question and answer in Meridian's knowledge graph is written. It drives the Phase 2 rewrite of the whole bank (~350 cards) and the Phase 3 AI question-generator prompt. Follow it literally.

---

## 0. The one-line summary

**Write so that a smart person meeting the term for the first time understands it on the first read.** Keep every fact. Change only whether the reader has to already know the vocabulary to follow along.

---

## 1. The card format (vocabulary for this guide)

Each card is a JSON object. The fields this guide governs:

- **`prompt`** — the question shown first. One specific, answerable thing.
- **`reveal`** — the answer, shown after the reader tries. This is where most of this guide applies.
- **`flow`** — the study mode, either `"flip"` or `"full"`:
  - **`flip`** — a flashcard. A crisp fact or rule you recall in one breath. Usually `"mins": 5`.
  - **`full`** — a teaching card. A concept worth several sentences to build. Usually `"mins": 15`.
- **`mins`** — study-time budget (5 or 15); tracks `flow`.

The other fields — `id`, `tags`, and `src` (`book` + `ref` + `page`) — are **the generator's concern, not this guide's.** One rule that touches writers: **`src` must be page-accurate** — the `ref`/`page` must actually point to where the fact is stated, because Knowledge-tab source lines deep-link to the book PDF at that page. Never invent or approximate a citation.

---

## 2. The pass/fail principle: first-read comprehension

There is exactly one gate every reveal must pass:

> **A smart, motivated reader who has never seen this term before understands it on the first read — without pausing to look anything up, and without reading a sentence twice.**

This is **pass/fail, not a nice-to-have.** A reveal that is technically flawless but assumes you already know what "certificate," "NSPACE," or "diagonalization" means has *failed*, no matter how correct it is. Correctness that doesn't land is not correctness — it's a note-to-self written for someone who already knows the answer.

Why this bar and not a softer one: Meridian's reader (Albert) has said plainly, *"a lot of explanations are lost on me if it is not explained plainly."* Plain English is therefore the primary constraint. Everything else in this guide — rigor, precision, concision — is layered **on top** of first-read comprehension, never traded against it. If you can only keep one property, keep this one.

**Scope of "one read":** the **gist** must land in a single pass at reading speed. The **precise version** (the rigorous rung, §6) may take a careful reader a moment to absorb — it must be *followable without outside lookup*, not necessarily one-glance obvious. We're removing the need to already know the vocabulary, not removing the need to think.

---

## 3. The jargon rule (the heart of the guide)

We are here to **build jargon fluency, not avoid jargon.** The reader wants to walk into an interview fluent in "certificate," "reduction," "PSPACE-complete." So we *use* the real vocabulary — we just never let a term go by naked.

### 3.1 Unpack, never delete

**If a term appears in the source card — especially if the `prompt` names it — keep it and gloss it. Do not replace it with a plainer word.** Swapping "Turing machine" for "program," or dropping "diagonalization" because it's hard, is a **violation of this rule, not an application of it.** The reader is here to *learn* that word. Keep the term, attach the plain meaning: *"a program — formally a Turing machine —"*, *"the self-reference trick (called diagonalization)"*. Add plainer synonyms as *extra* intuition; never as a *substitute* that makes the real term disappear.

### 3.2 Tier the unpack depth

Not every term earns the same treatment. Match effort to the term's role in *this* card:

- **Central concept** (what the card is about) → **full three beats:**
  1. **Stands for** — spell out the acronym or name the symbol.
  2. **What it actually IS** — the plain-English thing behind the name, concretely. The *idea*, not the formal definition restated.
  3. **Why it exists** — the job it does, the problem it solves.
- **Supporting term** (used to explain the central one) → **one-clause appositive gloss.** Set it off with dashes, don't spend a whole sentence: *"NP — problems where a proposed answer is fast to check —"*.
- **Incidental symbol** (`2ᵏ`, `f(x)`, `log n`) → **a 2–4-word inline gloss, no "why."** *"within 2ᵏ steps (that is, up to some step budget)"*. A bare `2ᵏ` with no gloss is still forbidden; a three-beat treatment of it is overkill.

**The technique is the appositive dash-clause:** unpack a supporting term *inside* the sentence that uses it, not in a new sentence before it. This keeps the gloss adjacent to the term and keeps length down.

### 3.3 Rules that follow

- **Never a bare symbol or acronym.** No `NSPACE(s(n)) ⊆ DSPACE(s(n)²)` dropped in raw. Say what it means in words first, *then* you may show the compact form as the "precise version."
- **Unpack on first use, then use it freely.** Once defined in a card, use the term plainly for the rest of that card. Don't re-explain within the same card.
- **Each card stands alone.** Cards are studied in isolation and in random order. A term unpacked in card A is *not* unpacked for the reader of card B. If a term is load-bearing here, unpack it here — even if you've written that gloss before.
- **Prefer the plain word, introduce the jargon as its name.** Lead with the idea, attach the term: "a short proof you can check quickly — the *certificate*." The reader meets the concept first, the label second.

### 3.4 "Preserve every fact" includes the fine print

Simplifying accessibility must not quietly drop content. **Every fact stays — and "fact" explicitly includes:**

- **Every corollary** (e.g. Savitch's "and NL ⊆ DSPACE(log²n)").
- **Every "-complete" qualifier.** Softening "STCON is **NL-complete**" to "STCON is a typical NL problem" is **fact loss, not simplification** — being the *canonical hardest* problem in a class is the entire point of naming it.
- **Every named theorem** (Rice's theorem, the hierarchy theorem, Cook-Levin). Keep the name *and* gloss what it says.
- Every exact bound, condition, and named example in the original.

If a fact is too much for one card, **split it into another card** (§6) — never delete it to hit a length target.

---

## 4. Voice

- **Active voice, present tense.** "A verifier checks the certificate," not "the certificate is checked."
- **Short sentences.** One idea per sentence. Split anything that stacks three clauses.
- **Concrete over abstract.** Name a real example **when it aids first-read comprehension** — especially for the card's central abstract idea. (You don't owe five examples for five classes listed in passing; spend the example on what's hard to picture.)
- **Define, then use.** Never use a term earlier in a sentence than where you gloss it. Order the sentence so the reader has the vocabulary *before* they need it.
- **Humane, not chatty.** Warm and direct, like a sharp friend at a whiteboard. No filler ("Basically," "It's important to note"), no hype, no exclamation marks.
- **Gist first, then the precise version.** The core move for every reveal (§6).
- **Cut hedging and meta.** No "arguably," "in some sense," "as we'll see." Say the thing.

---

## 5. When to use an analogy or a worked example

Albert learns well from a concrete analogy or a tiny worked example. Use one deliberately — where it does real work, not as decoration:

- **Reach for an analogy when the concept is a *mechanism the reader can't picture*** — self-reference, recursion, nondeterminism, "memory is reusable." One clean analogy beats a paragraph of abstraction. Example: the halting-problem contradiction *is* the liar's paradox ("this statement is false") — say so.
- **Reach for a tiny worked example when the concept is a *procedure or a claim about sizes/steps*** — "here's a 3-line program," "on input of length 4 the tape has 4 cells." Small enough to hold in your head (n = 3, not n = 1000).
- **Keep it to one, and keep it short.** An analogy that needs its own explanation has failed. If the example runs longer than the idea it illustrates, cut it down.
- **The analogy must be *true*, not just evocative.** Don't reach for a metaphor that breaks when the reader pushes on it. Flag the limit if there's one worth flagging.
- **Don't force it.** A clean plain sentence beats a strained analogy. Analogy is a tool for the genuinely hard-to-picture, not a tax on every card.

---

## 6. Structure: prompt style and reveal style

### 6.1 Prompt (the question)

- **One specific, answerable thing.** The reader should know exactly what a good answer contains.
- Prefer a real question ("Why does X hold?", "What breaks if Y?") over a topic label ("Binary search.").
- It's fine — often good — to ask for the *idea* or *intuition* rather than the formal proof. Meridian pairs with Math Academy, which owns the derivations; our questions stay applied and conceptual.
- Keep the prompt jargon-light. If it must name a term the reader may not know, that's usually fine — the reveal is about to unpack it — but don't stack three unexplained acronyms into the question.

### 6.2 Reveal (the `full` card) — the gist-first ladder

Every `full` reveal is a ladder the reader climbs:

1. **Gist first.** One or two sentences a first-timer understands completely, in plain words. The sentence they'd repeat to a friend. No bare symbols yet.
2. **The precise version.** Now layer in the rigor — the formal statement, the notation, the exact conditions — each new term unpacked inline per §3.
3. **Why it matters / the tell.** Close with the payoff, the common misconception, or the interview "tell" (the pattern that signals this concept). This is what makes it stick and useful under pressure.

The rigor doesn't leave — it moves to step 2, *after* the reader has intuition to hang it on.

### 6.3 Reveal (the `flip` card) — the ladder, degraded

A `flip` card is a flashcard: the reader wants the crisp answer they'd **say out loud**, not a lecture. Degrade the ladder:

- **Gist** — the recallable answer, in one or two sentences.
- **The one must-unpack term** — glossed inline if the answer hinges on it; drop the standalone "precise version" rung or fold it into a clause.
- **The tell** — the one-line trigger or gotcha, if there is one.

A flip reveal is typically **2–4 sentences.** If a flip card needs the full three-rung ladder to make sense, it's probably a `full` card mislabeled — reclassify it.

---

## 7. Length and what to cut

**Be honest about the trade:** unpacking vocabulary *costs* length. A reveal that glosses every term is often *longer* than the dense original — that's an accepted price for first-read comprehension, not a failure. Do **not** compress by deleting glosses or facts.

Targets (guide, not a hard cap):

- **`flip` reveal:** ~2–4 sentences.
- **`full` reveal:** ~6–12 sentences, depending on how many terms need unpacking. A jargon-dense complexity card lands near the top of that range; a card on a familiar idea near the bottom.
- **Past ~10–12 sentences: SPLIT into two cards.** When a card is doing too much, break the concept across cards — never crush it into unreadable density. Density is not the goal; fluency is.

**Cut:** hedges, meta-commentary, restating the prompt, a second example when one lands, proofs Math Academy owns, and any clause that only makes sense to someone who already knows the answer.

**Keep:** every fact from the original (§3.4), the "why it exists," the misconception, and the one analogy/example that earns its place.

---

## 8. What this does NOT mean

- **Not "dumbed down."** The rigor stays — precise definitions, exact bounds, real theorem names. We remove the *assumption that the reader already knows the vocabulary*, not the substance.
- **Not "avoid jargon."** The opposite: we teach jargon on purpose, because fluency is the goal. We just unpack it on first use.
- **Not baby talk or padding.** Plain ≠ verbose-for-its-own-sake. Short, direct, concrete. A tier-1 reader should find it *fast to read*, not condescending.
- **Not fewer facts.** Same facts, same edges of the knowledge graph. Only the accessibility changes.
- **Not "no symbols."** Symbols are welcome — as the *precise version* in step 2 of the ladder, after the words. We just never lead with a bare symbol.

---

## 9. Format conventions (pick one, be consistent)

A model left to its own devices will mix conventions across 350 cards. Lock these:

- **Powers and subscripts: Unicode superscripts.** Write `s²`, `2ᵏ`, `log²n`, `O(2ⁿ)` — not `s^2`, `2^k`. (Exception: inside a fenced/backtick code snippet, use ASCII `^` as the language requires.)
- **Set relations: words in prose, the symbol only as the precise-version rung.** In the gist, write "sits inside" / "is at least as hard as." When you show the formal chain as the precise version, the symbol `⊆` is fine *with* a plain reading beside it: `L ⊆ NL ⊆ P ⊆ NP ⊆ PSPACE` — tiny memory sits inside guessing-tiny-memory sits inside… Do not open a reveal with a bare `⊆`.
- **Quantifiers:** spell out on first use — "for all (∀)" and "there exists (∃)" — then the symbol is fine.
- **Identifiers and code:** wrap program names, variables, and machine names in backticks (`H`, `D`, `f(x)`, `STCON`). Render a short illustrative program as prose steps or a one-line backtick snippet, not a multi-line code block — reveals are a single JSON string.
- **Emphasis:** bold for the term being defined and for a "tell"; CAPS sparingly for a single contrast word (YES/NO, FIND/CHECK). Don't shout whole clauses.

---

## 10. Before → after (real cards, rewritten to the standard)

Four real complexity cards from `algorithms.json`, plus one `flip`. **Facts are identical — including every corollary, "-complete" qualifier, and named theorem.** Only accessibility changed. Each "what changed" note is a **real diff**, not a reassurance.

---

### 10.1 `a-p-vs-np-15` (`full`) — the reference standard: gloss-free, gloss over delete

**Prompt (unchanged):** *State precisely what P and NP are, using the verifier definition of NP. What is the single most common misconception about NP?*

**BEFORE:**
> P is the class of decision problems solvable by a deterministic algorithm in time polynomial in the input size. NP is the class where every YES-instance has a short (polynomial-size) CERTIFICATE that a deterministic verifier can check in polynomial time — e.g. for SAT the certificate is a satisfying assignment; for 'has a route under budget B' it is the route. Equivalently, NP is what a nondeterministic TM decides in polynomial time (guess the certificate, then verify). P ⊆ NP trivially. P vs NP asks whether every problem whose solutions are easy to CHECK is also easy to FIND. The big misconception: NP does not mean 'non-polynomial' or 'not in P' — many NP problems (all of P) are polynomial. NP is about efficient verifiability. Note the asymmetry: NP guarantees a certificate only for YES-instances; the mirror class for NO-instance certificates is coNP.

**AFTER:**
> The gist: **P is problems you can *solve* fast. NP is problems where you can *check* a proposed answer fast** — even if finding that answer might be slow.
>
> Precisely: **P** ("polynomial time") is the set of yes/no problems a normal step-by-step algorithm can solve in time that grows only polynomially with the input size — like n or n² or n³, not like 2ⁿ. ("Polynomial" is our stand-in for "efficient"; "exponential," for "hopeless at scale.")
>
> **NP** ("nondeterministic polynomial time" — the name is historical, don't read into it) is the set of problems where, whenever the answer is YES, there's a **certificate** — a short proof, small enough to write down in polynomial size — that a normal algorithm can *check* in polynomial time. For **SAT** (deciding whether a boolean formula can be made true), the certificate is a satisfying assignment of true/false values. For "is there a delivery route under budget B?", it's the route itself. (Intuition pump: a finished Sudoku grid is trivial to check even though solving from blank is hard.) The name "nondeterministic" comes from an equivalent picture — a machine that *guesses* the certificate, then verifies it.
>
> Every P problem is trivially in NP (solve it fast, and you can certainly check an answer fast), so P sits inside NP. **P vs NP** asks: *is checking an answer really any easier than finding one?* Nobody knows.
>
> **The myth to kill:** NP does **not** mean "not polynomial" or "impossible." Tons of NP problems are easy — all of P sits inside NP. NP is about *fast to verify*, nothing more. (Asymmetry footnote: NP promises a checkable proof only for YES answers; the mirror class that promises one for NO answers is **coNP**.)

*What changed (diff):* Added a one-line gist rung before the formal wording. Glossed "polynomial/exponential" as "efficient/hopeless at scale" with concrete growth shapes. Introduced "certificate" as "short proof you can check," then kept the label. **Kept SAT** and glossed it ("deciding whether a boolean formula can be made true") and **added** Sudoku as *extra* intuition rather than replacing SAT. "TM" → "machine" with the nondeterministic picture kept. `⊆` → "sits inside." Gave the misconception its own beat. *Facts unchanged: P def, NP verifier def, SAT + route examples, nondeterministic-guess equivalence, P⊆NP, the FIND-vs-CHECK question, the misconception, coNP.*

---

### 10.2 `a-halting-15` (`full`) — technique: name the analogy, keep the named terms

**Prompt (unchanged):** *What does it mean for the halting problem to be undecidable, and what is the diagonalization idea that proves it?*

**BEFORE:**
> Undecidable means NO algorithm exists — not that it is slow, but that no Turing machine can, for every pair (program M, input w), always halt and correctly report whether M halts on w. The proof is self-reference: assume a decider H(M,w) exists. Build D that takes a program's own code <M>, runs H(<M>,<M>), and then does the OPPOSITE — it loops if H says M halts on itself, and halts if H says it loops. Now ask what D does on its own code <D>: whatever H predicts, D contradicts it. So H cannot exist. The lesson for an engineer: some perfectly well-defined questions (does this code terminate? are these two programs equivalent?) have no general algorithm at all, regardless of compute — by Rice's theorem, essentially every non-trivial semantic property of programs is undecidable.

**AFTER:**
> "Undecidable" doesn't mean slow — it means **no program can ever do the job**, with any amount of time or memory. The halting problem asks: given any program and its input, will that program eventually stop, or run forever? The claim is that no single program can answer this for *every* program-and-input.
>
> The proof is **diagonalization** — the "this statement is false" trick, a paradox built on purpose. (Formally the "program" is a **Turing machine**, the standard abstract computer; nothing below depends on the details.) Suppose a perfect halt-checker `H` exists: hand it a program `M` and input `w`, and it always correctly says "stops" or "runs forever." Now build a troublemaker program `D`: `D` takes a program's own code, asks `H` "does this program stop when run on itself?", then does the **opposite** — if `H` says "stops," `D` loops forever; if `H` says "runs forever," `D` stops. Finally, feed `D` its *own* code. Whatever `H` predicts about `D`, `D` is built to do the reverse — a contradiction. So the perfect checker `H` can't exist.
>
> Why an engineer cares: some perfectly clear questions — "will this code ever terminate?", "do these two programs do the same thing?" — have **no** general algorithm, ever. **Rice's theorem** generalizes it: essentially any non-trivial question about *what a program does* (its behavior, not how it's written) is undecidable.

*What changed (diff):* **Kept "Turing machine"** — glossed it ("the standard abstract computer") instead of deleting it, since the concept is load-bearing. **Named "diagonalization"** explicitly (the prompt asks for it) and *then* attached the liar's-paradox analogy — analogy added, term retained. Kept `M`, `w`, `D`, `H` as backticked identifiers with plain roles. **Kept Rice's theorem by name** and glossed "semantic property" as "what a program does, not how it's written." *Facts unchanged: undecidable ≠ slow, the (M,w) formulation, the H/D contradiction construction, the two undecidable examples, Rice's theorem.*

---

### 10.3 `a-savitch-15` (`full`) — technique: unpack the notation before showing it; restore the dropped corollary

**Prompt (unchanged):** *What does Savitch's theorem say, what is its headline corollary, and what is the algorithmic trick behind it?*

**BEFORE:**
> Savitch's theorem: NSPACE(s(n)) ⊆ DSPACE(s(n)^2) for s(n) ≥ log n. Headline corollary: NPSPACE = PSPACE (polynomial squared is still polynomial), and NL ⊆ DSPACE(log^2 n). The trick is a recursive divide-and-conquer on reachability: to test whether configuration A can reach B in at most 2^k steps, GUESS a midpoint configuration M and recursively check A→M in 2^(k-1) steps and M→B in 2^(k-1) steps. The recursion is only k levels deep, and each level stores one configuration of size O(s(n)), so total space is O(s(n) · k) = O(s(n)^2) — and it is deterministic because we can try all midpoints one at a time, reusing the space. The meaning: for SPACE, nondeterminism buys at most a quadratic advantage — a stark contrast with TIME, where nondeterminism (P vs NP) is believed to give an exponential gap.

**AFTER:**
> First, the vocabulary. **"Space"** means working memory — scratch paper, not time. A **"nondeterministic"** machine may *guess* its way forward; a **"deterministic"** one has to plod through for real. So `NSPACE(f)` = "problems a *guessing* machine solves using scratch memory f," and `DSPACE(f)` = the same for an *honest* machine.
>
> **Savitch's theorem** says: anything a guessing machine can solve with a given amount of memory, an honest machine can solve using at most the **square** of that memory — formally `NSPACE(s) ⊆ DSPACE(s²)`, for any memory budget s at least log n. Squaring is mild: a polynomial squared is still a polynomial.
>
> **Headline corollary:** for memory, guessing barely helps. "Polynomial memory with guessing" equals "polynomial memory without" (`NPSPACE = PSPACE`). And at the small-memory end, log-space guessing costs only squaring too: `NL ⊆ DSPACE(log²n)` — problems a guessing machine solves in log-sized memory, an honest machine solves in (log n)² memory.
>
> **The trick** is divide-and-conquer on a reachability question: *can the machine get from state A to state B within 2ᵏ steps (some step budget)?* Instead of tracing the whole path (lots of memory), **guess the halfway state M**, then recursively ask two smaller questions: can A reach M in 2ᵏ⁻¹ steps, and can M reach B in 2ᵏ⁻¹ steps? The recursion is only k levels deep, and each level only remembers one state (size s), so total memory is about s × k = s². It's honest/deterministic because you can try every possible midpoint M one at a time, **reusing the same scratch memory** for each try.
>
> **Why it's a big deal:** for *memory*, guessing gives you almost nothing — at most a squaring. That's a sharp contrast with *time*, where guessing is believed to give an *exponential* speedup — that gap is exactly the P vs NP question.

*What changed (diff):* The raw `NSPACE ⊆ DSPACE(s²)` no longer leads — "space = memory," "nondeterministic = guessing," "deterministic = honest" come first, *then* the symbols appear as the precise restatement. **Restored the dropped corollary `NL ⊆ DSPACE(log²n)`** and glossed it in words (it was missing from the prior rewrite — a §3.4 fact loss). Powers rewritten as Unicode superscripts (2ᵏ, s², log²n). `2ᵏ`, `s`, `k` given short inline glosses. "configuration" softened to "state" *as an added synonym*, keeping the mechanism. *Facts unchanged: the theorem, BOTH corollaries (NPSPACE=PSPACE and NL⊆DSPACE(log²n)), the midpoint recursion, the k-levels × size-s space accounting, determinism via reused space, the space-vs-time punchline.*

---

### 10.4 `a-pspace-15` (`full`) — technique: defuse the acronym soup; restore "-complete" and the named theorem

**Prompt (unchanged):** *What is PSPACE, how do L and NL fit in, and what kind of problem is PSPACE-complete? Where do the classes sit relative to P and NP?*

**BEFORE:**
> PSPACE is the problems solvable using polynomial WORK SPACE with no time limit — space is reusable, which makes it powerful. L is deterministic O(log n) work-tape space (input is read-only, so you cannot even store a copy), and NL is its nondeterministic version; think pointers and counters, e.g. graph reachability (STCON) is NL-complete. The known chain is L ⊆ NL ⊆ P ⊆ NP ⊆ PSPACE, and every one of those inclusions is believed but not proven strict (we only know L ≠ PSPACE via the hierarchy theorem). PSPACE-complete problems are the 'unbounded interaction' ones: TQBF / true quantified boolean formulas (∃x∀y∃z …), and generalized two-player games with a polynomially-bounded number of moves like Generalized Geography or Hex, where you must reason about all of the opponent's responses. (Games that can run for exponentially many moves — generalized Go, Chess, Checkers — jump up to EXPTIME-complete.) Rule of thumb: alternating ∃/∀ quantifiers or perfect-play games smell PSPACE, not merely NP.

**AFTER:**
> These classes sort problems by how much **working memory** they need, ignoring time. The key fact about memory: you can **reuse** it — erase your scratch paper and write again — which is what makes memory-bounded classes surprisingly powerful.
>
> - **PSPACE** = problems solvable with a *polynomial* amount of working memory, with no time limit. Reusable memory + unlimited time makes this a big class.
> - **L** ("logarithmic space") = problems solvable with only about log n memory — enough for a few counters and pointers, but *not* enough to store a copy of the input (the input is read-only). Tiny memory.
> - **NL** = the "guessing" version of L (the machine may guess its way forward). Its **NL-complete** problem — the canonical hardest problem in NL, the one everything else in NL reduces to — is **reachability**: given a graph, can you get from node A to node B? (Formally `STCON`, s-t connectivity.)
>
> How they nest, smallest to largest: `L ⊆ NL ⊆ P ⊆ NP ⊆ PSPACE` — tiny memory sits inside guessing-tiny-memory sits inside fast-to-solve sits inside fast-to-verify sits inside polynomial-memory. Everyone *believes* each step is a strict jump, but the only gap actually *proven* is that L is strictly smaller than PSPACE — and that comes from the **space hierarchy theorem** (the result that more memory strictly buys you more solvable problems).
>
> **PSPACE-complete** problems — the hardest in PSPACE, the ones everything in PSPACE reduces to — are the "reason about a whole back-and-forth" problems. The canonical one is **TQBF**, "true quantified boolean formula": a logic statement with alternating "for **all** (∀) x… there **exists** (∃) y…" quantifiers, where deciding truth forces you to consider every branch of every choice. Two-player games with a polynomial number of moves (Generalized Geography, Hex) are PSPACE-complete for the same reason — winning means accounting for *all* of the opponent's replies. (Games that can drag on for *exponentially* many moves — generalized Go, Chess, Checkers — are even harder: **EXPTIME-complete**.)
>
> **Interview tell:** alternating "for all / there exists" quantifiers, or a perfect-play game, smells like PSPACE — a step above ordinary NP.

*What changed (diff):* Every acronym unpacked (L, NL, STCON, TQBF spelled out, EXPTIME glossed). **Restored "NL-complete"** — the prior rewrite softened it to "signature NL problem," which drops the whole point; now stated as "the canonical hardest problem in NL, the one everything reduces to." **Restored the hierarchy theorem** by name and glossed it ("more memory strictly buys more solvable problems") — it had been dropped. **Restored the "everything reduces to it" meaning of PSPACE-complete.** The chain `L ⊆ NL ⊆ P ⊆ NP ⊆ PSPACE` kept as the precise rung with a plain-word reading beside it. ∃/∀ spelled out on first use per §9. *Facts unchanged: all five classes and defs, memory-reuse, STCON NL-complete, the full chain, "all inclusions believed strict, only L≠PSPACE proven," the hierarchy theorem, TQBF, the game examples at both PSPACE and EXPTIME levels, the tell.*

---

### 10.5 `a-twoptr-5` (`flip`) — technique: the degraded ladder for a flashcard

**Prompt (unchanged):** *When does the two-pointer technique apply, and what property of the input makes it valid?*

**BEFORE:**
> Two pointers works when the array is sorted (or has some monotonic property) and you are searching for a pair/triple satisfying a condition. Validity rests on monotonicity: moving the left pointer right only increases the sum, moving the right pointer left only decreases it — so at each step you can eliminate an entire row or column of the search space without checking it. That is what turns O(n²) into O(n).

**AFTER:**
> Use two pointers when the array is **sorted** (or otherwise ordered) and you're hunting for a pair or triple that meets a condition. It works because of **monotonicity** — the property that moving one pointer only ever pushes the result one direction: slide the left pointer right and the pair's sum only grows; slide the right pointer left and it only shrinks. So each step rules out a whole slab of candidates without checking them, turning O(n²) into O(n). **Tell:** "find a pair in a sorted array."

*What changed (diff):* Kept it a tight 4-sentence flip — no separate "precise version" rung. **Monotonicity** (the one must-unpack term the answer hinges on) glossed inline: "the property that moving one pointer only ever pushes the result one direction." Added an explicit **tell** as the recall trigger. Powers left as `O(n²)`/`O(n)` per §9. *Facts unchanged: sorted precondition, monotonicity as the validity reason, the sum-direction mechanism, the O(n²)→O(n) payoff.*

---

## 11. Reveal checklist — comprehension (the judgment gate)

Apply to every card:

- [ ] **First-read gate:** a first-timer gets the *gist* in one pass, no lookups, no re-reads.
- [ ] **Every** term/acronym/symbol unpacked on first use, tiered by role (§3.2): central = three beats, supporting = appositive clause, incidental = short inline gloss.
- [ ] **Unpack, never delete** (§3.1): every term the source/prompt names is kept and glossed, not swapped for a plainer word.
- [ ] **No bare symbol or acronym** leads a sentence; words come before notation.
- [ ] Reveal follows the ladder: **gist → precise version → why-it-matters/tell** (`full`), or the degraded gist + one-term + tell (`flip`).
- [ ] Active voice; a concrete example named for the central abstract idea when it aids comprehension.
- [ ] At most one analogy or worked example, and it's *true* and *short*.
- [ ] Card **stands alone** — nothing relies on a term unpacked in another card.

## 12. Reveal checklist — mechanical (0/1, no judgment needed)

A skimmer or the model can score each of these true/false without deciding "would a first-timer get it":

- [ ] **(a) Term-gloss adjacency** — every term/acronym/symbol has its gloss in the **same sentence or the one immediately before**. No gloss "somewhere later."
- [ ] **(b) No forward reference** — no sentence uses a term defined only later in the reveal.
- [ ] **(c) Sentence budget** — prefer short sentences; a semicolon-or-dash chain that runs past **~35 words** is a genuine run-on — split it. (Softened from a hard ~25: the approved §10 reference cards routinely run longer clause-chains that still read cleanly on first pass, so the target is "no genuine run-on," not a strict word count. A first-read failure at the *gist* rung still fails (a); this check only flags the true run-ons.)
- [ ] **(d) Name the referent** — every "this," "that," "it" at a sentence start names what it points to ("this squaring," not a bare "this").
- [ ] **(e) Facts preserved** — every corollary, every "-complete" qualifier, and every named theorem from the source survives (§3.4).
- [ ] **(f) Format conventions** — Unicode superscripts, backticked identifiers, quantifiers spelled out on first use (§9).

## 13. Prompt checklist

- [ ] **(a)** The prompt asks **one specific, answerable thing** (not a bare topic label, not three questions in a trench coat).
- [ ] **(b) Prompt-answer match** — the reveal names and answers **exactly** what the prompt asked, by name. If the prompt says "the diagonalization idea," the reveal uses the word "diagonalization" and delivers that idea.

## 14. `src` / JSON checklist (generator's concern, noted here)

- [ ] `src.book` + `src.ref` (+ `page`) point to the **actual location** of the fact, page-accurate (deep-links into the book PDF depend on it).
- [ ] `flow`/`mins` match the card's real shape (`flip`≈5, `full`≈15); reclassify a flip that needs the full ladder.
- [ ] `id`, `tags` are the generator's to set — out of scope for the writing standard, listed here only for completeness.
