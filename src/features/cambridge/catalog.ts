/**
 * The Cambridge catalog: one typed view over the owner-editable curriculum JSON
 * (data/cambridge/step.json, courses.json, and the `track` in cs.json), so the
 * screens never read raw JSON shapes.
 *
 * Three tracks:
 * - `step`: Phases 0, A, A+, B, C, D (STEP).
 * - `courses`: Part IA of the Mathematical Tripos, one study item per example
 *   sheet, locked until the Phase B gate.
 * - `cst`: the Computer Science Tripos track (DECISIONS C11). cs.json gains it
 *   in the same shape as step.json; until it does, the track is empty.
 *
 * Each track is built at build time (catalogBuild.ts, through the Vite plugin
 * in scripts/cambridge/index-plugin.mjs) into its own lazy chunk, and a screen
 * loads only the tracks it shows: the Cambridge path loads step and courses,
 * the CS path only cst, a study item only its own track. Call loadPath,
 * loadItem or loadTracks first; the accessors below then read synchronously,
 * and those that list a path throw if its tracks have not loaded, so a missing
 * load fails loudly instead of rendering an empty plan.
 *
 * The unlock rules live in catalogCore.ts, which Today's small index
 * (catalogIndex.ts) shares, so Today and the path screen can never disagree.
 */
import promptTemplate from '@data/cambridge/supervisor-prompt.md?raw';
import type { CurrentItem } from '@/features/cambridge/schedule';
import type { CambridgeState } from '@/features/cambridge/types';
import type {
  CatBlock, CatEvidence, Catalog, CatItem, CatPhase, CatTrack, CatTrackData, TrackId,
} from '@/features/cambridge/catalogBuild';
import { STEP_ROLE } from '@/features/cambridge/catalogShared';
import {
  catalogEntriesOf, currentForIn, itemDone as itemDoneOf, liveItem, pathPhasesOf, STAGE_RANK, stageRank,
} from '@/features/cambridge/catalogCore';
import { catalogIndex } from '@/features/cambridge/catalogIndex';
import type { CatalogEntry } from '@/features/cambridge/schedule';

export type {
  CatBlock, CatEvidence, CatGate, CatItem, CatLink, CatPhase, CatQuestion, CatTrack, Catalog, CatalogIndexData, TrackId,
} from '@/features/cambridge/catalogBuild';
export { isHintLink } from '@/features/cambridge/catalogShared';
export {
  gatePassed, itemDone, liveItem, phaseOpen, phaseState, stageRank, type PhaseState,
} from '@/features/cambridge/catalogCore';

/* ------------------------------------------------------------------ */
/* Loading the tracks                                                   */
/* ------------------------------------------------------------------ */

const TRACK_ORDER: readonly TrackId[] = ['step', 'courses', 'cst'];

const LOADERS: Readonly<Record<TrackId, () => Promise<{ default: CatTrackData }>>> = {
  step: () => import('virtual:cambridge-track/step'),
  courses: () => import('virtual:cambridge-track/courses'),
  cst: () => import('virtual:cambridge-track/cst'),
};

/** The tracks each path screen lists. */
export const PATH_TRACKS: Readonly<Record<'math' | 'cst', readonly TrackId[]>> = { math: ['step', 'courses'], cst: ['cst'] };

const loaded: Partial<Record<TrackId, CatTrackData>> = {};
const inflight: Partial<Record<TrackId, Promise<void>>> = {};
let cached: Catalog | null = null;

/** Load these tracks once per page. A failed load can be retried. */
export function loadTracks(ids: readonly TrackId[]): Promise<void> {
  return Promise.all(
    ids.map((id) =>
      (inflight[id] ??= LOADERS[id]().then(
        (m) => {
          loaded[id] = m.default;
          cached = null;
        },
        (e: unknown) => {
          delete inflight[id];
          throw e;
        },
      )),
    ),
  ).then(() => undefined);
}

/** Load the tracks a path screen lists. */
export const loadPath = (which: 'math' | 'cst'): Promise<void> => loadTracks(PATH_TRACKS[which]);

