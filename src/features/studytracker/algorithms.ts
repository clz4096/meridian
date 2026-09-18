/**
 * Algorithm of the Day — a curated, offline catalogue that rotates one entry
 * per day. Each entry is written for a learner working from first principles:
 * a plain-English intuition, a formal treatment (idea, invariant, complexity,
 * correctness sketch), a C++ reference implementation (primary) with a Python
 * port, common pitfalls, and practice problems. Content is static (no network)
 * so it is always available and reviewable.
 */
export interface AlgoProblem {
  name: string;
  url: string;
  note: string;
}
export interface AlgoEntry {
  id: string;
  name: string;
  category: string;
  difficulty: 'Core' | 'Intermediate' | 'Advanced';
  /** One sentence: what it does and when to reach for it. */
  oneLiner: string;
  /** Plain-English, first-principles intuition (one paragraph per string). */
  plain: string[];
  /** The formal mechanism. */
  idea: string;
  /** The loop/structural invariant that makes it correct. */
  invariant: string;
  /** Why it is correct and why it terminates (proof sketch). */
  correctness: string;
  timeComplexity: string;
  spaceComplexity: string;
  /** C++ reference implementation (the primary language). */
  cpp: string;
  /** Python port of the same algorithm. */
  python: string;
  /** Common first-principles bugs to watch for. */
  pitfalls: string[];
  problems: AlgoProblem[];
}

