/**
 * Validates data/cambridge/*.json: each file against its JSON Schema (schema/<name>.schema.json),
 * then the cross-file rules a schema cannot express (unique ids, references that must
 * resolve, block coverage, phase order, https-only links).
 *
 * The validator covers only the JSON Schema subset the schemas use: type (string or
 * array), required, properties, additionalProperties: false, items, prefixItems, enum,
 * const, pattern, minItems, maxItems, allOf, anyOf, if/then, local $ref ("#/$defs/...")
 * and a $ref into a sibling schema file ("common.schema.json#/$defs/..."). No dependency
 * needed for that.
 *
 * The owner edits the JSON by hand, so the merge tests prove a re-scrape keeps those
 * edits (scripts/cambridge/merge.mjs, re-exported by scrape.mjs).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import stepJson from '@data/cambridge/step.json';
import coursesJson from '@data/cambridge/courses.json';
import undergroundJson from '@data/cambridge/underground.json';
import resourcesJson from '@data/cambridge/resources.json';
import glossaryJson from '@data/cambridge/glossary.json';
import csJson from '@data/cambridge/cs.json';
import {
  blockedReason,
  contextLabel,
  diffJson,
  isGenericLabel,
  isTrackUrl,
  mergeCourses,
  mergeCs,
  mergeStep,
  normalizeCourses,
  normalizeCs,
  normalizeStep,
  pdfQuestions,
  seedQuestions,
  trackCourseLinks,
} from '../../../scripts/cambridge/scrape.mjs';

const DIR = fileURLToPath(new URL('../../../data/cambridge/', import.meta.url));

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface Schema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  prefixItems?: Schema[];
  enum?: Json[];
  const?: Json;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  allOf?: Schema[];
  anyOf?: Schema[];
  if?: Schema;
  then?: Schema;
  $ref?: string;
  $defs?: Record<string, Schema>;
}

const typeOf = (v: Json): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;

/** Errors as "path: message"; an empty list means valid. */
function validate(value: Json, schema: Schema, root: Schema = schema, path = '$'): string[] {
  if (schema.$ref) {
    const [file, pointer = ''] = schema.$ref.split('#');
    const base = file ? schemaFile(file) : root;
    const def = base?.$defs?.[pointer.replace('/$defs/', '')];
    if (!def) return [`${path}: unknown $ref ${schema.$ref}`];
    return validate(value, def, base, path);
  }
  if (schema.anyOf && !schema.anyOf.some((sub) => validate(value, sub, root, path).length === 0)) {
    return [`${path}: matches none of anyOf`];
  }
  const errs: string[] = [];
  const t = typeOf(value);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = allowed.some((a) => a === t || (a === 'number' && t === 'integer'));
    if (!ok) return [`${path}: expected ${allowed.join('|')}, got ${t}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errs.push(`${path}: ${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`);
  }
  for (const sub of schema.allOf ?? []) errs.push(...validate(value, sub, root, path));
  if (schema.if && schema.then && validate(value, schema.if, root, path).length === 0) errs.push(...validate(value, schema.then, root, path));
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errs.push(`${path}: "${value}" does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    const prefix = schema.prefixItems ?? [];
    value.forEach((v, i) => {
      const sub = i < prefix.length ? prefix[i] : schema.items;
      if (sub) errs.push(...validate(v, sub, root, `${path}[${i}]`));
    });
  } else if (t === 'object') {
    const obj = value as Record<string, Json>;
    for (const k of schema.required ?? []) if (!(k in obj)) errs.push(`${path}: missing "${k}"`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validate(v, sub, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected "${k}"`);
    }
  }
  return errs;
}

const readJson = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
/** A schema file in data/cambridge/schema, for $refs that name one (null if missing). */
function schemaFile(name: string): Schema | null {
  try {
    return readJson(join(DIR, 'schema', name)) as Schema;
  } catch {
    return null;
  }
}
const dataFiles = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

/** Every object in `v` that carries a string `url`, with its path. */
function urlObjects(v: Json, path = '$', out: { path: string; obj: Record<string, Json> }[] = []) {
  if (Array.isArray(v)) v.forEach((x, i) => urlObjects(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    if (typeof v.url === 'string') out.push({ path, obj: v });
    for (const [k, x] of Object.entries(v)) urlObjects(x, `${path}.${k}`, out);
  }
  return out;
}

describe('validator', () => {
  const schema: Schema = {
    type: 'object',
    required: ['a'],
    additionalProperties: false,
    properties: { a: { type: 'array', minItems: 1, items: { $ref: '#/$defs/n' } }, b: { type: ['string', 'null'], pattern: '^x' } },
    $defs: { n: { type: 'integer', enum: [1, 2] } },
  };
  it('accepts a valid value', () => expect(validate({ a: [1, 2], b: null }, schema)).toEqual([]));
  it('checks const, prefixItems, maxItems and if/then', () => {
    const s: Schema = {
      type: 'object',
      properties: { k: { type: 'string' }, t: { type: 'array', maxItems: 2, prefixItems: [{ const: 8 }], items: { type: 'integer' } } },
      allOf: [{ if: { properties: { k: { const: 'x' } } }, then: { required: ['t'] } }],
    };
    expect(validate({ k: 'x', t: [8, 2] }, s)).toEqual([]);
    expect(validate({ k: 'y' }, s)).toEqual([]);
    expect(validate({ k: 'x' }, s)).toEqual(['$: missing "t"']);
    expect(validate({ t: [7, 2, 2] }, s)).toEqual(['$.t: more than 2 items', '$.t[0]: 7 is not 8']);
  });
  it('checks anyOf and a $ref into a sibling schema file', () => {
    const s: Schema = { type: 'object', properties: { g: { anyOf: [{ type: 'null' }, { $ref: 'common.schema.json#/$defs/gate' }] } } };
    expect(validate({ g: null }, s)).toEqual([]);
    expect(validate({ g: { text: 'x', xp: 200, evidence: [{ key: 'k', label: 'K', type: 'text' }] } }, s)).toEqual([]);
    expect(validate({ g: { text: 'x', xp: 200, evidence: [] } }, s)).toEqual(['$.g: matches none of anyOf']);
    expect(validate(1, { $ref: 'missing.schema.json#/$defs/x' })).toEqual(['$: unknown $ref missing.schema.json#/$defs/x']);
  });
  it('reports each rule', () => {
    expect(validate({ b: 'y', c: 1 }, schema)).toEqual(['$: missing "a"', '$.b: "y" does not match ^x', '$: unexpected "c"']);
    expect(validate({ a: [] }, schema)).toEqual(['$.a: fewer than 1 items']);
    expect(validate({ a: [3, 1.5] }, schema)).toEqual(['$.a[0]: 3 not in enum', '$.a[1]: expected integer, got number']);
  });
});

describe('data/cambridge schemas', () => {
  it('every JSON file has a schema', () => {
    const schemas = new Set(readdirSync(join(DIR, 'schema')));
    expect(dataFiles.filter((f) => !schemas.has(f.replace(/\.json$/, '.schema.json')))).toEqual([]);
  });
  for (const f of dataFiles) {
    it(`${f} matches its schema`, () => {
      const schema = readJson(join(DIR, 'schema', f.replace(/\.json$/, '.schema.json'))) as Schema;
      expect(validate(readJson(join(DIR, f)), schema)).toEqual([]);
    });
  }
});

describe('data/cambridge cross-file rules', () => {
  const step = stepJson;
  const courses = coursesJson;
  const itemIds = step.items.map((i) => i.id);

  it('ids are unique within each list, and study-item ids are unique across step and courses', () => {
    const lists: [string, string[]][] = [
      ['step.items', itemIds],
      ['step.phases', step.phases.map((p) => p.id)],
      ['step.blocks', step.blocks.map((b) => b.id)],
      ['underground.stations', undergroundJson.stations.map((s) => s.id)],
      ['resources', [...resourcesJson.resources, ...resourcesJson.books].map((r) => r.id)],
      ['study items', [...itemIds, ...courses.courses.map((c) => c.id), ...courses.partIB.map((c) => c.id)]],
    ];
    for (const f of ['glossary.json', 'method.json']) {
      lists.push([f, collectIds(readJson(join(DIR, f)))]);
    }
    // cs.json: question ids repeat across items by design (Q1, sw1), so check each list on its own.
    const track = csJson.track as Obj;
    lists.push(['cs.tripos courses', Object.values(csJson.tripos.parts).flatMap((p) => p.courses.map((c) => c.id))]);
    lists.push(['cs.track phases, blocks and items', [...track.phases, ...track.blocks, ...track.items].map((x: Obj) => x.id)]);
    for (const it of track.items as Obj[]) lists.push([`cs.track ${it.id} questions`, it.questions.map((q: Obj) => q.id)]);
    lists.push(['study items incl. the CS track', [...itemIds, ...courses.courses.map((c) => c.id), ...courses.partIB.map((c) => c.id), ...track.items.map((i: Obj) => i.id)]]);
    for (const [name, ids] of lists) expect(ids.filter((id, i) => ids.indexOf(id) !== i), name).toEqual([]);
  });

  it('every station in an underground block exists', () => {
    const ids = new Set(undergroundJson.stations.map((s) => s.id));
    const missing = undergroundJson.blocks.flatMap((b) => b.stations.filter((s) => !ids.has(s)));
    expect(missing).toEqual([]);
  });

  it('step blocks cover Foundation assignments 1..25 exactly once, matching the items', () => {
    const all = step.blocks.flatMap((b) => b.assignments).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    for (const b of step.blocks) {
      expect(b.items).toEqual(b.assignments.map((n) => `found-${String(n).padStart(2, '0')}`));
      for (const id of b.items) expect(step.items.find((i) => i.id === id)?.block, id).toBe(b.id);
      expect(undergroundJson.blocks.some((u) => u.block === b.undergroundBlock), b.id).toBe(true);
    }
  });

  it('phases run 0, A, A+, B, C, D, and every item sits in exactly its own phase', () => {
    expect(step.phases.map((p) => p.id)).toEqual(['0', 'A', 'A+', 'B', 'C', 'D']);
    step.phases.forEach((p, i) => expect(p.order).toBe(i));
    const listed = step.phases.flatMap((p) => p.items);
    expect([...listed].sort()).toEqual([...itemIds].sort());
    for (const p of step.phases) for (const id of p.items) expect(step.items.find((i) => i.id === id)?.phase).toBe(p.id);
    for (const p of step.phases) for (const id of p.uses ?? []) expect(itemIds).toContain(id);
  });

  it('gates: every phase but A+ has a 200 XP gate with evidence fields', () => {
    for (const p of step.phases) {
      if (p.id === 'A+') expect(p.gate).toBeNull();
      else {
        expect(p.gate?.xp, p.id).toBe(200);
        expect(p.gate?.evidence.length, p.id).toBeGreaterThan(0);
      }
    }
  });

  it('exam facts are consistent', () => {
    const e = step.exam;
    expect(e.durationMin).toBe(180);
    expect(e.sections.reduce((s, x) => s + x.count, 0)).toBe(e.questions);
    expect(e.maxMarks).toBe(e.bestCount * e.marksPerQuestion);
  });

  it('module order and counts match the plan', () => {
    const titles = (ph: string) => step.items.filter((i) => i.phase === ph && i.kind === 'module').map((i) => i.title);
    expect(titles('B')).toEqual(['Calculus', 'Curve Sketching', 'Complex Numbers', 'Equations and Inequalities', 'Matrices', 'Mechanics', 'Miscellaneous Pure', 'Statistics', 'Trigonometry', 'Vectors']);
    expect(titles('C')).toHaveLength(11);
    const siklos = step.items.filter((i) => i.kind === 'siklos');
    expect(siklos.map((i) => i.n)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
  });

  it('every Foundation assignment links its PDF and a hints file', () => {
    for (const it of step.items.filter((i) => i.kind === 'assignment')) {
      const kinds = (it.links ?? []).map((l) => l.kind);
      expect(kinds, it.id).toContain('assignment');
      expect(kinds, it.id).toContain('hints');
    }
  });

  it('references resolve: resources, unlock gate, course order and terms', () => {
    const res = new Set(resourcesJson.resources.map((r) => r.id));
    for (const i of step.items) if (i.resource) expect(res.has(i.resource), i.id).toBe(true);
    for (const p of step.phases) for (const r of p.resources ?? []) expect(res.has(r), r).toBe(true);
    expect(step.phases.map((p) => p.id)).toContain(courses.unlock.afterGate);
    const ids = new Set(courses.courses.map((c) => c.id));
    for (const pair of courses.order) for (const id of pair) expect(ids.has(id), id).toBe(true);
    for (const t of courses.terms) {
      for (const id of [...t.pure, ...t.applied]) expect(courses.courses.find((c) => c.id === id)?.term, id).toBe(t.id);
    }
    for (const c of courses.courses) expect(c.sheets.length, c.id).toBeGreaterThan(0);
  });

  it('every url is https unless flagged http-only or unverified, and every unverified link says why', () => {
    const bad: string[] = [];
    for (const f of dataFiles.filter((x) => x !== 'link-report.json')) {
      for (const { path, obj } of urlObjects(readJson(join(DIR, f)))) {
        const url = obj.url as string;
        if (!url.startsWith('https://') && obj.httpOnly !== true && obj.verified !== false) bad.push(`${f} ${path} ${url}`);
        if (obj.verified === false && typeof obj.reason !== 'string') bad.push(`${f} ${path}: verified false without a reason`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('generated files contain no en or em dashes', () => {
    for (const f of ['step.json', 'courses.json', 'cs.json', 'resources.json']) {
      expect(/[–—]/.test(readFileSync(join(DIR, f), 'utf8')), f).toBe(false);
    }
  });
});

const schemaOf = (f: string): Schema => readJson(join(DIR, 'schema', f.replace(/\.json$/, '.schema.json'))) as Schema;
const copy = <T,>(v: T): T => structuredClone(v);
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('data/cambridge schemas reject bad edits', () => {
  const rejects = (f: string, doc: unknown) => expect(validate(doc as Json, schemaOf(f)).length, f).toBeGreaterThan(0);
  const step = (): Obj => copy(stepJson) as Obj;
  const assignment = (d: Obj): Obj => d.items.find((i: Obj) => i.kind === 'assignment');

  it('the committed files pass (baseline for the mutations below)', () => {
    for (const f of ['step.json', 'glossary.json', 'underground.json']) expect(validate(readJson(join(DIR, f)), schemaOf(f)), f).toEqual([]);
  });
  it('an empty or blank gate text', () => {
    for (const text of ['', '   ']) {
      const d = step();
      d.phases.find((p: Obj) => p.gate).gate.text = text;
      rejects('step.json', d);
    }
  });
  it('an assignment missing its block, topics or links', () => {
    for (const k of ['block', 'topics', 'links']) {
      const d = step();
      delete assignment(d)[k];
      rejects('step.json', d);
    }
    for (const k of ['topics', 'links']) {
      const d = step();
      assignment(d)[k] = [];
      rejects('step.json', d);
    }
  });
  it('an item without a question list', () => {
    const d = step();
    delete d.items[0].questions;
    rejects('step.json', d);
  });
  it('exam facts other than the stated STEP values', () => {
    const bad: [string, unknown][] = [
      ['answerAtMost', 5],
      ['bestCount', 7],
      ['marksPerQuestion', 25],
      ['maxMarks', 100],
      ['durationMin', 120],
      ['questions', 13],
    ];
    for (const [k, v] of bad) {
      const d = step();
      d.exam[k] = v;
      rejects('step.json', d);
    }
    for (const counts of [[7, 3, 2], [8, 2, 3], [8, 2]]) {
      const d = step();
      d.exam.sections = counts.map((count, i) => ({ name: `S${i}`, count }));
      rejects('step.json', d);
    }
  });
  it('a glossary term with an empty meaning', () => {
    const d = copy(glossaryJson) as Obj;
    d.terms[0].meaning = '';
    rejects('glossary.json', d);
  });
  it('an underground mapping not labelled "suggested", or no mapping', () => {
    const d = copy(undergroundJson) as Obj;
    d.mapping.label = 'official';
    rejects('underground.json', d);
    delete d.mapping;
    rejects('underground.json', d);
  });
});

describe('data/cambridge per-question lists', () => {
  const items = stepJson.items as Obj[];

  it('every Foundation assignment has warm-up, preparation, the STEP question and warm-down, in that order', () => {
    for (const it of items.filter((i) => i.kind === 'assignment')) {
      const ids = it.questions.map((q: Obj) => q.id).filter((id: string) => !id.startsWith('step-'));
      expect(ids, it.id).toEqual(['warm-up', 'preparation', 'main', 'warm-down']);
      expect(it.questions.find((q: Obj) => q.id === 'main').step, it.id).toBe(it.stepQuestions[0]);
      // Assignment 20 has a second STEP question; it follows the main one.
      const extra = it.stepQuestions.slice(1);
      expect(it.questions.filter((q: Obj) => q.id.startsWith('step-')).map((q: Obj) => q.step), it.id).toEqual(extra);
    }
  });
  it('STEP 2 and 3 modules have Q1..Qn, n = the count the site states', () => {
    for (const it of items.filter((i) => i.kind === 'module')) {
      const stated = Number(it.siteTopics.match(/consists of (\d+) STEP(?: [123])? questions/i)?.[1]);
      const ids = it.questions.map((q: Obj) => q.id);
      expect(ids, it.id).toEqual(ids.map((_: string, i: number) => `Q${i + 1}`));
      if (stated) expect(ids.length, it.id).toBe(stated);
      else expect(ids.length, it.id).toBeGreaterThan(0);
    }
  });
  it('Siklos problems have one question; mixed STEP 1 sets list their STEP questions', () => {
    for (const it of items.filter((i) => i.kind === 'siklos')) expect(it.questions, it.id).toEqual([{ id: `P${it.n}` }]);
    for (const it of items.filter((i) => i.kind === 'set')) {
      expect(it.questions.length, it.id).toBeGreaterThan(1);
      for (const q of it.questions) expect(q.step, `${it.id} ${q.id}`).toMatch(/^\d{4} STEP [12] Q\d+$/);
    }
  });
  it('course example sheets carry an (owner-filled) question list', () => {
    for (const c of [...coursesJson.courses, ...coursesJson.partIB] as Obj[]) {
      for (const sh of c.sheets) expect(Array.isArray(sh.questions), `${c.id} sheet ${sh.n}`).toBe(true);
    }
  });
  it('seeding: the fallbacks used when the PDF cannot be read', () => {
    const a = seedQuestions({ kind: 'assignment', stepQuestions: ['2005 STEP 1 Q3'] }, null);
    expect(a.questions.map((q) => q.id)).toEqual(['warm-up', 'preparation', 'main', 'warm-down']);
    expect(a.note).toMatch(/standard four/);
    const m = seedQuestions({ kind: 'module', siteTopics: 'consists of some STEP questions' }, null);
    expect(m.questions.map((q) => q.id)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(m.note).toMatch(/4 assumed/);
    expect(seedQuestions({ kind: 'module', siteTopics: 'consists of 5 STEP questions' }, null).questions).toHaveLength(5);
    expect(pdfQuestions('STEP 2 Calculus Questions 1 2005 S2 Q1 Find ... 2 2006 S2 Q4 By ... 3 92 S2 Q9')).toEqual({
      refs: ['2005 STEP 2 Q1', '2006 STEP 2 Q4', '1992 STEP 2 Q9'],
    });
  });
});

describe('scrape merge keeps the owner\'s edits', () => {
  /** A fake scrape of the committed step.json: what the site would say today. */
  const freshStep = (from: Obj): Obj => ({
    $schema: from.$schema,
    source: from.source,
    scrapedAt: '2099-01-01',
    lastVerified: '2099-01-01',
    items: from.items
      .filter((i: Obj) => i.url)
      .map((i: Obj) => ({ id: i.id, phase: i.phase, kind: i.kind, n: i.n, title: `SITE ${i.title}`, siteTitle: i.siteTitle, url: i.url, siteTopics: i.siteTopics, ...(i.stepQuestions ? { stepQuestions: i.stepQuestions } : {}), links: copy(i.links) })),
  });

  it('owner edits survive; links refresh; new links and items are added; vanished items are flagged, never deleted', () => {
    const owner = copy(stepJson) as Obj;
    owner.phases.find((p: Obj) => p.id === 'B').gate.text = 'Owner gate: 5 of 6 at 15/20.';
    const a1 = owner.items.find((i: Obj) => i.id === 'found-01');
    a1.topics = ['owner topic'];
    a1.title = 'Owner title';
    a1.questions[0].note = 'owner note';
    a1.links[0].label = 'Owner label';
    owner.exam.durationMin = 180;

    const fresh = freshStep(copy(stepJson) as Obj);
    const f1 = fresh.items.find((i: Obj) => i.id === 'found-01');
    f1.links[0].verified = false;
    f1.links[0].reason = 'HTTP 404 on 2099-01-01';
    f1.links[0].label = 'Site label';
    f1.links.push({ kind: 'video', label: 'New video', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', role: 'further', verified: true });
    f1.siteTopics = 'New site blurb';
    fresh.items = fresh.items.filter((i: Obj) => i.id !== 's2-vectors');
    fresh.items.push({ id: 's2-new', phase: 'B', kind: 'module', n: 11, title: 'New', url: 'https://step.maths.org/assignments/step-2-new', siteTopics: '', links: [], questions: [{ id: 'Q1' }] });

    const merged = mergeStep(owner, fresh) as Obj;
    const m1 = merged.items.find((i: Obj) => i.id === 'found-01');
    expect(merged.phases.find((p: Obj) => p.id === 'B').gate.text).toBe('Owner gate: 5 of 6 at 15/20.');
    expect(m1.topics).toEqual(['owner topic']);
    expect(m1.title).toBe('Owner title');
    expect(m1.questions[0].note).toBe('owner note');
    expect(m1.links[0]).toMatchObject({ label: 'Owner label', verified: false, reason: 'HTTP 404 on 2099-01-01' });
    expect(m1.links.at(-1)).toMatchObject({ label: 'New video', verified: true });
    expect(m1.siteTopics).toBe('New site blurb');
    expect(merged.lastVerified).toBe('2099-01-01');
    expect(merged.exam).toEqual(stepJson.exam);
    expect(merged.blocks).toEqual(stepJson.blocks);
    // Vanished upstream: kept, flagged. Siklos (never scraped): untouched.
    expect(merged.items.find((i: Obj) => i.id === 's2-vectors')).toMatchObject({ title: 'Vectors', upstreamMissing: true });
    expect(merged.items.find((i: Obj) => i.id === 'siklos-p01').upstreamMissing).toBeUndefined();
    expect(merged.items).toHaveLength(stepJson.items.length + 1);
    // New upstream: appended to the items and to its phase.
    expect(merged.phases.find((p: Obj) => p.id === 'B').items.at(-1)).toBe('s2-new');

    // A later scrape that lists it again clears the flag.
    const again = mergeStep(merged, freshStep(copy(stepJson) as Obj)) as Obj;
    expect(again.items.find((i: Obj) => i.id === 's2-vectors').upstreamMissing).toBeUndefined();
  });

  it('a scrape of unchanged pages changes nothing but the dates', () => {
    const merged = mergeStep(copy(stepJson) as Obj, freshStep(copy(stepJson) as Obj));
    expect(diffJson(stepJson, merged)).toEqual([`~ lastVerified: "${stepJson.lastVerified}" -> "2099-01-01"`, `~ scrapedAt: "${stepJson.scrapedAt}" -> "2099-01-01"`]);
  });

  it('courses: owner notes, labels and sheet questions survive; sheets match by number', () => {
    const owner = copy(coursesJson) as Obj;
    const c = owner.courses[0];
    c.note = 'Owner note';
    c.sheets[0].questions = [{ id: 'Q3' }, { id: 'Q7' }];
    c.sheets[0].label = 'Owner sheet label';
    owner.order = [...owner.order].reverse();
    const fresh = {
      scrapedAt: '2099-01-01',
      lastVerified: '2099-01-01',
      courses: [{ id: c.id, sheetYear: '2098-2099', sheets: c.sheets.map((s: Obj) => ({ n: s.n, label: 'x', url: `${s.url}?new`, verified: true, questions: [] })), notes: [], siteNote: 'Site says' }],
      partIB: [],
    };
    const merged = mergeCourses(owner, fresh) as Obj;
    const mc = merged.courses[0];
    expect(mc).toMatchObject({ note: 'Owner note', sheetYear: '2098-2099', siteNote: 'Site says' });
    expect(mc.sheets[0]).toMatchObject({ label: 'Owner sheet label', questions: [{ id: 'Q3' }, { id: 'Q7' }] });
    expect(mc.sheets[0].url).toMatch(/\?new$/);
    expect(mc.notes.every((n: Obj) => n.upstreamMissing)).toBe(true);
    expect(merged.order).toEqual(owner.order);
    expect(merged.courses[1]).toEqual(owner.courses[1]);
  });

  it('cs: owner fields and extra top-level data survive', () => {
    const owner = copy(csJson) as Obj;
    owner.track = { note: 'added later by the owner' };
    const course = owner.tripos.parts.IB.courses[0];
    course.name = 'Owner name';
    course.note = 'Owner note';
    const fresh = {
      scrapedAt: '2099-01-01',
      lastVerified: '2099-01-01',
      tripos: {
        pastPapers: owner.tripos.pastPapers,
        parts: { IB: { url: owner.tripos.parts.IB.url, courses: [{ id: course.id, code: course.code, name: 'Site name', url: course.url, terms: ['Lent term'] }] } },
      },
    };
    const merged = mergeCs(owner, fresh) as Obj;
    const mc = merged.tripos.parts.IB.courses[0];
    expect(mc).toMatchObject({ name: 'Owner name', note: 'Owner note', terms: ['Lent term'] });
    expect(merged.track).toEqual({ note: 'added later by the owner' });
    expect(merged.tripos.parts.IA).toEqual(owner.tripos.parts.IA);
    expect(merged.tripos.parts.IB.courses.slice(1).every((x: Obj) => x.upstreamMissing)).toBe(true);
  });

  it('--offline normalising the committed files is a no-op', () => {
    expect(diffJson(stepJson, normalizeStep(copy(stepJson) as Obj))).toEqual([]);
    expect(diffJson(coursesJson, normalizeCourses(copy(coursesJson) as Obj))).toEqual([]);
    expect(diffJson(csJson, normalizeCs(copy(csJson) as Obj))).toEqual([]);
  });
});

describe('data/cambridge link hygiene', () => {
  it('blocks pirated copies and Google redirects', () => {
    expect(blockedReason('https://www.google.com/url?sa=t&url=https://unidel.edu.ng/focelibrary/books/x%2520(z-lib.org).pdf')).toMatch(/pirat/);
    expect(blockedReason('https://www.google.com/url?q=https://www.cl.cam.ac.uk/x.pdf')).toMatch(/redirect/);
    expect(blockedReason('https://libgen.is/book/1')).toMatch(/pirat/);
    expect(blockedReason('https://z-lib.org/x')).toMatch(/pirat/);
    expect(blockedReason('https://www.cl.cam.ac.uk/teaching/2526/Databases/x.pdf')).toBeNull();
    expect(blockedReason('https://docs.google.com/document/d/abc')).toBeNull();
  });
  it('no data file stores a blocked link', () => {
    const bad = dataFiles.flatMap((f) => urlObjects(readJson(join(DIR, f))).filter(({ obj }) => blockedReason(obj.url as string)).map(({ path }) => `${f} ${path}`));
    expect(bad).toEqual([]);
  });
  it('no link is labelled just "here" or "PDF"; the scraper labels them from context', () => {
    const bad = dataFiles
      .filter((f) => f !== 'link-report.json')
      .flatMap((f) => urlObjects(readJson(join(DIR, f))).filter(({ obj }) => typeof obj.label === 'string' && isGenericLabel(obj.label)).map(({ path, obj }) => `${f} ${path} ${obj.label}`));
    expect(bad).toEqual([]);
    expect(contextLabel({ text: 'here', before: 'The lecture notes are', href: 'https://x/a.pdf' }, '2025-26')).toBe('Lecture notes (2025-26)');
    expect(contextLabel({ text: 'PDF', before: 'Some exercises from Ross\'s book for lectures 1-4:', href: 'https://x/a.pdf' })).toBe("Exercises from Ross's book for lectures 1-4");
    expect(contextLabel({ text: 'here', before: '', href: 'https://x/Tick1.pdf' })).toBe('Tick1');
    expect(contextLabel({ text: 'Lecture slides', before: 'x', href: 'https://x/a.pdf' })).toBe('Lecture slides');
  });
  it('generated files carry a lastVerified date at the top', () => {
    for (const f of ['step.json', 'courses.json', 'cs.json']) {
      const keys = Object.keys(readJson(join(DIR, f)) as object);
      expect(keys.slice(0, 2), f).toEqual(['$schema', 'lastVerified']);
    }
  });
  it('resources: the nine listed resources plus the books, all verified', () => {
    expect(resourcesJson.resources).toHaveLength(9);
    expect(resourcesJson.resources.every((r) => r.verified)).toBe(true);
    expect(resourcesJson.books.length).toBeGreaterThan(0);
  });
});

describe('data/cambridge glossary matching', () => {
  const matches = glossaryJson.terms.flatMap((t) => t.match);
  it('does not match bare "Pure" or "Applied"', () => {
    expect(matches).not.toContain('Pure');
    expect(matches).not.toContain('Applied');
    expect(glossaryJson.terms.find((t) => t.id === 'pure-applied')?.match).toEqual(['pure maths', 'applied maths', 'Pure / Applied']);
  });
  it('underlines only the first occurrence, and lists the case-sensitive acronyms', () => {
    expect(glossaryJson.underline).toBe('first');
    expect(glossaryJson.caseSensitive).toEqual(['STEP', 'OCR', 'CST', 'DPMMS', 'DAMTP', 'TMUA', 'CSAT', 'NST']);
    for (const a of glossaryJson.caseSensitive) expect(matches, a).toContain(a);
  });
});

describe('data/cambridge CS track (cs.json track)', () => {
  const track = csJson.track as Obj;
  const items = track.items as Obj[];
  const byId = new Map(items.map((i) => [i.id, i]));
  const iaCourses = new Map(csJson.tripos.parts.IA.courses.map((c) => [c.id, c as Obj]));
  const phase = (id: string): Obj => track.phases.find((p: Obj) => p.id === id);
  const gateIds = new Set([...track.phases, ...track.blocks].filter((x: Obj) => x.gate).map((x: Obj) => x.id));

  it('phases run CS-0, CS-IA, CS-IB, and every item sits in exactly its own phase', () => {
    expect(track.phases.map((p: Obj) => p.id)).toEqual(['CS-0', 'CS-IA', 'CS-IB']);
    track.phases.forEach((p: Obj, i: number) => expect(p.order, p.id).toBe(i));
    const phaseIds = new Set(track.phases.map((p: Obj) => p.id));
    for (const it of items) expect(phaseIds.has(it.phase), it.id).toBe(true);
    const listed = track.phases.flatMap((p: Obj) => p.items);
    expect([...listed].sort()).toEqual(items.map((i) => i.id).sort());
    for (const p of track.phases) for (const id of p.items) expect(byId.get(id)?.phase, id).toBe(p.id);
  });

  it('blocks: CS-0 has the four sub-parts; every block and its items agree on phase and block', () => {
    expect(phase('CS-0').blocks).toEqual(['cs0-proof', 'cs0-maths', 'cs0-fp', 'cs0-checklist']);
    for (const b of track.blocks) {
      expect(track.phases.find((p: Obj) => p.id === b.phase)?.blocks, b.id).toContain(b.id);
      for (const id of b.items) expect(byId.get(id), `${b.id} ${id}`).toMatchObject({ phase: b.phase, block: b.id });
    }
    for (const it of items.filter((i) => i.block)) expect(track.blocks.find((b: Obj) => b.id === it.block)?.items, it.id).toContain(it.id);
  });

  it('gates: each CS-0 sub-part and Part IA pay 200 XP; Part IA and IB unlock in order', () => {
    for (const id of phase('CS-0').blocks) {
      const b = track.blocks.find((x: Obj) => x.id === id);
      expect(b.gate?.xp, id).toBe(200);
      expect(b.gate?.evidence.length, id).toBeGreaterThan(0);
      // A gated sub-part must not be marked alongside, or the catalog shows it as a side list that never gates.
      expect(b.alongside, id).toBeUndefined();
    }
    expect(phase('CS-IA').gate).toMatchObject({ xp: 200, text: 'Per paper: a timed past paper with 3 of 5 questions at least 14/20.' });
    expect(phase('CS-IA').unlockAfter).toEqual(phase('CS-0').blocks);
    expect(phase('CS-IB')).toMatchObject({ gate: null, unlockAfter: ['CS-IA'], triposPart: 'IB', items: [] });
    for (const p of track.phases) for (const g of p.unlockAfter ?? []) expect(gateIds.has(g), `${p.id} unlockAfter ${g}`).toBe(true);
  });

  it('the Part IA order is labelled suggested, pairs courses, and respects every stated prerequisite', () => {
    const order = phase('CS-IA').suggestedOrder;
    expect(order.label).toBe('suggested');
    const step = new Map<string, number>(order.steps.flatMap((ids: string[], i: number) => ids.map((id) => [id, i] as [string, number])));
    const courseItems = items.filter((i) => i.kind === 'course');
    expect([...step.keys()].sort()).toEqual(courseItems.map((i) => i.id).sort());
    expect(order.steps.flat()).toEqual(courseItems.map((i) => i.id));
    for (const s of order.steps) expect(s.length).toBeLessThanOrEqual(2);
    for (const it of courseItems) {
      for (const pre of it.prerequisites) {
        expect(step.has(pre), `${it.id} needs ${pre}`).toBe(true);
        expect(step.get(pre)!, `${pre} before ${it.id}`).toBeLessThan(step.get(it.id)!);
      }
    }
    // The prerequisites Cambridge states (docs/cst-track.md), pinned by name.
    expect(byId.get('cst-algorithm2')?.prerequisites).toContain('cst-algorithm1');
    expect(byId.get('cst-introprob')?.prerequisites).toContain('cst-discmath');
    expect(byId.get('cst-opsystems')?.prerequisites).toContain('cst-digelec');
    expect(step.get('cst-algorithm1')!).toBeLessThan(step.get('cst-algorithm2')!);
    expect(step.get('cst-discmath')!).toBeLessThan(step.get('cst-introprob')!);
    expect(step.get('cst-digelec')!).toBeLessThan(step.get('cst-opsystems')!);
  });

  it('Part IA courses sit on the right paper, in their tripos terms, with syllabus and past-paper links', () => {
    const onPaper = (n: number) => items.filter((i) => i.kind === 'course' && i.paper === n).map((i) => i.id).sort();
    expect(onPaper(1)).toEqual(['cst-algorithm1', 'cst-algorithm2', 'cst-foundscs', 'cst-introprob', 'cst-ooprog']);
    expect(onPaper(2)).toEqual(['cst-digelec', 'cst-discmath', 'cst-opsystems', 'cst-swseceng']);
    expect(onPaper(3)).toEqual(['cst-databases', 'cst-graphics', 'cst-intdesign', 'cst-mlrd']);
    for (const it of items.filter((i) => i.course)) {
      const c = iaCourses.get(it.course);
      expect(c, it.id).toBeDefined();
      expect(it.terms, it.id).toEqual(c!.terms);
      const urls = it.links.map((l: Obj) => l.url);
      expect(urls, it.id).toContain(c!.url);
      if (it.kind === 'course') expect(urls.some((u: string) => /\/exams\/pastpapers\/t-[A-Za-z0-9-]+\.html$/.test(u)), it.id).toBe(true);
    }
    for (const it of items.filter((i) => i.kind === 'practical')) expect(it.examined, it.id).toBe(false);
  });

  it('course links are exactly what the tripos data derives, so a re-scrape is a no-op', () => {
    for (const it of items.filter((i) => i.course)) {
      expect(it.links.map((l: Obj) => l.url), it.id).toEqual(trackCourseLinks(iaCourses.get(it.course)!).map((l) => l.url));
    }
  });

  it('every track url is https on an official host, verified or flagged with a reason; no unofficial CSAT copies', () => {
    const bad: string[] = [];
    for (const it of items) {
      for (const l of it.links) {
        if (!isTrackUrl(l.url)) bad.push(`${it.id} ${l.url}: not an official host`);
        if (typeof l.verified !== 'boolean' || (l.verified === false && typeof l.reason !== 'string')) bad.push(`${it.id} ${l.url}: unverified without a reason`);
        if (/openclimb|csat.*mirror/i.test(l.url) || blockedReason(l.url)) bad.push(`${it.id} ${l.url}: blocked`);
      }
      const urls = new Set(it.links.map((l: Obj) => l.url));
      for (const q of it.questions) if (q.link && !urls.has(q.link)) bad.push(`${it.id} ${q.id}: question link not among the item's links`);
    }
    expect(bad).toEqual([]);
    expect(isTrackUrl('https://openclimb.io/csat/')).toBe(false);
    expect(isTrackUrl('http://www.cl.cam.ac.uk/x')).toBe(false);
    expect(isTrackUrl('https://www.cl.cam.ac.uk/x')).toBe(true);
  });

  it('foundations: TMUA papers, the full NST workbook, Book of Proof and CS3110 chapters, the checklist', () => {
    const tmua = items.filter((i) => /^tmua-(\d{4}|specimen)-p[12]$/.test(i.id));
    expect(tmua.length).toBeGreaterThanOrEqual(2);
    for (const t of tmua) expect(t.questions.map((q: Obj) => q.id), t.id).toEqual(Array.from({ length: 20 }, (_, i) => `Q${i + 1}`));
    expect(items.filter((i) => i.id.startsWith('nstwb-'))).toHaveLength(15);
    for (const n of [1, 2, 4, 5, 6, 7, 8, 9, 10]) expect(byId.get(`bop-${String(n).padStart(2, '0')}`)?.optional, `bop ${n}`).toBeUndefined();
    for (const n of [2, 3, 4, 5, 8, 9]) expect(byId.get(`ocaml-${String(n).padStart(2, '0')}`)?.optional, `ocaml ${n}`).toBeUndefined();
    expect(byId.get('prep-python')?.optional).toBeUndefined();
    for (const id of ['prep-fundamentals', 'prep-unix']) expect(byId.get(id)?.optional, id).toBe(true);
    for (const id of ['tmua-logic-proof', 'tmua-spec', 'focs-notes', 'nst-ia-maths']) expect(byId.has(id), id).toBe(true);
  });

  it('the supervisor prompt names the course and the supervision work, and the code languages', () => {
    const sp = track.supervisorPrompt;
    expect(sp.replaces).toBe('STEP supervisor');
    expect(sp.text).toBe('{course} supervisor (Computer Science Tripos), supervision work {n}');
    expect(sp.codeLanguages).toEqual(['OCaml', 'Java', 'C++', 'Python']);
  });
});

