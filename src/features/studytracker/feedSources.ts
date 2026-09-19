/**
 * Daily reading feed — live, taste-ranked reading for the study ritual.
 * Hacker News (the CORS-friendly HN Algolia search API, hit directly from the
 * browser — no backend, no proxy) is the sole discovery engine. dev.to was
 * dropped as off-taste, low-signal (Amendment A1). arXiv's export API sends no
 * CORS headers and OpenAlex tagging is too noisy, so neither is used client-side.
 *
 * Taste target (A1): DEEP systems / distributed-systems engineering and applied
 * CS-theory / math-in-production, from sharp individual engineers and premium
 * company eng blogs. A curated, fetch-verified domain allowlist ranks up; the
 * rest are ranked toward the taste by points + theme heuristics. We only ever
 * render items HN actually returned — no fabricated sources or URLs.
 *
 * Cached per day in localStorage (`meridian.feed.v2`) so the list is stable
 * through the day and still shows (stale) when offline. Best-effort: each query
 * fails independently and never throws to the caller.
 */
import { todayISO } from '@/features/studytracker/trackerStore';

export interface FeedItem {
  source: 'HN';
  title: string;
  url: string;
  meta: string; // e.g. "412 pts · 87 comments"
  why: string; // truthful why-chosen line: names the allowlist domain or the matched theme
}
export interface FeedResult {
  items: FeedItem[];
  stale: boolean; // served from a previous day's cache (the fetch failed)
  error: string | null;
}

const KEY = 'meridian.feed.v2';
const HN_ENDPOINT = 'https://hn.algolia.com/api/v1/search';

/**
 * Curated, fetch-verified eng-blog domains (A1). Each was confirmed live and
 * on-taste. HN stories on these domains are boosted to the top; never invent
 * others, and only surface a domain here when HN actually returns it.
 */
const ALLOWLIST: readonly string[] = [
  'blog.cloudflare.com',
  'danluu.com',
  'jvns.ca',
  'research.swtch.com',
  'blog.acolyer.org',
  'brendangregg.com',
  'tj-zhang.com',
];

/** HN Algolia queries aimed at the A1 taste. */
const TASTE_QUERIES: readonly string[] = [
  'distributed systems',
  'systems programming',
  'performance latency',
  'algorithm',
  'database internals',
  'compiler',
  'operating system kernel',
  'formal proof verification',
];

/** Theme heuristics — a matched theme both ranks up and names the why-chosen line. */
const THEMES: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'distributed systems', re: /\b(distributed|consensus|raft|paxos|replicat|shard|quorum|fault[- ]toleran)/i },
  { label: 'performance & latency', re: /\b(performance|perf|latency|throughput|optimi[sz]|profil|benchmark|tail latenc)/i },
  { label: 'systems programming', re: /\b(kernel|operating system|syscall|linux|allocator|scheduler|lock-free|concurren|memory model|virtual memory)/i },
  { label: 'databases & storage', re: /\b(database|b-tree|lsm|storage engine|transaction|write-ahead|index(?:ing)?)/i },
  { label: 'compilers & languages', re: /\b(compiler|interpreter|type system|garbage collect|runtime|jit)/i },
  { label: 'algorithms & proofs', re: /\b(algorithm|proof|complexity|np-complete|data structure|invariant)/i },
];

const MIN_POINTS = 60; // server-side floor on how popular a story must be
const HIGH_SIGNAL_POINTS = 150; // keep an untagged story only if it clears this

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function isAllowed(host: string): boolean {
  return ALLOWLIST.some((d) => host === d || host.endsWith('.' + d));
}

function matchTheme(text: string): string | null {
  for (const t of THEMES) if (t.re.test(text)) return t.label;
  return null;
}

async function fetchHN(): Promise<FeedItem[]> {
  const seen = new Set<string>();
  const scored: Array<{ item: FeedItem; score: number }> = [];
  const results = await Promise.allSettled(
    TASTE_QUERIES.map((q) =>
      fetch(`${HN_ENDPOINT}?tags=story&query=${encodeURIComponent(q)}&numericFilters=points>${MIN_POINTS}&hitsPerPage=6`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ),
  );
  // Distinguish "HN is down" (every query rejected) from "quiet day" (queries
  // succeeded but nothing cleared the taste bar) so the caller can message each
  // honestly instead of always claiming HN is unreachable.
  if (results.every((r) => r.status === 'rejected')) throw new Error('hn-unreachable');
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    for (const hit of (res.value?.hits ?? []) as Array<Record<string, unknown>>) {
      const id = String(hit.objectID ?? '');
      const title = String(hit.title ?? '').trim();
      if (!title) continue;
      const url = (hit.url as string) || `https://news.ycombinator.com/item?id=${id}`;
      const dedupe = 'u:' + url.toLowerCase();
      if (seen.has(id) || seen.has(dedupe)) continue;

      const host = hostOf(url);
      const allowed = isAllowed(host);
      const theme = matchTheme(`${title} ${host}${pathOf(url)}`);
      const pts = Number(hit.points ?? 0);
      const cmts = Number(hit.num_comments ?? 0);

      // Rank toward the A1 taste: allowlisted or theme-matched always qualify;
      // an untagged story only survives if it is genuinely high-signal.
      if (!allowed && !theme && pts < HIGH_SIGNAL_POINTS) continue;

      seen.add(id);
      seen.add(dedupe);
      const why = allowed
        ? `Curated engineering blog · ${host}`
        : theme
          ? `On-taste: ${theme}`
          : `Top of Hacker News · ${pts} pts`;
      const score = pts + (allowed ? 10_000 : 0) + (theme ? 1_000 : 0);
      scored.push({ item: { source: 'HN', title, url, meta: `${pts} pts · ${cmts} comments`, why }, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.item);
}

interface Cache {
  date: string;
  items: FeedItem[];
}

function readCache(): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null') as Cache | null;
    if (c && typeof c.date === 'string' && Array.isArray(c.items)) return c;
  } catch {
    /* ignore */
  }
  return null;
}

export async function loadDailyFeed(force = false): Promise<FeedResult> {
  const cache = readCache();
  const today = todayISO();
  if (!force && cache && cache.date === today && cache.items.length) {
    return { items: cache.items, stale: false, error: null };
  }

  let items: FeedItem[] = [];
  let reachable = true;
  try {
    items = await fetchHN();
  } catch {
    reachable = false;
  }

  if (items.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ date: today, items }));
    } catch {
      /* ignore */
    }
    return { items, stale: false, error: null };
  }
  // No usable items. Fall back to a saved day if we have one; otherwise pick the
  // message that matches WHY we're empty (HN down vs nothing on-taste today).
  if (cache && cache.items.length) {
    return {
      items: cache.items,
      stale: true,
      error: reachable
        ? 'No fresh on-taste stories today; showing saved items.'
        : 'Showing saved items; Hacker News is unreachable.',
    };
  }
  return {
    items: [],
    stale: false,
    error: reachable
      ? 'No on-taste stories cleared the bar today — check back later.'
      : 'Hacker News is unreachable right now.',
  };
}
