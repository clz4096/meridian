/**
 * Recovery from a failed lazy load, and the in-app deep links.
 *
 * Chrome keeps a failed module fetch in the page's module map, so calling
 * import() again for the same chunk fails at once without touching the network
 * (DECISIONS D16). The only reliable retry is a fresh page: reload, then reopen
 * the screen that failed. Section chunks, the Cambridge data chunks (glossary,
 * catalog), KaTeX and the photo store all recover this way.
 *
 * Tiny on purpose: App.tsx imports it, so it is in the main chunk.
 */
import { camItemId, type Tab } from '@/ui/store';

const REOPEN_KEY = 'meridian.reopen';

/** Screens a reload or a link may land on. Today is home, so it is never "reopened". */
const REOPENABLE: ReadonlySet<Tab> = new Set<Tab>([
  'todos', 'scratch', 'workout', 'meal', 'knowledge', 'data', 'tracker', 'roadmap', 'wgu', 'math', 'cs', 'teach',
  'cambridge', 'cam-item', 'cam-errors', 'glossary',
]);

interface Reopen { tab: Tab; itemId?: string | null }

/**
 * Before a reload, open editors commit what the owner typed: a debounced field
 * may still hold keystrokes the store has not seen. They listen for this event.
 */
export const FLUSH_EVENT = 'meridian:flush-edits';

/** Reload the page and land back on `tab` (and the open study item, for `cam-item`). */
export function reloadInto(tab: Tab): void {
  window.dispatchEvent(new Event(FLUSH_EVENT));
  const r: Reopen = { tab, itemId: tab === 'cam-item' ? camItemId.value : undefined };
  try {
    sessionStorage.setItem(REOPEN_KEY, JSON.stringify(r));
  } catch {
    /* private mode: lands on Today */
  }
  window.location.reload();
}

/** The screen a reloadInto asked for, once. Restores the study item id it carried. */
export function takeReopen(): Tab | null {
  try {
    const raw = sessionStorage.getItem(REOPEN_KEY);
    sessionStorage.removeItem(REOPEN_KEY);
    if (!raw) return null;
    // Builds before this one stored the bare tab id.
    const r = (raw.startsWith('{') ? JSON.parse(raw) : { tab: raw }) as Reopen;
    if (!REOPENABLE.has(r.tab)) return null;
    if (r.tab === 'cam-item') {
      if (!r.itemId) return null;
      camItemId.value = r.itemId;
    }
    return r.tab;
  } catch {
    return null;
  }
}

export interface DeepLink {
  tab: Tab;
  /** `#/cam-item?id=found-01`: the study item to open. */
  itemId?: string;
  /** `#/glossary?t=tripos`: the term to land on. The glossary screen reads it from the hash. */
  term?: string;
}

/**
 * Parse a Cambridge deep link: `#/glossary`, `#/glossary?t=<term id>`, or
 * `#/cam-item?id=<item id>`. Anything else is not a deep link (null).
 */
export function parseDeepLink(hash: string): DeepLink | null {
  const m = /^#\/(glossary|cam-item)(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(m[2] ?? '');
  if (m[1] === 'glossary') {
    const term = params.get('t');
    return term ? { tab: 'glossary', term } : { tab: 'glossary' };
  }
  const itemId = params.get('id');
  return itemId ? { tab: 'cam-item', itemId } : null;
}
