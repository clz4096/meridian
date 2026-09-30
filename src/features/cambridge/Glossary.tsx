/**
 * Glossary screen (`glossary` tab, docs/cambridge-screens.md section e): every
 * Cambridge term with its plain meaning and nearest US equivalent, filtered as
 * you type. A popover's "Open glossary" link, or a `#/glossary?t=<id>` deep link
 * (routed by App.tsx), lands here on its term.
 */
import { useEffect, useErrorBoundary, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { PageHead } from '@/ui/components/PageHead';
import { reloadInto } from '@/ui/reopen';
import { glossaryData, glossaryFailed, glossaryTarget, loadGlossary, type GlossTerm } from './Gloss';
import './glossary.css';

/** Case-insensitive search over the term, meaning, US equivalent and match words. */
export function filterTerms(terms: readonly GlossTerm[], query: string): GlossTerm[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...terms];
  return terms.filter((t) =>
    [t.term, t.meaning, t.us ?? '', ...t.match].some((s) => s.toLowerCase().includes(q)),
  );
}

export function GlossaryView() {
  const data = glossaryData.value;
  const failed = glossaryFailed.value;
  useEffect(() => {
    if (!glossaryData.peek()) void loadGlossary();
  }, []);

  const total = data?.terms.length ?? 0;
  return (
    <main class="gl-root" aria-labelledby="gl-h">
      <PageHead id="gl-h" title="Glossary" note={data ? `${total} terms` : undefined} />
      <Guard>
        {data ? (
          <GlossaryList terms={data.terms} />
        ) : failed ? (
          <div class="m-state" data-kind="error" role="alert">
            <p class="m-state-title">The glossary didn't load.</p>
            <p class="m-state-body">Check your connection, then try again.</p>
            {/* A failed import() stays failed for the life of the page, so the retry is a fresh page (D16). */}
            <button type="button" class="m-btn" onClick={() => reloadInto('glossary')}>
              Try again
            </button>
          </div>
        ) : (
          <GlossarySkeleton />
        )}
      </Guard>
    </main>
  );
}

function GlossarySkeleton() {
  return (
    <div class="gl-skel" aria-busy="true" aria-label="Loading the glossary">
      <span class="m-skel gl-skel-search" />
      {[0, 1, 2, 3].map((i) => (
        <span class="gl-skel-term" key={i}>
          <span class="m-skel m-skel-line gl-w-40" />
          <span class="m-skel m-skel-line gl-w-90" />
          <span class="m-skel m-skel-line gl-w-60" />
        </span>
      ))}
    </div>
  );
}

function GlossaryList({ terms }: { terms: readonly GlossTerm[] }) {
  const [query, setQuery] = useState('');
  const shown = filterTerms(terms, query);
  const input = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Land on the term a popover link asked for: scroll to it, focus its <dt>, and
  // wash it briefly so the eye finds it.
  useEffect(() => {
    const id = glossaryTarget.peek();
    glossaryTarget.value = null;
    if (!id) return;
    const dt = document.getElementById(`g-${id}`)?.querySelector<HTMLElement>('dt');
    if (!dt) return;
    dt.scrollIntoView?.({ block: 'center' });
    dt.focus();
    setFlash(id);
  }, []);

  const note = query.trim() ? `${shown.length} of ${terms.length} terms` : `${terms.length} terms`;
  return (
    <>
      <div class="gl-search">
        <label class="m-label" for="gl-q">
          Search the glossary
        </label>
        <input
          id="gl-q"
          ref={input}
          class="gl-input"
          type="search"
          value={query}
          autoComplete="off"
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <p class="m-sr" aria-live="polite">
        {query.trim() ? note : ''}
      </p>
      {shown.length ? (
        <dl class="cam-gloss">
          {shown.map((t) => (
            <div
              class="gl-term"
              id={`g-${t.id}`}
              key={t.id}
              data-flash={flash === t.id ? 'true' : undefined}
              onAnimationEnd={() => setFlash(null)}
            >
              <dt tabIndex={-1}>{t.term}</dt>
              <dd class="gl-meaning">{t.meaning}</dd>
              {t.us && (
                <dd class="gl-us">
                  <span class="m-label">US</span> {t.us}
                </dd>
              )}
            </div>
          ))}
        </dl>
      ) : (
        <div class="m-state" data-kind="empty">
          <p class="m-state-title">No term matches '{query.trim()}'.</p>
          <p class="m-state-body">Try a shorter word, or clear the search.</p>
          <button
            type="button"
            class="m-btn"
            onClick={() => {
              setQuery('');
              input.current?.focus();
            }}
          >
            Clear search
          </button>
        </div>
      )}
    </>
  );
}

function Guard({ children }: { children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary();
  if (error)
    return (
      <div class="m-state" data-kind="error" role="alert">
        <p class="m-state-title">The glossary didn't load.</p>
        <p class="m-state-body">{error instanceof Error ? error.message : String(error)}</p>
        <button class="m-btn" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    );
  return <>{children}</>;
}
