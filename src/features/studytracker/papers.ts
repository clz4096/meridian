/**
 * Paper of the Week + Keshav 3-pass reproduce loop. A curated list of
 * foundational papers rotates weekly; each is worked with Keshav's three-pass
 * method (triage, grasp, reproduce), with the third pass anchored by a concrete
 * reproduce/extend step. Per-paper pass progress is ORDINARY-tier state in
 * `meridian.papers.v1` (namespaced localStorage).
 */
import { signal } from '@preact/signals';

export interface Paper {
  title: string;
  authors: string;
  year: number;
  url: string;
  area: string;
  why: string;
  reproduce: string;
}

/** Keshav's three-pass method (fixed structure). */
export const KESHAV_PASSES: ReadonlyArray<{ n: number; name: string; desc: string }> = [
  { n: 1, name: 'Triage', desc: '~10 min: title, abstract, intro, section headings, conclusions, references. Get the five Cs (category, context, correctness, contributions, clarity) and decide whether to go deeper.' },
  { n: 2, name: 'Grasp', desc: '~1 hr: read for the argument, scrutinize the figures, but ignore the proofs. You should be able to summarize the main thrust to someone else.' },
  { n: 3, name: 'Reproduce', desc: 'Virtually (or actually) re-implement the paper: reconstruct its results from the assumptions, then do the reproduce step below. This is where mastery is built.' },
];

