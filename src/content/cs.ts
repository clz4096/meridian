/**
 * Computer Science path content: the ordered CS courses (algorithms, theory, systems;
 * plan order = array order). Plain data, edit freely. The Massey Standard curriculum
 * (studytracker/curriculum.ts) reads these same records. The algorithm of the day
 * comes from studytracker/algorithms.ts.
 */
import type { Course } from '@/content/courseTypes';

export const CS_COURSES: readonly Course[] = [
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

/**
 * Current-course pointer. `null` means "the first not-done course in plan order".
 * Set it to a course code to feature that course as current while it is not done,
 * e.g. when taking courses out of order; once it is checked done the plan order resumes.
 */
export const CS_CURRENT: string | null = null;
