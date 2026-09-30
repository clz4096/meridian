/**
 * The build-time catalog index Today reads, and the prompts per exam:
 * - The index is the full catalog's structure, generated from the same data
 *   by the same code, so Today's card and the path screen agree on every
 *   phase, block, item and current item.
 * - Today's card, the tracker link and the CS card never import the full
 *   catalog (it is about 40 KB gzip of JSON; Today boots on every launch).
 * - Part IA and CST prompts talk about Tripos papers, not STEP.
 * - Only questions with a `step` field are STEP questions for the XP.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import indexData from 'virtual:cambridge-index';
import { buildCatalog, toIndex } from '@/features/cambridge/catalogBuild';
import { catalog, currentFor as fullCurrentFor, isStepQuestion, loadCatalog, pathPhases as fullPathPhases, supervisorPrompt } from '@/features/cambridge/catalog';
import { catalogIndex, currentFor, indexItem, pathPhases } from '@/features/cambridge/catalogIndex';
import { emptyCambridge, type CambridgeState } from '@/features/cambridge/types';
import { generateIndex } from '../../../scripts/cambridge/index-plugin.mjs';

const ROOT = resolve(__dirname, '../../..');
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-01T10:00:00Z') + 4 * HOUR;

await loadCatalog();

describe('the catalog index', () => {
  it('is exactly the full catalog reduced to its structure', () => {
    expect(indexData).toEqual(toIndex(buildCatalog()));
  });

  it('the Vite plugin generates the same index from the data files', async () => {
    const { data, inputs } = await generateIndex(ROOT);
    expect(data).toEqual(indexData);
    // A data edit regenerates it in dev: the JSON files are watched.
    expect(inputs.some((f) => f.endsWith('data/cambridge/step.json'))).toBe(true);
  });

  it('lists the same phases and items as the full catalog, with titles and question labels', () => {
    for (const which of ['math', 'cst'] as const) {
      const full = fullPathPhases(which);
      const small = pathPhases(which);
      expect(small.map((p) => [p.key, p.name, p.items, p.requires, !!p.gate, p.blocks.map((b) => b.items)])).toEqual(
        full.map((p) => [p.key, p.name, p.items, p.requires, !!p.gate, p.blocks.map((b) => b.items)]),
      );
    }
    expect(catalogIndex().items.size).toBe(catalog().items.size);
    expect(indexItem('found-01')).toMatchObject({ title: 'Assignment 1', phase: 'A' });
    expect(indexItem('found-01')!.questions.find((q) => q.id === 'main')!.label).toBe('The STEP question');
  });

  it('picks the same current item as the full catalog', () => {
    const states: CambridgeState[] = [emptyCambridge()];
    const s = emptyCambridge();
    s.gates['0'] = { phase: '0', passedAt: NOW - 1000, evidence: {}, updatedAt: 1 };
    s.items['found-01'] = { id: 'found-01', stage: 'supervised', supervisedAt: NOW - 1000, questions: {}, updatedAt: 1 };
    states.push(s);
    for (const st of states) {
      expect(currentFor(st, 'math', NOW)).toEqual(fullCurrentFor(st, 'math', NOW));
      expect(currentFor(st, 'cst', NOW)).toEqual(fullCurrentFor(st, 'cst', NOW));
    }
  });

  it('is small: a fraction of the full catalog', () => {
    expect(JSON.stringify(indexData).length).toBeLessThan(80_000);
  });

  it("Today's card, the tracker link and the CS card never import the full catalog", () => {
    for (const f of ['src/features/cambridge/todayCard.ts', 'src/features/cambridge/trackerLink.ts', 'src/features/paths/cs.ts']) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      expect(src, f).not.toMatch(/from '(\.\/|@\/features\/cambridge\/)catalog(Build)?'/);
      expect(src, f).not.toMatch(/@data\/cambridge\/(step|courses|cs)\.json/);
    }
  });
});

describe('prompts per exam', () => {
  it('a STEP item is marked STEP-style, with a follow-up from the STEP database', () => {
    const p = supervisorPrompt(catalog().items.get('found-07')!);
    expect(p).toContain('Mark each question out of 20, STEP-style.');
    expect(p).toContain('from the STEP database.');
  });

  it('a Part IA item is marked Tripos-style, with a follow-up from past Tripos papers', () => {
    const p = supervisorPrompt(catalog().items.get('ia-groups-s2')!);
    expect(p).toContain('Mark each question out of 20, Tripos-style.');
    expect(p).toContain('from past Tripos papers.');
    expect(p).not.toMatch(/STEP/);
    expect(p).not.toMatch(/\{[a-z -]+\}/);
  });

  it('a CST item is marked Tripos-style, with a follow-up from the CST past papers', () => {
    const cst = [...catalog().items.values()].find((i) => i.track === 'cst')!;
    const p = supervisorPrompt(cst);
    expect(p).toContain('Mark each question out of 20, Tripos-style.');
    expect(p).toContain('from the CST past papers.');
    expect(p).not.toMatch(/STEP/);
    expect(p).not.toMatch(/\{[a-z -]+\}/);
  });
});

describe('STEP questions', () => {
  it('only a question with a STEP source is a STEP question', () => {
    const a1 = catalog().items.get('found-01')!;
    expect(a1.questions.map((q) => [q.id, isStepQuestion(a1, q.id)])).toEqual([
      ['warm-up', false], ['preparation', false], ['main', true], ['warm-down', false],
    ]);
    const sheet = catalog().items.get('ia-groups-s2')!;
    expect(sheet.questions.some((q) => isStepQuestion(sheet, q.id))).toBe(false);
  });
});
