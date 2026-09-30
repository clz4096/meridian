/**
 * The catalog adapter over the committed curriculum JSON: phase order, unlock
 * rules (Part IA waits for the Phase B gate), hint links, gate evidence rules,
 * the supervisor prompt, and the entries currentItem() reads.
 */
import { describe, expect, it } from 'vitest';
import stepJson from '@data/cambridge/step.json';
import coursesJson from '@data/cambridge/courses.json';
import {
  catalog, catalogEntries, currentBlock, currentFor, evidenceRule, gateBlocker, isHintLink, itemDone, pathPhases,
  loadCatalog, phaseState, supervisorPrompt, type CatPhase,
} from '@/features/cambridge/catalog';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';

const NOW = Date.UTC(2026, 9, 1, 16); // Thu 1 Oct 2026, noon in Brooklyn

await loadCatalog();

const withGates = (...keys: string[]): CambridgeState => {
  const s = emptyCambridge();
  for (const k of keys) s.gates[k] = { phase: k, passedAt: NOW, evidence: {}, updatedAt: NOW };
  return s;
};
const phase = (key: string): CatPhase => catalog().phases.get(key)!;
const item = (id: string, patch: Partial<CamItem>): CamItem => ({ id, stage: 'not-started', questions: {}, updatedAt: NOW, ...patch });

describe('catalog: tracks', () => {
  it('the Math path lists 0, A, A+, B, C, D, then Part IA', () => {
    expect(pathPhases('math').map((p) => p.key)).toEqual(['0', 'A', 'A+', 'B', 'C', 'D', 'IA']);
    expect(pathPhases('math').map((p) => p.name)).toEqual(['Phase 0', 'Phase A', 'Phase A+', 'Phase B', 'Phase C', 'Phase D', 'Part IA']);
  });

  it('every step.json item is in the catalog, with its questions', () => {
    for (const it of stepJson.items) {
      const c = catalog().items.get(it.id)!;
      expect(c.title).toBe(it.title);
      expect(c.questions.map((q) => q.id)).toEqual(it.questions.map((q) => q.id));
    }
  });

  it('Part IA has one item per example sheet, in term order', () => {
    const ia = phase('IA');
    const sheets = coursesJson.courses.reduce((n, c) => n + c.sheets.length, 0);
    expect(ia.items).toHaveLength(sheets);
    expect(ia.blocks.map((b) => b.id)).toEqual(['michaelmas', 'lent', 'easter']);
    const first = catalog().items.get('ia-numbers-and-sets-s1')!;
    expect(first.title).toBe('Numbers and Sets, sheet 1');
    // The owner has not listed the sheet's questions yet, so it is one question.
    expect(first.questions).toEqual([{ id: 'all', label: 'The whole sheet', step: undefined }]);
  });

  it('Phase 0 is a first pass at Assignment 1; Phase A is 6 blocks', () => {
    expect(phase('0').items).toEqual(['found-01']);
    expect(phase('A').blocks.map((b) => b.name)).toEqual(['Block 1', 'Block 2', 'Block 3', 'Block 4', 'Block 5', 'Block 6']);
  });

  it('entries are unique and carry the phase key', () => {
    const entries = [...catalogEntries('step'), ...catalogEntries('courses')];
    // Phase 0 reuses found-01, so it appears twice: once per phase.
    expect(entries.filter((e) => e.id === 'found-01').map((e) => e.phase)).toEqual(['0', 'A']);
    const rest = entries.filter((e) => e.id !== 'found-01');
    expect(new Set(rest.map((e) => e.id)).size).toBe(rest.length);
  });
});

describe('catalog: links', () => {
  it('hints, solutions and worked-solution videos are hint links', () => {
    expect(isHintLink({ kind: 'hints' })).toBe(true);
    expect(isHintLink({ kind: 'solutions' })).toBe(true);
    expect(isHintLink({ kind: 'video', role: 'worked-solution' })).toBe(true);
    expect(isHintLink({ kind: 'assignment' })).toBe(false);
    const a1 = catalog().items.get('found-01')!;
    expect(a1.links.filter((l) => l.hint).map((l) => l.kind)).toEqual(['hints', 'video']);
  });

  it('a block item lists its Underground stations as suggested', () => {
    const stations = catalog().items.get('found-01')!.links.filter((l) => l.kind === 'station');
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.every((l) => l.suggested && !l.hint && l.url.startsWith('https://undergroundmathematics.org/'))).toBe(true);
  });
});

