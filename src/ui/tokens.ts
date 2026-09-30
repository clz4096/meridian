/**
 * JS mirror of the design tokens in src/styles/tokens.css (palette A, "Cream and Coral").
 * Only code that cannot read CSS variables (Three.js materials in the intro) needs these
 * values; everything else should use `var(--name)` or `readToken`, which reads the live
 * CSS value so palette B and any future change flow through. Keep these hexes equal to
 * tokens.css.
 *
 * The keys are the old role names the intro still asks for; each comment names the
 * token it now mirrors (design/token-map.md).
 */

export const TOKENS = {
  void: '#FAF6F0', // --bg: the page field
  core: '#C8432E', // --accent: node cores, the primary accent
  hub: '#B03A26', // --accent-ink: the one emphasized node and its label
  edge: '#E7DDD0', // --rule: hairline web
  ring: '#948272', // --rule-strong: the meridian ring
  text: '#2A211C', // --ink
  muted: '#584A40', // --ink-2
  faint: '#6F6054', // --ink-3
  accent2: '#EE9A82', // --accent-2: intro node glow and ring on the night field
  peach: '#F9DCC8', // --peach: the intro's emphasized hub node
  sand: '#E9DAC4', // --sand: the intro's edge web
} as const;

/** Chart series, in order of use (--series-1 to --series-5). */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'] as const;

/**
 * Solid hues for Three line materials, which carry `opacity` separately from `color`.
 * They mirror --rule-strong and --ink-3: on a light page a line needs a darker hue than
 * the CSS hairline to stay visible once the material's opacity is applied.
 */
export const EDGE_SOLID = '#948272';
export const RING_SOLID = '#6F6054';

/** Read a live CSS custom property (so `:root` can override at launch); falls back to `fallback`. */
export function readToken(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