describe('data/cambridge CS track: schema rejects bad edits, merge keeps owner edits', () => {
  const cs = (): Obj => copy(csJson) as Obj;
  const rejects = (doc: unknown) => expect(validate(doc as Json, schemaOf('cs.json')).length).toBeGreaterThan(0);
  const course = (d: Obj): Obj => d.track.items.find((i: Obj) => i.kind === 'course');

  it('rejects: no {n} in the prompt, an order not labelled suggested, a course without a paper, a blank gate', () => {
    let d = cs();
    d.track.supervisorPrompt.text = '{course} supervisor';
    rejects(d);
    d = cs();
    d.track.phases[1].suggestedOrder.label = 'official';
    rejects(d);
    d = cs();
    delete course(d).paper;
    rejects(d);
    d = cs();
    d.track.blocks[0].gate.text = ' ';
    rejects(d);
    d = cs();
    course(d).links[0].url = 'http://www.cl.cam.ac.uk/';
    rejects(d);
  });

  /** What a scrape of today's committed data would hand the merge. */
  const fresh = (from: Obj): Obj => ({
    $schema: from.$schema,
    scrapedAt: '2099-01-01',
    lastVerified: '2099-01-01',
    tripos: { pastPapers: from.tripos.pastPapers, parts: copy(from.tripos.parts) },
    track: {
      sources: ['fixed', 'bop', 'ocaml'],
      // Only the book chapter pages supply a siteTitle; the other items' siteTitle is the owner's.
      items: from.track.items.filter((i: Obj) => !i.course).map((i: Obj) => ({ id: i.id, ...(i.siteTitle && /^(bop|ocaml)-/.test(i.id) ? { siteTitle: i.siteTitle } : {}), links: copy(i.links) })),
    },
  });

  it('a scrape of unchanged pages changes nothing but the dates', () => {
    const merged = mergeCs(cs(), fresh(cs()));
    expect(diffJson(csJson, merged)).toEqual([`~ lastVerified: "${csJson.lastVerified}" -> "2099-01-01"`, `~ scrapedAt: "${csJson.scrapedAt}" -> "2099-01-01"`]);
  });

  it('owner edits survive; course links follow the tripos; gone items and links are flagged, never deleted', () => {
    const owner = cs();
    const db = owner.track.items.find((i: Obj) => i.id === 'cst-databases');
    db.title = 'Owner title';
    db.questions = [{ id: 'mine', label: 'Owner question' }];
    db.links[0].label = 'Owner label';
    owner.track.phases[1].suggestedOrder.steps.reverse();

    const f = fresh(cs());
    const fc = f.tripos.parts.IA.courses.find((c: Obj) => c.id === 'cs-ia-databases');
    const sheet = fc.materials.links.find((l: Obj) => l.label === 'Main Supervision Sheet 3');
    sheet.verified = false;
    sheet.lastCheckedStatus = 404;
    sheet.reason = 'HTTP 404 on 2099-01-01';
    fc.materials.links.push({ kind: 'notes', label: 'New notes', url: 'https://www.cl.cam.ac.uk/teaching/2627/Databases/new.pdf', verified: true });
    fc.materials.links.push({ kind: 'notes', label: 'Off-host', url: 'https://example.com/x.pdf', verified: true });
    f.track.items = f.track.items.filter((i: Obj) => i.id !== 'bop-02');

    const merged = mergeCs(owner, f) as Obj;
    const m = merged.track.items.find((i: Obj) => i.id === 'cst-databases');
    expect(m).toMatchObject({ title: 'Owner title', questions: [{ id: 'mine', label: 'Owner question' }] });
    expect(m.links[0].label).toBe('Owner label');
    expect(merged.track.phases[1].suggestedOrder.steps).toEqual(owner.track.phases[1].suggestedOrder.steps);
    expect(m.links.find((l: Obj) => l.label === 'Main Supervision Sheet 3')).toMatchObject({ upstreamMissing: true, verified: false, reason: 'HTTP 404 on 2099-01-01' });
    expect(m.links.at(-1)).toMatchObject({ label: 'New notes', verified: true });
    expect(m.links.some((l: Obj) => l.url.startsWith('https://example.com'))).toBe(false);
    expect(merged.track.items.find((i: Obj) => i.id === 'bop-02').upstreamMissing).toBe(true);
    expect(merged.track.items).toHaveLength(csJson.track.items.length);

    // Not read this run (no 'bop' source): not flagged.
    const partial = fresh(cs());
    partial.track = { sources: ['fixed'], items: partial.track.items.filter((i: Obj) => !i.id.startsWith('bop-')) };
    expect((mergeCs(cs(), partial) as Obj).track.items.some((i: Obj) => i.upstreamMissing)).toBe(false);
  });
});

describe('data/cambridge glossary: CS track terms', () => {
  it('defines the CST terms the track uses', () => {
    const terms = new Map(glossaryJson.terms.map((t) => [t.id, t]));
    for (const id of ['tmua', 'csat', 'nst', 'paper', 'tick', 'supervision-work']) {
      expect(terms.get(id)?.meaning, id).toMatch(/\S/);
    }
    expect(terms.get('nst')?.match).toContain('Natural Sciences Tripos');
  });
});

/** Every `id` string in a JSON value, in document order. */
function collectIds(v: Json, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => collectIds(x, out));
  else if (v && typeof v === 'object') {
    if (typeof v.id === 'string') out.push(v.id);
    for (const x of Object.values(v)) collectIds(x, out);
  }
  return out;
}
