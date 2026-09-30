/**
 * Error log (`cam-errors` tab, docs/cambridge-screens.md section d): every miss
 * from the study loop with its cause, topic and fix, filterable, with a weekly
 * trend by cause. The old proof journal sits at the bottom, read-only
 * (DECISIONS C6: its free text has no cause to convert).
 *
 * Filters are component state, never synced: they are a way of looking, not data.
 */
import { useErrorBoundary, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import method from '@data/cambridge/method.json';
import { PageHead } from '@/ui/components/PageHead';
import { bump, dataRev, notPending } from '@/ui/store';
import { deleteWithUndo } from '@/ui/actions';
import { openCamItem } from './nav';
import { cambridgeReady, deleteError, putError, readCambridge } from './store';
import { isoWeek, nyParts } from './schedule';
import type { CamError, ErrorCause } from './types';
import { Gloss } from './Gloss';
import { indexItem } from './catalogIndex';
import { lastSaved, retryScreen, useAdopting, useReady } from './camUi';
import './errorLog.css';

const DAY = 86_400_000;
export const CAUSES = method.errorCauses as ErrorCause[];
const WEEKS = 8;
const JOURNAL_KEY = 'meridian.proofjournal.v1';

const causeLabel = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1);
/** Auto-created entries (a low mark, a stuck question) arrive without a cause. */
const hasCause = (e: CamError): boolean => (CAUSES as string[]).includes(e.cause);

/**
 * The question as the item names it ("Preparation", "Supervision work 1"), not
 * its stored id. An id the catalog no longer has is shown capitalised.
 */
