/**
 * Builds the Cambridge catalog from the owner-editable curriculum JSON
 * (data/cambridge/step.json, courses.json, and the `track` in cs.json), the
 * small index Today reads (see catalogIndex.ts), and the per-track payloads the
 * screens load (see catalog.ts).
 *
 * Pure on purpose: it imports only the JSON, types and catalogShared.ts, so the
 * Vite plugin in scripts/cambridge/index-plugin.mjs can run it at build time to
 * generate the index and the tracks from the same data and the same rules.
 * App code imports only its types; the builder itself never ships.
 */
import stepJson from '@data/cambridge/step.json';
import coursesJson from '@data/cambridge/courses.json';
import csJson from '@data/cambridge/cs.json';
import undergroundJson from '@data/cambridge/underground.json';
import type { CoreBlock, CoreCatalog, CoreItem, CorePhase, TrackId } from '@/features/cambridge/catalogCore';
import { isHintLink, STEP_ROLE } from '@/features/cambridge/catalogShared';

export type { TrackId };
export { isHintLink, STEP_ROLE };

export interface CatEvidence { key: string; label: string; type: 'text' | 'number' | 'yesno' }
export interface CatGate { text: string; xp: number; evidence: CatEvidence[] }

export interface CatLink {
  kind: string;
  label: string;
  url: string;
  /** Hints, solutions and worked solutions stay hidden until the cold attempt is done. */
  hint: boolean;
  /** An Underground station, the owner's own mapping: shown with "(suggested)". */
  suggested?: boolean;
  /** A station with no Introducing resources says where to start instead. */
  note?: string;
}

export interface CatQuestion {
  id: string;
  label: string;
  /** The STEP question this is ("2005 STEP 1 Q3"): only these earn the STEP self-mark XP. */
  step?: string;
}

export interface CatItem extends CoreItem {
  id: string;
  track: TrackId;
  /** The gate key of the item's phase (see CatPhase.key). */
  phase: string;
  block?: string;
  kind: string;
  n: number;
  title: string;
  topics: string[];
  links: CatLink[];
  questions: CatQuestion[];
  /** The supervisor's role line for the prompt, e.g. "Groups supervisor, example sheet 2". */
  supervisor: string;
  /** A STEP track item. Its questions with a `step` field earn the STEP self-mark XP. */
  step: boolean;
  /** CST: the line allowing code answers in several languages, appended to the prompt. */
  codeLine?: string;
}

export interface CatBlock extends CoreBlock {
  id: string;
  name: string;
  items: string[];
  /** Runs alongside the phase's main work (NST Maths beside CST Part IA): listed, never gating. */
  alongside?: boolean;
}

export interface CatPhase extends CorePhase {
  /** The key gates are stored under. STEP and Part IA keep their own ids ('A', 'IA'); CST ids are prefixed 'cst:' so they never collide. */
  key: string;
  track: TrackId;
  /** As printed: "Phase A", "Part IA", "CS-0 Foundations: proof". */
  name: string;
  title: string;
  pace?: string;
  perWeek?: number;
  gate: CatGate | null;
  /** The phase this one runs alongside (A+ with B). */
  alongside?: string;
  /** Gate keys that must all pass before this phase opens; empty when it is open from the start. */
  requires: string[];
  /** "Unlocks when Phase A's gate passes.", for the locked row. */
  lockedText: string;
  items: string[];
  blocks: CatBlock[];
}

export interface CatTrack { id: TrackId; phases: CatPhase[] }

export interface Catalog extends CoreCatalog<CatPhase, CatItem> {
  tracks: Record<TrackId, CatTrack>;
}

/* ------------------------------------------------------------------ */
/* Raw JSON shapes (only the fields read here)                         */
/* ------------------------------------------------------------------ */