/** Load every track (the tests, and anything that reads across tracks). */
export const loadCatalog = (): Promise<void> => loadTracks(TRACK_ORDER);

/** The track an item belongs to, from Today's index, or undefined for an id not in the plan. */
export function trackOf(id: string | null | undefined): TrackId | undefined {
  const ix = catalogIndex();
  const phase = id ? ix.items.get(id)?.phase : undefined;
  return phase ? ix.phases.get(phase)?.track : undefined;
}

/** Load the track of one study item. An id not in the plan loads nothing, so the screen can say so. */
export function loadItem(id: string | null | undefined): Promise<void> {
  const t = trackOf(id);
  return t ? loadTracks([t]) : Promise.resolve();
}

/** Whether these tracks are loaded, so the accessors below can read them. */
export const tracksLoaded = (ids: readonly TrackId[]): boolean => ids.every((id) => !!loaded[id]);

function need(ids: readonly TrackId[]): void {
  const missing = ids.filter((id) => !loaded[id]);
  if (missing.length) throw new Error(`Cambridge catalog: the ${missing.join(' and ')} track is not loaded`);
}

/**
 * The loaded tracks as one catalog, rebuilt only when a track arrives. A track
 * not loaded yet has no phases and no items here.
 */
export function catalog(): Catalog {
  if (cached) return cached;
  const items = new Map<string, CatItem>();
  const phases = new Map<string, CatPhase>();
  const tracks = {} as Record<TrackId, CatTrack>;
  for (const id of TRACK_ORDER) {
    const t = loaded[id];
    tracks[id] = { id, phases: t?.phases ?? [] };
    for (const it of t?.items ?? []) items.set(it.id, it);
    for (const p of t?.phases ?? []) phases.set(p.key, p);
  }
  cached = { tracks, items, phases };
  return cached;
}

/** A loaded study item, or undefined (not in the plan, or its track has not loaded). */
export const catItem = (id: string | null | undefined): CatItem | undefined => (id ? catalog().items.get(id) : undefined);

/** Whether a self-mark of 14 or more on this question earns the STEP self-mark XP: only real STEP questions do. */
export const isStepQuestion = (item: CatItem, q: string): boolean =>
  item.step && !!item.questions.find((x) => x.id === q)?.step;

/* ------------------------------------------------------------------ */
/* The supervisor prompt                                                */
/* ------------------------------------------------------------------ */

/**
 * The exam-specific lines of supervisor-prompt.md, per track: how to mark, and
 * where the harder follow-up comes from. A Part IA or CST supervisor marks and
 * sets follow-ups from Tripos papers, not STEP.
 */
const EXAM_LINES: Readonly<Record<TrackId, { style: string; source: string }>> = {
  step: { style: 'STEP-style', source: 'from the STEP database' },
  courses: { style: 'Tripos-style', source: 'from past Tripos papers' },
  cst: { style: 'Tripos-style', source: 'from the CST past papers' },
};

/**
 * The supervisor prompt with the item filled in: the text the owner pastes into
 * Claude. Plain text, never rendered as HTML.
 */
export function supervisorPrompt(item: CatItem, q?: string): string {
  let role = item.supervisor;
  if (role.includes('{n}')) {
    // CST: {n} is the supervision work's own number (question id `sw2` gives 2),
    // never the item's position. The selected question decides, else the first
    // supervision work; an item with none drops the clause.
    const sw = (id: string | undefined): string | undefined => (id ? /^sw(\d+)$/.exec(id)?.[1] : undefined);
    const n = sw(q) ?? item.questions.map((x) => sw(x.id)).find(Boolean);
    role = n ? role.replaceAll('{n}', n) : role.replace(/,?\s*[^,]*\{n\}/, '');
  }
  const exam = EXAM_LINES[item.track];
  let text = promptTemplate
    .replace(STEP_ROLE, role)
    .replaceAll('{item title}', item.title)
    .replaceAll('{marking style}', exam.style)
    .replaceAll('{follow-up source}', exam.source);
  if (item.codeLine) text = text.trimEnd() + '\n' + item.codeLine + '\n';
  return text;
}