export function questionLabel(itemId: string, q: string): string {
  return indexItem(itemId)?.questions.find((x) => x.id === q)?.label ?? causeLabel(q);
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Thu 2 Oct", read in Brooklyn like the rest of the Cambridge schedule. */
export function fmtDay(t: number): string {
  const p = nyParts(t);
  return `${WEEKDAY[p.wd]} ${p.d} ${MONTH[p.m - 1]}`;
}
/** "9:14 PM", in Brooklyn. */
function fmtClock(t: number): string {
  const p = nyParts(t);
  return `${p.h % 12 || 12}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
}

/** The last `n` ISO weeks ending with the one `now` is in, oldest first. */
export function lastWeeks(now: number, n: number = WEEKS): string[] {
  const p = nyParts(now);
  // Step back from Brooklyn noon, so a DST change can never push a step across midnight.
  const noon = Date.UTC(p.y, p.m - 1, p.d, 16);
  const out: string[] = [];
  for (let k = n - 1; k >= 0; k--) out.push(isoWeek(noon - k * 7 * DAY));
  return out;
}

export interface Trend {
  weeks: string[];
  causes: ErrorCause[];
  /** counts[w][c]: entries in week w with cause c. */
  counts: number[][];
  totals: number[];
  max: number;
}

/** Entries per week by cause, for the given causes only. */
export function weeklyTrend(entries: readonly CamError[], now: number, causes: readonly ErrorCause[] = CAUSES): Trend {
  const weeks = lastWeeks(now);
  const index = new Map(weeks.map((w, i) => [w, i]));
  const counts = weeks.map(() => causes.map(() => 0));
  for (const e of entries) {
    const w = index.get(isoWeek(e.at));
    const c = e.cause ? causes.indexOf(e.cause) : -1; // entries still needing a cause aren't charted
    if (w !== undefined && c >= 0) counts[w]![c]!++;
  }
  const totals = counts.map((r) => r.reduce((a, b) => a + b, 0));
  return { weeks, causes: [...causes], counts, totals, max: Math.max(1, ...totals) };
}

export interface JournalEntry {
  id: string;
  at: number;
  title: string;
  body: string;
}

/** The old proof journal, read straight from its key. Never written from here. */
export function readJournal(): JournalEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return (v as JournalEntry[])
      .filter((e) => e && typeof e === 'object')
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  } catch {
    return [];
  }
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function ErrorLogView({ ready = cambridgeReady }: { ready?: Promise<void> }) {
  const state = useReady(ready);
  return (
    <main class="el-root" aria-labelledby="el-h">
      {state === 'ready' ? (
        <Guard what="the error log">
          <ErrorLogBody />
        </Guard>
      ) : state === 'failed' ? (
        <>
          <PageHead id="el-h" title="Error log" />
          <div class="m-state" data-kind="error" role="alert">
            <p class="m-state-title">The error log didn't load.</p>
            <p class="m-state-body">Your Cambridge data couldn't be read on this device.</p>
            <button type="button" class="m-btn" onClick={retryScreen}>
              Try again
            </button>
          </div>
        </>
      ) : (
        <>
          <PageHead id="el-h" title="Error log" />
          <ErrorLogSkeleton />
        </>
      )}
      <Guard what="the archived journal">
        <ArchivedJournal />
      </Guard>
    </main>
  );
}

function ErrorLogSkeleton() {
  return (
    <div class="el-skel" aria-busy="true" aria-label="Loading the error log">
      <span class="m-skel el-skel-filters" />
      <span class="m-card el-trend-card el-skel-trend">
        <span class="m-trend-bars m-skel el-skel-plot" />
      </span>
      {[0, 1, 2, 3].map((i) => (
        <span class="el-skel-row" key={i}>
          <span class="m-skel m-skel-line el-w-60" />
          <span class="m-skel m-skel-line el-w-40" />
          <span class="m-skel m-skel-line el-w-80" />
        </span>
      ))}
    </div>
  );
}

function ErrorLogBody() {
  dataRev.value; // subscribe: store writes and sync merges re-render the log
  const now = Date.now();
  const [cause, setCause] = useState<ErrorCause | null>(null);
  const [topic, setTopic] = useState('');

  const s = readCambridge();
  const all = Object.values(s.errors ?? {})
    .filter((e) => !e.deleted)
    .filter(notPending)
    .sort((a, b) => b.at - a.at);
  const topics = [...new Set(all.map((e) => e.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const shown = all.filter((e) => (!cause || e.cause === cause) && (!topic || e.topic === topic));
  const thisWeek = isoWeek(now);
  // The header counts every entry. The trend charts only entries with a cause, so
  // while some still need one the week's figure says "charted", matching the chart,
  // and the trend's heading says the rule.
  const caused = all.filter(hasCause);
  const needs = all.length - caused.length;
  const weekCount = caused.filter((e) => isoWeek(e.at) === thisWeek).length;
  const trend = weeklyTrend(
    all.filter((e) => !topic || e.topic === topic),
    now,
    cause ? [cause] : CAUSES,
  );
  const filtered = cause !== null || topic !== '';

  const savedAt = Math.max(0, ...Object.values(s.errors ?? {}).map((e) => e.updatedAt ?? 0));
  const offlineNote =
    isOffline() && savedAt ? (
      <span class="m-state m-num" data-kind="offline">
        Offline · Saved {fmtClock(savedAt)}
      </span>
    ) : null;

  // With nothing logged there is no section head to carry the note, so it stands
  // above the empty state: the screen still says it is offline and when it saved.
  const lastAt = lastSaved(s);
  const emptyOffline = isOffline() ? (
    <p class="el-offline">
      <span class="m-state m-num" data-kind="offline">
        Offline{lastAt ? ` · Saved ${fmtClock(lastAt)}` : ''}
      </span>
    </p>
  ) : null;

  const clear = (): void => {
    setCause(null);
    setTopic('');
  };

  return (
    <>
      <PageHead
        id="el-h"
        title="Error log"
        note={
          `${all.length} ${all.length === 1 ? 'entry' : 'entries'} · ` +
          (needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} a cause · ${weekCount} charted this week` : `${weekCount} this week`)
        }
      />
      {all.length === 0 ? (
        <>
          {emptyOffline}
          <div class="m-state" data-kind="empty">
            <p class="m-state-title">No errors logged yet.</p>
            <p class="m-state-body">Entries appear when a question is marked under 14 or stuck.</p>
          </div>
        </>
      ) : (
        <>
          <div class="el-filters">
            <div class="el-chips" role="group" aria-label="Filter by cause">
              <span class="m-label el-filter-label" aria-hidden="true">
                Cause
              </span>
              <button type="button" class="m-chip" aria-pressed={cause === null} onClick={() => setCause(null)}>
                All
              </button>
              {CAUSES.map((c) => (
                <button
                  type="button"
                  class="m-chip"
                  key={c}
                  aria-pressed={cause === c}
                  onClick={() => setCause(cause === c ? null : c)}
                >
                  {causeLabel(c)}
                </button>
              ))}
            </div>
            <div class="el-topic">
              <label class="m-label el-filter-label" for="el-topic">
                Topic
              </label>
              <select
                id="el-topic"
                class="el-select"
                value={topic}
                onChange={(e) => setTopic((e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">All topics</option>
                {topics.map((t) => (
                  <option value={t} key={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <section aria-labelledby="el-trend-h">
            <div class="m-section">
              <h2 class="m-title" id="el-trend-h">
                Weekly trend
              </h2>
              {needs > 0 && <span class="m-label">Entries with a cause</span>}
            </div>
            <Guard what="the weekly trend">
              <div class="m-card el-trend-card">
                <TrendChart trend={trend} current={thisWeek} />
              </div>
            </Guard>
          </section>

          <section aria-labelledby="el-list-h">
            <div class="m-section">
              <h2 class="m-title" id="el-list-h">
                Entries
              </h2>
              {offlineNote ?? <span class="m-label m-num">Showing {shown.length}</span>}
            </div>
            <p class="m-sr" aria-live="polite">
              {filtered ? `Showing ${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}` : ''}
            </p>
            {shown.length ? (
              <ul class="el-list">
                {shown.map((e) => (
                  <EntryRow key={e.id} entry={e} title={indexItem(e.itemId)?.title ?? e.itemId} />
                ))}
              </ul>
            ) : (
              <div class="m-state" data-kind="empty">
                <p class="m-state-title">
                  No entries for {[cause ? causeLabel(cause) : '', topic].filter(Boolean).join(' in ')}.
                </p>
                <button type="button" class="m-btn" onClick={clear}>
                  Clear filters
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Trend                                                               */
/* ------------------------------------------------------------------ */

const seriesVar = (c: ErrorCause): string => `var(--series-${CAUSES.indexOf(c) + 1})`;
const weekLabel = (w: string): string => w.slice(w.indexOf('-') + 1);

export function TrendChart({ trend, current }: { trend: Trend; current: string }) {
  const { weeks, causes, counts, totals, max } = trend;
  const cur = weeks.indexOf(current);
  const thisN = cur >= 0 ? totals[cur]! : 0;
  const lastN = cur > 0 ? totals[cur - 1]! : 0;
  const summary = weeks.map((w, i) => `${weekLabel(w)} ${totals[i]}`).join(', ');
  return (
    <figure class="m-trend">
      <figcaption class="m-trend-cap">
        <span class="m-label">Errors per week</span>
        <span class="m-num">
          {thisN} this week · {lastN} last
        </span>
      </figcaption>
      <ol class="m-trend-bars" role="img" aria-label={`Errors per week, last ${weeks.length} weeks: ${summary}`}>
        {weeks.map((w, i) => (
          <li
            class="m-trend-col"
            key={w}
            style={{ '--m-trend-max': max }}
            aria-current={w === current ? 'true' : undefined}
          >
            <span class="m-trend-stack">
              {causes.map((c, j) =>
                counts[i]![j] ? (
                  <span class="m-trend-seg" key={c} style={{ '--v': counts[i]![j], '--c': seriesVar(c) }} />
                ) : null,
              )}
            </span>
            <span class="m-trend-x m-num">{weekLabel(w)}</span>
          </li>
        ))}
      </ol>
      <ul class="m-trend-key" aria-hidden="true">
        {causes.map((c) => (
          <li key={c}>
            <span class="m-trend-swatch" style={{ '--c': seriesVar(c) }} />
            {causeLabel(c)}
          </li>
        ))}
      </ul>
      <div class="m-sr">
        <table>
          <caption>Errors per week by cause</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              {causes.map((c) => (
                <th scope="col" key={c}>
                  {causeLabel(c)}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={w}>
                <th scope="row">{w}</th>
                {causes.map((c, j) => (
                  <td key={c}>{counts[i]![j]}</td>
                ))}
                <td>{totals[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Entry row                                                           */
/* ------------------------------------------------------------------ */

function EntryRow({ entry: e, title }: { entry: CamError; title: string }) {
  const needsCause = !hasCause(e);
  const [editing, setEditing] = useState(false);
  const formOpen = editing || needsCause;
  // Through nav, so Back from the item returns to this log rather than Today.
  const openItem = (): void => openCamItem(e.itemId);
  const remove = (): void =>
    deleteWithUndo(e.id, 'Error log entry deleted', () => {
      deleteError(e.id);
      bump();
    });
  return (
    <li class="m-row cam-err">
      <span class="el-line1 m-num">
        {fmtDay(e.at)} · {title} · {questionLabel(e.itemId, e.q)}
      </span>
      {needsCause ? (
        <span class="el-needs">Needs a cause</span>
      ) : (
        <span class="el-line2">
          {causeLabel(e.cause)}
          {e.topic ? (
            <>
              {' · '}
              <Gloss text={e.topic} />
            </>
          ) : null}
        </span>
      )}
      {e.fix && !formOpen && (
        <span class="el-line3">
          Fix: <Gloss text={e.fix} />
        </span>
      )}
      {formOpen ? (
        <EntryForm entry={e} onDone={() => setEditing(false)} canCancel={editing} />
      ) : (
        <span class="el-actions">
          <button type="button" class="m-btn m-btn-quiet" onClick={openItem}>
            Open {title}
          </button>
          <button type="button" class="m-btn m-btn-quiet" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" class="m-btn m-btn-quiet" onClick={remove}>
            Delete
          </button>
        </span>
      )}
    </li>
  );
}

function EntryForm({ entry: e, onDone, canCancel }: { entry: CamError; onDone: () => void; canCancel: boolean }) {
  // Both fields follow the stored entry until the owner edits them, so a sync pull
  // while the form is open shows, and Save never puts back the older copy.
  const { value: cause, edit: setCause, dirty: causeEdited } = useAdopting<string>(hasCause(e) ? e.cause : '');
  const { value: fix, edit: setFix, dirty: fixEdited } = useAdopting(e.fix ?? '');
  const base = `el-${e.id}`;
  const save = (ev: Event): void => {
    ev.preventDefault();
    if (!cause) return;
    const cur = readCambridge().errors[e.id] ?? e;
    const { updatedAt: _stamp, ...rest } = cur;
    putError({
      ...rest,
      cause: (causeEdited.current || !hasCause(cur) ? cause : cur.cause) as ErrorCause,
      fix: fixEdited.current ? fix.trim() : cur.fix,
    });
    bump();
    onDone();
  };
  return (
    <form class="el-form" onSubmit={save}>
      <label class="m-label" for={`${base}-cause`}>
        Cause
      </label>
      <select
        id={`${base}-cause`}
        class="el-select"
        value={cause}
        onChange={(ev) => setCause((ev.currentTarget as HTMLSelectElement).value)}
      >
        <option value="" disabled>
          Pick a cause
        </option>
        {CAUSES.map((c) => (
          <option value={c} key={c}>
            {causeLabel(c)}
          </option>
        ))}
      </select>
      <label class="m-label" for={`${base}-fix`}>
        Fix
      </label>
      <input
        id={`${base}-fix`}
        class="el-input"
        type="text"
        value={fix}
        onInput={(ev) => setFix((ev.currentTarget as HTMLInputElement).value)}
      />
      <span class="el-actions">
        <button type="submit" class="m-btn m-btn-primary" aria-disabled={!cause || undefined}>
          Save
        </button>
        {canCancel && (
          <button type="button" class="m-btn m-btn-quiet" onClick={onDone}>
            Cancel
          </button>
        )}
      </span>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Archived journal                                                    */
/* ------------------------------------------------------------------ */

function ArchivedJournal() {
  const entries = useMemo(readJournal, []);
  return (
    <section aria-labelledby="el-journal-h">
      <div class="m-section">
        <h2 class="m-title" id="el-journal-h">
          Archived journal
        </h2>
        <span class="m-label">Read-only</span>
      </div>
      {entries.length ? (
        <details class="el-journal">
          <summary>
            The old proof journal, <span class="m-num">{entries.length}</span>{' '}
            {entries.length === 1 ? 'entry' : 'entries'}
          </summary>
          <ul class="el-journal-list">
            {entries.map((j, i) => (
              <li class="el-journal-entry" key={j.id ?? i}>
                <span class="el-line1 m-num">{typeof j.at === 'number' ? fmtDay(j.at) : ''}</span>
                <span class="el-journal-title">{j.title}</span>
                {j.body && <span class="el-journal-body">{j.body}</span>}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <div class="m-state" data-kind="empty">
          <p class="m-state-title">No archived journal on this device.</p>
          <p class="m-state-body">New misses go in the error log above.</p>
        </div>
      )}
    </section>
  );
}

function Guard({ what, children }: { what: string; children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary();
  if (error)
    return (
      <div class="m-state" data-kind="error" role="alert">
        <p class="m-state-title">Couldn't show {what}.</p>
        <p class="m-state-body">{error instanceof Error ? error.message : String(error)}</p>
        <button class="m-btn" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    );
  return <>{children}</>;
}
