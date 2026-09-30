/**
 * Contrast and color-separation checks for src/styles/tokens.css.
 *
 * Pure functions, no I/O, so the same logic runs in three places: the CLI
 * (scripts/contrast.mjs), the vitest regression test, and the /styleguide page,
 * which shows the live ratios next to each swatch.
 *
 * Math: WCAG 2.x relative luminance and contrast ratio; CIE L*a*b* (D65) with
 * CIE76 delta E for "can you tell these apart"; Machado, Oliveira and Fernandes
 * (2009) severity 1.0 matrices for deuteranopia and protanopia simulation, applied
 * in linear RGB.
 */

/* ---------- parsing ---------- */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Return the body of every top-level `selector { ... }` block, skipping at-rules. */
function topLevelBlocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    // At-rules (@media, @font-face, @supports) never hold the palette, so the
    // reduced-motion override cannot leak into a variant's color map.
    if (!selector.startsWith('@')) out.push({ selector, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

function declarations(body) {
  const map = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) map[m[1]] = m[2].trim();
  return map;
}

/**
 * Parse tokens.css into one flat custom-property map per palette variant.
 * Variant A is `:root`; variant B is `:root` overlaid with `:root[data-palette="b"]`.
 */
export function parseVariants(css) {
  const blocks = topLevelBlocks(stripComments(css));
  const a = {};
  const bOnly = {};
  for (const { selector, body } of blocks) {
    const sel = selector.replace(/\s+/g, '').replace(/'/g, '"');
    if (sel === ':root') Object.assign(a, declarations(body));
    else if (sel === ':root[data-palette="b"]') Object.assign(bOnly, declarations(body));
  }
  return { a, b: { ...a, ...bOnly } };
}

/** Follow var(--x) chains to a literal value. Throws on a missing token or a cycle. */
export function resolveToken(map, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`token cycle at ${name}`);
  seen.add(name);
  const raw = map[name];
  if (raw === undefined) throw new Error(`missing token ${name}`);
  const ref = raw.match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);
  return ref ? resolveToken(map, ref[1], seen) : raw;
}

/* ---------- color math ---------- */

/** '#rgb' or '#rrggbb' to [r, g, b] in 0..255. Only opaque hex is accepted on purpose:
 *  a translucent token has no single contrast ratio, so it can't be a text color. */
export function hexToRgb(hex) {
  const h = hex.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) throw new Error(`not an opaque hex color: ${hex}`);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16));
}

const toLinear = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb8 = (lin) => {
  const v = Math.min(1, Math.max(0, lin));
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
};

