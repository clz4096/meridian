/**
 * The small catalog index Today's Math and CS cards and the tracker read: the
 * curriculum's structure (phases, blocks, unlock rules, item titles and
 * question labels) without its links, topics and prompts.
 *
 * Why: the full catalog is about 40 KB gzip of JSON, and Today boots on every
 * launch. The index is generated at build time from the same JSON and the same
 * building code (catalogBuild.ts, through the Vite plugin in
 * scripts/cambridge/index-plugin.mjs), so it can never drift from the data.
 * The full catalog loads only when a Cambridge screen opens.
 */
import data from 'virtual:cambridge-index';
import type { CurrentItem } from '@/features/cambridge/schedule';
import type { CambridgeState } from '@/features/cambridge/types';
import {
  currentForIn, pathPhasesOf, type CoreCatalog, type CoreItem, type CorePhase, type TrackId,
} from '@/features/cambridge/catalogCore';

export { itemDone, liveItem, phaseState } from '@/features/cambridge/catalogCore';
export type { CoreItem as IndexItem, CorePhase as IndexPhase } from '@/features/cambridge/catalogCore';

let cached: CoreCatalog | null = null;

/** The index as a catalog, built once per page. */
export function catalogIndex(): CoreCatalog {
  if (cached) return cached;
  const tracks = {
    step: { id: 'step', phases: data.tracks.step },
    courses: { id: 'courses', phases: data.tracks.courses },
    cst: { id: 'cst', phases: data.tracks.cst },
  } as Record<TrackId, { id: TrackId; phases: CorePhase[] }>;
  const items = new Map<string, CoreItem>(
    data.items.map(([id, title, phase, qs]) => [id, { id, title, phase, questions: qs.map(([qid, label]) => ({ id: qid, label })) }]),
  );
  const phases = new Map<string, CorePhase>();
  for (const t of Object.values(tracks)) for (const p of t.phases) phases.set(p.key, p);
  cached = { tracks, items, phases };
  return cached;
}

export const indexItem = (id: string | null | undefined): CoreItem | undefined => (id ? catalogIndex().items.get(id) : undefined);

export const pathPhases = (which: 'math' | 'cst'): CorePhase[] => pathPhasesOf(catalogIndex(), which);

export const currentFor = (state: CambridgeState, which: 'math' | 'cst', now: number): CurrentItem | null =>
  currentForIn(catalogIndex(), state, which, now);
