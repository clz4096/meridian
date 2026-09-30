/**
 * Today, block 2: the paper of the week and its next Keshav pass.
 *
 * papers.ts lives in the tracker chunk, so it loads with import() after Today's first
 * paint (DECISIONS D13), behind a skeleton the same size as the card.
 */
import { useEffect } from 'preact/hooks';
import { clockMinute } from '@/ui/store';
import { openSection } from '@/ui/actions';
import { lazyMod, page, readSaved, useSaveOnChange, clockTime } from './lazyContent';

type PapersModule = typeof import('@/features/studytracker/papers');

export const papersMod = lazyMod<PapersModule>(() => import('@/features/studytracker/papers'));

/** Keshav's passes: triage, grasp, reproduce. */
export const PASS_TIME = ['~10 min', '~60 min', '~3 h'] as const;
const WEEK_MS = 7 * 86_400_000;
const SAVE_KEY = 'reading';

/** What the card shows; plain data so it can be saved for offline. */
export interface ReadingView {
  title: string;
  authors: string;
  area: string;
  url: string;
  /** Index of the next pass (0, 1, 2), or null when all three are done. */
  pass: number | null;
  passName: string;
  nextWeek: string | null;
}

export function readingView(m: PapersModule, now: Date): ReadingView | null {
  const p = m.paperOfWeek(now);
  if (!p) return null;
  const done = m.paperProgress.value[m.paperKey(p)] ?? [false, false, false];
  const i = done.findIndex((x) => !x);
  const pass = i < 0 ? null : i;
  return {
    title: p.title,
    authors: p.authors,
    area: p.area,
    url: p.url,
    pass,
    passName: pass === null ? '' : m.KESHAV_PASSES[pass]?.name ?? '',
    nextWeek: pass === null ? m.paperOfWeek(new Date(now.getTime() + WEEK_MS))?.title ?? null : null,
  };
}

export function ReadingBlock() {
  const now = new Date(clockMinute.value);
  const m = papersMod.mod.value;
  useEffect(() => {
    void papersMod.load();
  }, []);

  let view: ReadingView | null = null;
  let broke = false;
  if (m) {
    try {
      view = readingView(m, now); // reads paperProgress, so a ticked pass re-renders this
    } catch {
      broke = true;
    }
  }
  useSaveOnChange(SAVE_KEY, view);

  const saved = !m || broke ? readSaved<ReadingView | null>(SAVE_KEY) : null;
  const failed = papersMod.failed.value || broke;
  const note = failed && saved ? `Offline · Saved ${clockTime(saved.at)}` : 'Paper of the week';

  let body;
  if (m && !broke) {
    body = view ? (
      <ReadingCard
        v={view}
        onDone={
          view.pass === null
            ? undefined
            : () => {
                const p = m.paperOfWeek(now);
                if (p && view && view.pass !== null) m.togglePass(p, view.pass as 0 | 1 | 2);
              }
        }
      />
    ) : (
      <div class="m-state td-read-state" data-kind="empty">
        <p class="m-state-title">No paper this week.</p>
        <p class="m-state-body">The reading list is in the Cambridge Method.</p>
        <button type="button" class="m-btn" onClick={() => openSection('tracker')}>
          Open the Cambridge Method
        </button>
      </div>
    );
  } else if (failed && saved?.value) {
    body = <ReadingCard v={saved.value} />;
  } else if (failed) {
    body = (
      <div class="m-state td-read-state" data-kind="error" role="alert">
        <p class="m-state-title">Today's reading didn't load.</p>
        <p class="m-state-body">Check your connection, then try again.</p>
        <button type="button" class="m-btn" onClick={() => page.reload()}>
          Try again
        </button>
      </div>
    );
  } else {
    body = <ReadingSkeleton />;
  }

  return (
    <section class="td-block" aria-labelledby="td-reading-h">
      <div class="m-section">
        <h2 class="td-h2" id="td-reading-h">
          Today's reading
        </h2>
        <span class={failed && saved ? 'm-state m-num' : 'm-label'} data-kind={failed && saved ? 'offline' : undefined}>
          {note}
        </span>
      </div>
      {body}
    </section>
  );
}

function ReadingCard({ v, onDone }: { v: ReadingView; onDone?: () => void }) {
  const done = v.pass === null;
  return (
    <article class="m-card td-read">
      <p class="td-read-top">
        <span class="m-label">{done ? 'Done this week' : `Pass ${(v.pass ?? 0) + 1} of 3 · ${v.passName}`}</span>
        {!done && <span class="m-num td-read-time">{PASS_TIME[v.pass ?? 0]}</span>}
      </p>
      <h3 class="td-read-title">{v.title}</h3>
      <p class="td-read-meta">{done && v.nextWeek ? `Next week: ${v.nextWeek}` : `${v.authors} · ${v.area}`}</p>
      <div class="td-read-actions">
        <a class="m-btn m-btn-quiet" href={v.url} target="_blank" rel="noopener noreferrer">
          Open paper
        </a>
        {onDone && (
          <button type="button" class="m-btn" onClick={onDone}>
            Mark {v.passName} done
          </button>
        )}
      </div>
    </article>
  );
}

function ReadingSkeleton() {
  return (
    <div class="m-card td-read" aria-busy="true" aria-label="Loading today's reading">
      <span class="m-skel m-skel-line td-w-40" />
      <span class="m-skel m-skel-line td-w-80" />
      <span class="m-skel m-skel-line td-w-60" />
      <span class="m-skel td-read-skel-btn" />
    </div>
  );
}