/* ------------------------------------------------------------------ */
/* Progress, unlocks and the current phase                              */
/* ------------------------------------------------------------------ */

/** The phases the path lists for a screen: the Math path shows STEP then Part IA. */
export function pathPhases(which: 'math' | 'cst'): CatPhase[] {
  need(PATH_TRACKS[which]);
  return pathPhasesOf(catalog(), which);
}

const mainBlocks = (p: CatPhase): CatBlock[] => p.blocks.filter((b) => !b.alongside);

/** Items of the block to show now: the first block with work left, or the whole phase when it has no blocks. */
export function currentBlock(state: CambridgeState, p: CatPhase): CatBlock {
  const main = mainBlocks(p);
  if (!main.length) return { id: p.key, name: p.name, items: p.items };
  return main.find((b) => b.items.some((id) => !itemDoneLive(state, id))) ?? main[main.length - 1]!;
}
const itemDoneLive = (state: CambridgeState, id: string): boolean => itemDoneOf(liveItem(state, id));

/** Blocks that run beside the phase's main work, listed under it while the phase is open. */
export const sideBlocks = (p: CatPhase): CatBlock[] => p.blocks.filter((b) => b.alongside);

/** The last main block's items (the whole phase without blocks): the gate opens when these are all supervised. */
export function gateItems(p: CatPhase): string[] {
  const main = mainBlocks(p);
  return main.length ? main[main.length - 1]!.items : p.items;
}

/** What is still in the way of the gate, or '' when the gate can be passed. */
export function gateBlocker(state: CambridgeState, p: CatPhase): string {
  const left = gateItems(p).filter((id) => stageRank(liveItem(state, id)) < STAGE_RANK.supervised).length;
  if (!left) return '';
  return `${left} ${left === 1 ? 'item' : 'items'} still to supervise`;
}

/** The `{id, title, phase}` entries currentItem() expects, in study order. */
export function catalogEntries(track: TrackId): CatalogEntry[] {
  need([track]);
  return catalogEntriesOf(catalog(), track);
}

/**
 * The current item for a path. The Math path is STEP then Part IA (schedule's
 * own unlock table applies); locked CST entries are dropped before the call.
 */
export function currentFor(state: CambridgeState, which: 'math' | 'cst', now: number): CurrentItem | null {
  need(PATH_TRACKS[which]);
  return currentForIn(catalog(), state, which, now);
}

/* ------------------------------------------------------------------ */
/* Gate evidence rules                                                  */
/* ------------------------------------------------------------------ */

export interface EvidenceRule {
  /** Shown under the field, e.g. "Under 60 to pass". */
  text: string;
  ok(value: string): boolean;
}

/**
 * The pass rule for one gate field, read from its label, so the owner edits
 * the rule by editing the JSON: "(need 4)" means at least 4, "under 60" less
 * than 60, "out of 20" 0 to 20, "180 max" at most 180, "(yes/no)" must be yes.
 */
export function evidenceRule(e: CatEvidence): EvidenceRule {
  const label = e.label.toLowerCase();
  if (e.type === 'yesno') return { text: 'Yes to pass', ok: (v) => v === 'yes' };
  if (e.type === 'text') return { text: 'Required', ok: (v) => v.trim().length > 0 };
  const num = (v: string): number => (v.trim() === '' ? NaN : Number(v));
  const need = /need (\d+)/.exec(label);
  if (need) return { text: `${need[1]} or more to pass`, ok: (v) => num(v) >= Number(need[1]) };
  const under = /under (\d+)/.exec(label);
  if (under) return { text: `Under ${under[1]} to pass`, ok: (v) => num(v) >= 0 && num(v) < Number(under[1]) };
  const max = /(\d+) max/.exec(label);
  if (max) return { text: `${max[1]} or less`, ok: (v) => num(v) >= 0 && num(v) <= Number(max[1]) };
  const outOf = /out of (\d+)/.exec(label);
  if (outOf) return { text: `0 to ${outOf[1]}`, ok: (v) => num(v) >= 0 && num(v) <= Number(outOf[1]) };
  return { text: 'A number', ok: (v) => Number.isFinite(num(v)) };
}
