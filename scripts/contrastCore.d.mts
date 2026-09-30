/** Types for scripts/contrastCore.mjs, so TypeScript callers (tests, /styleguide) get checked. */
export type TokenMap = Record<string, string>;

export interface Pair {
  fg: string;
  bg: string;
  min: number;
  use: string;
}

export interface PairResult extends Pair {
  fgHex: string;
  bgHex: string;
  ratio: number;
  pass: boolean;
}

export interface Separation {
  normal: number;
  deuteranopia: number;
  protanopia: number;
}

export interface VariantScore {
  failures: number;
  minTextRatio: number;
  minTextMargin: number;
  minNonTextMargin: number;
  bodyRatio: number;
  bgChroma: number;
  series: Separation;
  accentDanger: { normal: number; deuteranopia: number };
}

export function parseVariants(css: string): { a: TokenMap; b: TokenMap };
export function resolveToken(map: TokenMap, name: string, seen?: Set<string>): string;
export function hexToRgb(hex: string): [number, number, number];
export function luminance(hex: string): number;
export function contrast(fg: string, bg: string): number;
export function simulate(hex: string, kind?: 'deuteranopia' | 'protanopia'): string;
export function toLab(hex: string): [number, number, number];
export function deltaE(h1: string, h2: string): number;
export const PAIRS: Pair[];
export const SERIES: string[];
export function checkVariant(map: TokenMap, pairs?: Pair[]): PairResult[];
export function seriesSeparation(map: TokenMap): Separation;
export function accentDangerSeparation(map: TokenMap): { normal: number; deuteranopia: number };
export function scoreVariant(map: TokenMap): VariantScore;