interface RawLink { kind: string; label: string; url: string; role?: string }
interface RawQuestion { id: string; label?: string; step?: string; link?: string }
interface RawItem {
  id: string; phase: string; block?: string; kind: string; n?: number; title: string;
  topics?: string[]; links?: RawLink[]; questions?: RawQuestion[]; course?: string; supervisionPrompt?: string;
}
interface RawPhase {
  id: string; name: string; do?: string; order?: number; pace?: { text?: string; perWeek?: number };
  gate?: CatGate | null; alongside?: string; uses?: string[]; items?: string[];
  /** CST: block ids of this phase, and the phases whose gates open it. */
  blocks?: string[]; unlockAfter?: string[]; triposPart?: string;
}
interface RawBlock {
  id: string; name: string; items: string[];
  /** CST blocks can carry their own gate and pace (the four CS-0 sub-parts). */
  phase?: string; do?: string; pace?: { text?: string; perWeek?: number }; gate?: CatGate | null; alongside?: string;
}
interface RawPrompt { replaces?: string; text: string; codeLanguages?: string[] }
interface RawTrack { phases: RawPhase[]; blocks?: RawBlock[]; items: RawItem[]; supervisorPrompt?: string | RawPrompt }
interface RawTriposCourse { id: string; name: string; url: string; materials?: { links?: RawLink[] } }

interface RawSheet { n: number; label: string; url: string; questions?: RawQuestion[] }
interface RawCourse {
  id: string; name: string; term: string; page?: string; sheets: RawSheet[];
  notes?: { label: string; url: string }[]; supervisionPrompt?: string;
}

/* ------------------------------------------------------------------ */
/* Links and the supervisor prompt                                      */
/* ------------------------------------------------------------------ */

const toLink = (l: RawLink): CatLink => ({ kind: l.kind, label: l.label, url: l.url, hint: isHintLink(l) });

interface Station { id: string; name: string; url: string; has?: { introducing?: boolean } }
const STATIONS = new Map((undergroundJson.stations as Station[]).map((s) => [s.id, s]));
const BLOCK_STATIONS = new Map((undergroundJson.blocks as { block: string; stations: string[] }[]).map((b) => [b.block, b.stations]));

function stationLinks(block: string | undefined): CatLink[] {
  if (!block) return [];
  return (BLOCK_STATIONS.get(block) ?? []).flatMap((id): CatLink[] => {
    const s = STATIONS.get(id);
    if (!s) return [];
    return [{
      kind: 'station', label: `Underground: ${s.name}`, url: s.url, hint: false, suggested: true,
      note: s.has?.introducing === false ? 'Start with Developing.' : undefined,
    }];
  });
}

const CST_ROLE = '{course} supervisor (Computer Science Tripos), supervision work {n}';
const CST_LANGUAGES = ['OCaml', 'Java', 'C++', 'Python'];

/** "OCaml, Java, C++ or Python". */
const orList = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

const fill = (template: string, course: string, n: number): string =>
  template.replaceAll('{course}', course).replaceAll('{n}', String(n));

/* ------------------------------------------------------------------ */
/* Building the tracks                                                  */
/* ------------------------------------------------------------------ */

const STEP_PHASE_TITLE: Readonly<Record<string, string>> = { '0': 'Phase 0', IA: 'Part IA' };
const phaseName = (id: string): string => STEP_PHASE_TITLE[id] ?? `Phase ${id}`;

function questionsOf(raw: RawQuestion[] | undefined, fallback: string): CatQuestion[] {
  const qs = (raw ?? []).map((q) => ({ id: q.id, label: q.label ?? q.id, step: q.step }));
  // A sheet whose questions the owner has not listed yet is one question, so it
  // still gets a cold timer, a status and a mark.
  return qs.length ? qs : [{ id: 'all', label: fallback }];
}

