/**
 * A study item (`cam-item`): the loop stepper, the questions with their cold
 * timers, the links (hints wait for the cold hour), the write-up with photos,
 * and the supervision with its redo. docs/cambridge-screens.md section (c).
 *
 * Timers are clock-derived (schedule.elapsedSec over a persisted runningSince),
 * so a reload, a closed tab or going offline never loses time.
 *
 * Lazy-loaded by the router. KaTeX and the photo store are further lazy chunks,
 * loaded on first Preview and first photo.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import method from '@data/cambridge/method.json';
import { camItemId, dataRev, notPending } from '@/ui/store';
import { deleteWithUndo, openSection } from '@/ui/actions';
import { PageHead } from '@/ui/components/PageHead';
import { Gloss } from '@/features/cambridge/Gloss';
import { cambridgeReady, putError, readCambridge, updateItem } from '@/features/cambridge/store';
import {
  elapsedSec, fmtDue, redoDue, REDO_WINDOW_MS, startColdTimer, stopColdTimer, supervisionsThisWeek,
} from '@/features/cambridge/schedule';
import {
  awardColdAttempt, awardRedo, awardStepSelfMark, awardSupervision, awardWriteup, camEventId, COLD_MIN_SEC, STEP_PASS_MARK,
} from '@/features/cambridge/xp';
import { catItem, isStepQuestion, loadItem, supervisorPrompt, type CatItem, type CatLink } from '@/features/cambridge/catalog';
import { indexItem } from '@/features/cambridge/catalogIndex';
import type { CamItem, CamQuestion, CambridgeState, ItemStage, QStatus } from '@/features/cambridge/types';
import { Guard, Note, clock, dayMonth, hm, retryScreen, useAdopting, useAutosave, useReady, useTick, write } from '@/features/cambridge/camUi';
import { STAGE_WORD } from '@/features/cambridge/CambridgePath';
import './cambridge.css';
import { Emblem } from '@/ui/components/Emblem';

interface MethodStep { id: string; name: string; do: string }
const STEPS = (method as { steps: MethodStep[] }).steps;

/* ------------------------------------------------------------------ */
/* Store helpers                                                        */
/* ------------------------------------------------------------------ */

const blankQ = (q: string): CamQuestion => ({ q, coldSec: 0 });

function editQuestion(itemId: string, q: string, edit: (x: CamQuestion) => CamQuestion, stage?: (s: ItemStage) => ItemStage): void {
  updateItem(itemId, (it) => ({
    ...it,
    stage: stage ? stage(it.stage) : it.stage,
    questions: { ...it.questions, [q]: edit(it.questions[q] ?? blankQ(q)) },
  }));
}

const startIfNew = (s: ItemStage): ItemStage => (s === 'not-started' ? 'attempting' : s);

/**
 * An error-log entry for a question marked under 14 or stuck. The id is fixed
 * per question, so a second trigger (stuck, then a low mark) never duplicates
 * it, and an entry the owner has edited or deleted is left alone.
 *
 * The cause is left empty for the owner to pick in the log ("Needs a cause"),
 * as the screen spec asks. CamError types `cause` as one of the four causes, so
 * the empty value is cast; see the handback note.
 */
export function autoError(item: CatItem, q: string, now: number = Date.now()): void {
  const id = `auto:${item.id}:${q}`;
  if (readCambridge().errors[id]) return;
  putError({ id, itemId: item.id, q, cause: '', topic: item.topics[0] ?? item.title, fix: '', at: now }, now);
}

/** Stop every running timer except (itemId, q), paying any cold hour it reached. Returns what it paused. */
function pauseOthers(itemId: string, q: string, now: number): string[] {
  const paused: string[] = [];
  for (const [iid, it] of Object.entries(readCambridge().items)) {
    if (it.deleted) continue;
    for (const [qid, question] of Object.entries(it.questions)) {
      if (question.runningSince === undefined || (iid === itemId && qid === q)) continue;
      stopColdTimer(iid, qid, now);
      awardColdAttempt(iid, qid, now);
      // Any track's item can be running; the index has every title and label.
      const cat = indexItem(iid);
      const label = cat?.questions.find((x) => x.id === qid)?.label ?? qid;
      paused.push(iid === itemId ? label : `${cat?.title ?? iid} ${label}`);
    }
  }
  return paused;
}

/* ------------------------------------------------------------------ */
/* Stepper                                                              */
/* ------------------------------------------------------------------ */

/** Index of the current loop step (0..4), or 5 when all five are done. */
export function loopIndex(it: CamItem | undefined, questionIds: string[]): number {
  if (!it) return 0;
  switch (it.stage) {
    case 'not-started':
      return 0;
    case 'attempting':
      return questionIds.every((q) => it.questions[q]?.status !== undefined) ? 2 : 1;
    case 'written-up':
      return 3;
    case 'supervised':
      return (it.redoQs?.length ?? 0) > 0 && it.redoneAt === undefined ? 4 : 5;
    case 'redo-done':
      return 5;
  }
}

