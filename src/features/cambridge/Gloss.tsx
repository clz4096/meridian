/**
 * <Gloss>: glossary terms inside running Cambridge text (docs/cambridge-screens.md,
 * section e). A match word is underlined and opens a definition popover on tap or
 * Enter, so British terms ("supervision", "Tripos") read plainly to a US reader.
 *
 * The glossary JSON is loaded with import() on first use, so it stays out of the
 * main chunk. Until it arrives the text renders plain; the underline never changes
 * the line box (.m-gloss), so the swap causes no layout shift.
 */
import { signal } from '@preact/signals';
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef } from 'preact/hooks';
import { currentTab, glossaryTarget, type Tab } from '@/ui/store';
import { openCam } from './nav';

export interface GlossTerm {
  id: string;
  term: string;
  meaning: string;
  match: string[];
  us?: string;
}

export interface GlossaryData {
  /** 'first': only the first match of a term per text block is underlined. */
  underline?: 'first' | 'all';
  /** Match strings that only match with this exact case (acronyms). */
  caseSensitive?: string[];
  terms: GlossTerm[];
}

/* ------------------------------------------------------------------ */
/* Lazy data                                                           */
/* ------------------------------------------------------------------ */

export const glossaryData = signal<GlossaryData | null>(null);
export const glossaryFailed = signal(false);
let inflight: Promise<void> | null = null;

/** Load the glossary once per page. A failed load can be retried. */
export function loadGlossary(): Promise<void> {
  inflight ??= import('@data/cambridge/glossary.json').then(
    (m) => {
      glossaryData.value = (m.default ?? m) as GlossaryData;
      glossaryFailed.value = false;
    },
    () => {
      inflight = null;
      glossaryFailed.value = true;
    },
  );
  return inflight;
}

/** The term the glossary screen lands on (lives in the main chunk's store, so deep links can set it). */
export { glossaryTarget } from '@/ui/store';

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

interface Candidate {
  text: string;
  lower: string;
  exact: boolean;
  term: GlossTerm;
}

interface Matcher {
  re: RegExp;
  /** Candidates by lowercased match string, longest first overall. */
  byLower: Map<string, Candidate[]>;
  firstOnly: boolean;
}

export type Segment = string | { text: string; term: GlossTerm };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);

const matchers = new WeakMap<GlossaryData, Matcher>();

function compile(data: GlossaryData): Matcher {
  const cached = matchers.get(data);
  if (cached) return cached;
  const acronyms = new Set(data.caseSensitive ?? []);
  const cands: Candidate[] = [];
  for (const term of data.terms) {
    for (const text of term.match) {
      if (!text) continue;
      // "STEP 2" contains the acronym "STEP", so it is exact-case too; otherwise
      // the stepper's "Step 2 of 5" would be glossed as the exam.
      const exact = acronyms.has(text) || text.split(/\s+/).some((w) => acronyms.has(w));
      cands.push({ text, lower: text.toLowerCase(), exact, term });
    }
  }
  // Longest first, so "Part III" wins over "Part II" and "supervisions" over "supervision".
  cands.sort((a, b) => b.text.length - a.text.length);
  const byLower = new Map<string, Candidate[]>();
  for (const c of cands) {
    const list = byLower.get(c.lower) ?? [];
    list.push(c);
    byLower.set(c.lower, list);
  }
  const re = new RegExp(cands.map((c) => escapeRe(c.text)).join('|') || '(?!)', 'giu');
  const m = { re, byLower, firstOnly: data.underline !== 'all' };
  matchers.set(data, m);
  return m;
}

/**
 * Split one text block into plain runs and glossary hits. Whole words only;
 * exact-case strings (acronyms) must match their case; with underline 'first',
 * each term is marked once per block. Pure, so the rules are unit-testable.
 */
