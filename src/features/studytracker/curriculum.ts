/**
 * Princeton/MIT curriculum track — a proof-and-pset-driven path a theory
 * student would actually follow (COS + MAT + MIT OCW), ordered by prerequisite.
 * Static content; the only mutable state is a per-course "done" checkbox in
 * `meridian.curriculum.v1` (namespaced localStorage). A weekly rotation surfaces
 * one problem set as the "problem set of the week".
 */
import { signal } from '@preact/signals';

export interface PSet {
  name: string;
  url: string;
}
export interface Course {
  code: string;
  school: 'Princeton' | 'MIT';
  name: string;
  track: 'Algorithms' | 'Theory' | 'Math' | 'Systems';
  topics: string;
  text: string;
  url: string;
  psets: PSet[];
  targetWeek: number;
}

export const CURRICULUM: readonly Course[] = [
{
  code: 'MIT 6.042J',
  school: 'MIT',
  name: 'Mathematics for Computer Science',
  track: 'Math',
  topics: 'Logic, proofs, induction, number theory, combinatorics, graph theory, discrete probability',
  text: 'Lehman, Leighton & Meyer, Mathematics for Computer Science (free)',
  url: 'https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-fall-2010/',
  psets: [
    { name: 'Problem Sets', url: 'https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-fall-2010/pages/assignments/' },
  ],
  targetWeek: 1,
},
{
  code: 'MIT 18.01',
  school: 'MIT',
  name: 'Single Variable Calculus',
  track: 'Math',
  topics: 'Limits, differentiation, integration, series, Taylor approximation',
  text: 'Apostol, Calculus, Vol. 1 / OCW lecture notes',
  url: 'https://ocw.mit.edu/courses/18-01-single-variable-calculus-fall-2006/',
  psets: [
    { name: 'Assignments', url: 'https://ocw.mit.edu/courses/18-01-single-variable-calculus-fall-2006/pages/assignments/' },
  ],
  targetWeek: 1,
},
{
  code: 'MIT 18.02',
  school: 'MIT',
  name: 'Multivariable Calculus',
  track: 'Math',
  topics: 'Vectors, partial derivatives, gradients, multiple integrals, vector calculus, Stokes',
  text: 'Apostol, Calculus, Vol. 2 / OCW lecture notes',
  url: 'https://ocw.mit.edu/courses/18-02-multivariable-calculus-fall-2007/',
  psets: [
    { name: 'Assignments', url: 'https://ocw.mit.edu/courses/18-02-multivariable-calculus-fall-2007/pages/assignments/' },
  ],
  targetWeek: 2,
},
{
  code: 'MIT 18.06',
  school: 'MIT',
  name: 'Linear Algebra',
  track: 'Math',
  topics: 'Vector spaces, elimination, four subspaces, orthogonality, eigenvalues, SVD, positive-definite matrices',
  text: 'Strang, Introduction to Linear Algebra',
  url: 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/',
  psets: [
    { name: 'Problem Sets', url: 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/pages/assignments/' },
  ],
  targetWeek: 3,
},
{
  code: 'MIT 6.041SC',
  school: 'MIT',
  name: 'Probabilistic Systems Analysis and Applied Probability',
  track: 'Math',
  topics: 'Probability spaces, random variables, expectation, conditioning, limit theorems, Markov chains',
  text: 'Bertsekas & Tsitsiklis, Introduction to Probability',
  url: 'https://ocw.mit.edu/courses/6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013/',
  psets: [
    { name: 'Problem Sets', url: 'https://ocw.mit.edu/courses/6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013/pages/assignments/' },
  ],
  targetWeek: 4,
},
{
  code: 'COS 226',
  school: 'Princeton',
  name: 'Algorithms and Data Structures',
  track: 'Algorithms',
  topics: 'Union-find, sorting, priority queues, BSTs, hashing, graph algorithms, tries, string search, compression',
  text: 'Sedgewick & Wayne, Algorithms, 4th ed.',
  url: 'https://www.cs.princeton.edu/courses/archive/spring21/cos226/',
  psets: [
    { name: 'Programming Assignments', url: 'https://www.cs.princeton.edu/courses/archive/spring21/cos226/assignments.php' },
    { name: 'Percolation', url: 'https://www.cs.princeton.edu/courses/archive/spring21/cos226/assignments/percolation/specification.php' },
  ],
  targetWeek: 5,
},
{
  code: 'MIT 6.006',
  school: 'MIT',
  name: 'Introduction to Algorithms',
  track: 'Algorithms',
  topics: 'Asymptotics, sorting, hashing, BSTs, graph search, shortest paths, dynamic programming, complexity',
  text: 'Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms (CLRS)',
  url: 'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/',
  psets: [
    { name: 'Assignments', url: 'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/pages/assignments/' },
  ],
  targetWeek: 6,
},
{
  code: 'MIT 18.100A',
  school: 'MIT',
  name: 'Real Analysis',
  track: 'Math',
  topics: 'Sequences, series, continuity, differentiation, Riemann integration, uniform convergence, rigorous proofs',
  text: 'Rudin, Principles of Mathematical Analysis',
  url: 'https://ocw.mit.edu/courses/18-100a-real-analysis-fall-2020/',
  psets: [
    { name: 'Assignments and Exams', url: 'https://ocw.mit.edu/courses/18-100a-real-analysis-fall-2020/pages/assignments-and-exams/' },
  ],
  targetWeek: 6,
},
{
  code: 'MIT 6.046J',
  school: 'MIT',
  name: 'Design and Analysis of Algorithms',
  track: 'Algorithms',
  topics: 'Divide-and-conquer, randomization, amortization, dynamic programming, greedy, network flow, NP-completeness',
  text: 'Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms (CLRS)',
  url: 'https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2015/',
  psets: [
    { name: 'Assignments', url: 'https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2015/pages/assignments/' },
  ],
  targetWeek: 8,
},
{
  code: 'MIT 18.404J',
  school: 'MIT',
  name: 'Theory of Computation',
  track: 'Theory',
  topics: 'Finite automata, regular and context-free languages, Turing machines, decidability, reducibility, complexity classes',
  text: 'Sipser, Introduction to the Theory of Computation',
  url: 'https://ocw.mit.edu/courses/18-404j-theory-of-computation-fall-2020/',
  psets: [
    { name: 'Assignments', url: 'https://ocw.mit.edu/courses/18-404j-theory-of-computation-fall-2020/pages/assignments/' },
  ],
  targetWeek: 9,
},
{
  code: 'COS 522',
  school: 'Princeton',
  name: 'Computational Complexity Theory',
  track: 'Theory',
  topics: 'P, NP, space complexity, polynomial hierarchy, circuits, randomness, interactive proofs, PCP, hardness',
  text: 'Arora & Barak, Computational Complexity: A Modern Approach',
  url: 'https://www.cs.princeton.edu/courses/archive/spring16/cos522/',
  psets: [
    { name: 'Homeworks', url: 'https://www.cs.princeton.edu/courses/archive/spring16/cos522/' },
  ],
  targetWeek: 11,
},
];

/** All (course, pset) pairs, in curriculum order. */
function allPSets(): Array<{ course: Course; pset: PSet }> {
  const out: Array<{ course: Course; pset: PSet }> = [];
  for (const c of [...CURRICULUM].sort((a, b) => a.targetWeek - b.targetWeek))
    for (const p of c.psets) out.push({ course: c, pset: p });
  return out;
}

/** Rotate one problem set per week (stable within the week). */
export function psetOfWeek(d: Date = new Date()): { course: Course; pset: PSet } | undefined {
  const list = allPSets();
  if (!list.length) return undefined;
  const week = Math.floor(d.getTime() / (7 * 86_400_000));
  const n = list.length;
  return list[((week % n) + n) % n];
}

/* ── per-course completion ── */
export type CurriculumChecks = Record<string, boolean>;
const KEY = 'meridian.curriculum.v1';

function load(): CurriculumChecks {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as CurriculumChecks;
  } catch {
    /* ignore */
  }
  return {};
}

export const curriculumChecks = signal<CurriculumChecks>(load());

export function toggleCourse(code: string): void {
  const next = { ...curriculumChecks.value, [code]: !curriculumChecks.value[code] };
  curriculumChecks.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function curriculumSummary(): { done: number; total: number } {
  const c = curriculumChecks.value;
  return { done: CURRICULUM.filter((x) => c[x.code]).length, total: CURRICULUM.length };
}
