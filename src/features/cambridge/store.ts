/**
 * Cambridge store access. A thin layer over the synced `cambridge` store in
 * appState, in the same style as trackerStore: read the live store, build the
 * next one, persist it, and mark it dirty so the SyncEngine saves and pushes it.
 *
 * Every write stamps `updatedAt`, because the merge is last-writer-wins per
 * record: a record written without a fresh stamp would lose to an older copy
 * on another device.
 */
import { appState } from '@/app/bootstrap';
import { emptyCambridge, type CamError, type CamGate, type CamItem, type CamWeek, type CambridgeState } from '@/features/cambridge/types';

/**
 * Resolves once the store has loaded and, on a device's first run, the Massey
 * backup has been taken. Await it before the first Cambridge write.
 */
export { cambridgeReady } from '@/app/bootstrap';

/**
 * The live store. Falls back to an empty one when appState is not wired yet (an
 * import cycle through bootstrap at module-eval time, as in trackerStore).
 */
export function readCambridge(): CambridgeState {
  try {
    const c = appState.get('cambridge') as unknown as CambridgeState | undefined;
    return c && c.items ? c : emptyCambridge();
  } catch {
    return emptyCambridge();
  }
}

/** Persist a whole next state. `system` saves without the "Saved" flash meant for the owner's edits. */
export function commitCambridge(next: CambridgeState, opts: { system?: boolean } = {}): void {
  appState.set('cambridge', next as unknown as Record<string, unknown>);
  appState.markTheoristDirty(opts);
}

/** A new, not-started item for a catalog id. */
export function blankItem(id: string, now: number): CamItem {
  return { id, stage: 'not-started', questions: {}, updatedAt: now };
}

/**
 * Apply `edit` to one item (created blank if absent) and stamp it. Returns the
 * stored item. A tombstoned item is revived as blank, since re-opening a deleted
 * item is a fresh start.
 */
export function updateItem(id: string, edit: (item: CamItem) => CamItem, now: number = Date.now()): CamItem {
  const s = readCambridge();
  const prev = s.items[id];
  const base = prev && !prev.deleted ? prev : blankItem(id, now);
  const item = { ...edit(structuredClone(base)), id, updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1) };
  commitCambridge({ ...s, items: { ...s.items, [id]: item } });
  return item;
}

/** Tombstone an item so the delete reaches other devices (pruned after 30 days). */
export function deleteItem(id: string, now: number = Date.now()): void {
  const s = readCambridge();
  const prev = s.items[id];
  if (!prev || prev.deleted) return;
  const tomb: CamItem = { id, stage: 'not-started', questions: {}, deleted: true, updatedAt: Math.max(now, prev.updatedAt + 1) };
  commitCambridge({ ...s, items: { ...s.items, [id]: tomb } });
}

export function putError(e: Omit<CamError, 'updatedAt'>, now: number = Date.now()): CamError {
  const s = readCambridge();
  const prev = s.errors[e.id];
  const rec: CamError = { ...e, updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1) };
  commitCambridge({ ...s, errors: { ...s.errors, [e.id]: rec } });
  return rec;
}

export function deleteError(id: string, now: number = Date.now()): void {
  const s = readCambridge();
  const prev = s.errors[id];
  if (!prev || prev.deleted) return;
  const rec: CamError = { ...prev, deleted: true, updatedAt: Math.max(now, prev.updatedAt + 1) };
  commitCambridge({ ...s, errors: { ...s.errors, [id]: rec } });
}

export function putGate(g: Omit<CamGate, 'updatedAt'>, now: number = Date.now()): CamGate {
  const s = readCambridge();
  const prev = s.gates[g.phase];
  const rec: CamGate = { ...g, updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1) };
  commitCambridge({ ...s, gates: { ...s.gates, [g.phase]: rec } });
  return rec;
}

export function putWeek(w: Omit<CamWeek, 'updatedAt'>, now: number = Date.now()): CamWeek {
  const s = readCambridge();
  const prev = s.weeks[w.week];
  const rec: CamWeek = { ...w, updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1) };
  commitCambridge({ ...s, weeks: { ...s.weeks, [w.week]: rec } });
  return rec;
}
