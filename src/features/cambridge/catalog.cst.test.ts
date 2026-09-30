/**
 * The CST track read from cs.json (DECISIONS C11, docs/cst-track.md): the four
 * CS-0 sub-parts each gated on their own, Part IA opening when all four pass,
 * Part IB waiting for the Part IA gate, the CST supervisor prompt, and a
 * cs.json without a track.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyCambridge, type CambridgeState } from '@/features/cambridge/types';
import * as real from '@/features/cambridge/catalog';

const NOW = Date.UTC(2026, 9, 1, 16);

const gate = (n: number) => ({ text: `Gate ${n}.`, xp: 200, evidence: [{ key: 'q', label: 'Questions at 14/20 or more (need 3)', type: 'number' }] });
const TRACK = {
  supervisorPrompt: { replaces: 'STEP supervisor', text: '{course} supervisor (Computer Science Tripos), supervision work {n}', codeLanguages: ['OCaml', 'Python'] },
  phases: [
    { id: 'CS-0', order: 0, name: 'Foundations', gate: null, blocks: ['p', 'm'] },
    { id: 'CS-IA', order: 1, name: 'Part IA', gate: gate(3) },
    { id: 'CS-IB', order: 2, name: 'Part IB', gate: null, unlockAfter: ['CS-IA'], triposPart: 'IB' },
  ],
  blocks: [
    { id: 'p', phase: 'CS-0', name: 'Proof', items: ['proof-1'], gate: gate(1) },
    { id: 'm', phase: 'CS-0', name: 'Maths', items: ['maths-1'], gate: gate(2) },
    { id: 'nst', phase: 'CS-IA', name: 'NST Maths (alongside)', items: ['nst-1'], gate: null, alongside: 'CS-IA' },
  ],
  items: [
    { id: 'proof-1', phase: 'CS-0', block: 'p', kind: 'chapter', n: 1, title: 'Book of Proof, chapter 1', questions: [{ id: 'Q1' }] },
    { id: 'maths-1', phase: 'CS-0', block: 'm', kind: 'paper', n: 1, title: 'TMUA 2023, Paper 1', questions: [],
      links: [{ kind: 'answers', label: 'Answer key', url: 'https://example.org/k' }] },
    { id: 'focs', phase: 'CS-IA', kind: 'course', n: 1, title: 'Foundations of Computer Science', questions: [{ id: 'Q1' }] },
    { id: 'discmath', phase: 'CS-IA', kind: 'course', n: 2, title: 'Discrete Mathematics',
      questions: [{ id: 'sw1', label: 'Sheet 1', link: 'https://example.org/sw1' }, { id: 'sw2', label: 'Sheet 2', link: 'https://example.org/sw2' }] },
    { id: 'nst-1', phase: 'CS-IA', block: 'nst', kind: 'paper', n: 1, title: 'NST IA 2025', questions: [{ id: 'Q1' }] },
  ],
};
const TRIPOS = { parts: { IB: { courses: [{ id: 'cs-ib-compiler', name: 'Compiler Construction', url: 'https://www.cl.cam.ac.uk/teaching/2627/CompConstr/' }] } } };

const gates = (...keys: string[]): CambridgeState => {
  const s = emptyCambridge();
  for (const k of keys) s.gates[k] = { phase: k, passedAt: NOW, evidence: {}, updatedAt: NOW };
  return s;
};

// The screens load built tracks (virtual:cambridge-track/*); these are built here
// from the mocked cs.json by the same builder the Vite plugin runs.
const TRACK_IDS = ['step', 'courses', 'cst'] as const;
async function loadWith(cs: object) {
  vi.resetModules();
  vi.doMock('@data/cambridge/cs.json', () => ({ default: cs }));
  const { catalogModules } = await import('@/features/cambridge/catalogBuild');
  const { tracks } = catalogModules();
  vi.doMock('virtual:cambridge-track/step', () => ({ default: tracks.step }));
  vi.doMock('virtual:cambridge-track/courses', () => ({ default: tracks.courses }));
  vi.doMock('virtual:cambridge-track/cst', () => ({ default: tracks.cst }));
  const c = await import('@/features/cambridge/catalog');
  await c.loadCatalog();
  return c;
}
afterEach(() => {
  vi.doUnmock('@data/cambridge/cs.json');
  for (const t of TRACK_IDS) vi.doUnmock(`virtual:cambridge-track/${t}`);
});

describe('catalog: the CST track', () => {
  it('each gated CS-0 sub-part is its own row; gate keys are prefixed', async () => {
    const c = await loadWith({ tripos: TRIPOS, track: TRACK });
    expect(c.pathPhases('cst').map((p) => [p.key, p.name, p.title])).toEqual([
      ['cst:p', 'CS-0 Proof', 'Foundations: proof'],
      ['cst:m', 'CS-0 Maths', 'Foundations: maths'],
      ['cst:CS-IA', 'CS-IA', 'Part IA'],
      ['cst:CS-IB', 'CS-IB', 'Part IB'],
    ]);
  });

  it('Part IA opens when every sub-part passes; Part IB when Part IA does', async () => {
    const c = await loadWith({ tripos: TRIPOS, track: TRACK });
    const st = (s: CambridgeState) => c.pathPhases('cst').map((p) => c.phaseState(s, p));
    expect(st(emptyCambridge())).toEqual(['current', 'current', 'locked', 'locked']);
    expect(st(gates('cst:p'))).toEqual(['passed', 'current', 'locked', 'locked']);
    expect(st(gates('cst:p', 'cst:m'))).toEqual(['passed', 'passed', 'current', 'locked']);
    expect(st(gates('cst:p', 'cst:m', 'cst:CS-IA'))).toEqual(['passed', 'passed', 'passed', 'current']);
    expect(c.catalog().phases.get('cst:CS-IA')!.lockedText).toBe('Unlocks when the CS-0 Proof and CS-0 Maths gates pass.');
    expect(c.catalog().phases.get('cst:CS-IB')!.lockedText).toBe("Unlocks when CS-IA's gate passes.");
  });

  it('Part IA lists its courses first and the alongside block beside them; only the courses gate it', async () => {
    const c = await loadWith({ tripos: TRIPOS, track: TRACK });
    const ia = c.catalog().phases.get('cst:CS-IA')!;
    expect(ia.blocks.map((b) => [b.name, b.items, !!b.alongside])).toEqual([
      ['Courses, suggested order', ['focs', 'discmath'], false],
      ['NST Maths (alongside)', ['nst-1'], true],
    ]);
    expect(c.gateItems(ia)).toEqual(['focs', 'discmath']);
    expect(c.sideBlocks(ia).map((b) => b.id)).toEqual(['nst']);
  });

  it('Part IB lists the Tripos course list with its links', async () => {
    const c = await loadWith({ tripos: TRIPOS, track: TRACK });
    const ib = c.catalog().phases.get('cst:CS-IB')!;
    expect(ib.items).toEqual(['cs-ib-compiler']);
    expect(c.catalog().items.get('cs-ib-compiler')!.links[0]!.url).toBe('https://www.cl.cam.ac.uk/teaching/2627/CompConstr/');
  });

  it('the current CST item skips locked phases', async () => {
    const c = await loadWith({ tripos: TRIPOS, track: TRACK });
    expect(c.currentFor(emptyCambridge(), 'cst', NOW)).toMatchObject({ itemId: 'proof-1' });
    const s = gates('cst:p', 'cst:m');
    s.items['proof-1'] = { id: 'proof-1', stage: 'redo-done', questions: {}, updatedAt: NOW };
    s.items['maths-1'] = { id: 'maths-1', stage: 'redo-done', questions: {}, updatedAt: NOW };
    expect(c.currentFor(s, 'cst', NOW)).toMatchObject({ itemId: 'focs' });
  });

  it('the supervisor prompt uses the CST role with the item title, and the code languages', async () => {
    const c = await loadWith({ tripos: TRIPOS, track: TRACK });
    const p = c.supervisorPrompt(c.catalog().items.get('focs')!);
    // FoCS has no supervision work listed yet, so the clause is dropped.
    expect(p).toContain('Act as my Cambridge Foundations of Computer Science supervisor (Computer Science Tripos). Today:');
    // {n} is the supervision work's own number, not the course's position (2).
    const dm = c.catalog().items.get('discmath')!;
    expect(c.supervisorPrompt(dm, 'sw2')).toContain('Discrete Mathematics supervisor (Computer Science Tripos), supervision work 2.');
    expect(c.supervisorPrompt(dm)).toContain('supervision work 1.');
    expect(dm.links.map((l) => l.url)).toEqual(['https://example.org/sw1', 'https://example.org/sw2']);
    expect(p).toContain('Code questions may be answered in OCaml or Python.');
    expect(c.catalog().items.get('maths-1')!.links[0]!.hint).toBe(true);
  });

  it('cs.json without a track gives an empty CST track and leaves the Math path alone', async () => {
    const c = await loadWith({ tripos: {} });
    expect(c.pathPhases('cst')).toEqual([]);
    expect(c.currentFor(emptyCambridge(), 'cst', NOW)).toBeNull();
    expect(c.pathPhases('math')).toHaveLength(7);
  });
});

describe('catalog: the committed CST track', () => {
  it('reads cs.json: four CS-0 sub-parts, then Part IA, then Part IB', async () => {
    await real.loadPath('cst');
    const phases = real.pathPhases('cst');
    expect(phases.map((p) => p.name)).toEqual([
      'CS-0 Proof', 'CS-0 Maths', 'CS-0 Functional programming', 'CS-0 Pre-arrival checklist', 'CS-IA', 'CS-IB',
    ]);
    expect(real.catalog().phases.get('cst:CS-IA')!.requires).toHaveLength(4);
    expect(real.catalog().phases.get('cst:CS-IB')!.requires).toEqual(['cst:CS-IA']);
    for (const p of phases) for (const id of p.items) expect(real.catalog().items.has(id), id).toBe(true);
  });
});
