/**
 * chart — inline-SVG figure structure. Renders to a string, so we assert on the
 * markup: the right marks, the headline value, the reference line, empty state.
 */
import { describe, expect, it } from 'vitest';
import { chart } from './chart.js';
import type { Point } from './progress.js';

const pts = (vals: number[]): Point[] => vals.map((v, i) => ({ key: `k${i}`, label: `L${i}`, value: v }));

describe('chart', () => {
  it('renders an empty state (no svg) when there are no points', () => {
    const html = chart({ kind: 'line', title: 'Bodyweight', points: [] });
    expect(html).toContain('No data yet');
    expect(html).toContain('Bodyweight');
    expect(html).not.toContain('<svg');
  });

  it('a line chart draws a path, an end marker, and headlines the last value', () => {
    const html = chart({ kind: 'line', title: 'Bodyweight', points: pts([130, 131, 133]), unit: 'lb' });
    expect(html).toContain('<svg');
    expect(html).toContain('<path');
    expect(html).toContain('<circle'); // end marker
    expect(html).toContain('>133 lb<'); // headline = last value + unit
  });

  it('a bar chart draws one rect per point and headlines the sum', () => {
    const html = chart({ kind: 'bar', title: 'XP', points: pts([16, 20, 8]) });
    expect(html.match(/<rect/g)?.length).toBe(3);
    expect(html).toContain('>44<'); // 16+20+8
  });

  it('draws a reference line + label when a target is given', () => {
    const html = chart({ kind: 'line', title: 'Bodyweight', points: pts([130, 133]), reference: { value: 150, label: 'goal' } });
    expect(html).toContain('stroke-dasharray'); // dashed reference line
    expect(html).toContain('>goal<');
  });

  it('applies the value formatter to the headline', () => {
    const html = chart({ kind: 'line', title: 'BW', points: pts([130.4, 131.55]), format: (v) => v.toFixed(1), unit: 'lb' });
    expect(html).toContain('>131.6 lb<'); // last, formatted to 1 dp
  });

  it('respects an explicit summary mode', () => {
    const html = chart({ kind: 'bar', title: 'Cal', points: pts([2000, 3000]), summary: 'avg' });
    expect(html).toContain('>2500<');
  });

  it('escapes the title', () => {
    const html = chart({ kind: 'bar', title: '<x> & "y"', points: pts([1]) });
    expect(html).toContain('&lt;x&gt; &amp; &quot;y&quot;');
    expect(html).not.toContain('<x>');
  });
});