/** WCAG 2.x relative luminance. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const MACHADO = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
};

/** Simulated appearance of `hex` for a dichromat ('deuteranopia' | 'protanopia'). */
export function simulate(hex, kind = 'deuteranopia') {
  const m = MACHADO[kind];
  const lin = hexToRgb(hex).map(toLinear);
  const out = m.map((row) => toSrgb8(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 delta E. About 2.3 is a just-noticeable difference; 20+ reads as a different color. */
export function deltaE(h1, h2) {
  const [l1, a1, b1] = toLab(h1);
  const [l2, a2, b2] = toLab(h2);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/* ---------- the declared pairs ---------- */

const TEXT = 4.5; // WCAG 1.4.3 normal text
const NON_TEXT = 3; // WCAG 1.4.11 UI components and graphics

const SURFACES = ['--bg', '--surface', '--surface-2'];
const on = (fg, bgs, min, use) => bgs.map((bg) => ({ fg, bg, min, use }));

/**
 * Every foreground/background combination the design system allows. A token pair
 * that isn't listed here must not be used for text; add it here first.
 */
export const PAIRS = [
  ...on('--ink', SURFACES, TEXT, 'body text'),
  ...on('--ink-2', SURFACES, TEXT, 'secondary text'),
  ...on('--ink-3', SURFACES, TEXT, 'faint meta text, captions'),
  ...on('--accent-ink', SURFACES, TEXT, 'links, accent labels'),
  ...on('--ok', ['--bg', '--surface'], TEXT, 'success text'),
  ...on('--warn', ['--bg', '--surface'], TEXT, 'warning text'),
  ...on('--danger', ['--bg', '--surface'], TEXT, 'error text'),
  { fg: '--on-accent', bg: '--accent', min: TEXT, use: 'primary button label' },
  { fg: '--ink', bg: '--peach', min: TEXT, use: 'chip label' },
  { fg: '--ink-2', bg: '--peach', min: TEXT, use: 'chip meta' },
  { fg: '--ink', bg: '--sand', min: TEXT, use: 'tag label' },
  { fg: '--ink', bg: '--accent-wash', min: TEXT, use: 'selected row text' },
  { fg: '--accent-ink', bg: '--accent-wash', min: TEXT, use: 'selected row accent' },
  { fg: '--ink-3', bg: '--accent-wash', min: TEXT, use: 'selected row meta' },
  { fg: '--on-accent', bg: '--accent-ink', min: TEXT, use: 'primary button label, hover' },
  { fg: '--on-accent', bg: '--ok', min: TEXT, use: 'banked button label, done step number' },
  { fg: '--on-accent', bg: '--danger', min: TEXT, use: 'teach badge label' },
  // --m-mastered is --series-2; the mastery word on topic cards and the rail is text.
  ...on('--series-2', ['--bg', '--surface'], TEXT, 'mastered level word'),
  // The intro overlay is a night field: --ink is the background there (landing.css).
  { fg: '--bg', bg: '--ink', min: TEXT, use: 'intro wordmark, Enter label' },
  { fg: '--rule', bg: '--ink', min: TEXT, use: 'intro tagline and hint' },
  { fg: '--accent-2', bg: '--ink', min: TEXT, use: 'intro wordmark accent, Enter hover' },
  { fg: '--sand', bg: '--ink', min: NON_TEXT, use: 'intro Enter border' },
  { fg: '--accent-2', bg: '--ink', min: NON_TEXT, use: 'intro focus ring' },
  // The ring is drawn with outline-offset, so its neighbor is the surface, never the button fill.
  ...on('--focus', SURFACES, NON_TEXT, 'focus ring'),
  ...on('--accent', ['--bg', '--surface'], NON_TEXT, 'primary button edge, progress fill'),
  { fg: '--accent', bg: '--track', min: NON_TEXT, use: 'progress fill vs track' },
  ...on('--rule-strong', ['--bg', '--surface', '--surface-2'], NON_TEXT, 'control borders'),
  ...['--series-1', '--series-2', '--series-3', '--series-4', '--series-5'].flatMap((s) =>
    on(s, ['--bg', '--surface'], NON_TEXT, 'chart series'),
  ),
];

export const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5'];

/** Check every declared pair against one variant's map. */
export function checkVariant(map, pairs = PAIRS) {
  return pairs.map((p) => {
    const fgHex = resolveToken(map, p.fg);
    const bgHex = resolveToken(map, p.bg);
    const ratio = contrast(fgHex, bgHex);
    return { ...p, fgHex, bgHex, ratio, pass: ratio >= p.min };
  });
}

/** Smallest pairwise delta E among the chart series, normal and simulated. */
export function seriesSeparation(map) {
  const hexes = SERIES.map((s) => resolveToken(map, s));
  const minPair = (xs) => {
    let best = Infinity;
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++) best = Math.min(best, deltaE(xs[i], xs[j]));
    return best;
  };
  return {
    normal: minPair(hexes),
    deuteranopia: minPair(hexes.map((h) => simulate(h, 'deuteranopia'))),
    protanopia: minPair(hexes.map((h) => simulate(h, 'protanopia'))),
  };
}

/** How far apart the accent and danger read, so a coral button never looks like an error. */
export function accentDangerSeparation(map) {
  const a = resolveToken(map, '--accent-ink');
  const d = resolveToken(map, '--danger');
  return {
    normal: deltaE(a, d),
    deuteranopia: deltaE(simulate(a, 'deuteranopia'), simulate(d, 'deuteranopia')),
  };
}

/** Summary numbers used by design/palette-decision.md. */
export function scoreVariant(map) {
  const rows = checkVariant(map);
  const text = rows.filter((r) => r.min === TEXT);
  const margin = (xs) => Math.min(...xs.map((r) => r.ratio / r.min));
  return {
    failures: rows.filter((r) => !r.pass).length,
    minTextRatio: Math.min(...text.map((r) => r.ratio)),
    minTextMargin: margin(text),
    minNonTextMargin: margin(rows.filter((r) => r.min === NON_TEXT)),
    bodyRatio: contrast(resolveToken(map, '--ink'), resolveToken(map, '--bg')),
    // Chroma of the page: lower is calmer for long reading, higher is warmer.
    bgChroma: Math.hypot(...toLab(resolveToken(map, '--bg')).slice(1)),
    series: seriesSeparation(map),
    accentDanger: accentDangerSeparation(map),
  };
}
