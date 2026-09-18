/**
 * Princeton Theory of Computation group — a reading section pointing at the
 * group itself (home, Theory Lunch, faculty) and a handful of representative
 * papers by its members. Static reference content; facts verified against the
 * group's own pages.
 */
export interface GroupPaper {
  title: string;
  authors: string;
  year: number;
  url: string;
  why: string;
}

export const GROUP_INFO = {
  url: 'https://theory.cs.princeton.edu/',
  lunch: 'Theory Lunch (the Princeton TCS Seminar) meets Fridays 12:15–1:15 pm, with food around noon; talks in the CS building and on Zoom.',
  blurb: "Princeton's Theoretical Computer Science group studies the mathematical foundations of computing: computational complexity, algorithms, cryptography, communication and information complexity, and pseudorandomness, plus algorithmic game theory, ML theory, and computational geometry.",
  faculty: 'Sanjeev Arora, Mark Braverman, Bernard Chazelle, Zeev Dvir, Gillat Kol, Pravesh Kothari, Ran Raz, Robert Tarjan, Matt Weinberg, Huacheng Yu',
};

export const PRINCETON_THEORY: readonly GroupPaper[] = [
  {
    title: 'Computational Complexity: A Modern Approach',
    authors: 'Arora & Barak',
    year: 2009,
    url: 'https://theory.cs.princeton.edu/complexity/',
    why: "The standard graduate text on complexity, by Princeton's Sanjeev Arora with Boaz Barak. A full draft is free from the official book page, making it the best single entry point to the field.",
  },
  {
    title: 'Proof Verification and the Hardness of Approximation Problems',
    authors: 'Arora, Lund, Motwani, Sudan & Szegedy',
    year: 1998,
    url: 'https://doi.org/10.1145/278298.278306',
    why: 'One half of the PCP theorem: every NP proof can be checked by reading only a constant number of bits. It reshaped complexity theory and showed many optimization problems are hard even to approximate.',
  },
  {
    title: 'Efficiency of a Good But Not Linear Set Union Algorithm',
    authors: 'Tarjan',
    year: 1975,
    url: 'https://doi.org/10.1145/321879.321884',
    why: "Robert Tarjan's classic analysis of union-find with path compression and union by rank, proving the near-linear inverse-Ackermann bound. A model of tight amortized analysis.",
  },
  {
    title: 'A Parallel Repetition Theorem',
    authors: 'Raz',
    year: 1998,
    url: 'https://doi.org/10.1137/S0097539795280895',
    why: 'Ran Raz proved that repeating a two-prover one-round game in parallel drives the error down exponentially. A cornerstone of hardness-of-approximation and interactive proofs.',
  },
  {
    title: 'Polylogarithmic Independence Fools AC0 Circuits',
    authors: 'Braverman',
    year: 2010,
    url: 'https://doi.org/10.1145/1754399.1754401',
    why: 'Mark Braverman settled the Linial–Nisan conjecture: constant-depth circuits cannot distinguish polylog-wise independent distributions from uniform. A landmark in circuit complexity and pseudorandomness.',
  },
  {
    title: 'A Nearly Tight Sum-of-Squares Lower Bound for the Planted Clique Problem',
    authors: 'Barak, Hopkins, Kelner, Kothari, Moitra & Potechin',
    year: 2016,
    url: 'https://arxiv.org/abs/1604.03084',
    why: "With Princeton's Pravesh Kothari among the authors, this introduces pseudo-calibration to prove sum-of-squares lower bounds for planted clique. A modern touchstone for average-case hardness.",
  },
];