function buildStep(items: Map<string, CatItem>): CatTrack {
  const raw = stepJson as unknown as { phases: RawPhase[]; blocks: RawBlock[]; items: RawItem[] };
  for (const it of raw.items) {
    items.set(it.id, {
      id: it.id, track: 'step', phase: it.phase, block: it.block, kind: it.kind, n: it.n ?? 1, title: it.title,
      topics: it.topics ?? [],
      links: [...(it.links ?? []).map(toLink), ...stationLinks(it.block)],
      questions: questionsOf(it.questions, 'The problem'),
      supervisor: STEP_ROLE, step: true,
    });
  }
  const blocksByPhase = new Map<string, CatBlock[]>();
  for (const b of raw.blocks) {
    const phase = items.get(b.items[0] ?? '')?.phase;
    if (!phase) continue;
    blocksByPhase.set(phase, [...(blocksByPhase.get(phase) ?? []), { id: b.id, name: `Block ${b.id}`, items: b.items }]);
  }
  // `requires` is for display ("Unlocks when Phase A's gate passes"); whether a
  // STEP phase is open is schedule.phaseUnlocked's call. The previous gated phase
  // in order gives the same answer as its table: A+ and B wait for A.
  let prevGated: string | undefined;
  const phases = [...raw.phases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p): CatPhase => {
    // Phase 0 owns no items: it is a first pass at Assignment 1 (its `uses`).
    const ids = p.items?.length ? p.items : (p.uses ?? []);
    const phase: CatPhase = {
      key: p.id, track: 'step', name: phaseName(p.id), title: p.name, pace: p.pace?.text, perWeek: p.pace?.perWeek,
      gate: p.gate ?? null, alongside: p.alongside, requires: prevGated ? [prevGated] : [], lockedText: '',
      items: ids.filter((id) => items.has(id)), blocks: blocksByPhase.get(p.id) ?? [],
    };
    if (p.gate) prevGated = p.id;
    return phase;
  });
  return { id: 'step', phases };
}

function buildCourses(items: Map<string, CatItem>): CatTrack {
  const raw = coursesJson as unknown as {
    unlock: { afterGate: string }; supervisionPrompt: string; courses: RawCourse[];
    terms: { id: string; name: string; cambridge: string; optional?: boolean }[];
  };
  const blocks: CatBlock[] = [];
  for (const term of raw.terms) {
    const ids: string[] = [];
    for (const c of raw.courses.filter((x) => x.term === term.id)) {
      for (const sh of c.sheets) {
        const id = `${c.id}-s${sh.n}`;
        ids.push(id);
        items.set(id, {
          id, track: 'courses', phase: 'IA', block: term.id, kind: 'sheet', n: sh.n, title: `${c.name}, sheet ${sh.n}`,
          topics: [c.name],
          links: [
            { kind: 'sheet', label: sh.label, url: sh.url, hint: false },
            ...(c.notes ?? []).map((l) => ({ kind: 'notes', label: l.label, url: l.url, hint: false })),
          ],
          questions: questionsOf(sh.questions, 'The whole sheet'),
          supervisor: fill(c.supervisionPrompt ?? raw.supervisionPrompt, c.name, sh.n), step: false,
        });
      }
    }
    if (ids.length) blocks.push({ id: term.id, name: `${term.cambridge} (${term.name})${term.optional ? ', optional' : ''}`, items: ids });
  }
  const phase: CatPhase = {
    key: 'IA', track: 'courses', name: 'Part IA', title: 'Mathematical Tripos, first year',
    pace: '2 courses at a time, 1 supervision per sheet', gate: null, requires: [raw.unlock.afterGate], lockedText: '',
    items: blocks.flatMap((b) => b.items), blocks,
  };
  return { id: 'courses', phases: [phase] };
}

/** cs.json's `track`. The screens show an empty state without it. */
function rawCstTrack(): RawTrack | null {
  const t = (csJson as unknown as { track?: RawTrack }).track;
  return t && Array.isArray(t.phases) && Array.isArray(t.items) ? t : null;
}

export const cstKey = (id: string): string => `cst:${id}`;

const lowerFirst = (x: string): string => x.charAt(0).toLowerCase() + x.slice(1);

/**
 * The CST track. Its shape is step.json's with two additions:
 * - A phase with no gate of its own whose blocks carry gates (CS-0: proof,
 *   maths, functional programming, the pre-arrival checklist) becomes one row
 *   per gated block, run side by side, each passed on its own.
 * - `unlockAfter` names the phases whose gates open a phase (CS-IB waits for
 *   CS-IA); without it a phase waits for every gate of the phase before it
 *   (CS-IA waits for all four CS-0 sub-parts).
 * A phase with `triposPart` and no items lists that Tripos part's courses.
 */