export function segment(text: string, data: GlossaryData): Segment[] {
  const { re, byLower, firstOnly } = compile(data);
  const out: Segment[] = [];
  const seen = new Set<string>();
  let last = 0;
  re.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(text))) {
    const at = hit.index;
    // The regex found the longest string that matches ignoring case here. It may be
    // an acronym in the wrong case or sit inside a word, so check every candidate
    // at this position, longest first, against the real rules.
    let found: Candidate | null = null;
    for (const len of lengthsFrom(byLower, text.length - at)) {
      const slice = text.slice(at, at + len);
      const list = byLower.get(slice.toLowerCase());
      if (!list || isWordChar(text[at - 1]) || isWordChar(text[at + len])) continue;
      found = list.find((c) => !c.exact || c.text === slice) ?? null;
      if (found) break;
    }
    if (!found) {
      re.lastIndex = at + 1;
      continue;
    }
    const end = at + found.text.length;
    re.lastIndex = end;
    if (firstOnly && seen.has(found.term.id)) continue;
    seen.add(found.term.id);
    if (at > last) out.push(text.slice(last, at));
    out.push({ text: text.slice(at, end), term: found.term });
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const lengthCache = new WeakMap<Map<string, Candidate[]>, number[]>();
/** The distinct candidate lengths, longest first, that fit in `room` characters. */
function lengthsFrom(byLower: Map<string, Candidate[]>, room: number): number[] {
  let all = lengthCache.get(byLower);
  if (!all) {
    all = [...new Set([...byLower.keys()].map((k) => k.length))].sort((a, b) => b - a);
    lengthCache.set(byLower, all);
  }
  return all.filter((n) => n <= room);
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/** The one open popover on the page (its anchor's id), so opening one closes the rest. */
const openGloss = signal<string | null>(null);

/**
 * Text with its glossary terms marked. `plain` renders the text only, for text
 * inside a button (a card), where a nested button would be invalid.
 */
export function Gloss({ text, plain }: { text: string; plain?: boolean }) {
  const data = glossaryData.value;
  useEffect(() => {
    if (!plain && !glossaryData.peek()) void loadGlossary();
  }, [plain]);
  // Keyed, so the glossed text replaces the plain text rather than reusing its
  // node: a reused text node that now starts after a term button counts as a
  // layout shift in Chrome, even though nothing visibly moves.
  if (plain || !data) return <Fragment key="plain">{text}</Fragment>;
  return (
    <Fragment key="gloss">
      {segment(text, data).map((s, i) =>
        typeof s === 'string' ? s : <GlossTermButton key={i} term={s.term} label={s.text} />,
      )}
    </Fragment>
  );
}

/** Nodes for one text block: `gloss('Your first supervision')`. */
export function gloss(text: string, opts: { plain?: boolean } = {}): ComponentChildren {
  return <Gloss text={text} plain={opts.plain} />;
}

function GlossTermButton({ term, label }: { term: GlossTerm; label: string }) {
  const uid = useId();
  const popId = `gloss-pop-${uid}`;
  const open = openGloss.value === uid;
  const btn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  const close = (): void => {
    if (openGloss.peek() === uid) openGloss.value = null;
  };

  // Keep the bubble inside the page gutters with its arrow still on the term, and
  // flip it above the term when there is no room below (GlossDemo in Styleguide.tsx).
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    const host = el.closest('.appwrap') ?? document.body;
    const gutter = parseFloat(getComputedStyle(host).paddingLeft) || 16;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.left < gutter) dx = gutter - r.left;
    else if (r.right > vw - gutter) dx = vw - gutter - r.right;
    el.style.setProperty('--m-pop-x', `calc(-50% + ${dx}px)`);
    el.style.setProperty('--m-pop-arrow', `calc(50% - ${dx}px)`);
    if (r.bottom > window.innerHeight && r.top - r.height > 0) el.dataset.side = 'top';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      close();
      btn.current?.focus();
    };
    const onDown = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const tabAtOpen: Tab = currentTab.peek();
    // A route change unmounts most screens, but not always (a shared header), so close explicitly.
    const unsub = currentTab.subscribe((t) => {
      if (t !== tabAtOpen) close();
    });
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      unsub();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // A term that unmounts while open clears the shared id, so the next term opens cleanly.
  useEffect(() => () => close(), []);

  const onFocusOut = (e: FocusEvent): void => {
    // Only a focus move to somewhere else closes it. A null target is a click on the
    // bubble's own text, which the pointerdown check already handles.
    const to = e.relatedTarget as Node | null;
    if (to && !wrap.current?.contains(to)) close();
  };

  const toGlossary = (e: MouseEvent): void => {
    e.preventDefault();
    glossaryTarget.value = term.id;
    close();
    openCam('glossary');
  };

  return (
    <span class="m-popover-anchor" ref={wrap} onFocusOut={onFocusOut}>
      <button
        type="button"
        class="m-gloss"
        ref={btn}
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => (openGloss.value = open ? null : uid)}
      >
        {label}
      </button>
      {open && (
        <span class="m-popover" ref={pop} id={popId} role="dialog" aria-label={term.term} data-side="bottom">
          <span class="m-popover-term">{term.term}</span>
          <span class="m-popover-body">{term.meaning}</span>
          {term.us && (
            <span class="m-popover-us">
              <span class="m-label">US</span>
              {term.us}
            </span>
          )}
          <a class="m-popover-link" href={`#/glossary?t=${encodeURIComponent(term.id)}`} onClick={toGlossary}>
            Open glossary
          </a>
        </span>
      )}
    </span>
  );
}