export const ALGORITHMS: readonly AlgoEntry[] = [
  {
    id: 'binary-search',
    name: 'Binary Search',
    category: 'Searching',
    difficulty: 'Core',
    oneLiner: 'Find a target (or the boundary where it would go) in a sorted range in O(log n) by halving the live interval each step.',
    plain: [
      'You are looking for a name in a physical phone book. You do not start at page one; you flip to the middle, see whether your name falls before or after, and throw away the half that cannot contain it. Repeat and the book collapses to one page in a handful of flips.',
      'That "throw away half every time" is the whole idea. A list of a million sorted items is found in about 20 steps, because each step cuts the problem in half (2^20 is over a million).',
      'The robust version does not just ask "is it here?" It finds the first position where the target could sit (a lower bound). That single primitive answers "is x present?", "where do I insert x?", and "how many are < x?" all at once.',
    ],
    idea: 'Keep a half-open interval [lo, hi) that is guaranteed to contain the answer if it exists. Look at the midpoint; the comparison tells you which half to discard, so the interval shrinks by half each iteration.',
    invariant: 'At the top of every loop iteration, the answer (the first index whose value is >= target) lies in [lo, hi). Everything left of lo is strictly < target; everything at or right of hi is not a smaller candidate.',
    correctness: 'The invariant holds initially ([0, n) covers all indices). Each step preserves it: if a[mid] < target the answer is strictly right, so lo = mid + 1 is safe; otherwise a[mid] is a valid candidate, so hi = mid keeps it. The interval length hi - lo strictly decreases each iteration (mid < hi always, and mid + 1 > lo), so it reaches 0 in ceil(log2 n) steps, at which point lo == hi is the answer.',
    timeComplexity: 'O(log n)',
    spaceComplexity: 'O(1)',
    cpp: `#include <vector>

// First index i in [0, n) with a[i] >= target (a lower bound).
// Returns n if every element is < target. a must be sorted ascending.
int lowerBound(const std::vector<int>& a, int target) {
    int lo = 0, hi = static_cast<int>(a.size());   // half-open [lo, hi)
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;              // avoids lo + hi overflow
        if (a[mid] < target) lo = mid + 1;         // answer is strictly right
        else                 hi = mid;             // a[mid] is a candidate; keep it
    }
    return lo;                                      // lo == hi == first i with a[i] >= target
}`,
    python: `from typing import List

def lower_bound(a: List[int], target: int) -> int:
    """First index i with a[i] >= target; len(a) if none. a sorted ascending."""
    lo, hi = 0, len(a)                 # half-open [lo, hi)
    while lo < hi:
        mid = lo + (hi - lo) // 2      # overflow-proof by habit (Python ints are big)
        if a[mid] < target:
            lo = mid + 1               # answer is strictly right
        else:
            hi = mid                   # a[mid] is a candidate; keep it
    return lo`,
    pitfalls: [
      'Computing mid = (lo + hi) / 2 can overflow a 32-bit int in C++; use lo + (hi - lo) / 2.',
      'Mixing a half-open [lo, hi) interval with closed-interval updates (hi = mid - 1) causes off-by-one bugs. Pick one convention and keep every branch consistent.',
      'If neither branch strictly shrinks the interval (e.g. lo = mid instead of mid + 1), the loop can spin forever.',
      'Binary search is only valid on a monotonic predicate. The array (or the yes/no answer over the range) must actually be ordered.',
    ],
    problems: [
      { name: 'LC 704 · Binary Search', url: 'https://leetcode.com/problems/binary-search/', note: 'The bare primitive; get the boundaries exactly right.' },
      { name: 'LC 35 · Search Insert Position', url: 'https://leetcode.com/problems/search-insert-position/', note: 'This is literally lower_bound.' },
      { name: 'LC 278 · First Bad Version', url: 'https://leetcode.com/problems/first-bad-version/', note: 'Binary search on a monotonic predicate, not on an array.' },
    ],
  },
  {
    id: 'two-pointers',
    name: 'Two Pointers',
    category: 'Arrays',
    difficulty: 'Core',
    oneLiner: 'Scan a sorted array from both ends (or with a lead/lag pair) so each step provably rules out a whole class of candidates in O(n).',
    plain: [
      'Imagine a sorted row of numbers and you want two that add to a target. Put one finger on the smallest and one on the largest. If their sum is too big, the largest cannot possibly pair with anything, so move that finger left. If too small, the smallest is hopeless, so move it right.',
      'Every move eliminates one number for good, so you sweep the whole array once instead of trying all pairs. The trick is that sortedness lets one comparison discard an entire row or column of the pair grid.',
      'The same shape shows up as a slow/fast pair moving the same direction (dedup, cycle detection) and as the engine under the sliding window.',
    ],
    idea: 'Maintain two indices l and r into a sorted array. A single comparison of a[l] + a[r] against the target tells you which pointer to move, because sortedness guarantees the discarded element cannot be part of any solution.',
    invariant: 'Every pair (i, j) with i < l or j > r has already been correctly excluded: no such pair can be a solution given the current l, r and the sorted order. The window [l, r] still contains any remaining solution.',
    correctness: 'Start with l = 0, r = n - 1, so nothing is excluded yet (invariant holds). If a[l] + a[r] > target, then a[l] + a[k] > target for every k <= r as well (a is sorted), so r can never be part of a solution and r-- preserves the invariant; symmetrically for the too-small case. Each step moves a pointer inward, so l and r meet after at most n steps: O(n).',
    timeComplexity: 'O(n) after an O(n log n) sort if the input is unsorted',
    spaceComplexity: 'O(1)',
    cpp: `#include <vector>
#include <array>

// Indices of the two values in a sorted array that sum to target, or {-1,-1}.
std::array<int, 2> twoSumSorted(const std::vector<int>& a, int target) {
    int l = 0, r = static_cast<int>(a.size()) - 1;
    while (l < r) {
        long long sum = static_cast<long long>(a[l]) + a[r];  // avoid 32-bit overflow
        if (sum == target) return {l, r};
        if (sum < target)  ++l;        // smallest is too small to ever work
        else               --r;        // largest is too big to ever work
    }
    return {-1, -1};
}`,
    python: `from typing import List, Tuple

def two_sum_sorted(a: List[int], target: int) -> Tuple[int, int]:
    """Indices of the two values summing to target, or (-1, -1). a sorted."""
    l, r = 0, len(a) - 1
    while l < r:
        s = a[l] + a[r]
        if s == target:
            return (l, r)
        if s < target:
            l += 1                     # smallest is too small to ever work
        else:
            r -= 1                     # largest is too big to ever work
    return (-1, -1)`,
    pitfalls: [
      'The opposite-ends technique needs a sorted array. Sorting first costs O(n log n) and may destroy original indices; store them if the answer needs original positions.',
      'Moving the wrong pointer (or both) breaks the correctness argument; each step must discard exactly the element that cannot participate.',
      'Off-by-one on the stop condition: use l < r (not l <= r) when a value cannot pair with itself.',
      'For 3Sum-style problems, skip duplicate values after a match or you emit the same triple repeatedly.',
    ],
    problems: [
      { name: 'LC 167 · Two Sum II', url: 'https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/', note: 'The canonical opposite-ends scan.' },
      { name: 'LC 11 · Container With Most Water', url: 'https://leetcode.com/problems/container-with-most-water/', note: 'Move the shorter wall inward; prove why that is safe.' },
      { name: 'LC 15 · 3Sum', url: 'https://leetcode.com/problems/3sum/', note: 'Fix one index, two-pointer the rest; handle duplicates.' },
    ],
  },
{
  id: "sliding-window",
  name: "Sliding Window",
  category: "Arrays",
  difficulty: "Intermediate",
  oneLiner: "Maintain a contiguous window over a sequence, growing and shrinking its ends to track the best (or smallest) span satisfying a constraint — use it whenever a brute-force answer re-scans overlapping subarrays or substrings.",
  plain: [
    "Imagine reading a sentence through a slot that shows only a stretch of consecutive letters. You slide the right edge forward to take in more, and when what you can see breaks a rule you care about (say, a letter repeated), you drag the left edge forward until the rule holds again. At every moment the slot shows a valid stretch, and you remember the widest one you ever saw.",
    "The whole trick is that you never restart the scan. The right edge only moves right, and the left edge only moves right. Each element enters the window once and leaves at most once, so even though the window is constantly resizing, every element is touched a bounded number of times. That is why an O(n^2) 'check every subarray' brute force collapses to O(n).",
    "There are two flavors. Variable-size windows (below) grow until they violate a condition, then shrink to restore it — good for 'longest/shortest span with property X'. Fixed-size windows just march a constant-width slot across the array. The state you carry (a count, a frequency table, a running sum) is what you update on each entry and exit."
  ],
  idea: "Keep a half-open window [l, r). Advance r to admit s[r]. If admitting s[r] violates the invariant, advance l (evicting elements and updating auxiliary state) until the invariant is restored. After each restoration the window [l, r) is a maximal valid window ending at r; record its width. For the 'no repeats' case, carry the last-seen position of each character so l can jump directly past a duplicate rather than crawling.",
  invariant: "At the top of each iteration, the window [l, r) contains no repeated character (for longest-unique) — equivalently, every character in [l, r) appears exactly once. l is monotonically non-decreasing.",
  correctness: "Correctness: for each right endpoint r, the loop makes [l, r+1) the longest duplicate-free window ending at r, because l is pushed to exactly one past the previous occurrence of s[r] whenever that occurrence lies in the window, and is left untouched otherwise. The global answer is the max over all right endpoints of the longest window ending there, which covers every possible window. Termination: r increases by one each iteration and is bounded by n; l only ever increases and is bounded by r, so the loop runs exactly n iterations.",
  timeComplexity: "O(n)",
  spaceComplexity: "O(min(n, sigma)) for the alphabet/character map (O(1) for a fixed alphabet)",
  cpp: `#include <string>
#include <array>
#include <algorithm>

// Longest substring without repeating characters.
// Half-open window [l, r): expand r, and when the incoming char would
// duplicate one already inside, jump l forward so the window stays unique.
int lengthOfLongestSubstring(const std::string& s) {
    std::array<int, 256> last;   // last[c] = (index where c last seen) + 1; 256 covers any byte 0-255
    last.fill(0);                // 0 doubles as "not yet seen in this scan"
    int best = 0;
    int l = 0;                   // window start
    for (int r = 0; r < static_cast<int>(s.size()); ++r) {
        unsigned char c = static_cast<unsigned char>(s[r]);
        // last[c] > l means c's previous occurrence sits inside [l, r);
        // move l just past it. We never move l backward, preserving the
        // monotonic invariant that keeps the scan linear.
        if (last[c] > l) l = last[c];
        last[c] = r + 1;         // store index+1 so the 0 sentinel survives
        best = std::max(best, r - l + 1);
    }
    return best;
}`,
  python: `def length_of_longest_substring(s: str) -> int:
    last: dict[str, int] = {}   # char -> (index where last seen) + 1
    best = 0
    l = 0                       # window start
    for r, c in enumerate(s):
        # If c was last seen inside the current window, snap l past it.
        # l only ever increases, so each char enters/leaves the window once.
        if c in last and last[c] > l:
            l = last[c]
        last[c] = r + 1
        best = max(best, r - l + 1)
    return best`,
  pitfalls: [
    "Moving the left pointer backward (e.g. l = last[c] without the guard last[c] > l): a stale occurrence from before the current window drags l back, corrupting the window and breaking linearity.",
    "Off-by-one in width: with a half-open window the count of elements in [l, r] inclusive is r - l + 1, not r - l; mixing inclusive and exclusive conventions is the classic bug.",
    "Shrinking with an if instead of a while in min-window / at-most-k problems: one eviction may not restore the invariant, so you must loop until it holds.",
    "Forgetting to update auxiliary state (frequency counts, distinct-count) symmetrically on both entry (r advances) and exit (l advances) — the window's bookkeeping silently desyncs."
  ],
  problems: [
    { name: "Longest Substring Without Repeating Characters", url: "https://leetcode.com/problems/longest-substring-without-repeating-characters/", note: "The canonical variable-size window; exactly the reference implementation above." },
    { name: "Minimum Window Substring", url: "https://leetcode.com/problems/minimum-window-substring/", note: "Shrink-to-minimal variant: grow until all target chars are covered, then contract with a while loop to find the tightest window." },
    { name: "Longest Repeating Character Replacement", url: "https://leetcode.com/problems/longest-repeating-character-replacement/", note: "Window is valid while (width - count of most frequent char) <= k; teaches carrying a running max-frequency as window state." }
  ]
},
{
  id: "prefix-sums",
  name: "Prefix Sums",
  category: "Arrays",
  difficulty: "Core",
  oneLiner: "Precompute cumulative totals so any range sum answers in O(1) — use it when you face many range-sum queries, or pair it with a hash map to count subarrays with a target sum in one pass.",
  plain: [
    "Think of a running odometer. If you record the total distance traveled at the end of each mile marker, then the distance between marker 3 and marker 7 is just odometer(7) minus odometer(3) — no need to re-add the miles in between. Prefix sums apply the same idea to an array: store the total of everything up to each position, and any range's sum becomes one subtraction.",
    "Concretely, build an array P where P[i] is the sum of the first i elements, with P[0] = 0 representing 'summed nothing yet'. Then the sum of the half-open range [l, r) equals P[r] - P[l]. The two cancel out everything before l and keep exactly the elements from l up to r. One O(n) preprocessing pass buys you unlimited O(1) range queries.",
    "The deeper payoff is a reframing: 'a subarray [l, r) sums to k' is identical to 'P[r] - P[l] = k', i.e. 'P[l] = P[r] - k'. So as you sweep left to right computing the running prefix, you can ask a hash map how many earlier prefixes had the value you now need. That turns an O(n^2) subarray search into a single O(n) pass — the subarray-sum-equals-k trick."
  ],
  idea: "Define P[0] = 0 and P[i] = P[i-1] + a[i-1], so P[i] is the sum of the first i elements. The sum over half-open [l, r) is P[r] - P[l] in O(1). For counting subarrays with sum k, sweep the running prefix `run`; a subarray ending at the current index has sum k iff some earlier prefix equals run - k, so keep a hash map from prefix value to how many times it has occurred (seeded with {0: 1} for the empty prefix).",
  invariant: "For the query array: P[i] equals the exact sum of a[0..i). For the counting variant: after processing index i, `seen` maps each prefix value P[0..i+1] to its multiplicity, and `count` holds the number of subarrays ending at or before i whose sum is k.",
  correctness: "Range query: P[r] - P[l] = (a[0]+...+a[r-1]) - (a[0]+...+a[l-1]) = a[l]+...+a[r-1] by telescoping, which is exactly the sum of [l, r). Counting: for a fixed right end r, the subarrays with sum k are precisely those left ends l with P[l] = P[r] - k; because `seen` was populated with every prefix strictly before the current one and seeded with the empty prefix (value 0), each qualifying l is counted once and exactly once. Termination: both are single bounded for-loops over n elements.",
  timeComplexity: "O(n) preprocessing, O(1) per range query; O(n) for subarray-sum-equals-k",
  spaceComplexity: "O(n) for the prefix array or the hash map",
  cpp: `#include <vector>
#include <unordered_map>

// P[i] = sum of the first i elements, with P[0] = 0.
// Then sum of the half-open range [l, r) = P[r] - P[l], in O(1).
std::vector<long long> buildPrefix(const std::vector<int>& a) {
    // long long because a sum of many ints overflows a 32-bit int.
    std::vector<long long> P(a.size() + 1, 0);
    for (std::size_t i = 0; i < a.size(); ++i)
        P[i + 1] = P[i] + a[i];
    return P;
}

// Count subarrays summing to k. A subarray [l, r) sums to k iff
// P[r] - P[l] == k, i.e. P[l] == P[r] - k. Sweep the running prefix and
// ask how many earlier prefixes hit the value we now need.
long long subarraySumEqualsK(const std::vector<int>& a, long long k) {
    std::unordered_map<long long, long long> seen; // prefix value -> count
    seen[0] = 1;                 // the empty prefix P[0] = 0 must be present
    long long run = 0, count = 0;
    for (int x : a) {
        run += x;
        auto it = seen.find(run - k);   // count BEFORE inserting run, so a
        if (it != seen.end())           // subarray must have positive length
            count += it->second;
        ++seen[run];
    }
    return count;
}`,
  python: `from collections import defaultdict

def build_prefix(a: list[int]) -> list[int]:
    p = [0] * (len(a) + 1)          # p[i] = sum of first i elements; p[0] = 0
    for i, x in enumerate(a):
        p[i + 1] = p[i] + x         # Python ints are unbounded: no overflow
    return p

def subarray_sum_equals_k(a: list[int], k: int) -> int:
    seen: dict[int, int] = defaultdict(int)
    seen[0] = 1                     # empty prefix, so subarrays from index 0 count
    run = 0
    count = 0
    for x in a:
        run += x
        count += seen[run - k]      # earlier prefixes that complete a sum-k range
        seen[run] += 1              # record AFTER querying -> length >= 1
    return count`,
  pitfalls: [
    "Forgetting to seed the map with {0: 1}: subarrays that start at index 0 (whose left prefix is the empty prefix) go uncounted.",
    "Querying and inserting in the wrong order in subarraySumEqualsK: incrementing seen[run] before reading seen[run - k] lets a zero-length subarray be counted when k == 0.",
    "Integer overflow in the prefix accumulation: with 32-bit ints and large arrays the running sum wraps; use a 64-bit accumulator in C++ (Python is immune).",
    "Confusing inclusive [l, r] with half-open [l, r) indexing: the clean identity is sum[l, r) = P[r] - P[l]; an inclusive query is P[r+1] - P[l]. Pick one convention and hold it."
  ],
  problems: [
    { name: "Range Sum Query - Immutable", url: "https://leetcode.com/problems/range-sum-query-immutable/", note: "Textbook prefix array: build once, answer each sumRange in O(1)." },
    { name: "Subarray Sum Equals K", url: "https://leetcode.com/problems/subarray-sum-equals-k/", note: "The hash-map variant implemented above; note it needs the {0:1} seed and works with negatives." },
    { name: "Contiguous Array", url: "https://leetcode.com/problems/contiguous-array/", note: "Map 0 -> -1 so a balanced subarray becomes a prefix-sum of zero; store first index of each prefix value to maximize length." }
  ]
},
{
  id: "kadane",
  name: "Kadane's Algorithm",
  category: "Dynamic Programming",
  difficulty: "Intermediate",
  oneLiner: "Find the maximum-sum contiguous subarray in one linear pass by tracking the best sum ending at each position — use it whenever you need the most profitable/heaviest run of consecutive elements.",
  plain: [
    "Walk along the array carrying one number: the best sum of any subarray that ends right here, at the element you are standing on. At each new element you face a single decision — should this element join the good streak you were building, or is the streak so bad (negative) that you are better off starting a fresh streak at this element alone?",
    "The rule falls straight out of that question. The best sum ending here is this element plus the best sum ending at the previous element, but only if that previous best was positive; if it was negative it can only hurt you, so you drop it and start over. In one line: best_here = a[i] + max(best_here_prev, 0). Alongside that you keep the largest best_here you have ever seen, which is the answer.",
    "The subtle part is all-negative arrays. If you seed your running answer with 0, you'll wrongly report 0 for an array like [-3, -1, -2] because you'd 'choose' the empty subarray. Seeding with the first actual element instead forces the answer to be a real, non-empty subarray — here, -1."
  ],
  idea: "Let best[i] be the maximum sum of a subarray ending exactly at index i. The recurrence is best[i] = a[i] + max(best[i-1], 0), with best[0] = a[0]. The answer is max over all i of best[i]. Only best[i-1] is needed to compute best[i], so it collapses to two scalars: `best` (best sum ending at the current index) and `ans` (best seen anywhere).",
  invariant: "After processing index i, `best` = the maximum sum of any subarray ending at i, and `ans` = the maximum sum of any subarray within a[0..i]. Every subarray ending at i either is {a[i]} alone or extends an optimal subarray ending at i-1.",
  correctness: "Correctness by induction on the recurrence: any subarray ending at i is a[i] appended to some (possibly empty) subarray ending at i-1; to maximize its sum you append the best-ending-at-(i-1) subarray if that sum is positive, else you take a[i] alone — exactly a[i] + max(best[i-1], 0). Since best[i] is optimal for every i and the global maximum subarray must end at some index, max over best[i] is the global optimum. Seeding ans and best with a[0] (not 0) keeps subarrays non-empty, giving the correct answer on all-negative input. Termination: a single for-loop over n elements.",
  timeComplexity: "O(n)",
  spaceComplexity: "O(1)",
  cpp: `#include <vector>
#include <algorithm>
#include <stdexcept>

// Maximum-sum contiguous (non-empty) subarray.
// best = largest sum of a subarray ending at the current index.
// Either extend the running streak or restart at a[i], whichever is larger:
//   best = a[i] + max(best_prev, 0)
long long maxSubArray(const std::vector<int>& a) {
    if (a.empty()) throw std::invalid_argument("empty array");
    // Seed with a[0], NOT 0 — otherwise an all-negative array wrongly
    // yields 0 by "selecting" the empty subarray.
    long long best = a[0];   // best sum ending at current index
    long long ans  = a[0];   // best sum seen anywhere so far
    for (std::size_t i = 1; i < a.size(); ++i) {
        best = a[i] + std::max(best, 0LL);
        ans  = std::max(ans, best);
    }
    return ans;
}`,
  python: `def max_sub_array(a: list[int]) -> int:
    if not a:
        raise ValueError("empty array")
    # Seed with a[0], not 0, so all-negative inputs return a real element.
    best = ans = a[0]           # best ending here; best seen anywhere
    for x in a[1:]:
        best = x + max(best, 0)  # extend the streak, or restart at x
        ans = max(ans, best)
    return ans`,
  pitfalls: [
    "Initializing the answer to 0: breaks on all-negative arrays, where the true answer is the single largest (least negative) element, not 0.",
    "Resetting `best` to 0 instead of computing a[i] + max(best, 0): this drops the current element and can skip a valid single-element subarray.",
    "Updating `ans` before `best` in the loop body: you'd compare against the previous iteration's `best`, missing the subarray ending at the current index.",
    "Assuming Kadane transfers to maximum PRODUCT subarrays — it doesn't, because a negative times a negative flips sign, so you must track both max and min running products."
  ],
  problems: [
    { name: "Maximum Subarray", url: "https://leetcode.com/problems/maximum-subarray/", note: "The direct application; the implementation above solves it as written." },
    { name: "Maximum Product Subarray", url: "https://leetcode.com/problems/maximum-product-subarray/", note: "Kadane's cousin: carry running max AND min products because a negative factor swaps which is largest." },
    { name: "Best Time to Buy and Sell Stock", url: "https://leetcode.com/problems/best-time-to-buy-and-sell-stock/", note: "Kadane on the array of consecutive price differences equals the max single-transaction profit." }
  ]
},
{
  id: "merge-sort",
  name: "Merge Sort",
  category: "Sorting",
  difficulty: "Core",
  oneLiner: "A stable, guaranteed O(n log n) divide-and-conquer sort that splits the array in half, sorts each half, then merges the two sorted halves — use it when you need worst-case O(n log n), stability, or the merge step's side effects (like counting inversions).",
  plain: [
    "Sorting a big pile is hard; merging two already-sorted piles is easy — you just repeatedly take the smaller of the two front items. Merge sort leans entirely on that asymmetry. It keeps splitting the array in half until each piece has one element (which is trivially sorted), then merges pieces back together, always combining two sorted runs into one larger sorted run.",
    "The splitting forms a tree about log2(n) levels deep, because you halve the size each time. At every level the merges together touch all n elements once, so each level costs O(n) and there are O(log n) levels — that is the O(n log n), and unlike quicksort it holds even in the worst case, with no dependence on the input's initial order.",
    "'Stable' means equal elements keep their original relative order. Merge sort achieves this for free: when the two front items tie during a merge, you take from the left run first. That matters when you sort records by one key and want ties broken by their earlier ordering (e.g. sort by last name, keeping first-name order within)."
  ],
  idea: "Recursively sort the half-open range [lo, hi): if it has more than one element, split at mid = lo + (hi - lo) / 2, sort [lo, mid) and [mid, hi), then merge the two adjacent sorted runs into a scratch buffer and copy back. The merge advances two read pointers, always emitting the smaller front element and preferring the left run on ties to preserve stability. A single reused scratch buffer avoids per-call allocation.",
  invariant: "Merge invariant: at each step the buffer segment [lo, k) is sorted and contains exactly the elements already consumed from the two runs, and every unconsumed element in both runs is >= the last element written. Recursion invariant: mergeSortRec returns with a[lo..hi) sorted as a permutation of its original contents.",
  correctness: "Correctness by structural induction on range length: a range of size <= 1 is sorted by definition (base case). For larger ranges, both sub-ranges are sorted by the inductive hypothesis, and the merge produces a sorted run because it always emits the minimum available front element while the buffer-prefix invariant holds; taking from the left run on ties makes the output a stable permutation. Termination: mid strictly satisfies lo < mid < hi whenever hi - lo >= 2, so each recursive call operates on a strictly smaller range, and the recursion depth is bounded by ceil(log2 n).",
  timeComplexity: "O(n log n) in all cases (best, average, worst)",
  spaceComplexity: "O(n) auxiliary for the scratch buffer, plus O(log n) recursion stack",
  cpp: `#include <vector>

// Merge the two adjacent sorted runs a[lo..mid) and a[mid..hi) into buf,
// then copy back. Half-open bounds throughout.
void merge(std::vector<int>& a, int lo, int mid, int hi,
           std::vector<int>& buf) {
    int i = lo, j = mid, k = lo;
    while (i < mid && j < hi) {
        // Take from the RIGHT run only when it is strictly smaller; on ties
        // we take the left element first, which is what makes the sort stable.
        if (a[j] < a[i]) buf[k++] = a[j++];
        else             buf[k++] = a[i++];
    }
    while (i < mid) buf[k++] = a[i++];   // drain leftovers (one loop is empty)
    while (j < hi)  buf[k++] = a[j++];
    for (int t = lo; t < hi; ++t) a[t] = buf[t];
}

// Sort the half-open range [lo, hi).
void mergeSortRec(std::vector<int>& a, int lo, int hi, std::vector<int>& buf) {
    if (hi - lo <= 1) return;            // 0 or 1 element is already sorted
    int mid = lo + (hi - lo) / 2;        // overflow-safe midpoint (not (lo+hi)/2)
    mergeSortRec(a, lo, mid, buf);
    mergeSortRec(a, mid, hi, buf);
    merge(a, lo, mid, hi, buf);
}

void mergeSort(std::vector<int>& a) {
    // One scratch buffer allocated once and reused across every merge.
    std::vector<int> buf(a.size());
    mergeSortRec(a, 0, static_cast<int>(a.size()), buf);
}`,
  python: `def merge_sort(a: list[int]) -> list[int]:
    # Returns a new sorted list; base case of size <= 1 is already sorted.
    if len(a) <= 1:
        return a[:]
    mid = len(a) // 2
    left = merge_sort(a[:mid])
    right = merge_sort(a[mid:])
    return _merge(left, right)

def _merge(left: list[int], right: list[int]) -> list[int]:
    out: list[int] = []
    i = j = 0
    while i < len(left) and j < len(right):
        # Prefer the left element on ties (take right only if strictly
        # smaller) so equal keys keep their original order -> stable.
        if right[j] < left[i]:
            out.append(right[j]); j += 1
        else:
            out.append(left[i]); i += 1
    out.extend(left[i:])        # exactly one of these tails is non-empty
    out.extend(right[j:])
    return out`,
  pitfalls: [
    "Breaking stability by taking from the right run on ties (using a[j] <= a[i] as the take-right test): equal elements get reordered.",
    "Computing the midpoint as (lo + hi) / 2: for large indices lo + hi can overflow a 32-bit int; use lo + (hi - lo) / 2.",
    "Allocating a fresh scratch buffer inside every merge call: correct but turns the constant factor and allocation pressure sharply worse; allocate once and reuse.",
    "Off-by-one from mixing inclusive and half-open bounds — e.g. recursing on [lo, mid] and [mid, hi) double-counts index mid; keep every range half-open and split at mid consistently."
  ],
  problems: [
    { name: "Sort an Array", url: "https://leetcode.com/problems/sort-an-array/", note: "Directly solvable with the merge sort above; O(n log n) worst case avoids quicksort's adversarial inputs." },
    { name: "Count of Smaller Numbers After Self", url: "https://leetcode.com/problems/count-of-smaller-numbers-after-self/", note: "Instrument the merge step: when a left element is emitted after right elements, those right elements are the smaller-to-the-right count (merge-sort inversion counting)." },
    { name: "Merge Sorted Array", url: "https://leetcode.com/problems/merge-sorted-array/", note: "Isolates the merge step itself; merging from the back in-place is the key idea reused inside merge sort." }
  ]
},
{
  id: 'quicksort',
  name: 'Quicksort',
  category: 'Sorting',
  difficulty: 'Core',
  oneLiner: 'A divide-and-conquer, in-place comparison sort that partitions around a pivot; the go-to general-purpose sort when you need speed and O(log n) extra space but not stability.',
  plain: [
    'Imagine a messy stack of numbered files. Pick one file (the "pivot") and split the rest into two piles: everything smaller goes left, everything larger goes right. That one file is now in its final, correct position — nothing smaller is to its right, nothing larger is to its left — and you never have to touch it again.',
    'Now you have two smaller messes. Do the exact same thing to each pile, and to their sub-piles, until every pile has one file. At that point the whole stack is sorted. The clever part is that the sorting happens as a side effect of the partitioning: you never explicitly "merge" anything back together the way merge sort does.',
    'The catch is the pivot choice. If you always happen to pick the smallest (or largest) file, one pile is empty and the other has everything, so you have done almost no dividing — that degenerates to n passes of n work, i.e. O(n^2). Picking the pivot at random makes that worst case astronomically unlikely on any input, which is why real implementations randomize.'
  ],
  idea: 'Choose a pivot, then partition the range so all elements < pivot precede it and all >= follow it (Lomuto scheme: a single left-to-right scan maintaining a boundary index i for the "less-than" region). The pivot lands at its final sorted index p. Recurse on [lo, p-1] and [p+1, hi]. Recursing into the smaller partition and looping on the larger (tail-call elimination) bounds recursion depth to O(log n).',
  invariant: 'During the partition scan with pointer j over [lo, hi-1] and boundary i: every element in a[lo..i-1] is < pivot, and every element in a[i..j-1] is >= pivot. When j reaches hi, swapping a[i] with the pivot at a[hi] places the pivot at index i with the < region entirely to its left.',
  correctness: 'Correctness: after partition, a[p] is at its final position (invariant guarantees left side < pivot <= right side), and each recursive call sorts a strictly smaller subarray; by induction both sides become sorted, so the concatenation is sorted. Termination: each partition places at least one element (the pivot) permanently and recurses only on ranges excluding it, so the total number of unfixed elements strictly decreases; recursion depth is finite because subarray length shrinks by at least 1 each level.',
  timeComplexity: 'Average O(n log n); worst case O(n^2) on adversarial/sorted input with a fixed pivot, made exponentially improbable by a randomized pivot. Not stable.',
  spaceComplexity: 'O(log n) auxiliary (recursion stack) when always recursing into the smaller half; O(n) stack in the degenerate case without that guard. In-place otherwise.',
  cpp: `#include <vector>
#include <random>
#include <utility>

// Lomuto partition. Pivot chosen randomly then swapped to a[hi].
// Postcondition: returns index i such that a[lo..i-1] < a[i] <= a[i+1..hi].
static int partition(std::vector<int>& a, int lo, int hi) {
    // Randomized pivot: defeats the sorted-input O(n^2) trap for any FIXED input.
    static thread_local std::mt19937 rng{std::random_device{}()};
    std::uniform_int_distribution<int> pick(lo, hi);
    std::swap(a[pick(rng)], a[hi]);

    int pivot = a[hi];
    int i = lo;                       // boundary: a[lo..i-1] are all < pivot
    for (int j = lo; j < hi; ++j)
        if (a[j] < pivot)
            std::swap(a[i++], a[j]);  // grow the "less-than" region
    std::swap(a[i], a[hi]);           // drop pivot into its final home
    return i;
}

void quicksort(std::vector<int>& a, int lo, int hi) {
    while (lo < hi) {
        int p = partition(a, lo, hi);
        // Recurse into the SMALLER half, loop on the larger -> O(log n) stack depth.
        if (p - lo < hi - p) {
            quicksort(a, lo, p - 1);
            lo = p + 1;
        } else {
            quicksort(a, p + 1, hi);
            hi = p - 1;
        }
    }
}

// Convenience overload.
void quicksort(std::vector<int>& a) {
    if (!a.empty()) quicksort(a, 0, static_cast<int>(a.size()) - 1);
}`,
  python: `import random
from typing import List, Optional


def _partition(a: List[int], lo: int, hi: int) -> int:
    # Randomized pivot swapped into the last slot.
    p = random.randint(lo, hi)
    a[p], a[hi] = a[hi], a[p]

    pivot = a[hi]
    i = lo                                # a[lo..i-1] < pivot
    for j in range(lo, hi):
        if a[j] < pivot:
            a[i], a[j] = a[j], a[i]
            i += 1
    a[i], a[hi] = a[hi], a[i]             # pivot to its final position
    return i


def quicksort(a: List[int], lo: int = 0, hi: Optional[int] = None) -> None:
    if hi is None:
        hi = len(a) - 1
    while lo < hi:
        p = _partition(a, lo, hi)
        # Recurse into the smaller half; loop on the larger -> O(log n) depth.
        if p - lo < hi - p:
            quicksort(a, lo, p - 1)
            lo = p + 1
        else:
            quicksort(a, p + 1, hi)
            hi = p - 1`,
  pitfalls: [
    'Fixed pivot (first/last element) on already-sorted or reverse-sorted input gives O(n^2). Randomize the pivot (or use median-of-three) — do not assume "random data".',
    'Off-by-one in the partition bounds: the scan must run j over [lo, hi-1] (excluding the pivot slot), and the final swap places the pivot at i, not i-1 or hi.',
    'Recursing into both halves unconditionally without looping on the larger one risks O(n) stack depth and stack overflow on degenerate inputs.',
    'Using <= instead of < in the comparison can send all equal elements to one side, degrading to O(n^2) on inputs with many duplicates (consider 3-way/Dutch-flag partitioning there).'
  ],
  problems: [
    { name: 'Sort an Array', url: 'https://leetcode.com/problems/sort-an-array/', note: 'Direct implementation; randomized pivot is required to pass the sorted-input test cases.' },
    { name: 'Kth Largest Element in an Array', url: 'https://leetcode.com/problems/kth-largest-element-in-an-array/', note: 'Quickselect — the partition step of quicksort recursing into only one side, average O(n).' }
  ]
},
{
  id: 'union-find',
  name: 'Union-Find (Disjoint Set Union)',
  category: 'Data Structures',
  difficulty: 'Intermediate',
  oneLiner: 'A structure that maintains a partition of n elements into disjoint sets with near-constant-time merge and same-set queries; the tool of choice for dynamic connectivity, Kruskal MST, and cycle detection in undirected graphs.',
  plain: [
    'Picture people forming friend groups. Each person starts alone. When two people become friends, their entire groups merge into one. Later you want to ask "are these two in the same group?" fast, no matter how the groups formed. Union-Find answers exactly that.',
    'Represent each group as a rooted tree, where every element points to a "parent" and each tree has one root that names the group. To test if two elements share a group, walk each up to its root and compare roots. To merge two groups, point one root at the other. That is the whole idea — the rest is making those upward walks cheap.',
    'Two tricks keep the trees flat. Path compression: while walking up, re-point nodes closer to the root so future walks are shorter. Union by rank/size: always attach the shorter (or smaller) tree under the taller one so the tree never gets needlessly deep. Together they make each operation cost, in an amortized sense, less than any constant you would ever measure — formally the inverse Ackermann function.'
  ],
  idea: 'Maintain a parent[] forest where each set is a tree identified by its root (parent[root] == root). find(x) follows parent pointers to the root; union(a,b) links the two roots. Two optimizations: (1) union by rank — attach the tree of smaller rank (an upper bound on height) under the larger, incrementing rank only on a tie; (2) path compression (here, path halving: parent[x] = parent[parent[x]] during the climb) to flatten queried chains.',
  invariant: 'parent[] always encodes a forest of rooted trees (no cycles except the self-loop at each root), and every element x satisfies: repeatedly applying parent reaches the unique root of x\'s set. rank[r] is a valid upper bound on the height of the tree rooted at r. Elements are in the same set iff find returns the same root.',
  correctness: 'Correctness: find returns the root of x\'s tree (follows parents until the self-loop); two elements return equal roots iff they were linked by a chain of unions, which is exactly the reflexive-transitive closure of the union operations — the intended partition. Path halving only re-points nodes to existing ancestors, preserving the "reaches the same root" invariant. Termination: find\'s loop advances x strictly up a finite acyclic tree toward the root each iteration; union performs O(1) work after two finds. Amortized O(α(n)) per operation follows from the classic Tarjan analysis combining union-by-rank (height O(log n)) with path compression.',
  timeComplexity: 'O(α(n)) amortized per find/union with both optimizations, where α is the inverse Ackermann function (<= 4 for any n writable in the universe); effectively constant. O(n) to construct.',
  spaceComplexity: 'O(n) for the parent and rank arrays.',
  cpp: `#include <vector>
#include <numeric>
#include <utility>

class DSU {
    std::vector<int> parent;   // parent[i] == i  <=>  i is a root
    std::vector<int> rank_;    // rank_[r] is an UPPER BOUND on the tree height
public:
    explicit DSU(int n) : parent(n), rank_(n, 0) {
        std::iota(parent.begin(), parent.end(), 0);  // each element its own set
    }

    // find with path halving: every other node on the path is re-pointed
    // to its grandparent, flattening the tree without a second pass.
    int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

    // union by rank. Returns false if already in the same set (useful for
    // detecting a redundant edge / cycle in an undirected graph).
    bool unite(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false;
        if (rank_[ra] < rank_[rb]) std::swap(ra, rb);  // ra is the taller root
        parent[rb] = ra;
        if (rank_[ra] == rank_[rb]) ++rank_[ra];       // tie: height grows by 1
        return true;
    }

    bool connected(int a, int b) { return find(a) == find(b); }
};`,
  python: `from typing import List


class DSU:
    def __init__(self, n: int) -> None:
        self.parent: List[int] = list(range(n))  # each element its own set
        self.rank: List[int] = [0] * n           # upper bound on tree height

    def find(self, x: int) -> int:
        # Path halving: re-point to grandparent while climbing.
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def unite(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False                          # already connected
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra                        # ra is the taller root
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1                     # tie: height grows by 1
        return True

    def connected(self, a: int, b: int) -> bool:
        return self.find(a) == self.find(b)`,
  pitfalls: [
    'Comparing raw elements instead of roots: same-set tests and unions must operate on find(a)/find(b), never on a and b directly.',
    'Dropping either optimization and expecting near-constant time. Union by rank alone gives O(log n); path compression alone is also strong, but the near-O(1) inverse-Ackermann bound needs the combination.',
    'Incrementing rank on every union rather than only on a tie inflates ranks and breaks the height bound. Rank is not the same as set size — do not treat them interchangeably.',
    'Forgetting that find mutates parent[] (compression). If you iterate or snapshot the parent array during queries, the structure may change under you.'
  ],
  problems: [
    { name: 'Number of Provinces', url: 'https://leetcode.com/problems/number-of-provinces/', note: 'Union all connected city pairs, then count distinct roots.' },
    { name: 'Redundant Connection', url: 'https://leetcode.com/problems/redundant-connection/', note: 'The first edge whose unite() returns false closes a cycle — that is the answer.' },
    { name: 'Accounts Merge', url: 'https://leetcode.com/problems/accounts-merge/', note: 'Union accounts sharing an email, then group emails by root.' }
  ]
},
{
  id: 'bfs',
  name: 'Breadth-First Search',
  category: 'Graphs',
  difficulty: 'Core',
  oneLiner: 'A graph traversal that explores in rings of increasing distance using a FIFO queue; the standard way to find shortest paths (fewest edges) in an unweighted graph.',
  plain: [
    'Think of dropping a stone in a pond. The ripple reaches everything one step away first, then everything two steps away, then three. BFS explores a graph the same way: it fully finishes distance 1 before touching anything at distance 2. That is precisely why the first time it reaches a node, it has arrived by the shortest possible route in an unweighted graph.',
    'The engine is a queue (first-in, first-out). You start by putting the source in the queue at distance 0. You repeatedly take the front node, look at its neighbors, and any neighbor you have not seen yet you stamp with distance = current + 1 and push to the back. Because the queue hands nodes back in the order they were discovered, and discovery order tracks distance, the rings come out in sorted order.',
    'The single most important detail: mark a node as visited when you ENQUEUE it, not when you dequeue it. If you wait until dequeue, the same node can be added to the queue many times before it is processed, which both wastes work and can corrupt the distance guarantee. "Seen" and "in the queue" must become true at the same instant.'
  ],
  idea: 'Maintain a FIFO queue seeded with the source at distance 0 and a visited/dist array. Repeatedly dequeue u and relax each neighbor v: if v is unvisited, set dist[v] = dist[u] + 1 and enqueue it (marking it visited on enqueue). The queue always holds nodes of at most two consecutive distance levels, so nodes are finalized in non-decreasing distance order.',
  invariant: 'At every step, nodes are dequeued in non-decreasing order of dist, and the queue contains only nodes whose dist values differ by at most 1. When a node is first marked visited, dist[node] equals its true shortest-path distance (in edges) from the source and is never updated again.',
  correctness: 'Correctness: prove by induction on distance k that every node at true distance k is discovered with dist set to k. Base: source, k=0. Step: a node at distance k+1 has a neighbor at distance k; that neighbor is dequeued (all distance-k nodes are enqueued before any distance-(k+1) node by the two-level queue invariant) and relaxes it to k+1, and no shorter value is possible since a smaller dist would require a neighbor at distance < k. Termination: each node is enqueued at most once (marked visited on enqueue), so the queue empties after at most V dequeues, each doing work proportional to its degree.',
  timeComplexity: 'O(V + E) — every vertex is enqueued once and every edge examined once (twice for an undirected adjacency list).',
  spaceComplexity: 'O(V) for the queue and the visited/dist array.',
  cpp: `#include <vector>
#include <queue>

// Shortest distance in EDGES from src on an unweighted graph.
// adj is an adjacency list. dist[v] == -1 means v is unreachable.
std::vector<int> bfs(const std::vector<std::vector<int>>& adj, int src) {
    std::vector<int> dist(adj.size(), -1);
    std::queue<int> q;

    dist[src] = 0;
    q.push(src);                       // mark-on-enqueue: src is now "seen"
    while (!q.empty()) {
        int u = q.front(); q.pop();
        for (int v : adj[u]) {
            if (dist[v] == -1) {       // first sighting == shortest distance
                dist[v] = dist[u] + 1;
                q.push(v);             // mark v as seen the instant we queue it
            }
        }
    }
    return dist;
}`,
  python: `from collections import deque
from typing import List


def bfs(adj: List[List[int]], src: int) -> List[int]:
    """Shortest distance in edges from src; -1 marks unreachable nodes."""
    dist = [-1] * len(adj)
    dist[src] = 0
    q: deque[int] = deque([src])       # mark-on-enqueue
    while q:
        u = q.popleft()
        for v in adj[u]:
            if dist[v] == -1:          # first sighting == shortest distance
                dist[v] = dist[u] + 1
                q.append(v)
    return dist`,
  pitfalls: [
    'Marking visited on dequeue instead of on enqueue: the same node gets pushed multiple times, blowing up work and breaking the shortest-path guarantee.',
    'Using BFS for shortest paths on a WEIGHTED graph. BFS counts edges, not weights — you need Dijkstra (or 0-1 BFS with a deque) when edge costs differ.',
    'Using a stack (LIFO) or a plain list.pop() instead of a FIFO queue turns it into DFS and destroys the distance-ordering property.',
    'Forgetting to seed dist[src] = 0 / mark the source visited, so the source can be re-processed or its distance reported as unreachable.'
  ],
  problems: [
    { name: 'Rotting Oranges', url: 'https://leetcode.com/problems/rotting-oranges/', note: 'Multi-source BFS: seed the queue with every rotten orange at time 0.' },
    { name: 'Shortest Path in Binary Matrix', url: 'https://leetcode.com/problems/shortest-path-in-binary-matrix/', note: 'Grid BFS with 8-directional moves; unweighted so BFS gives the shortest path.' },
    { name: 'Word Ladder', url: 'https://leetcode.com/problems/word-ladder/', note: 'Implicit graph where edges connect words differing by one letter; BFS finds the fewest transformations.' }
  ]
},
{
  id: 'dfs',
  name: 'Depth-First Search',
  category: 'Graphs',
  difficulty: 'Core',
  oneLiner: 'A graph traversal that dives as deep as possible before backtracking, via recursion or an explicit stack; the backbone of cycle detection, topological sort, and connected-components work.',
  plain: [
    'Exploring a maze, DFS is the "always walk forward, and only turn back when you hit a dead end" strategy. From a node you pick an unvisited neighbor and commit to it, then a neighbor of that, going as deep as the graph allows. Only when you can go no deeper do you retreat one step and try the next unexplored branch. Contrast BFS, which fans out evenly in all directions.',
    'The natural way to write it is recursion — the call stack IS the "path I am currently on." When you need to avoid stack-overflow on deep graphs, you replace the call stack with an explicit stack and loop; the behavior is the same, but you now manage the pending nodes yourself.',
    'For directed graphs, the powerful refinement is three colors. White means untouched, gray means "currently on my active path" (entered but not finished), black means "fully explored and done." The instant DFS looks at an edge pointing to a gray node, it has found an edge back to something still on its own path — a cycle. That single observation powers cycle detection and, by recording finish order, topological sorting.'
  ],
  idea: 'Recursive DFS visits u, marks it, and recurses into each unvisited neighbor, backtracking when none remain. The three-color refinement (white=0 unvisited, gray=1 on the recursion stack, black=2 finished) detects a back edge — an edge (u, v) where v is gray — which exists in a directed graph iff the graph has a cycle. The iterative variant replaces the call stack with an explicit LIFO stack, marking nodes visited on POP (and skipping already-visited pops), since a node may be pushed by several predecessors before it is processed.',
  invariant: 'Recursive/color version: a node is gray for exactly the interval between entering its dfs call and returning from it, i.e. gray nodes form the current root-to-node path in the DFS tree. Every edge examined goes to a white node (tree edge, recurse), a gray node (back edge => cycle), or a black node (already finished, ignore). Iterative version: every node in the stack is pending; a node is finalized exactly once, on the pop where visited[u] first becomes true.',
  correctness: 'Correctness of cycle detection: (=>) if dfs sees an edge (u,v) with v gray, then v is an ancestor of u on the active path, and edge (u,v) closes a cycle v -> ... -> u -> v. (<=) if a directed cycle exists, consider the first vertex of that cycle to be colored gray; following cycle edges, DFS will explore along the cycle and eventually examine the edge entering that still-gray first vertex before it turns black, so a back edge is detected. Termination: each vertex changes color monotonically white -> gray -> black exactly once, and each edge is examined a constant number of times, so the process visits each vertex/edge finitely and halts.',
  timeComplexity: 'O(V + E) — each vertex is entered once and each edge examined once (twice for undirected adjacency lists).',
  spaceComplexity: 'O(V) for the color/visited array plus O(V) recursion or explicit-stack depth (up to O(V) on a path-like graph).',
  cpp: `#include <vector>
#include <stack>

// Three-color recursive DFS for cycle detection in a DIRECTED graph.
// color: 0 = white (unseen), 1 = gray (on the active path), 2 = black (done).
class CycleFinder {
    const std::vector<std::vector<int>>& adj;
    std::vector<int> color;
public:
    explicit CycleFinder(const std::vector<std::vector<int>>& g)
        : adj(g), color(g.size(), 0) {}

    bool hasCycle() {
        for (int u = 0; u < static_cast<int>(adj.size()); ++u)
            if (color[u] == 0 && dfs(u)) return true;  // cover disconnected parts
        return false;
    }

private:
    bool dfs(int u) {
        color[u] = 1;                       // enter: put u on the active path
        for (int v : adj[u]) {
            if (color[v] == 1) return true; // edge to a gray node == back edge
            if (color[v] == 0 && dfs(v)) return true;
        }
        color[u] = 2;                       // leave: u is fully explored
        return false;
    }
};

// Iterative preorder DFS with an explicit stack. Marks on POP, not on push,
// so duplicate pushes are harmless (guarded by the visited check).
std::vector<int> dfsOrder(const std::vector<std::vector<int>>& adj, int src) {
    std::vector<int> order;
    std::vector<bool> visited(adj.size(), false);
    std::stack<int> st;
    st.push(src);
    while (!st.empty()) {
        int u = st.top(); st.pop();
        if (visited[u]) continue;           // may have been queued twice
        visited[u] = true;
        order.push_back(u);
        // Push in reverse so neighbors come off the stack left-to-right.
        for (auto it = adj[u].rbegin(); it != adj[u].rend(); ++it)
            if (!visited[*it]) st.push(*it);
    }
    return order;
}`,
  python: `from typing import List


def has_cycle(adj: List[List[int]]) -> bool:
    """Directed-graph cycle detection via three colors."""
    color = [0] * len(adj)                 # 0 white, 1 gray, 2 black

    def dfs(u: int) -> bool:
        color[u] = 1                       # enter: u is on the active path
        for v in adj[u]:
            if color[v] == 1:              # edge to a gray node == back edge
                return True
            if color[v] == 0 and dfs(v):
                return True
        color[u] = 2                       # leave: u fully explored
        return False

    return any(color[u] == 0 and dfs(u) for u in range(len(adj)))


def dfs_order(adj: List[List[int]], src: int) -> List[int]:
    """Iterative preorder traversal; mark on pop to tolerate duplicate pushes."""
    order: List[int] = []
    visited = [False] * len(adj)
    stack = [src]
    while stack:
        u = stack.pop()
        if visited[u]:
            continue
        visited[u] = True
        order.append(u)
        for v in reversed(adj[u]):         # reverse -> left-to-right visitation
            if not visited[v]:
                stack.append(v)
    return order`,
  pitfalls: [
    'Using a two-state visited flag for cycle detection in a DIRECTED graph. You need three colors: revisiting a black (finished) node is fine; only an edge to a gray (on-path) node is a cycle.',
    'In the iterative version, marking visited on push instead of on pop — or forgetting the visited-check after popping — leads to processing a node multiple times or wrong ordering.',
    'Applying the gray-node rule to an UNDIRECTED graph without excluding the edge back to the parent: the immediate parent is gray, so you must skip it (or track the parent) to avoid a false cycle.',
    'Deep or path-like graphs overflow the recursion stack; switch to the explicit-stack form (or raise the recursion limit in Python) when depth can approach V.'
  ],
  problems: [
    { name: 'Number of Islands', url: 'https://leetcode.com/problems/number-of-islands/', note: 'Flood-fill each unvisited land cell with DFS; count the number of launches.' },
    { name: 'Course Schedule', url: 'https://leetcode.com/problems/course-schedule/', note: 'Prerequisites form a directed graph; a cycle means the schedule is impossible — classic three-color DFS.' },
    { name: 'Course Schedule II', url: 'https://leetcode.com/problems/course-schedule-ii/', note: 'DFS post-order (finish times reversed) yields a valid topological order when acyclic.' }
  ]
},
{
  id: 'dijkstra',
  name: "Dijkstra's Shortest Path",
  category: 'Graphs',
  difficulty: 'Intermediate',
  oneLiner: 'Single-source shortest paths on a graph with non-negative edge weights, by greedily settling the closest unsettled vertex using a min-priority-queue.',
  plain: [
    'Imagine every edge is a length of rope and you want the shortest rope route from a start city to every other city. You keep a "best-known distance so far" for each city, all starting at infinity except the start at 0. You always walk out from the closest city you have not yet finalized, because with non-negative ropes you can never later discover a shorter way into a city that was already the closest one on the frontier.',
    'The core move is relaxation: standing at city u whose distance is now final, you look at each neighbor v and ask "is going through u better than v\'s current best?" If dist[u] + weight(u,v) beats dist[v], you lower dist[v]. Do this for every edge out of every city, always processing cities in increasing order of finalized distance, and every best-known distance converges to the true shortest distance.',
    'The reason we process the closest-first is subtle but decisive: once a city is the nearest unfinished one, no other route can beat it, because any alternative route must leave through some other unfinished city that is already at least as far away, and the remaining edges only add non-negative length. That "closest-is-final" guarantee is exactly what breaks if any edge is negative.'
  ],
  idea: 'Maintain a tentative distance dist[] initialized to +inf (0 at source) and a set of settled vertices. Repeatedly extract the unsettled vertex u with minimum dist[u] from a binary min-heap, mark it settled, and relax every outgoing edge (u,v,w): if dist[u]+w < dist[v], update dist[v] and push (dist[v], v). Use lazy deletion: stale heap entries (where the popped key exceeds the current dist) are skipped on pop rather than decrease-key.',
  invariant: 'At the start of each iteration: (1) for every settled vertex s, dist[s] equals the true shortest-path distance delta(source, s); and (2) for every unsettled vertex v, dist[v] is the length of the shortest path from source to v whose intermediate vertices are all settled (or +inf if none exists).',
  correctness: 'Correctness of the settled invariant: when u is extracted with key d = dist[u], claim dist[u] = delta(source, u). Suppose not, and let u be the first extracted vertex for which dist[u] > delta(source, u). Take a true shortest path P from source to u. Let y be the first vertex on P that is not yet settled, and x its predecessor (settled, so dist[x] = delta(source, x) by induction). When x was settled we relaxed edge (x,y), so dist[y] <= dist[x] + w(x,y) = delta(source, y). Since edge weights are non-negative, the tail of P from y to u has length >= 0, hence delta(source, y) <= delta(source, u) < dist[u]. Thus dist[y] < dist[u], so y (not u) would have been extracted first — contradiction. Non-negativity is used exactly at delta(source,y) <= delta(source,u); with a negative edge the tail could shorten the path and the claim fails. Termination: each vertex is settled at most once and every edge is relaxed at most once per settle, so the loop runs a finite number of times; the heap only ever holds entries pushed by relaxations, of which there are O(E).',
  timeComplexity: 'O((V + E) log V) with a binary heap: each of the O(E) relaxations may push one heap entry (O(log V)), and each vertex is settled once. (O(E + V log V) with a Fibonacci heap.)',
  spaceComplexity: 'O(V + E) — the graph adjacency lists plus dist[] and up to O(E) live heap entries under lazy deletion.',
  cpp: `#include <vector>
#include <queue>
#include <limits>
#include <utility>
#include <functional>
using namespace std;

// adj[u] = list of (neighbor v, non-negative weight w).
// Returns shortest distance from src to every vertex (LLONG_MAX = unreachable).
vector<long long> dijkstra(const vector<vector<pair<int,int>>>& adj, int src) {
    const long long INF = numeric_limits<long long>::max();
    vector<long long> dist(adj.size(), INF);
    dist[src] = 0;

    // Min-heap keyed on tentative distance. We use lazy deletion instead of
    // decrease-key: a vertex may appear multiple times, and we skip stale copies.
    priority_queue<pair<long long,int>,
                   vector<pair<long long,int>>,
                   greater<>> pq;
    pq.push({0, src});

    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();
        // Stale entry: a shorter path to u was already settled. Skipping here is
        // what makes lazy deletion correct — u is settled only on its minimal pop.
        if (d > dist[u]) continue;

        for (auto [v, w] : adj[u]) {
            // Relaxation. dist[u] is final at this point, so this can only improve v.
            if (dist[u] + w < dist[v]) {
                dist[v] = dist[u] + w;
                pq.push({dist[v], v});
            }
        }
    }
    return dist;
}`,
  python: `import heapq
from typing import List, Tuple

def dijkstra(adj: List[List[Tuple[int, int]]], src: int) -> List[float]:
    """adj[u] = list of (neighbor v, non-negative weight w).
    Returns shortest distance from src to every vertex (inf = unreachable)."""
    dist: List[float] = [float("inf")] * len(adj)
    dist[src] = 0
    # Min-heap of (tentative distance, vertex); lazy deletion, no decrease-key.
    pq: List[Tuple[float, int]] = [(0, src)]

    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue  # stale entry: u was already settled with a smaller distance
        for v, w in adj[u]:
            nd = d + w  # d == dist[u] here, and dist[u] is final
            if nd < dist[v]:  # relaxation
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist`,
  pitfalls: [
    'Running it on a graph with any negative edge. The "closest popped vertex is final" argument collapses; use Bellman-Ford (or Johnson) instead.',
    'Forgetting the stale-entry guard (if d > dist[u] continue). Without it you re-settle vertices and relax from outdated distances, which is both incorrect and can blow up the running time.',
    'Marking a vertex settled when it is first pushed rather than when it is popped. A vertex can be pushed with a large key and later improved; only the pop with the minimal key is final.',
    'Integer overflow when summing weights (dist[u] + w) near the sentinel. Use a 64-bit distance type and never relax through an unreachable (INF) vertex.'
  ],
  problems: [
    { name: 'Network Delay Time', url: 'https://leetcode.com/problems/network-delay-time/', note: 'Textbook single-source Dijkstra; answer is the maximum finalized distance.' },
    { name: 'Path With Minimum Effort', url: 'https://leetcode.com/problems/path-with-minimum-effort/', note: 'Dijkstra on a grid where "distance" is the max edge on the path (min-max relaxation).' },
    { name: 'Path with Maximum Probability', url: 'https://leetcode.com/problems/path-with-maximum-probability/', note: 'Multiplicative weights in [0,1]; a max-heap Dijkstra variant since factors are non-negative.' }
  ]
},
{
  id: 'dynamic-programming-lis',
  name: 'Longest Increasing Subsequence',
  category: 'Dynamic Programming',
  difficulty: 'Intermediate',
  oneLiner: 'Find the length of the longest strictly increasing subsequence of an array — the canonical lens for turning a DP recurrence (O(n^2)) into a patience-sorting + binary-search solution (O(n log n)).',
  plain: [
    'A subsequence keeps elements in their original order but may drop any of them. You want the longest run that strictly increases. The first-principles DP question is: "if I demand that the subsequence ends exactly at position i, how long can it be?" Call that dp[i]. Then dp[i] is 1 plus the best dp[j] over all earlier j with a[j] < a[i]. The answer is the max over all i. That double loop is the O(n^2) DP.',
    'To go faster, flip what you store. Instead of "best length ending here," track, for each achievable length L, the smallest value that can end an increasing subsequence of that length. Call it tails[L-1]. A smaller ending value is always at least as good, because it leaves the most room for future elements to extend it. This is patience sorting: deal each card onto the leftmost pile whose top is >= it.',
    'The magic is that this tails array is always sorted, so "leftmost pile whose top is >= x" is a binary search. For each element you either extend the longest subsequence (append a new pile) or improve some length by lowering its ending value (overwrite one pile top). The number of piles at the end is the LIS length. You process n elements with a log n search each.'
  ],
  idea: 'O(n^2) DP: dp[i] = 1 + max{ dp[j] : j < i and a[j] < a[i] } (0 if no such j); answer = max_i dp[i]. O(n log n): maintain tails, where tails[k] is the smallest value that terminates some strictly increasing subsequence of length k+1. For each x, binary-search the first index i with tails[i] >= x (lower_bound); if none, append x (LIS grew); otherwise set tails[i] = x. LIS length = tails.size().',
  invariant: 'O(n log n) invariant: after processing a prefix, (1) tails is strictly increasing, and (2) tails[k] equals the minimum possible final element over all strictly increasing subsequences of the prefix that have length k+1; a length k+1 is achievable iff index k exists.',
  correctness: 'Why tails stays sorted: a strictly increasing subsequence of length k+1 contains, by dropping its last element, one of length k whose tail is strictly smaller, so the minimum length-(k+1) tail exceeds the minimum length-k tail — hence tails is strictly increasing at all times. Why each step preserves the invariant: for element x we take i = lower_bound(tails, x), the leftmost position with tails[i] >= x. If i == size, then x strictly exceeds every current tail, so appending x to the length-i subsequence ending at tails[i-1] creates a length-(i+1) subsequence — a new best, correctly appended. Otherwise tails[i-1] < x <= tails[i] (i is leftmost qualifying), so x is a valid, no-larger terminator for length i+1; overwriting tails[i] = x can only lower it and keeps tails[i-1] < x < tails[i+1], preserving sortedness and the minimality claim. Using lower_bound (>=) rather than upper_bound enforces strict increase; upper_bound would allow equal values and compute the longest non-decreasing subsequence. Since tails.size() is the largest achievable length index+1, it equals the LIS length. Termination: both algorithms are simple bounded loops over n (and, in the DP, over j<i), so they finish.',
  timeComplexity: 'O(n^2) for the DP; O(n log n) for the patience/tails method (n elements, one O(log n) binary search each).',
  spaceComplexity: 'O(n) for both — dp[] of size n, or tails of size at most n.',
  cpp: `#include <vector>
#include <algorithm>
using namespace std;

// O(n^2) DP: dp[i] = length of the longest increasing subsequence ending at i.
int lisQuadratic(const vector<int>& a) {
    int n = (int)a.size();
    if (n == 0) return 0;
    vector<int> dp(n, 1);          // every element alone is a subsequence of length 1
    int best = 1;
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < i; ++j)
            if (a[j] < a[i])       // strict increase; can extend the run ending at j
                dp[i] = max(dp[i], dp[j] + 1);
        best = max(best, dp[i]);
    }
    return best;
}

// O(n log n): tails[k] = smallest possible tail of an increasing subseq of length k+1.
// tails is kept sorted, so we binary-search the insertion point.
int lisPatience(const vector<int>& a) {
    vector<int> tails;
    for (int x : a) {
        // lower_bound => first tail >= x. Strict LIS: an equal value must replace,
        // not extend. (For a non-decreasing LIS you would use upper_bound.)
        auto it = lower_bound(tails.begin(), tails.end(), x);
        if (it == tails.end())
            tails.push_back(x);    // x beats every tail -> the LIS just grew
        else
            *it = x;               // improve an existing length with a smaller tail
    }
    return (int)tails.size();
}`,
  python: `from bisect import bisect_left
from typing import List

def lis_quadratic(a: List[int]) -> int:
    """O(n^2) DP: dp[i] = LIS length ending at index i."""
    n = len(a)
    if n == 0:
        return 0
    dp = [1] * n
    for i in range(n):
        for j in range(i):
            if a[j] < a[i]:           # strict increase
                dp[i] = max(dp[i], dp[j] + 1)
    return max(dp)

def lis_patience(a: List[int]) -> int:
    """O(n log n): tails[k] = smallest tail of an increasing subseq of length k+1."""
    tails: List[int] = []
    for x in a:
        # bisect_left => first index with tails[i] >= x (strict LIS).
        i = bisect_left(tails, x)
        if i == len(tails):
            tails.append(x)           # x extends the longest run so far
        else:
            tails[i] = x              # lower the tail for that length
    return len(tails)`,
  pitfalls: [
    'Confusing the values in tails with an actual LIS. tails is NOT a valid subsequence — only its length is meaningful; reconstructing the sequence needs a separate parent/index array.',
    'Using upper_bound / bisect_right when you want a strictly increasing subsequence. That computes the longest non-decreasing subsequence (allows equal elements).',
    'In the O(n^2) DP, initializing dp[i] to 0 instead of 1, or forgetting to take the max over all i (the LIS need not end at the last element).',
    'For variants like Russian Doll Envelopes: sort by the first key ascending but the second key DESCENDING within equal firsts, so equal-first items cannot chain and the 1-D LIS on the second key stays correct.'
  ],
  problems: [
    { name: 'Longest Increasing Subsequence', url: 'https://leetcode.com/problems/longest-increasing-subsequence/', note: 'The base problem; asks for the O(n log n) solution as a follow-up.' },
    { name: 'Russian Doll Envelopes', url: 'https://leetcode.com/problems/russian-doll-envelopes/', note: '2-D LIS: sort by width asc, height desc, then run LIS on heights.' },
    { name: 'Number of Longest Increasing Subsequence', url: 'https://leetcode.com/problems/number-of-longest-increasing-subsequence/', note: 'Extends the O(n^2) DP to also count how many subsequences achieve the max length.' }
  ]
},
{
  id: 'topological-sort',
  name: 'Topological Sort (Kahn)',
  category: 'Graphs',
  difficulty: 'Intermediate',
  oneLiner: 'Order the vertices of a directed acyclic graph so every edge points forward — via Kahn\'s in-degree BFS, which also detects whether the graph has a cycle.',
  plain: [
    'Think of tasks with prerequisites: you cannot take a course before its requirements. A topological order is any schedule where each task appears after everything it depends on. It exists exactly when there are no circular dependencies (the graph is a DAG).',
    'Kahn\'s method reads dependencies as in-degree: how many arrows point INTO each vertex. Any vertex with in-degree 0 has no unmet prerequisites, so it is safe to place next. Place it, then "remove" it by decrementing the in-degree of everything it points to. Some of those may now drop to 0 and become ready in turn.',
    'You process vertices in waves using a queue. If you manage to emit every vertex, you have a valid order. If you get stuck with vertices still unplaced but none at in-degree 0, those vertices form a cycle — each is waiting on another in the loop — which is how the same routine doubles as a cycle detector.'
  ],
  idea: 'Compute indeg[v] = number of incoming edges for every vertex. Seed a queue with all vertices of in-degree 0. Repeatedly pop u, append it to the order, and for each edge (u,v) decrement indeg[v]; when indeg[v] hits 0 push v. If the emitted order contains all V vertices, it is a valid topological order; otherwise the graph contains a directed cycle (report it, e.g. by returning an empty order).',
  invariant: 'Loop invariant: the queue holds exactly the vertices all of whose predecessors have already been emitted into the order but which are not themselves emitted yet; equivalently, for every not-yet-emitted vertex v, indeg[v] counts precisely its predecessors that are still unemitted. Hence any vertex popped has all predecessors already placed before it.',
  correctness: 'Ordering validity: by the invariant, when u is popped every predecessor of u was emitted earlier, so every edge (p,u) goes from an earlier to a later position — the defining property of a topological order. Completeness on a DAG: a finite non-empty DAG always has a vertex of in-degree 0 (follow edges backward; in an acyclic graph this cannot cycle and must terminate at a source), so the queue never empties prematurely while unprocessed vertices remain, and all V vertices are emitted. Cycle detection: each vertex enters the queue at most once (it is pushed only when indeg drops to 0, and indeg never increases), and is emitted at most once, so emitted-count <= V always. If emitted-count < V at the end, the unemitted vertices each still have indeg > 0, i.e. each has an unemitted predecessor; following predecessors within a finite unemitted set must repeat a vertex, exhibiting a directed cycle. Termination: every dequeue permanently emits one vertex and each edge is examined once during its source processing, so the loop runs O(V+E) steps and halts.',
  timeComplexity: 'O(V + E): one pass to compute in-degrees over all edges, then each vertex enqueued/dequeued once and each edge relaxed once.',
  spaceComplexity: 'O(V) auxiliary for the in-degree array, the queue, and the output order (plus O(V+E) for the graph itself).',
  cpp: `#include <vector>
#include <queue>
using namespace std;

// adj[u] = vertices v such that edge u -> v exists.
// Returns a topological order, or an EMPTY vector if the graph has a cycle.
vector<int> topoSort(const vector<vector<int>>& adj) {
    int n = (int)adj.size();
    vector<int> indeg(n, 0);
    for (int u = 0; u < n; ++u)
        for (int v : adj[u])
            ++indeg[v];                 // count incoming edges

    queue<int> q;
    for (int u = 0; u < n; ++u)
        if (indeg[u] == 0) q.push(u);   // sources: no unmet prerequisites

    vector<int> order;
    order.reserve(n);
    while (!q.empty()) {
        int u = q.front(); q.pop();
        order.push_back(u);
        for (int v : adj[u])
            if (--indeg[v] == 0)        // v's last remaining prerequisite is now placed
                q.push(v);
    }

    // If we could not emit every vertex, the leftovers all sit on a cycle.
    if ((int)order.size() != n) return {};
    return order;
}`,
  python: `from collections import deque
from typing import List

def topo_sort(adj: List[List[int]]) -> List[int]:
    """adj[u] = vertices v with edge u -> v.
    Returns a topological order, or [] if the graph contains a cycle."""
    n = len(adj)
    indeg = [0] * n
    for u in range(n):
        for v in adj[u]:
            indeg[v] += 1

    q = deque(u for u in range(n) if indeg[u] == 0)  # sources first
    order: List[int] = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:            # v's last prerequisite just got placed
                q.append(v)

    return order if len(order) == n else []  # short order => cycle`,
  pitfalls: [
    'Treating a short/failed result as "no valid order" without recognizing WHY: emitted-count < V specifically means a directed cycle exists. Silently returning a partial order hides that.',
    'Building the in-degree array from the wrong edge direction. indeg[v] must count edges INTO v; reversing it produces a reverse-topological or invalid order.',
    'Pushing a vertex when its in-degree merely decreases rather than reaching exactly 0, which enqueues it multiple times and corrupts the order.',
    'Assuming the topological order is unique. When several vertices sit at in-degree 0, any tie-break is valid; use a min-heap instead of a plain queue if a lexicographically smallest order is required.'
  ],
  problems: [
    { name: 'Course Schedule', url: 'https://leetcode.com/problems/course-schedule/', note: 'Pure cycle-detection: return whether all courses can be finished (Kahn emits all vertices).' },
    { name: 'Course Schedule II', url: 'https://leetcode.com/problems/course-schedule-ii/', note: 'Return an actual valid ordering, or empty if a cycle exists.' },
    { name: 'Alien Dictionary', url: 'https://leetcode.com/problems/alien-dictionary/', note: 'Derive precedence edges from adjacent words, then topologically sort the alphabet.' }
  ]
},
{
  id: 'greedy-interval-scheduling',
  name: 'Greedy Interval Scheduling',
  category: 'Greedy',
  difficulty: 'Core',
  oneLiner: 'Select the maximum number of mutually non-overlapping intervals (activity selection) by repeatedly taking the compatible interval that finishes earliest.',
  plain: [
    'You have a room and a pile of requests, each with a start and finish time, and you want to grant as many non-conflicting bookings as possible. The winning instinct is "finish early": always take the booking that frees the room soonest among those that still fit, because finishing early leaves the most time for everything after it.',
    'Concretely, sort all intervals by finish time. Walk through them keeping track of when the room last became free. Whenever the next interval starts at or after that free time, it is compatible — take it and update the free time to its finish. Skip anything that would overlap.',
    'It feels too simple to be optimal, and the surprising part is proving that greedily grabbing earliest-finish never costs you a better global solution. The argument is an exchange: any optimal schedule can be edited to start with the greedy choice without losing any bookings, so greedy is at least as good as optimal — hence optimal.'
  ],
  idea: 'Sort the n intervals by finish time ascending. Scan left to right maintaining lastFinish (initially -inf). For each interval [s, f): if s >= lastFinish it is compatible with all previously chosen intervals, so select it and set lastFinish = f; otherwise discard it. The count of selected intervals is the maximum size of a mutually compatible set.',
  invariant: 'Loop invariant: after processing the first k intervals (in finish-sorted order), the selected set is a maximum-size compatible subset among those k whose last-finishing member finishes as early as possible; lastFinish holds that earliest achievable finishing time for a selection of the current size.',
  correctness: 'Exchange argument (greedy stays ahead). Order intervals by finish time. Let greedy pick g_1, g_2, ... and let o_1, o_2, ... be any optimal solution, both sorted by finish time. Claim: finish(g_i) <= finish(o_i) for all i, by induction. Base i=1: greedy picks the globally earliest-finishing interval, so finish(g_1) <= finish(o_1). Step: assume finish(g_{i-1}) <= finish(o_{i-1}). Since o_i is compatible with o_{i-1}, start(o_i) >= finish(o_{i-1}) >= finish(g_{i-1}), so o_i is also compatible with the greedy choice so far and was a candidate when greedy chose g_i; greedy takes the earliest-finishing candidate, hence finish(g_i) <= finish(o_i). Now suppose greedy produced fewer intervals than optimal, |greedy| = m < |OPT|. Then o_{m+1} exists with start(o_{m+1}) >= finish(o_m) >= finish(g_m), so o_{m+1} is compatible with all of the greedy picks and greedy would not have stopped — contradiction. Therefore |greedy| = |OPT|, and greedy is optimal. (Equivalently: swap o_1 for g_1 — legal since g_1 finishes no later, so it stays compatible with o_2,... — to get another optimal solution agreeing with greedy on the first pick, then induct.) Termination: a single linear scan over a finite sorted array.',
  timeComplexity: 'O(n log n), dominated by the sort; the selection scan is O(n).',
  spaceComplexity: 'O(1) auxiliary beyond the input (or O(n) if the sort is not in place / input must be preserved).',
  cpp: `#include <vector>
#include <algorithm>
#include <climits>
using namespace std;

struct Interval { int start, finish; };   // half-open [start, finish)

// Maximum number of mutually non-overlapping intervals (activity selection).
int maxNonOverlapping(vector<Interval> v) {
    // Earliest finish first: the greedy choice that leaves the most room after it.
    sort(v.begin(), v.end(),
         [](const Interval& a, const Interval& b) { return a.finish < b.finish; });

    int count = 0;
    long long lastFinish = LLONG_MIN;      // when the room last became free
    for (const auto& iv : v) {
        if (iv.start >= lastFinish) {      // compatible with everything chosen so far
            ++count;
            lastFinish = iv.finish;
        }
    }
    return count;
}`,
  python: `from typing import List, Tuple

def max_non_overlapping(intervals: List[Tuple[int, int]]) -> int:
    """Each interval is (start, finish), half-open [start, finish).
    Returns the max number of mutually non-overlapping intervals."""
    # Sort by finish time: greedily keep the interval that frees up soonest.
    intervals.sort(key=lambda iv: iv[1])

    count = 0
    last_finish = float("-inf")            # room-free time
    for start, finish in intervals:
        if start >= last_finish:           # compatible with all chosen so far
            count += 1
            last_finish = finish
    return count`,
  pitfalls: [
    'Sorting by start time (or by shortest duration) instead of earliest finish. Both are intuitive and both are provably NON-optimal; only earliest-finish-time survives the exchange argument.',
    'Getting the boundary wrong for touching intervals. With half-open [s, f), start == lastFinish is compatible (use s >= lastFinish); if intervals are closed and endpoints conflict, require s > lastFinish.',
    'Reformulating a related problem incorrectly: "minimum intervals to remove so the rest are non-overlapping" is n minus this maximum, not a separate algorithm.',
    'Assuming this maximizes total covered TIME or weighted value. Earliest-finish greedy maximizes the COUNT of intervals; weighted interval scheduling needs DP (sort + binary search), not greedy.'
  ],
  problems: [
    { name: 'Non-overlapping Intervals', url: 'https://leetcode.com/problems/non-overlapping-intervals/', note: 'Minimum removals = n minus the max compatible set; identical earliest-finish greedy.' },
    { name: 'Minimum Number of Arrows to Burst Balloons', url: 'https://leetcode.com/problems/minimum-number-of-arrows-to-burst-balloons/', note: 'Sort by end coordinate; each new arrow is placed at the earliest end that a balloon does not already cover.' },
    { name: 'Maximum Length of Pair Chain', url: 'https://leetcode.com/problems/maximum-length-of-pair-chain/', note: 'Directly the activity-selection maximum on pairs sorted by second element.' }
  ]
},
];

/** Days since the Unix epoch (UTC), used to rotate the entry deterministically per day. */
function epochDay(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

/** The algorithm for a given day (defaults to today), rotating through the catalogue. */
export function algoOfDay(d: Date = new Date()): AlgoEntry {
  const n = ALGORITHMS.length;
  const i = ((epochDay(d) % n) + n) % n;
  return ALGORITHMS[i]!;
}