function buildCst(items: Map<string, CatItem>): CatTrack {
  const raw = rawCstTrack();
  if (!raw) return { id: 'cst', phases: [] };
  const sp = raw.supervisorPrompt;
  const role = typeof sp === 'string' ? sp : sp?.text ?? CST_ROLE;
  const codeLine = `Code questions may be answered in ${orList(typeof sp === 'object' && sp.codeLanguages?.length ? sp.codeLanguages : CST_LANGUAGES)}.`;
  const addItem = (it: RawItem): void => {
    items.set(it.id, {
      id: it.id, track: 'cst', phase: cstKey(it.phase), block: it.block, kind: it.kind, n: it.n ?? 1, title: it.title,
      topics: it.topics ?? [it.title],
      links: [
        ...(it.links ?? []).map(toLink),
        // Supervision work sheets are linked from their question.
        ...(it.questions ?? []).filter((q) => q.link).map((q) => ({ kind: 'exercises', label: q.label ?? q.id, url: q.link!, hint: false })),
      ],
      questions: questionsOf(it.questions, 'The whole set'),
      // {course} is the item title (a Part IA course item is titled with the course
      // name); {n} is filled per supervision work in supervisorPrompt.
      supervisor: (it.supervisionPrompt ?? role).replaceAll('{course}', it.title), step: false, codeLine,
    });
  };
  raw.items.forEach(addItem);

  const rawBlocks = raw.blocks ?? [];
  const sorted = [...raw.phases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const phases: CatPhase[] = [];
  // Raw phase id -> the gate keys that finish it.
  const gatesOf = new Map<string, string[]>();
  let prev: string[] = [];
  for (const p of sorted) {
    const requires = p.unlockAfter ? p.unlockAfter.flatMap((id) => gatesOf.get(id) ?? [cstKey(id)]) : prev;
    const own = rawBlocks.filter((b) => (b.phase ? cstKey(b.phase) : items.get(b.items[0] ?? '')?.phase) === cstKey(p.id));
    const gatedBlocks = own.filter((b) => b.gate && !b.alongside);
    const base = { track: 'cst' as const, requires, lockedText: '' };
    if (!p.gate && gatedBlocks.length) {
      for (const b of gatedBlocks) {
        phases.push({
          ...base, key: cstKey(b.id), name: `${p.id} ${b.name}`, title: `${p.name}: ${lowerFirst(b.name)}`,
          pace: b.pace?.text, perWeek: b.pace?.perWeek, gate: b.gate ?? null, items: b.items.filter((id) => items.has(id)), blocks: [],
        });
      }
      gatesOf.set(p.id, gatedBlocks.map((b) => cstKey(b.id)));
    } else {
      let ids = (p.items?.length ? p.items : raw.items.filter((i) => i.phase === p.id).map((i) => i.id)).filter((id) => items.has(id));
      if (!ids.length && p.triposPart) ids = triposItems(p, items);
      const side = own.filter((b) => b.alongside);
      const inSide = new Set(side.flatMap((b) => b.items));
      const main = ids.filter((id) => !inSide.has(id));
      const blocks: CatBlock[] = side.length
        ? [
            { id: `${p.id}-main`, name: 'Courses, suggested order', items: main },
            ...side.map((b) => ({ id: b.id, name: b.name, items: b.items.filter((id) => items.has(id)), alongside: true })),
          ]
        : [];
      phases.push({
        ...base, key: cstKey(p.id), name: p.id, title: p.name, pace: p.pace?.text, perWeek: p.pace?.perWeek,
        gate: p.gate ?? null, items: ids, blocks,
      });
      gatesOf.set(p.id, p.gate ? [cstKey(p.id)] : []);
    }
    const done = gatesOf.get(p.id)!;
    if (done.length) prev = done;
  }
  return { id: 'cst', phases };
}

/** A Tripos part's course list (cs.json `tripos.parts`), as study items with their links. */
function triposItems(p: RawPhase, items: Map<string, CatItem>): string[] {
  const parts = (csJson as unknown as { tripos?: { parts?: Record<string, { courses?: RawTriposCourse[] }> } }).tripos?.parts;
  const courses = parts?.[p.triposPart!]?.courses ?? [];
  return courses.map((c, i) => {
    items.set(c.id, {
      id: c.id, track: 'cst', phase: cstKey(p.id), kind: 'course', n: i + 1, title: c.name, topics: [c.name],
      links: [{ kind: 'course', label: `${c.name}: course page`, url: c.url, hint: false }, ...(c.materials?.links ?? []).map(toLink)],
      questions: questionsOf(undefined, 'The whole set'),
      supervisor: CST_ROLE.replaceAll('{course}', c.name), step: false,
    });
    return c.id;
  });
}

/** "Unlocks when Phase A's gate passes." or, for several, "Unlocks when the CS-0 Proof, … gates pass." */
function lockedText(p: CatPhase, phases: ReadonlyMap<string, CatPhase>): string {
  const names = p.requires.map((k) => phases.get(k)?.name ?? k);
  if (!names.length) return 'Locked.';
  if (names.length === 1) return `Unlocks when ${names[0]}'s gate passes.`;
  return `Unlocks when the ${orList(names).replace(/ or ([^,]*)$/, ' and $1')} gates pass.`;
}

/** The catalog, built from the bundled JSON. catalog.ts caches it per page. */
export function buildCatalog(): Catalog {
  const items = new Map<string, CatItem>();
  const tracks: Record<TrackId, CatTrack> = {
    step: buildStep(items), courses: buildCourses(items), cst: buildCst(items),
  };
  const phases = new Map<string, CatPhase>();
  for (const t of Object.values(tracks)) for (const p of t.phases) phases.set(p.key, p);
  for (const p of phases.values()) p.lockedText = lockedText(p, phases);
  return { tracks, items, phases };
}

/* ------------------------------------------------------------------ */
/* The index                                                            */
/* ------------------------------------------------------------------ */

/**
 * What Today's cards and the tracker need from the catalog, and nothing more:
 * phases in order with their blocks and unlock rules, and each item's title,
 * phase and question labels. About a tenth of the full catalog's size, because
 * it leaves out links, topics and prompts.
 */
export interface CatalogIndexData {
  tracks: Record<TrackId, CorePhase[]>;
  /** [id, title, phase key, [question id, label][]] */
  items: [string, string, string, [string, string][]][];
}

/** The index for a catalog. Gates become `true` (their details stay in the full catalog). */
export function toIndex(c: Catalog): CatalogIndexData {
  const phase = (p: CatPhase): CorePhase => ({
    key: p.key, track: p.track, name: p.name, title: p.title, gate: p.gate ? true : null,
    ...(p.alongside ? { alongside: p.alongside } : {}),
    requires: p.requires, items: p.items,
    blocks: p.blocks.map((b) => ({ id: b.id, name: b.name, items: b.items, ...(b.alongside ? { alongside: true } : {}) })),
  });
  return {
    tracks: { step: c.tracks.step.phases.map(phase), courses: c.tracks.courses.phases.map(phase), cst: c.tracks.cst.phases.map(phase) },
    items: [...c.items.values()].map((it) => [it.id, it.title, it.phase, it.questions.map((q) => [q.id, q.label] as [string, string])]),
  };
}

/* ------------------------------------------------------------------ */
/* Per-track payloads                                                   */
/* ------------------------------------------------------------------ */

/**
 * One track of the built catalog, as the screens load it: its phases in order
 * and its items. The Vite plugin emits one lazy module per track, so a screen
 * fetches only the tracks it shows (the CS path never loads STEP or Part IA)
 * and never builds anything at runtime. Phases carry their `lockedText`
 * already, which is the one field that reads across tracks (Part IA waits for
 * Phase B).
 */
export interface CatTrackData {
  id: TrackId;
  phases: CatPhase[];
  items: CatItem[];
}

export function trackData(c: Catalog, id: TrackId): CatTrackData {
  return { id, phases: c.tracks[id].phases, items: [...c.items.values()].filter((it) => it.track === id) };
}

/** Build-time entry for the Vite plugin: the index of the bundled catalog, and each track's payload. */
export function catalogModules(): { index: CatalogIndexData; tracks: Record<TrackId, CatTrackData> } {
  const c = buildCatalog();
  return {
    index: toIndex(c),
    tracks: { step: trackData(c, 'step'), courses: trackData(c, 'courses'), cst: trackData(c, 'cst') },
  };
}
