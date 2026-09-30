/**
 * Contrast regression gate: any token edit that drops a declared pair below its WCAG
 * threshold fails `npm run test`. Same logic as `node scripts/contrast.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkVariant,
  contrast,
  parseVariants,
  resolveToken,
  seriesSeparation,
  simulate,
} from '../../scripts/contrastCore.mjs';

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
const variants = parseVariants(css);

describe('contrast math', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 on white is the well-known 4.54:1 AA boundary grey.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('leaves greys unchanged under deuteranopia simulation', () => {
    expect(simulate('#808080')).toBe('#808080');
  });
});

describe('tokens.css parsing', () => {
  it('finds both variants and B overrides A', () => {
    expect(resolveToken(variants.a, '--bg')).toMatch(/^#/);
    expect(resolveToken(variants.b, '--bg')).not.toBe(resolveToken(variants.a, '--bg'));
    // Non-color tokens are shared, not duplicated.
    expect(variants.b['--sp-4']).toBe(variants.a['--sp-4']);
  });

  it('ignores the reduced-motion override when building the palette', () => {
    expect(variants.a['--dur-2']).toBe('200ms');
  });
});

describe.each(['a', 'b'] as const)('palette variant %s', (key) => {
  const rows = checkVariant(variants[key]);

  it('passes every declared text and non-text pair', () => {
    const failures = rows.filter((r) => !r.pass).map((r) => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)} < ${r.min}`);
    expect(failures).toEqual([]);
  });

  it('keeps the chart series distinguishable in normal vision', () => {
    // 20 delta E reads as a different color at a glance.
    expect(seriesSeparation(variants[key]).normal).toBeGreaterThan(20);
  });
});

it('the default palette keeps series apart under deuteranopia', () => {
  // The reason variant A won (design/palette-decision.md); don't regress it silently.
  expect(seriesSeparation(variants.a).deuteranopia).toBeGreaterThan(15);
});
