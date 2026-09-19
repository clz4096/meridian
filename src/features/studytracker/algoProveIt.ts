/**
 * "Prove it yourself" — interactive proof practice for the Algorithm of the Day.
 *
 * Two tiers ship today (Tier B, the predict-then-reveal trace, is a deliberate
 * open item — its client-side feasibility was flagged in the Massey Standard spec
 * and is deferred, NOT silently folded into Tier C):
 *   - Tier A (ALGO_FLAW): an autogradable, single-answer flaw-spotting question.
 *     The `correct` index is the genuine defect; distractors are plausible-but-wrong.
 *     Only a handful of algorithms carry a Tier-A question — the crisp, unambiguous
 *     classic pitfalls. A topic without one simply shows Tier C.
 *   - Tier C (generic, in the component): reconstruct the correctness argument from
 *     memory, then reveal-and-compare against the authored proof in algoProofs.ts.
 *
 * Every claim here is standard, textbook-correct CS. Tier A is scored for
 * correctness (client-side); Tier C scores the ATTEMPT only, never correctness.
 */
export interface FlawMC {
  /** The setup + the question. */
  question: string;
  /** Answer choices; exactly one is the real flaw. */
  options: string[];
  /** Index into `options` of the genuine defect. */
  correct: number;
  /** Shown after answering — why the right answer is right (and the trap in the others). */
  explain: string;
}

export const ALGO_FLAW: Record<string, FlawMC> = {
  'binary-search': {
    question:
      'A student’s binary search computes `mid = (lo + hi) / 2` and loops `while (lo <= hi)`, setting `hi = mid` when `a[mid] >= target`. Which is the real defect?',
    options: [
      'Binary search requires the array to be sorted in descending order.',
      '`(lo + hi) / 2` can overflow for large indices, and with `hi = mid` under `lo <= hi` the interval can stop shrinking (when `lo == hi == mid`), so the loop may never terminate.',
      'It should compare against `a[lo]` instead of `a[mid]`.',
      'The midpoint should be `hi - lo` rather than an index between `lo` and `hi`.',
    ],
    correct: 1,
    explain:
      'Two coupled bugs: `lo + hi` can exceed INT_MAX (use `lo + (hi - lo) / 2`), and mixing the inclusive test `lo <= hi` with the candidate-keeping update `hi = mid` breaks the "interval strictly shrinks" guarantee, so termination can fail. The clean form is a half-open interval with `while (lo < hi)` and `hi = mid`. The other options are false: ascending order is required, and comparing against `a[mid]` is exactly right.',
  },
  'kadane': {
    question:
      'Kadane’s algorithm is implemented with the running maximum initialized to 0 (`best = 0`) and updated as `cur = max(0, cur + a[i]); best = max(best, cur)`. On which input is this WRONG, and why?',
    options: [
      'On an all-negative array (e.g. [-3, -1, -2]) it returns 0, but the empty subarray is disallowed — the true answer is the largest single element (-1).',
      'On a sorted array, because Kadane requires unsorted input.',
      'On an array with duplicates, because `max` cannot break ties.',
      'On very long arrays, because the recurrence is not O(n).',
    ],
    correct: 0,
    explain:
      'Seeding the global maximum with 0 silently admits the empty subarray, so an all-negative array wrongly yields 0. Seed with `a[0]` (or -infinity) so the answer is forced to be a nonempty subarray. Kadane is O(n), works on any ordering, and ties are irrelevant — those distractors are wrong.',
  },
  'dijkstra': {
    question:
      'Dijkstra is run on a graph containing a single negative-weight edge and returns a distance. What is the genuine flaw?',
    options: [
      'Dijkstra cannot run on directed graphs.',
      'Dijkstra requires the graph to be connected or it loops forever.',
      'Dijkstra’s finalization step assumes non-negative edge weights; a negative edge can let a cheaper path improve an already-settled vertex, so a settled distance can be wrong.',
      'A min-priority queue cannot store more than one entry per vertex.',
    ],
    correct: 2,
    explain:
      'The correctness proof needs the remaining tail of any shortest path to be non-negative, so that the extracted-minimum vertex is truly finalized. A negative edge violates that: e.g. s→a=2, s→b=3, b→a=−2 makes Dijkstra finalize d[a]=2 though the true distance is 1 via b. Use Bellman-Ford for negative edges. Dijkstra handles directed and disconnected graphs fine, and PQs routinely hold stale duplicate entries.',
  },
  'merge-sort': {
    question:
      'Someone claims a clever comparison-based variant of merge sort sorts any array in O(n) comparisons. Why is this impossible?',
    options: [
      'Because merge sort is not stable.',
      'Because any comparison sort is a binary decision tree that must have at least n! leaves, forcing worst-case height — and thus comparisons — of Ω(n log n).',
      'Because recursion always costs O(n log n) regardless of the work done.',
      'Because merging two halves requires O(n log n) comparisons.',
    ],
    correct: 1,
    explain:
      'The information-theoretic lower bound: sorting must distinguish all n! input orderings, and a binary decision tree separating n! outcomes has height ≥ log2(n!) = Ω(n log n). No comparison sort can beat it, so O(n) comparisons is impossible. Merging is O(n) per level (not O(n log n)); stability and recursion-cost claims are red herrings.',
  },
  'quicksort': {
    question:
      'A note states: "randomized quicksort guarantees O(n log n) comparisons in the worst case." What is wrong with this statement?',
    options: [
      'Randomized quicksort is actually O(n^2) on every input.',
      'Randomization changes the output order, so it does not sort correctly.',
      'The O(n log n) is the EXPECTED number of comparisons over the random pivot choices; the worst case (adversarial coin flips) is still Θ(n^2) — randomization bounds the average, not the maximum.',
      'Quicksort cannot be randomized without extra O(n) space.',
    ],
    correct: 2,
    explain:
      'Randomization makes O(n log n) hold in expectation for every input (E[comparisons] = 2n ln n + O(n)), but an unlucky sequence of pivots can still degrade to Θ(n^2) — it is a bound on the expectation, not a worst-case guarantee. Randomized quicksort still sorts correctly and can be done in-place; the other options are false.',
  },
  'topological-sort': {
    question:
      'Kahn’s algorithm emits fewer than V vertices on some input. A student concludes the algorithm is buggy. What is actually true?',
    options: [
      'The algorithm is buggy; Kahn’s always emits all V vertices.',
      'Emitting fewer than V vertices is the correct, intended signal that the graph contains a cycle (the leftover vertices are trapped in or downstream of it).',
      'It means the graph is disconnected, not cyclic.',
      'It means the queue was initialized with the wrong vertex.',
    ],
    correct: 1,
    explain:
      'A topological order exists iff the graph is a DAG. Kahn’s repeatedly removes in-degree-0 vertices; vertices on or after a cycle never reach in-degree 0, so an emitted count < V is a sound and complete cycle detector — not a bug. Disconnected DAGs still emit all V vertices, so that distractor is wrong.',
  },
};
