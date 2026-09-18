/**
 * Daily reading feed — live CS / C++ / math reading for the study ritual.
 * Two CORS-friendly public APIs the browser hits directly (no backend, no
 * proxy): the Hacker News Algolia search API, and the dev.to articles API.
 * Both return real articles/blogs, which is what a daily reading list wants.
 * (arXiv's export API sends no CORS headers, and OpenAlex's concept tagging is
 * too noisy for a focused CS list, so neither is used from the browser; a
 * server-side proxy would be needed for real arXiv.)
 *
 * Cached per day in localStorage (`meridian.feed.v1`) so the list is stable
 * through the day and still shows (stale) when offline. Best-effort: each
 * source fails independently and never throws to the caller.
 */
import { todayISO } from '@/features/studytracker/trackerStore';

export interface FeedItem {
  source: 'HN' | 'blog';
  title: string;
  url: string;
  meta: string;
}
export interface FeedResult {
  items: FeedItem[];
  stale: boolean; // served from a previous day's cache (a fetch failed)
  error: string | null;
}

const KEY = 'meridian.feed.v1';
const HN_TOPICS = ['C++', 'compilers', 'algorithms', 'operating systems'];
const DEV_TAGS = ['cpp', 'algorithms', 'computerscience'];

interface Cache { date: string; items: FeedItem[] }

function readCache(): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null') as Cache | null;
    if (c && typeof c.date === 'string' && Array.isArray(c.items)) return c;
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchHN(): Promise<FeedItem[]> {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  const results = await Promise.allSettled(
    HN_TOPICS.map((q) =>
      fetch(`https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(q)}&numericFilters=points>80&hitsPerPage=6`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ),
  );
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    for (const hit of (res.value?.hits ?? []) as Array<Record<string, unknown>>) {
      const id = String(hit.objectID ?? '');
      const title = String(hit.title ?? '').trim();
      if (!title || seen.has(id)) continue;
      seen.add(id);
      const url = (hit.url as string) || `https://news.ycombinator.com/item?id=${id}`;
      const pts = Number(hit.points ?? 0);
      const cmts = Number(hit.num_comments ?? 0);
      out.push({ source: 'HN', title, url, meta: `${pts} pts · ${cmts} comments` });
    }
  }
  return out.sort((a, b) => (parseInt(b.meta) || 0) - (parseInt(a.meta) || 0)).slice(0, 6);
}

async function fetchDevto(): Promise<FeedItem[]> {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  const results = await Promise.allSettled(
    DEV_TAGS.map((t) =>
      fetch(`https://dev.to/api/articles?tag=${encodeURIComponent(t)}&top=90&per_page=4`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ),
  );
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    for (const a of (res.value ?? []) as Array<Record<string, unknown>>) {
      const id = String(a.id ?? '');
      const title = String(a.title ?? '').trim();
      const url = String(a.url ?? '');
      if (!title || !url || seen.has(id)) continue;
      seen.add(id);
      const hearts = Number(a.positive_reactions_count ?? 0);
      const who = (a.user as { name?: string } | undefined)?.name || String(a.readable_publish_date ?? '');
      out.push({ source: 'blog', title, url, meta: `${hearts} reactions${who ? ` · ${who}` : ''}` });
    }
  }
  return out.sort((a, b) => (parseInt(b.meta) || 0) - (parseInt(a.meta) || 0)).slice(0, 6);
}

/** Interleave HN and blogs so both are visible near the top. */
function weave(hn: FeedItem[], blog: FeedItem[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (let i = 0; i < Math.max(hn.length, blog.length); i++) {
    if (hn[i]) out.push(hn[i]!);
    if (blog[i]) out.push(blog[i]!);
  }
  return out;
}

export async function loadDailyFeed(force = false): Promise<FeedResult> {
  const cache = readCache();
  const today = todayISO();
  if (!force && cache && cache.date === today && cache.items.length) {
    return { items: cache.items, stale: false, error: null };
  }
  const [hnR, blogR] = await Promise.allSettled([fetchHN(), fetchDevto()]);
  const hn = hnR.status === 'fulfilled' ? hnR.value : [];
  const blog = blogR.status === 'fulfilled' ? blogR.value : [];
  const items = weave(hn, blog);
  if (items.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ date: today, items }));
    } catch {
      /* ignore */
    }
    const someFailed = hn.length === 0 || blog.length === 0;
    return { items, stale: false, error: someFailed ? 'Some sources were unavailable.' : null };
  }
  if (cache && cache.items.length) return { items: cache.items, stale: true, error: 'Showing saved items; feeds are unreachable.' };
  return { items: [], stale: false, error: 'Feeds are unreachable right now.' };
}
