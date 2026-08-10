/**
 * Shared, pure source-link helpers — the single source of truth consumed by BOTH
 * knowledge study surfaces (TopicCard via QSrc, and Ascent's Card). Extracting the
 * link/normalize logic here keeps the two renderers from diverging: page-vs-anchor
 * precedence, the fragment-strip, the http(s) scheme guard, and the practice/see
 * union-normalization all live in one place.
 *
 * Trust note: the question bank is author-controlled static content in-repo, but
 * every href still passes an `^https?:` allow-list (defense-in-depth) so a stray
 * `javascript:`/`data:` payload can never reach an `<a href>`.
 */
import type { KnowledgeItem, PracticeLink, SeeLink } from '@/features/knowledge/types';

/** Only http(s) urls are ever linkable — anything else renders as plain text / is dropped. */
const HTTP_SCHEME = /^https?:/i;

/** Drop any existing trailing `#…` fragment before we append our own (§2.2). */
function stripFrag(u: string): string {
  const i = u.indexOf('#');
  return i === -1 ? u : u.slice(0, i);
}

/**
 * Resolve the deep-link href for a question's source, or `null` when there is no
 * safe/linkable url. `base = src.url ?? bookUrl`; then, first rule wins:
 *   1. `page` set AND base ends `.pdf` → `stripFrag(base)#page=N`
 *   2. `anchor` set                    → `stripFrag(base)#anchor`
 *   3. otherwise                       → `base` (unchanged)
 * A non-http(s) or absent base yields `null` (the scheme guard).
 */
export function srcHref(src: KnowledgeItem['src'], bookUrl: string | undefined): string | null {
  const base = src.url ?? bookUrl;
  if (!base || !HTTP_SCHEME.test(base)) return null;
  // Detect `.pdf` on the fragment-stripped base so `…/x.pdf#section` still counts as
  // a PDF (rules 1 & 2 append onto the stripped base; rule 3 leaves base untouched).
  const stripped = stripFrag(base);
  if (typeof src.page === 'number' && src.page > 0 && /\.pdf$/i.test(stripped)) return `${stripped}#page=${src.page}`;
  if (src.anchor) return `${stripped}#${encodeURIComponent(src.anchor)}`;
  return base;
}

/** Keep only entries with a non-empty label and an http(s) url. */
function normalize<T extends { label?: unknown; url?: unknown }>(links: T | T[] | undefined): T[] {
  if (!links) return [];
  const arr = Array.isArray(links) ? links : [links];
  return arr.filter(
    (l): l is T => !!l && typeof l.label === 'string' && l.label.trim() !== '' && typeof l.url === 'string' && HTTP_SCHEME.test(l.url),
  );
}

/** Normalize the `practice` object|array|undefined union to a guaranteed, guarded array. */
export function practiceLinks(it: { practice?: PracticeLink | PracticeLink[] }): PracticeLink[] {
  return normalize(it.practice);
}

/** Normalize the `see` (secondary links) array to a guaranteed, guarded array. */
export function seeLinks(it: { see?: SeeLink[] }): SeeLink[] {
  return normalize(it.see);
}
