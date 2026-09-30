/**
 * Question-bank loader. `fetchQuestionIndex` reads only questions/index.json (the
 * question ids per topic, a few KB), which is all Today's mastery % needs.
 * `fetchQuestionBank` reads the index plus every topic file (about 550 KB) and runs
 * only when Knowledge opens. Offline launches are served by the service worker, which
 * precaches every file under questions/.
 */

interface Manifest {
  topics?: Record<string, { file: string; count?: number; ids?: string[] }>;
}

export interface QuestionBank {
  /** The parsed index.json, or null when served from the offline cache. */
  manifest: Manifest | null;
  /** Topic id → array of question objects. */
  items: Record<string, unknown[]>;
}

// The bank used to be mirrored here for offline starts. The service worker precache
// replaced it; it is still read as a last resort and cleared after a complete download.
const CACHE_KEY = 'kg_bank_cache';

/**
 * Every curated question id, by topic, from index.json. Null when the index can't be
 * fetched or lists no ids (callers then fall back to the full bank, if loaded).
 */
export async function fetchQuestionIndex(): Promise<Record<string, string[]> | null> {
  try {
    const r = await fetch('questions/index.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const manifest = (await r.json()) as Manifest;
    const out: Record<string, string[]> = {};
    for (const [t, v] of Object.entries(manifest.topics ?? {})) {
      if (!Array.isArray(v.ids)) return null; // an older index without ids: no partial answer
      out[t] = v.ids.map(String);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

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
    // A complete download means the legacy mirror (about 550 KB of localStorage quota,
    // shared with the user's own data) is no longer needed.
    if (!missing.length) {
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
        /* storage unavailable */
      }
    }
    return { manifest, items };
  } catch {
    // Offline with no service worker (dev, or a first visit): the legacy mirror, if any.
    try {
      const c = localStorage.getItem(CACHE_KEY);
      if (c) return { manifest: null, items: JSON.parse(c) };
    } catch {
      /* corrupt cache */
    }
    return null;
  }
}
