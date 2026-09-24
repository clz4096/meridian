/**
 * Question-bank loader — fetches questions/index.json and every topic file it
 * lists, caching the result to localStorage so the offline PWA still has the
 * bank on a cold, network-less start.
 */

interface Manifest {
  topics?: Record<string, { file: string; count?: number }>;
}

export interface QuestionBank {
  /** The parsed index.json, or null when served from the offline cache. */
  manifest: Manifest | null;
  /** Topic id → array of question objects. */
  items: Record<string, unknown[]>;
}

const CACHE_KEY = 'kg_bank_cache';

/**
 * Fetch the manifest + all topic files. On any network failure, fall back to
 * the last good cache. Returns null only when there is neither network nor cache.
 */
export async function fetchQuestionBank(): Promise<QuestionBank | null> {
  try {
    const r = await fetch('questions/index.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const manifest = (await r.json()) as Manifest;
    const topics = Object.keys(manifest.topics ?? {});
    const items: Record<string, unknown[]> = {};
    await Promise.all(topics.map(async (t) => {
      try {
        const rr = await fetch(manifest.topics![t]!.file, { cache: 'no-cache' });
        if (rr.ok) items[t] = await rr.json();
      } catch {
        /* skip a topic file that fails; the rest still load */
      }
    }));
    // A topic that failed this time keeps its last good copy, so one flaky request
    // can't drop a topic (and its due reviews) from the offline cache.
    const missing = topics.filter((t) => !items[t]);
    if (missing.length) {
      try {
        const old = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, unknown[]>;
        for (const t of missing) if (old[t]) items[t] = old[t];
      } catch {
        /* no usable cache */
      }
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {
      /* quota — cache is best-effort */
    }
    return { manifest, items };
  } catch {
    // offline / file:// fallback — use the last good cache.
    try {
      const c = localStorage.getItem(CACHE_KEY);
      if (c) return { manifest: null, items: JSON.parse(c) };
    } catch {
      /* corrupt cache */
    }
    return null;
  }
}