function Stepper({ index }: { index: number }) {
  const step = STEPS[index];
  return (
    <div class="ci-stepper">
      <ol class="m-stepper" aria-label="Study loop">
        {STEPS.map((s, i) => {
          const st = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li key={s.id} class="m-step" data-state={st} aria-current={st === 'current' ? 'step' : undefined}>
              <span class="m-step-mark" aria-hidden="true">{i + 1}</span>
              <span class="m-step-name">{s.name}</span>
              {st === 'done' && <span class="m-sr">, done</span>}
            </li>
          );
        })}
      </ol>
      <p class="ci-step-line">
        {step ? (
          <>
            <span class="m-num">Step {index + 1} of {STEPS.length}</span> · <Gloss text={step.do} />
          </>
        ) : (
          'All five steps done.'
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Questions and the cold timer                                         */
/* ------------------------------------------------------------------ */

const Q_WORD: Readonly<Record<QStatus, string>> = { solved: 'Solved', partial: 'Partial', stuck: 'Stuck' };

function QStatusMark({ q }: { q: CamQuestion | undefined }) {
  const status = q?.status ?? (q && (q.coldSec > 0 || q.runningSince !== undefined) ? 'attempting' : 'not-started');
  const word = q?.status ? Q_WORD[q.status] : STAGE_WORD[status as ItemStage];
  return (
    <span class="m-status" data-status={status}>
      <span class="m-status-mark" aria-hidden="true" />
      {word}
    </span>
  );
}

function MarkField({ cat, q, question }: { cat: CatItem; q: string; question: CamQuestion | undefined }) {
  const { value: v, edit: setV, dirty } = useAdopting(question?.mark === undefined ? '' : String(question.mark));
  const id = `ci-mark-${q}`;
  const n = Number(v);
  const bad = v.trim() !== '' && !(Number.isInteger(n) && n >= 0 && n <= 20);
  const commit = (): void => {
    if (bad) return;
    dirty.current = false;
    const mark = v.trim() === '' ? undefined : n;
    if (mark === question?.mark) return;
    const now = Date.now();
    write(() => {
      editQuestion(cat.id, q, (x) => ({ ...x, mark }));
      if (mark === undefined) return;
      if (isStepQuestion(cat, q)) awardStepSelfMark(cat.id, q, now);
      if (mark < STEP_PASS_MARK) autoError(cat, q, now);
    });
  };
  return (
    <div class="cam-field">
      <label for={id}>Mark</label>
      <span class="ci-mark">
        <input id={id} class="cam-input ci-mark-input m-num" type="text" inputMode="numeric" value={v} aria-invalid={bad || undefined}
          aria-describedby={`${id}-rule`} onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)} onChange={commit} />
        <span class="m-num">/ 20</span>
      </span>
      <p id={`${id}-rule`} class="cam-rule" data-invalid={bad ? 'true' : undefined}>A whole number from 0 to 20</p>
    </div>
  );
}

function StalledField({ itemId, q, saved }: { itemId: string; q: string; saved: string }) {
  const [v, setV] = useAutosave(saved, (next) => write(() => editQuestion(itemId, q, (x) => ({ ...x, stalledAt: next.trim() || undefined }))));
  const id = `ci-stall-${q}`;
  return (
    <div class="cam-field">
      <label for={id}>Where you stalled</label>
      <input id={id} class="cam-input" type="text" value={v} onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)} />
    </div>
  );
}