describe('catalog: unlocks and phase states', () => {
  const states = (s: CambridgeState): Record<string, string> =>
    Object.fromEntries(pathPhases('math').map((p) => [p.key, phaseState(s, p)]));

  it('a fresh start: only Phase 0 is open', () => {
    expect(states(emptyCambridge())).toEqual({ 0: 'current', A: 'locked', 'A+': 'locked', B: 'locked', C: 'locked', D: 'locked', IA: 'locked' });
  });

  it('passing A opens A+ and B together', () => {
    expect(states(withGates('0', 'A'))).toMatchObject({ 0: 'passed', A: 'passed', 'A+': 'current', B: 'current', C: 'locked', IA: 'locked' });
  });

  it("Part IA unlocks with Phase B's gate, and A+ ends with B", () => {
    expect(states(withGates('0', 'A', 'B'))).toMatchObject({ 'A+': 'passed', B: 'passed', C: 'current', IA: 'current' });
  });

  it('locked phases name the gate they wait for', () => {
    expect(phase('A').requires).toEqual(['0']);
    expect(phase('A+').requires).toEqual(['A']);
    expect(phase('B').requires).toEqual(['A']);
    expect(phase('IA').requires).toEqual(['B']);
    expect(phase('IA').lockedText).toBe("Unlocks when Phase B's gate passes.");
    expect(phase('0').requires).toEqual([]);
  });
});

describe('catalog: blocks and the gate', () => {
  it('the current block is the first with work left', () => {
    const s = withGates('0');
    for (const id of ['found-01', 'found-02', 'found-03', 'found-04']) s.items[id] = item(id, { stage: 'redo-done' });
    expect(currentBlock(s, phase('A')).id).toBe('2');
  });

  it('an item is done once supervised with no redo left, or redone', () => {
    expect(itemDone(item('x', { stage: 'supervised' }))).toBe(true);
    expect(itemDone(item('x', { stage: 'supervised', redoQs: ['Q1'] }))).toBe(false);
    expect(itemDone(item('x', { stage: 'supervised', redoQs: ['Q1'], redoneAt: NOW }))).toBe(true);
    expect(itemDone(item('x', { stage: 'written-up' }))).toBe(false);
  });

  it("the gate waits for every item in the phase's last block to be supervised", () => {
    const s = withGates('0');
    expect(gateBlocker(s, phase('A'))).toBe('4 items still to supervise');
    for (const id of ['found-22', 'found-23', 'found-24']) s.items[id] = item(id, { stage: 'supervised' });
    expect(gateBlocker(s, phase('A'))).toBe('1 item still to supervise');
    s.items['found-25'] = item('found-25', { stage: 'redo-done' });
    expect(gateBlocker(s, phase('A'))).toBe('');
  });

  it('evidence rules come from the field labels', () => {
    const r = (label: string, type: 'text' | 'number' | 'yesno' = 'number') => evidenceRule({ key: 'k', label, type });
    expect(r('Questions at 14/20 or more (need 4)').text).toBe('4 or more to pass');
    expect(r('Questions at 14/20 or more (need 4)').ok('3')).toBe(false);
    expect(r('Questions at 14/20 or more (need 4)').ok('4')).toBe(true);
    expect(r('Time on the STEP question (minutes, under 60)').ok('59')).toBe(true);
    expect(r('Time on the STEP question (minutes, under 60)').ok('60')).toBe(false);
    expect(r('Self-mark out of 20').ok('21')).toBe(false);
    expect(r('Time taken (minutes, 180 max)').ok('180')).toBe(true);
    expect(r('Self-mark out of 20').ok('')).toBe(false);
    expect(r('Warm-up done with no help (yes/no)', 'yesno').ok('no')).toBe(false);
    expect(r('Warm-up done with no help (yes/no)', 'yesno').ok('yes')).toBe(true);
    expect(r('Paper (year)', 'text').ok('  ')).toBe(false);
  });
});

describe('catalog: supervisor prompt and the current item', () => {
  it('a STEP item keeps the STEP supervisor and fills the title', () => {
    const p = supervisorPrompt(catalog().items.get('found-07')!);
    expect(p).toContain('Act as my Cambridge STEP supervisor. Today: Assignment 7.');
    expect(p).not.toContain('{item title}');
  });

  it('a Part IA item names its course and sheet', () => {
    const p = supervisorPrompt(catalog().items.get('ia-groups-s2')!);
    expect(p).toContain('Act as my Cambridge Groups supervisor, example sheet 2. Today: Groups, sheet 2.');
    expect(p).not.toContain('STEP supervisor');
  });

  it('currentFor(math) starts on Assignment 1 in Phase 0', () => {
    expect(currentFor(emptyCambridge(), 'math', NOW)).toMatchObject({ itemId: 'found-01', phase: '0', label: 'Assignment 1: attempt cold' });
  });
});
