/**
 * The catalog loads per track: a screen fetches only the tracks it shows (the
 * CS path only cst, the Cambridge path step and courses, a study item its own
 * track), and reading a path whose tracks have not loaded fails loudly rather
 * than drawing an empty plan.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const fresh = async () => {
  vi.resetModules();
  return import('@/features/cambridge/catalog');
};

describe('catalog: per-track loading', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('nothing is loaded up front, and listing a path before its load throws', async () => {
    const c = await fresh();
    expect(c.tracksLoaded(['step'])).toBe(false);
    expect(c.catalog().items.size).toBe(0);
    expect(() => c.pathPhases('math')).toThrow(/not loaded/);
    expect(() => c.currentFor({ items: {}, gates: {} } as never, 'cst', 0)).toThrow(/not loaded/);
  });

  it('the CS path loads only the CST track', async () => {
    const c = await fresh();
    await c.loadPath('cst');
    expect(c.tracksLoaded(['cst'])).toBe(true);
    expect(c.tracksLoaded(['step'])).toBe(false);
    expect(c.tracksLoaded(['courses'])).toBe(false);
    expect(c.pathPhases('cst').length).toBeGreaterThan(0);
    expect([...c.catalog().items.values()].every((it) => it.track === 'cst')).toBe(true);
  });

  it('the Cambridge path loads STEP and Part IA, not the CST track', async () => {
    const c = await fresh();
    await c.loadPath('math');
    expect(c.tracksLoaded(['step', 'courses'])).toBe(true);
    expect(c.tracksLoaded(['cst'])).toBe(false);
    expect(c.pathPhases('math').map((p) => p.key)).toEqual(['0', 'A', 'A+', 'B', 'C', 'D', 'IA']);
    // Part IA's locked line names a STEP phase: it is built with the whole catalog, so it survives the split.
    expect(c.catalog().phases.get('IA')!.lockedText).toBe("Unlocks when Phase B's gate passes.");
  });

  it('a study item loads its own track; an id not in the plan loads nothing', async () => {
    const c = await fresh();
    expect(c.trackOf('found-01')).toBe('step');
    expect(c.trackOf('ia-groups-s2')).toBe('courses');
    expect(c.trackOf('nope')).toBeUndefined();
    await c.loadItem('ia-groups-s2');
    expect(c.tracksLoaded(['courses'])).toBe(true);
    expect(c.tracksLoaded(['step'])).toBe(false);
    expect(c.catItem('ia-groups-s2')!.title).toBe('Groups, sheet 2');
    await c.loadItem('nope');
    expect(c.catItem('nope')).toBeUndefined();
  });

  it('the split tracks together equal the whole catalog', async () => {
    const c = await fresh();
    await c.loadCatalog();
    const { buildCatalog } = await import('@/features/cambridge/catalogBuild');
    const whole = buildCatalog();
    expect([...c.catalog().items.keys()]).toEqual([...whole.items.keys()]);
    expect(JSON.parse(JSON.stringify([...c.catalog().items.values()]))).toEqual(JSON.parse(JSON.stringify([...whole.items.values()])));
    expect(JSON.parse(JSON.stringify(c.catalog().tracks))).toEqual(JSON.parse(JSON.stringify(whole.tracks)));
  });

  it('no screen imports the builder or the curriculum JSON, so none ships the raw data', () => {
    for (const f of [
      'src/features/cambridge/catalog.ts', 'src/features/cambridge/CambridgePath.tsx', 'src/features/paths/CSPath.tsx',
      'src/features/cambridge/StudyItem.tsx', 'src/features/cambridge/ErrorLog.tsx', 'src/ui/App.tsx',
    ]) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      // Type-only imports are erased; a value import would pull the JSON in.
      expect(src, f).not.toMatch(/^import (?!type )[^;]*from '@\/features\/cambridge\/catalogBuild'/m);
      expect(src, f).not.toMatch(/@data\/cambridge\/(step|courses|cs|underground)\.json/);
    }
  });
});