function QuestionPanel({ cat, item, q, now, announce }: {
  cat: CatItem; item: CamItem | undefined; q: string; now: number; announce: (m: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstConfirm = useRef<HTMLButtonElement>(null);
  const question = item?.questions[q];
  const label = cat.questions.find((x) => x.id === q)?.label ?? q;
  const sec = question ? elapsedSec(question, now) : 0;
  const running = question?.runningSince !== undefined;
  const reached = sec >= COLD_MIN_SEC;
  const hintsOpen = reached || !!item?.hintsUnlockedEarly;
  const state = reached ? 'reached' : running ? 'running' : sec > 0 ? 'paused' : 'idle';

  // Crossing 60 minutes while this panel is open: pay the cold attempt once and say so.
  const wasReached = useRef(reached);
  useEffect(() => {
    if (reached && !wasReached.current) {
      if (readCambridge().awarded[camEventId('coldAttempt', cat.id, q)] === undefined) write(() => awardColdAttempt(cat.id, q));
      announce('60 minutes reached. Hints are open.');
    }
    wasReached.current = reached;
  }, [reached, q]);

  useEffect(() => {
    if (confirm) firstConfirm.current?.focus();
  }, [confirm]);

  const toggle = (): void => {
    const t = Date.now();
    if (running) {
      const stopped = write(() => {
        const out = stopColdTimer(cat.id, q, t);
        awardColdAttempt(cat.id, q, t);
        return out;
      });
      announce(`Timer paused at ${Math.floor(stopped.coldSec / 60)} minutes`);
    } else {
      const paused = write(() => {
        const p = pauseOthers(cat.id, q, t);
        startColdTimer(cat.id, q, t);
        return p;
      });
      announce(paused.length ? `${paused.join(', ')} paused. Timer started on ${label}.` : 'Timer started');
    }
  };
  const setStatus = (s: QStatus): void => {
    write(() => {
      editQuestion(cat.id, q, (x) => ({ ...x, status: s }), startIfNew);
      if (s === 'stuck') autoError(cat, q);
    });
  };
  const openHints = (): void => {
    write(() => updateItem(cat.id, (it) => ({ ...it, hintsUnlockedEarly: true })));
    setConfirm(false);
    announce('Hints are open.');
  };
  const cancel = (): void => {
    setConfirm(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  };

  const stateWord = reached
    ? `60 minutes reached · hints open${running ? ' · running' : ''}`
    : running ? 'Running' : sec > 0 ? 'Paused' : 'Not started';
  const pct = Math.min(100, Math.round((sec / COLD_MIN_SEC) * 100));
  const stall = question?.status === 'partial' || question?.status === 'stuck';

  return (
    <div class="m-card ci-panel">
      <div class="m-timer" data-state={state}>
        <span class="m-label">Cold attempt · {label}</span>
        <span class="m-timer-value" role="timer" aria-label={`Cold time, ${label}`}>{clock(sec)}</span>
        <span class="m-timer-goal m-num">of 60:00</span>
        <span class="m-timer-state">
          <span class="m-timer-dot" aria-hidden="true" />
          {stateWord}
        </span>
        <div class="m-progress" role="progressbar" aria-label="Cold time toward 60 minutes" aria-valuemin={0} aria-valuemax={60}
          aria-valuenow={Math.min(60, Math.floor(sec / 60))} aria-valuetext={`${Math.floor(sec / 60)} of 60 minutes`}>
          <div class="m-progress-fill" style={{ '--m-progress': `${pct}%` }} />
        </div>
        {confirm ? (
          <div class="ci-confirm" role="group" aria-label="Open the hints early?"
            onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}>
            <p class="ci-confirm-text">Open the hints now? The 60-minute cold attempt is the point of this step.</p>
            <div class="m-timer-actions">
              <button ref={firstConfirm} class="m-btn" type="button" onClick={openHints}>Open hints</button>
              <button class="m-btn m-btn-primary" type="button" onClick={cancel}>Keep going</button>
            </div>
          </div>
        ) : (
          <div class="m-timer-actions">
            <button class="m-btn m-btn-primary" type="button" onClick={toggle}>{running ? 'Pause' : 'Start'}</button>
            {!hintsOpen && (
              <button ref={trigger} class="m-btn m-btn-quiet" type="button" onClick={() => setConfirm(true)}>Hints: unlock early</button>
            )}
          </div>
        )}
      </div>
      <div class="ci-status" role="group" aria-label={`Status, ${label}`}>
        <span class="m-label" aria-hidden="true">Status</span>
        {(['solved', 'partial', 'stuck'] as QStatus[]).map((s) => (
          <button key={s} class="m-chip" type="button" aria-pressed={question?.status === s} onClick={() => setStatus(s)}>
            {Q_WORD[s]}
          </button>
        ))}
      </div>
      {stall && <StalledField key={`${cat.id}:${q}`} itemId={cat.id} q={q} saved={question?.stalledAt ?? ''} />}
      {item?.supervisedAt !== undefined && <MarkField key={`${cat.id}:${q}:m`} cat={cat} q={q} question={question} />}
    </div>
  );
}

function Questions({ cat, item, state, sel, setSel, now, announce }: {
  cat: CatItem; item: CamItem | undefined; state: CambridgeState; sel: string; setSel: (q: string) => void; now: number; announce: (m: string) => void;
}) {
  const solved = cat.questions.filter((q) => item?.questions[q.id]?.status === 'solved').length;
  return (
    <section aria-labelledby="ci-q-h">
      <div class="m-section">
        <h2 class="m-title" id="ci-q-h">Questions</h2>
        <Note state={state}>{solved} solved</Note>
      </div>
      <ul class="ci-qs">
        {cat.questions.map((q) => {
          const question = item?.questions[q.id];
          return (
            <li key={q.id}>
              <button class="m-row ci-q" type="button" aria-current={q.id === sel ? 'true' : undefined} onClick={() => setSel(q.id)}>
                <span class="ci-q-main">
                  <span class="ci-q-label">{q.label}</span>
                  {q.step && <span class="ci-q-sub m-num">{q.step}</span>}
                  {question?.stalledAt && <span class="ci-q-sub ci-q-stall">stalled: “{question.stalledAt}”</span>}
                </span>
                <QStatusMark q={question} />
                <span class="ci-q-time m-num">{clock(question ? elapsedSec(question, now) : 0)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <QuestionPanel key={sel} cat={cat} item={item} q={sel} now={now} announce={announce} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Links                                                                */
/* ------------------------------------------------------------------ */

function Links({ cat, item, sel, now }: { cat: CatItem; item: CamItem | undefined; sel: string; now: number }) {
  const question = item?.questions[sel];
  const left = COLD_MIN_SEC - (question ? elapsedSec(question, now) : 0);
  const open = left <= 0 || !!item?.hintsUnlockedEarly;
  // Minute resolution: the row is not a live clock, so it does not show seconds.
  const leftText = `${Math.ceil(Math.max(0, left) / 60)} min`;
  const rows = cat.links;
  const hints = rows.filter((l) => l.hint);
  const plain = rows.filter((l) => !l.hint);
  const row = (l: CatLink) => (
    <li key={l.url + l.label}>
      <a class="m-row ci-link" href={l.url} target="_blank" rel="noopener noreferrer">
        <span class="ci-link-main">
          <span>
            {l.label}
            {l.suggested && <span class="ci-suggested"> (suggested)</span>}
          </span>
          {l.note && <span class="ci-q-sub">{l.note}</span>}
        </span>
        <span class="ci-arrow" aria-hidden="true">→</span>
      </a>
    </li>
  );
  return (
    <section aria-labelledby="ci-links-h">
      <div class="m-section">
        <h2 class="m-title" id="ci-links-h">Links</h2>
        {hints.length > 0 && <span class="m-label m-num">{open ? 'Hints open' : 'Hints locked'}</span>}
      </div>
      {rows.length === 0 ? (
        <div class="m-state" data-kind="empty">
          <p class="m-state-title">No links for this item.</p>
          <p class="m-state-body">Add them to the item in the curriculum JSON.</p>
        </div>
      ) : (
        <ul class="ci-links">
          {plain.map(row)}
          {hints.length > 0 && !open && (
            <li>
              <div class="m-row ci-link ci-locked">
                <span>Hints</span>
                <span class="m-num ci-locked-left">Locked for {leftText} more</span>
              </div>
            </li>
          )}
          {open && hints.map(row)}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Write-up and photos                                                  */
/* ------------------------------------------------------------------ */

type PreviewMod = { WriteupPreview: ComponentType<{ text: string }> };
let previewMod: Promise<PreviewMod> | null = null;
const loadPreview = (): Promise<PreviewMod> => {
  previewMod ??= import('@/features/cambridge/WriteupPreview');
  previewMod.catch(() => { previewMod = null; });
  return previewMod;
};

type PhotosMod = typeof import('@/features/cambridge/photos');
let photosMod: Promise<PhotosMod> | null = null;
/** Set when the photo module itself failed to load: only a fresh page can fetch it again. */
let photosModFailed = false;
const loadPhotos = (): Promise<PhotosMod> => {
  photosMod ??= import('@/features/cambridge/photos');
  photosMod.catch(() => { photosModFailed = true; });
  return photosMod;
};

function Preview({ text }: { text: string }) {
  const [mod, setMod] = useState<PreviewMod | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadPreview().then((m) => live && setMod(m), () => live && setFailed(true));
    return () => { live = false; };
  }, []);
  if (!text.trim())
    return <div class="m-editor-preview" data-empty="true" tabIndex={0} aria-label="Write-up preview">Nothing written yet.</div>;
  if (failed)
    return (
      <div class="m-editor-preview">
        <div class="m-state" data-kind="error" role="alert">
          <p class="m-state-title">The preview didn't load.</p>
          <p class="m-state-body">Your text is saved. Check your connection.</p>
          {/* A failed chunk stays failed for this page, so the retry is a fresh page on this item; the write-up is saved first. */}
          <button class="m-btn" type="button" onClick={retryScreen}>Try again</button>
        </div>
      </div>
    );
  if (!mod)
    return (
      <div class="m-editor-preview" aria-busy="true" aria-label="Loading the preview">
        <span class="m-skel m-skel-line" />
        <span class="m-skel m-skel-line" />
        <span class="m-skel m-skel-line ci-skel-short" />
      </div>
    );
  const P = mod.WriteupPreview;
  return (
    <div class="m-editor-preview" tabIndex={0} aria-label="Write-up preview">
      <P text={text} />
    </div>
  );
}

function Thumb({ id, n, onRemove }: { id: string; n: number; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    loadPhotos().then((m) => m.getPhoto(id)).then((blob) => {
      if (!live || !blob) return;
      u = URL.createObjectURL(blob);
      setUrl(u);
    }, () => {});
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <li class="m-thumb" data-state={url ? undefined : 'loading'}>
      {url && <img src={url} alt={`Page ${n} of the write-up`} />}
      <button type="button" class="m-thumb-remove" aria-label={`Remove page ${n}`} onClick={onRemove}>
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

function Photos({ itemId, ids }: { itemId: string; ids: string[] }) {
  const [adding, setAdding] = useState(0);
  const [err, setErr] = useState<'' | 'save' | 'module'>('');
  const shown = ids.filter((id) => notPending({ id }));
  const add = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    setErr('');
    setAdding((n) => n + files.length);
    loadPhotos()
      .then((m) => m.savePhotos(files))
      .then((newIds) => write(() => updateItem(itemId, (it) => ({ ...it, photos: [...(it.photos ?? []), ...newIds] }))))
      .catch(() => setErr(photosModFailed ? 'module' : 'save'))
      .finally(() => setAdding((n) => Math.max(0, n - files.length)));
  };
  const remove = (id: string): void =>
    deleteWithUndo(id, 'Photo removed', () => {
      write(() => updateItem(itemId, (it) => ({ ...it, photos: (it.photos ?? []).filter((p) => p !== id) })));
      void loadPhotos().then((m) => m.deletePhoto(id)).catch(() => {});
    });
  return (
    <div class="ci-photos">
      <p class="m-label" id="ci-photos-l">Photos</p>
      <ul class="m-thumbs" aria-labelledby="ci-photos-l">
        {shown.map((id, i) => (
          <Thumb key={id} id={id} n={i + 1} onRemove={() => remove(id)} />
        ))}
        {Array.from({ length: adding }, (_, i) => (
          <li key={`adding-${i}`} class="m-thumb" data-state="loading" aria-label="Saving a photo" />
        ))}
        <li>
          <label class="m-thumb-add">
            Add photo
            <input type="file" accept="image/*" capture="environment" class="m-sr" onChange={add} />
          </label>
        </li>
      </ul>
      {err === 'save' && (
        <p class="cam-rule" data-invalid="true" role="alert">Couldn't save the photo. Try again.</p>
      )}
      {err === 'module' && (
        <div class="m-state" data-kind="error" role="alert">
          <p class="m-state-title">Photos didn't load.</p>
          <p class="m-state-body">Check your connection. Your write-up is saved.</p>
          <button class="m-btn" type="button" onClick={retryScreen}>Try again</button>
        </div>
      )}
    </div>
  );
}

function Writeup({ cat, item, state }: { cat: CatItem; item: CamItem | undefined; state: CambridgeState }) {
  const saved = item?.writeup ?? '';
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [text, setText] = useAutosave(saved, (v) => {
    write(() => updateItem(cat.id, (it) => ({ ...it, writeup: v, stage: startIfNew(it.stage) })));
    setSavedAt(Date.now());
  });
  const hasWork = text.trim().length > 0 || (item?.photos?.length ?? 0) > 0;
  const submitted = (item?.stage === 'written-up' || item?.stage === 'supervised' || item?.stage === 'redo-done');
  const submit = (): void => {
    if (!hasWork || submitted) return;
    const now = Date.now();
    write(() => {
      updateItem(cat.id, (it) => ({ ...it, writeup: text, stage: 'written-up' }), now);
      awardWriteup(cat.id, now);
    });
    setSavedAt(now);
  };
  const noteAt = savedAt ?? item?.updatedAt;
  return (
    <section aria-labelledby="ci-w-h">
      <div class="m-section">
        <h2 class="m-title" id="ci-w-h">Write-up</h2>
        <Note state={state}>{noteAt && saved ? `Saved ${hm(noteAt)}` : null}</Note>
      </div>
      <div class="m-editor">
        <div class="m-editor-bar">
          <span class="m-label" id="ci-ed-l">Your write-up</span>
          <div class="m-seg" role="group" aria-labelledby="ci-ed-l">
            <button type="button" aria-pressed={mode === 'write'} onClick={() => setMode('write')}>Write</button>
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</button>
          </div>
        </div>
        {mode === 'write' ? (
          <textarea class="m-editor-input" aria-labelledby="ci-ed-l" value={text} placeholder="Markdown, with $x^2$ for math"
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
        ) : (
          <Preview text={text} />
        )}
        <p class="m-editor-foot m-num">Markdown and $LaTeX$</p>
      </div>
      <Guard what="Photos">
        <Photos itemId={cat.id} ids={item?.photos ?? []} />
      </Guard>
      <div class="ci-submit">
        {submitted ? (
          <p class="ci-line">Write-up submitted.</p>
        ) : (
          <>
            <button class="m-btn m-btn-primary" type="button" aria-disabled={!hasWork || undefined} aria-describedby={hasWork ? undefined : 'ci-submit-why'}
              onClick={submit}>
              Submit write-up
            </button>
            {!hasWork && <p id="ci-submit-why" class="ci-line">Write something or add a photo first.</p>}
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Supervision and redo                                                 */
/* ------------------------------------------------------------------ */

/**
 * Record the owner edited, laid over the stored values. Untouched fields keep
 * showing (and saving) the store's value, so a sync pull that lands while the
 * form is open is never overwritten by the copy the form opened with.
 */
function useEdits<T>(): [Record<string, T>, (k: string, v: T) => void] {
  const [edits, setEdits] = useState<Record<string, T>>({});
  return [edits, (k, v) => setEdits((prev) => ({ ...prev, [k]: v }))];
}

/** Stored slots with the edited ones swapped in. */
const overlay = (stored: readonly string[], n: number, edits: Record<string, string>): string[] =>
  Array.from({ length: n }, (_, i) => edits[i] ?? stored[i] ?? '');

function SupervisionForm({ cat, item, onSaved, onCancel }: { cat: CatItem; item: CamItem | undefined; onSaved: (m: string) => void; onCancel: () => void }) {
  const [markEdits, editMark] = useEdits<string>();
  const [weakEdits, editWeak] = useEdits<string>();
  const [redoEdits, editRedo] = useEdits<string>();
  const storedMark = (it: CamItem | undefined, q: string): string => it?.questions[q]?.mark?.toString() ?? '';
  const marks = Object.fromEntries(cat.questions.map((q) => [q.id, markEdits[q.id] ?? storedMark(item, q.id)]));
  const weak = overlay(item?.weakPoints ?? [], 3, weakEdits);
  const redo = overlay(item?.redoQs ?? [], 2, redoEdits);
  const [tried, setTried] = useState(false);
  const badMark = (v: string): boolean => v.trim() !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 20);
  const save = (e: Event): void => {
    e.preventDefault();
    setTried(true);
    const bad = cat.questions.find((q) => badMark(marks[q.id] ?? ''));
    if (bad) {
      document.getElementById(`ci-sv-${bad.id}`)?.focus();
      return;
    }
    const now = Date.now();
    let first = false;
    const saved = write(() => {
      const out = updateItem(cat.id, (it) => {
        const questions = { ...it.questions };
        for (const [q, raw] of Object.entries(markEdits)) {
          const v = raw.trim();
          if (v !== '') questions[q] = { ...(questions[q] ?? blankQ(q)), mark: Number(v) };
        }
        // Merged with the store as it is now, not as it was when the form opened.
        const weakPoints = Object.keys(weakEdits).length
          ? overlay(it.weakPoints ?? [], 3, weakEdits).map((w) => w.trim()).filter(Boolean)
          : it.weakPoints;
        const redoQs = Object.keys(redoEdits).length ? [...new Set(overlay(it.redoQs ?? [], 2, redoEdits).filter(Boolean))] : it.redoQs ?? [];
        first = it.supervisedAt === undefined;
        if (first) {
          return {
            ...it, questions, supervisedAt: now, weakPoints, redoQs,
            redoDue: redoQs.length ? redoDue(now) : undefined, redoneAt: undefined, stage: 'supervised',
          };
        }
        // Editing the log later corrects marks, weak points and redo questions only.
        // The supervision keeps its date, its redo deadline and its stage, so an edit
        // never reopens a redo that was done or moves a deadline. Redo questions
        // added on an edit get the deadline the supervision itself set.
        const due = it.redoDue ?? (redoQs.length ? redoDue(it.supervisedAt!) : undefined);
        return { ...it, questions, weakPoints, redoQs, redoDue: due };
      }, now);
      awardSupervision(cat.id, now);
      for (const q of cat.questions) {
        const question = out.questions[q.id];
        if (question?.mark !== undefined) {
          if (isStepQuestion(cat, q.id)) awardStepSelfMark(cat.id, q.id, now);
          if (question.mark < STEP_PASS_MARK) autoError(cat, q.id, now);
        }
        if (question?.status === 'stuck') autoError(cat, q.id, now);
      }
      return out;
    });
    const due = saved.redoQs?.length && saved.redoneAt === undefined ? saved.redoDue : undefined;
    if (!first) onSaved('Supervision log updated.');
    else onSaved(due !== undefined ? `Supervision saved. Redo due ${fmtDue(due)}.` : 'Supervision saved.');
  };
  return (
    <form class="ci-sv-form" onSubmit={save} noValidate>
      <fieldset>
        <legend class="m-label">Marks</legend>
        {/* One hint for the group rather than one per question, so the form stays quiet;
            a field that fails the rule gets its own line. */}
        <p id="ci-sv-marks-rule" class="cam-rule">Each 0 to 20, or blank if not marked</p>
        {cat.questions.map((q) => {
          const id = `ci-sv-${q.id}`;
          const invalid = tried && badMark(marks[q.id] ?? '');
          return (
            <div class="cam-field" key={q.id}>
              <label for={id}>{q.label} mark</label>
              <span class="ci-mark">
                <input id={id} class="cam-input ci-mark-input m-num" type="text" inputMode="numeric" value={marks[q.id]}
                  aria-invalid={invalid || undefined} aria-describedby={invalid ? `ci-sv-marks-rule ${id}-rule` : 'ci-sv-marks-rule'}
                  onInput={(e) => editMark(q.id, (e.currentTarget as HTMLInputElement).value)} />
                <span class="m-num">/ 20</span>
              </span>
              {invalid && <p id={`${id}-rule`} class="cam-rule" data-invalid="true">Use 0 to 20, or leave it blank</p>}
            </div>
          );
        })}
      </fieldset>
      <fieldset>
        <legend class="m-label">3 weak points</legend>
        {weak.map((w, i) => (
          <div class="cam-field" key={i}>
            <label for={`ci-weak-${i}`}>Weak point {i + 1}</label>
            <input id={`ci-weak-${i}`} class="cam-input" type="text" value={w}
              onInput={(e) => editWeak(String(i), (e.currentTarget as HTMLInputElement).value)} />
          </div>
        ))}
      </fieldset>
      <fieldset>
        <legend class="m-label">2 redo questions</legend>
        {redo.map((r, i) => (
          <div class="cam-field" key={i}>
            <label for={`ci-redo-${i}`}>Redo question {i + 1}</label>
            <select id={`ci-redo-${i}`} class="cam-input" value={r}
              onChange={(e) => editRedo(String(i), (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">None</option>
              {cat.questions.map((q) => (
                <option key={q.id} value={q.id}>{q.label}</option>
              ))}
            </select>
          </div>
        ))}
      </fieldset>
      <div class="cam-actions">
        <button class="m-btn m-btn-primary" type="submit">Save</button>
        <button class="m-btn m-btn-quiet" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Supervision({ cat, item, state, now, sel, announce }: { cat: CatItem; item: CamItem | undefined; state: CambridgeState; now: number; sel: string; announce: (m: string) => void }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fallback'>('idle');
  const [form, setForm] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const week = supervisionsThisWeek(state, now);
  const prompt = supervisorPrompt(cat, sel);
  const start = (): void => {
    const done = (): void => { setCopied('ok'); announce('Prompt copied. Paste it into Claude with your photos.'); };
    const fail = (): void => setCopied('fallback');
    try {
      const p = navigator.clipboard?.writeText(prompt);
      if (p) p.then(done, fail);
      else fail();
    } catch {
      fail();
    }
  };
  const redoPending = item?.supervisedAt !== undefined && (item.redoQs?.length ?? 0) > 0 && item.redoneAt === undefined;
  const due = item?.redoDue;
  const shifted = due !== undefined && item?.supervisedAt !== undefined && due !== item.supervisedAt + REDO_WINDOW_MS;
  const markRedo = (): void => {
    const t = Date.now();
    write(() => {
      updateItem(cat.id, (it) => ({ ...it, redoneAt: t, stage: 'redo-done' }), t);
      awardRedo(cat.id, t);
    });
    announce('Redo marked done.');
  };
  const redoLabels = (item?.redoQs ?? []).map((q) => cat.questions.find((x) => x.id === q)?.label ?? q).join(', ');
  return (
    <section aria-labelledby="ci-s-h">
      <div class="m-section">
        <h2 class="m-title cam-title" id="ci-s-h">
          <Emblem kind="pembroke" height={24} />
          <span>Supervision</span>
        </h2>
        <Note state={state}>{week.held} of {week.target} this week</Note>
      </div>
      <div class="ci-sv">
        <div class="cam-actions">
          <button class="m-btn m-btn-primary" type="button" onClick={start}>Start supervision</button>
          {!form && (
            <button class="m-btn" type="button" onClick={() => setForm(true)}>
              {item?.supervisedAt !== undefined ? 'Edit the supervision log' : 'Log the supervision'}
            </button>
          )}
        </div>
        {copied === 'ok' && <p class="ci-line" role="status">Prompt copied. Paste it into Claude with your photos.</p>}
        {copied === 'fallback' && (
          <div class="cam-field">
            <label for="ci-prompt">Copy this prompt into Claude</label>
            <textarea id="ci-prompt" ref={promptRef} class="m-editor-input ci-prompt" readOnly value={prompt} />
            <button class="m-btn m-btn-quiet" type="button" onClick={() => promptRef.current?.select()}>Select all</button>
          </div>
        )}
        <p class="ci-line">
          <Gloss text={`Supervisions this week: ${week.held} of ${week.target}. Afterwards, log marks out of 20, 3 weak points and 2 questions to redo.`} />
        </p>
        {form && (
          <SupervisionForm cat={cat} item={item}
            onSaved={(m) => { setForm(false); announce(m); }} onCancel={() => setForm(false)} />
        )}
        {item?.supervisedAt !== undefined && !form && (
          <p class="ci-line m-num">
            Supervised {dayMonth(item.supervisedAt)}
            {item.weakPoints?.length ? ` · weak points: ${item.weakPoints.join('; ')}` : ''}
          </p>
        )}
        {redoPending && due !== undefined && (
          <div class="ci-redo">
            <p class="ci-redo-line m-num" data-warn={due < now ? 'true' : undefined}>
              {due < now ? `Redo overdue since ${fmtDue(due)}` : `Redo due ${fmtDue(due)}${shifted ? ', after the Sabbath' : ''}`}
              {redoLabels ? ` · ${redoLabels}` : ''}
            </p>
            <button class="m-btn" type="button" onClick={markRedo}>Mark redo done</button>
          </div>
        )}
        {item?.redoneAt !== undefined && <p class="ci-line m-num">Redone {dayMonth(item.redoneAt)} at {hm(item.redoneAt)}</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The screen                                                           */
/* ------------------------------------------------------------------ */

export function StudyItemSkeleton() {
  return (
    <div class="cam-root" aria-busy="true" aria-label="Loading the study item">
      <div class="m-section m-pagehead">
        <span class="m-skel m-skel-line cam-skel-title" />
      </div>
      <span class="m-skel ci-skel-stepper" />
      <div class="m-section">
        <span class="m-skel m-skel-line cam-skel-h" />
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} class="m-skel cam-skel-row" />
      ))}
      <span class="m-skel ci-skel-panel" />
    </div>
  );
}

/** The question to open: the running one, else the first not yet marked solved. */
function firstQuestion(cat: CatItem, item: CamItem | undefined): string {
  const qs = cat.questions.map((q) => q.id);
  return qs.find((q) => item?.questions[q]?.runningSince !== undefined)
    ?? qs.find((q) => item?.questions[q]?.status !== 'solved')
    ?? qs[0]!;
}

function ItemScreen({ cat, state }: { cat: CatItem; state: CambridgeState }) {
  const it = state.items[cat.id];
  const item = it && !it.deleted ? it : undefined;
  const [sel, setSel] = useState(() => firstQuestion(cat, item));
  const [msg, setMsg] = useState('');
  const anyRunning = !!item && Object.values(item.questions).some((q) => q.runningSince !== undefined);
  // A running timer ticks every second; otherwise once a minute is enough for the hints countdown.
  const now = useTick(anyRunning ? 1000 : 60_000);
  const index = loopIndex(item, cat.questions.map((q) => q.id));
  const selIdx = cat.questions.findIndex((q) => q.id === sel);
  const stepName = STEPS[Math.min(index, STEPS.length - 1)]!.name;
  const note = index >= STEPS.length ? 'Done' : `${stepName} · Q${selIdx + 1} of ${cat.questions.length}`;
  return (
    <main class="cam-root ci-root" aria-labelledby="ci-h">
      <PageHead id="ci-h" title={cat.title} note={note} />
      <Stepper index={index} />
      <Guard what="The questions">
        <Questions cat={cat} item={item} state={state} sel={sel} setSel={setSel} now={now} announce={setMsg} />
      </Guard>
      <Guard what="The links">
        <Links cat={cat} item={item} sel={sel} now={now} />
      </Guard>
      <Guard what="The write-up">
        <Writeup key={cat.id} cat={cat} item={item} state={state} />
      </Guard>
      <Guard what="The supervision">
        <Supervision cat={cat} item={item} state={state} now={now} sel={sel} announce={setMsg} />
      </Guard>
      <div class="m-sr" aria-live="polite">{msg}</div>
    </main>
  );
}

export function StudyItemView({ ready = cambridgeReady, itemId }: { ready?: Promise<void>; itemId?: string } = {}) {
  const id = itemId ?? camItemId.value;
  // Keyed by the item, so moving to an item on another track waits for that track.
  return <ItemLoader key={id ?? ''} id={id} ready={ready} />;
}

function ItemLoader({ id, ready }: { id: string | null; ready: Promise<void> }) {
  void dataRev.value; // re-render on every store write and sync pull
  // The store, and the catalog track this item is on.
  const both = useMemo(() => Promise.all([ready, loadItem(id)]).then(() => undefined), [ready, id]);
  const status = useReady(both);
  if (status === 'loading') return <StudyItemSkeleton />;
  const cat = catItem(id);
  if (status === 'failed' || !cat)
    return (
      <div class="cam-root">
        <div class="m-state" data-kind="error" role="alert">
          <p class="m-state-title">{status === 'failed' ? "This item didn't load." : "This item isn't in the plan."}</p>
          <p class="m-state-body">
            {status === 'failed' ? 'The study store could not be read on this device.' : 'It may have been renamed in the curriculum JSON.'}
          </p>
          {status === 'failed' ? (
            <button class="m-btn" type="button" onClick={retryScreen}>Try again</button>
          ) : (
            <button class="m-btn" type="button" onClick={() => openSection('cambridge')}>Back to the Cambridge path</button>
          )}
        </div>
      </div>
    );
  return <ItemScreen key={cat.id} cat={cat} state={readCambridge()} />;
}