export const PAPERS: readonly Paper[] = [
{
  title: "The Complexity of Theorem-Proving Procedures",
  authors: "Cook (1971)",
  year: 1971,
  url: "https://doi.org/10.1145/800157.805047",
  area: "Complexity",
  why: "Introduces the notion of NP-completeness and proves that Boolean satisfiability (SAT) is NP-complete via polynomial-time reductions on nondeterministic Turing machines. It reframed 'is this problem hard?' as 'is it as hard as SAT?', founding the theory of intractability that all of complexity theory builds on.",
  reproduce: "Implement a naive DPLL SAT solver in C++, then write a reduction from 3-COLORING of small graphs to SAT and feed the generated CNF to your solver; confirm colorable/uncolorable answers match a brute-force checker on graphs up to ~12 vertices."
},
{
  title: "Reducibility Among Combinatorial Problems",
  authors: "Karp (1972)",
  year: 1972,
  url: "https://doi.org/10.1007/978-1-4684-2001-2_9",
  area: "Complexity",
  why: "Shows that 21 natural combinatorial problems (CLIQUE, VERTEX COVER, HAMILTONIAN CIRCUIT, SUBSET-SUM, etc.) are all NP-complete by chaining polynomial reductions from Cook's SAT. It converted NP-completeness from a single curiosity into a pervasive phenomenon and gave the working reduction toolkit still taught today.",
  reproduce: "Implement the classic chain 3-SAT to CLIQUE to VERTEX COVER as explicit graph transformations, and empirically verify on random small instances that a solution to the target problem maps back to a satisfying assignment (and vice versa)."
},
{
  title: "A Mathematical Theory of Communication",
  authors: "Shannon (1948)",
  year: 1948,
  url: "https://doi.org/10.1002/j.1538-7305.1948.tb01338.x",
  area: "Information Theory",
  why: "Defines entropy as the measure of information, establishes the source-coding and noisy-channel coding theorems, and proves that reliable communication is possible up to a channel's capacity. It founded information theory and underpins compression, coding, and much of modern ML.",
  reproduce: "Implement Huffman coding in Python, compress a text corpus, and plot achieved bits/symbol against the empirical Shannon entropy H = -sum p log2 p to show the code lands within one bit of the entropy bound."
},
{
  title: "A Note on Two Problems in Connexion with Graphs",
  authors: "Dijkstra (1959)",
  year: 1959,
  url: "https://doi.org/10.1007/BF01386390",
  area: "Algorithms",
  why: "Presents the single-source shortest-path algorithm (and a minimum-spanning-tree method) in a two-page note. Dijkstra's algorithm is the canonical greedy graph algorithm and the backbone of routing, planning, and network analysis.",
  reproduce: "Implement Dijkstra with a binary heap in C++, then benchmark it against a Fibonacci-heap or d-ary-heap variant on sparse vs. dense random graphs and plot runtime vs. edge density to observe where the theoretical O(E + V log V) advantage actually shows up."
},
{
  title: "Quicksort",
  authors: "Hoare (1962)",
  year: 1962,
  url: "https://doi.org/10.1093/comjnl/5.1.10",
  area: "Algorithms",
  why: "Introduces in-place partition-based sorting with O(n log n) average time and tiny constants, plus the recursive divide-and-conquer framing. Quicksort remains the default general-purpose sort and a case study in average-case vs. worst-case analysis.",
  reproduce: "Implement Quicksort in C++ with three pivot strategies (first element, median-of-three, random), then measure comparison counts on sorted, reverse-sorted, and random inputs to reproduce the worst-case blowup and show randomization restores expected O(n log n)."
},
{
  title: "MapReduce: Simplified Data Processing on Large Clusters",
  authors: "Dean & Ghemawat (2004)",
  year: 2004,
  url: "https://research.google.com/archive/mapreduce-osdi04.pdf",
  area: "Distributed Systems",
  why: "Introduces a programming model that hides parallelism, fault tolerance, and data distribution behind two user functions, map and reduce. It made large-scale batch data processing accessible to ordinary programmers and seeded the entire big-data ecosystem (Hadoop, Spark).",
  reproduce: "Build a single-machine MapReduce harness in Python with a worker pool and implement word-count plus an inverted index on top of it; then inject a simulated worker crash and verify task re-execution produces identical output."
},
{
  title: "In Search of an Understandable Consensus Algorithm",
  authors: "Ongaro & Ousterhout (2014)",
  year: 2014,
  url: "https://raft.github.io/raft.pdf",
  area: "Distributed Systems",
  why: "Presents Raft, a consensus protocol designed for understandability, decomposing agreement into leader election, log replication, and safety. It gave the field a teachable, implementable alternative to Paxos and is the basis of many production systems (etcd, Consul).",
  reproduce: "Implement leader election and log replication for a 3-node in-process Raft cluster with message-passing over channels, then kill the leader mid-run and assert that a new leader is elected and committed log entries survive."
},
{
  title: "The PageRank Citation Ranking: Bringing Order to the Web",
  authors: "Page, Brin, Motwani & Winograd (1999)",
  year: 1999,
  url: "http://ilpubs.stanford.edu:8090/422/",
  area: "Algorithms",
  why: "Models web importance as the stationary distribution of a random surfer on the link graph, computed as the dominant eigenvector via power iteration with damping. It turned link structure into a global ranking signal and launched modern web search.",
  reproduce: "Build the PageRank power-iteration in Python on a small crawled or synthetic link graph (a few thousand nodes), verify convergence of the L1 residual, and reproduce the effect of the damping factor d on the rank distribution."
},
{
  title: "Attention Is All You Need",
  authors: "Vaswani et al. (2017)",
  year: 2017,
  url: "https://arxiv.org/abs/1706.03762",
  area: "ML",
  why: "Introduces the Transformer, an architecture built entirely on self-attention that dispenses with recurrence and convolution, enabling massive parallelism and long-range dependency modeling. It is the foundation of essentially all modern large language models.",
  reproduce: "Implement scaled dot-product and multi-head attention from scratch in PyTorch (no nn.Transformer), train a tiny 2-layer model on a copy or sort toy task, and visualize the attention matrices to confirm the heads learn the expected alignment."
},
{
  title: "A Theory of the Learnable",
  authors: "Valiant (1984)",
  year: 1984,
  url: "https://doi.org/10.1145/1968.1972",
  area: "ML",
  why: "Defines the PAC (Probably Approximately Correct) learning framework, formalizing what it means to learn a concept class efficiently from examples with high-probability, low-error guarantees. It founded computational learning theory and links sample complexity to hypothesis-class structure.",
  reproduce: "Empirically test the PAC sample-complexity bound for learning axis-aligned rectangles in the plane: draw m samples for increasing m, fit the tightest consistent rectangle, and plot measured generalization error against the theoretical (1/eps) ln(1/delta) bound."
},
{
  title: "A Proof for the Queuing Formula: L = lambda W",
  authors: "Little (1961)",
  year: 1961,
  url: "https://doi.org/10.1287/opre.9.3.383",
  area: "Queueing Theory",
  why: "Gives the first general proof of Little's Law, that the average number in a system equals arrival rate times average time in system, with no assumptions on arrival or service distributions. It is the workhorse identity of performance analysis, capacity planning, and systems benchmarking.",
  reproduce: "Write a discrete-event simulator for an M/M/1 queue in C++, measure long-run average occupancy L, arrival rate lambda, and mean sojourn time W independently, and confirm L = lambda*W holds within sampling error across several utilization levels."
},
];

/** Days since epoch / 7, so the pick advances once per week and is stable within it. */
export function paperOfWeek(d: Date = new Date()): Paper | undefined {
  if (!PAPERS.length) return undefined;
  const week = Math.floor(d.getTime() / (7 * 86_400_000));
  const n = PAPERS.length;
  return PAPERS[((week % n) + n) % n];
}

/* ── per-paper 3-pass progress ── */
export type PaperProgress = Record<string, [boolean, boolean, boolean]>;
const KEY = 'meridian.papers.v1';

function load(): PaperProgress {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as PaperProgress;
  } catch {
    /* ignore */
  }
  return {};
}

export const paperProgress = signal<PaperProgress>(load());

/** Stable key for a paper (title is unique in the catalogue). */
export function paperKey(p: Paper): string {
  return p.title;
}

export function togglePass(p: Paper, pass: 0 | 1 | 2): void {
  const k = paperKey(p);
  const cur = paperProgress.value[k] ?? [false, false, false];
  const next: [boolean, boolean, boolean] = [cur[0], cur[1], cur[2]];
  next[pass] = !next[pass];
  const merged = { ...paperProgress.value, [k]: next };
  paperProgress.value = merged;
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
}
