/**
 * The catalog rules that need only the curriculum's structure: which phases a
 * path lists, whether a phase is open, passed or locked, and which item is
 * current. Both the full catalog (catalog.ts, for the Cambridge screens) and the
 * small build-time index (catalogIndex.ts, for Today and the tracker) run
 * through these, so the two can never disagree.
 *
 * Every function takes the structure it reads, so this module holds no JSON.
 */
import { currentItem, phaseUnlocked, type CatalogEntry, type CurrentItem } from '@/features/cambridge/schedule';
import type { CamItem, CambridgeState } from '@/features/cambridge/types';

export type TrackId = 'step' | 'courses' | 'cst';

export interface CoreQuestion { id: string; label: string }

export interface CoreItem {
  id: string;
  title: string;
  /** The gate key of the item's phase. */
  phase: string;
  questions: CoreQuestion[];
}

export interface CoreBlock {
  id: string;
  name: string;
  items: string[];
  /** Runs alongside the phase's main work: listed, never gating. */
  alongside?: boolean;
}

export interface CorePhase {
  /** The key gates are stored under. */
  key: string;
  track: TrackId;
  name: string;
  title: string;
  /** Truthy when the phase has a gate of its own (the full catalog holds the gate's details). */
  gate: unknown;
  /** The phase this one runs alongside (A+ with B). */
  alongside?: string;
  /** Gate keys that must all pass before this phase opens. */
  requires: string[];
  items: string[];
  blocks: CoreBlock[];
}

export interface CoreCatalog<P extends CorePhase = CorePhase, I extends CoreItem = CoreItem> {
  tracks: Record<TrackId, { id: TrackId; phases: P[] }>;
  items: ReadonlyMap<string, I>;
  phases: ReadonlyMap<string, P>;
}

export const liveItem = (state: CambridgeState, id: string): CamItem | undefined => {
  const it = state.items?.[id];
  return it && !it.deleted ? it : undefined;
};

/** Supervised with no redo left, or redone: the item counts as done. Same rule as schedule.currentItem. */
export function itemDone(it: CamItem | undefined): boolean {
  if (!it) return false;
  if (it.stage === 'redo-done') return true;
  return it.stage === 'supervised' && !((it.redoQs?.length ?? 0) > 0 && it.redoneAt === undefined);
}

export const STAGE_RANK: Readonly<Record<CamItem['stage'], number>> = {
  'not-started': 0, attempting: 1, 'written-up': 2, supervised: 3, 'redo-done': 4,
};
export const stageRank = (it: CamItem | undefined): number => STAGE_RANK[it?.stage ?? 'not-started'];

export const gatePassed = (state: CambridgeState, key: string): boolean => !!state.gates?.[key]?.passedAt;

export function phaseOpen(state: CambridgeState, p: CorePhase): boolean {
  if (p.track === 'cst') return p.requires.every((k) => gatePassed(state, k));
  return phaseUnlocked(state, p.key);
}

export type PhaseState = 'passed' | 'current' | 'locked';

/**
 * A phase with a gate is passed when its gate is. One without (A+, Part IA)
 * runs alongside another and is finished when that one passes, or never.
 */
export function phaseState(state: CambridgeState, p: CorePhase): PhaseState {
  if (p.gate ? gatePassed(state, p.key) : !!p.alongside && gatePassed(state, p.alongside)) return 'passed';
  return phaseOpen(state, p) ? 'current' : 'locked';
}

/** The phases a path lists: the Math path shows STEP then Part IA. */
export function pathPhasesOf<P extends CorePhase>(c: CoreCatalog<P>, which: 'math' | 'cst'): P[] {
  const t = c.tracks;
  return which === 'math' ? [...t.step.phases, ...t.courses.phases] : t.cst.phases;
}

/** The `{id, title, phase}` entries currentItem() expects, in study order. */
export function catalogEntriesOf(c: CoreCatalog, track: TrackId): CatalogEntry[] {
  return c.tracks[track].phases.flatMap((p) =>
    p.items.map((id) => ({ id, title: c.items.get(id)!.title, phase: p.key })),
  );
}

/**
 * The current item for a path. The Math path is STEP then Part IA (schedule's
 * own unlock table applies). CST phases are unknown to that table, so locked
 * CST entries are dropped before the call.
 */
export function currentForIn(c: CoreCatalog, state: CambridgeState, which: 'math' | 'cst', now: number): CurrentItem | null {
  if (which === 'math') return currentItem(state, catalogEntriesOf(c, 'step'), catalogEntriesOf(c, 'courses'), now);
  const open = new Set(c.tracks.cst.phases.filter((p) => phaseOpen(state, p)).map((p) => p.key));
  return currentItem(state, catalogEntriesOf(c, 'cst').filter((e) => open.has(e.phase)), [], now);
}
