/**
 * The Massey Standard's storage keys, in a module of their own so boot can read
 * them synchronously (see `snapshotMassey`) without loading the migration chunk.
 */
/**
 * Every key the Massey Standard owns (ARCHITECTURE-cambridge.md section 2,
 * checked against the code). `meridian-theorist__v` is the version stamp that
 * decides which storage tier wins on load, so a restore needs it too.
 */
export const MASSEY_KEYS: readonly string[] = [
  'meridian-theorist',
  'meridian-theorist__v',
  'meridian.curriculum.v1',
  'meridian.papers.v1',
  'meridian.proofjournal.v1',
  'meridian.tracker.ui.v1',
  'meridian.tracker.tab.v1',
  'meridian.teach.v1',
  'meridian.feed.v2',
  'meridian.tracker.v1',
  'meridian.theorist.migrated',
  'meridian.mastery.migrated',
];

/**
 * The raw value of every Massey key, read synchronously. Boot takes this as its
 * first step, before the first render, so the backup always holds the values as
 * the old build left them, even if the owner taps something (a paper pass, a
 * block tick) before the lazy migration chunk has loaded and written the backup.
 */
export function snapshotMassey(storage: Storage | null): Record<string, string | null> {
  const keys: Record<string, string | null> = {};
  for (const k of MASSEY_KEYS) {
    try { keys[k] = storage?.getItem(k) ?? null; } catch { keys[k] = null; }
  }
  return keys;
}
