/**
 * The Cambridge path screen (`cambridge`, and the old `math` id): the week's
 * supervisions, the phase map with each gate, and the block of study items to
 * work on now. docs/cambridge-screens.md section (b).
 *
 * `CamTrack` is the phase map plus the current blocks on their own, so the CS
 * path can render the CST track with the same components.
 *
 * Lazy-loaded by the router. The screen waits for the store and for its own
 * catalog tracks (step and courses; the CS path loads cst), drawing the
 * skeleton until both are in.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { dataRev } from '@/ui/store';
import { PageHead } from '@/ui/components/PageHead';
import { Gloss } from '@/features/cambridge/Gloss';
import { cambridgeReady, putGate, readCambridge } from '@/features/cambridge/store';
import { awardGate } from '@/features/cambridge/xp';
import { fmtDue, isoWeek, supervisionsThisWeek } from '@/features/cambridge/schedule';
import {
  catalog, currentBlock, evidenceRule, gateBlocker, itemDone, liveItem, loadPath, pathPhases, phaseOpen, phaseState, sideBlocks,
  type CatBlock, type CatPhase, type PhaseState,
} from '@/features/cambridge/catalog';
import type { CamItem, CambridgeState, ItemStage } from '@/features/cambridge/types';
import { openCam, openCamItem } from '@/features/cambridge/nav';
import { Guard, Note, dayMonth, retryScreen, shortDay, useReady, write } from '@/features/cambridge/camUi';
import './cambridge.css';
import { Emblem } from '@/ui/components/Emblem';

export const STAGE_WORD: Readonly<Record<ItemStage, string>> = {
  'not-started': 'Not started',
  attempting: 'Attempting',
  'written-up': 'Written up',
  supervised: 'Supervised',
  'redo-done': 'Redo done',
};

export function StageStatus({ stage }: { stage: ItemStage }) {
  return (
    <span class="m-status" data-status={stage}>
      <span class="m-status-mark" aria-hidden="true" />
      {STAGE_WORD[stage]}
    </span>
  );
}

/** Same outline as the loaded screen (PageHead, week line, tools, 7 phase rows, 4 item rows), so the swap does not shift. */
export function CambridgePathSkeleton({ rows = 7, head = true }: { rows?: number; head?: boolean }) {
  return (
    <div class="cam-root" aria-busy="true" aria-label="Loading the Cambridge path">
      {head && (
        <>
          <div class="m-section m-pagehead">
            <span class="m-skel m-skel-line cam-skel-title" />
          </div>
          <span class="m-skel m-skel-line cam-skel-week" />
          <span class="m-skel cam-skel-tools" />
        </>
      )}
      <div class="m-section">
        <span class="m-skel m-skel-line cam-skel-h" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} class="m-skel cam-skel-phase" />
      ))}
      <div class="m-section">
        <span class="m-skel m-skel-line cam-skel-h" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} class="m-skel cam-skel-row" />
      ))}
    </div>
  );
}

const phaseLabel = (key: string): string => catalog().phases.get(key)?.name ?? key;

/* ------------------------------------------------------------------ */
/* Gate flow                                                            */
/* ------------------------------------------------------------------ */

function GateForm({ phase, onDone, onCancel }: { phase: CatPhase; onDone: (msg: string) => void; onCancel: () => void }) {
  const evidence = phase.gate!.evidence;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(evidence.map((e) => [e.key, ''])));
  const [tried, setTried] = useState(false);
  const rules = evidence.map((e) => evidenceRule(e));
  const bad = evidence.map((e, i) => !rules[i]!.ok(values[e.key] ?? ''));

  const submit = (ev: Event): void => {
    ev.preventDefault();
    setTried(true);
    if (bad.some(Boolean)) {
      const first = evidence[bad.indexOf(true)]!;
      document.getElementById(`cam-ev-${phase.key}-${first.key}`)?.focus();
      return;
    }
    const now = Date.now();
    write(() => {
      putGate({ phase: phase.key, passedAt: now, evidence: values }, now);
      awardGate(phase.key, now);
    });
    const after = readCambridge();
    const opened = pathPhases(phase.track === 'cst' ? 'cst' : 'math').filter((p) => p.requires.includes(phase.key) && phaseOpen(after, p));
    onDone(
      `${phase.name} passed.` +
        (opened.length ? ` ${opened.map((p) => p.name).join(' and ')} ${opened.length === 1 ? 'is' : 'are'} open.` : ''),
    );
    // The next phase is the natural next stop; its row takes focus after the re-render.
    const next = opened[0];
    if (next) window.setTimeout(() => document.getElementById(phaseRowId(next.key))?.focus(), 0);
  };

  return (
    <form class="cam-gate-form" onSubmit={submit} noValidate>
      <fieldset>
        <legend class="m-label">Evidence</legend>
        {evidence.map((e, i) => {
          const id = `cam-ev-${phase.key}-${e.key}`;
          const invalid = tried && bad[i];
          const set = (v: string): void => setValues((prev) => ({ ...prev, [e.key]: v }));
          return (
            <div class="cam-field" key={e.key}>
              <label for={id}>{e.label}</label>
              {e.type === 'yesno' ? (
                <select id={id} class="cam-input" value={values[e.key]} aria-invalid={invalid || undefined}
                  aria-describedby={`${id}-rule`} onChange={(ev) => set((ev.currentTarget as HTMLSelectElement).value)}>
                  <option value="">Choose</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input id={id} class="cam-input" type="text" value={values[e.key]}
                  inputMode={e.type === 'number' ? 'numeric' : undefined} aria-invalid={invalid || undefined}
                  aria-describedby={`${id}-rule`} onInput={(ev) => set((ev.currentTarget as HTMLInputElement).value)} />
              )}
              <p id={`${id}-rule`} class="cam-rule" data-invalid={invalid ? 'true' : undefined}>
                {rules[i]!.text}
              </p>
            </div>
          );
        })}
      </fieldset>
      <div class="cam-actions">
        <button class="m-btn m-btn-primary" type="submit">Record the pass</button>
        <button class="m-btn m-btn-quiet" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const phaseRowId = (key: string): string => `cam-ph-${key.replace(/[^A-Za-z0-9-]/g, '_')}`;

function PhaseDetail({ phase, st, state, announce }: { phase: CatPhase; st: PhaseState; state: CambridgeState; announce: (m: string) => void }) {
  const [form, setForm] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const gate = state.gates[phase.key];
  if (st === 'passed' && gate) {
    const ev = phase.gate?.evidence ?? [];
    return (
      <div class="cam-phase-detail">
        <p class="cam-detail-line m-num">Passed {dayMonth(gate.passedAt)}</p>
        {ev.length > 0 && (
          <dl class="cam-evidence">
            {ev.map((e) => (
              <div key={e.key}>
                <dt>{e.label}</dt>
                <dd class="m-num">{gate.evidence[e.key] || '(none)'}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }
  if (!phase.gate) {
    return (
      <div class="cam-phase-detail">
        <p class="cam-detail-line">
          {phase.alongside ? `No gate of its own: it ends when ${phaseLabel(phase.alongside)} passes.` : 'No gate: work through it at your pace.'}
        </p>
      </div>
    );
  }
  const blocker = gateBlocker(state, phase);
  return (
    <div class="cam-phase-detail">
      {phase.pace && <p class="cam-detail-line">Pace: <Gloss text={phase.pace} /></p>}
      {blocker ? (
        <p class="cam-detail-line">{blocker} before the gate.</p>
      ) : form ? (
        <GateForm phase={phase} onDone={(m) => { setForm(false); announce(m); }}
          onCancel={() => { setForm(false); window.setTimeout(() => trigger.current?.focus(), 0); }} />
      ) : (
        <button ref={trigger} class="m-btn m-btn-primary" type="button" onClick={() => setForm(true)}>
          Pass the gate
        </button>
      )}
    </div>
  );
}

function PhaseRow({ phase, state, announce }: { phase: CatPhase; state: CambridgeState; announce: (m: string) => void }) {
  const st = phaseState(state, phase);
  const [open, setOpen] = useState(false);
  const gate = state.gates[phase.key];
  const word = st === 'passed' ? (gate ? `Passed ${shortDay(gate.passedAt)}` : 'Done') : st === 'current' ? 'Current' : 'Locked';
  const title = phase.title + (phase.alongside ? `, alongside ${phaseLabel(phase.alongside)}` : '');
  const gateLine =
    st === 'locked'
      ? phase.lockedText
      : phase.gate ? `Gate: ${phase.gate.text}` : '';
  // The name, state and title open the detail, so they sit in the button and stay
  // plain text (a glossary term there would be a button inside a button). The gate
  // line is outside it, so its terms ("STEP") can be glossed.
  const body = (
    <>
      <span class="m-phase-head">
        <span class="m-phase-name">{phase.name}</span>
        <span class="m-phase-state m-num">{word}</span>
      </span>
      <span class="m-phase-title cam-block">{st === 'locked' ? <Gloss text={title} /> : title}</span>
    </>
  );
  const detailId = `${phaseRowId(phase.key)}-detail`;
  return (
    <li id={phaseRowId(phase.key)} class="m-phase" tabIndex={-1} data-state={st}
      data-parallel={phase.alongside ? 'true' : undefined} aria-current={st === 'current' ? 'step' : undefined}>
      <span class="m-phase-node" aria-hidden="true" />
      <div class="m-phase-body">
        {st === 'locked' ? (
          body
        ) : (
          <button class="m-phase-open" type="button" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>
            {body}
          </button>
        )}
        {gateLine && (
          <div class="m-phase-gate">
            <Gloss text={gateLine} />
          </div>
        )}
        {open && st !== 'locked' && (
          <div id={detailId}>
            <PhaseDetail phase={phase} st={st} state={state} announce={announce} />
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Items                                                                */
/* ------------------------------------------------------------------ */

/** The one useful second line of an item row, or null. An overdue redo is the only warning. */
function itemSub(it: CamItem | undefined, now: number): { text: string; warn?: boolean } | null {
  if (!it || it.supervisedAt === undefined) return null;
  const pending = (it.redoQs?.length ?? 0) > 0 && it.redoneAt === undefined && it.stage !== 'redo-done';
  if (pending && it.redoDue !== undefined) {
    return it.redoDue < now ? { text: `Redo overdue since ${fmtDue(it.redoDue)}`, warn: true } : { text: `Redo due ${fmtDue(it.redoDue)}` };
  }
  if (it.stage === 'supervised') return { text: `Supervised ${dayMonth(it.supervisedAt).split(' ')[0]}` };
  return null;
}

const LIST_CAP = 8;

function BlockSection({ phase, block, state, now }: { phase: CatPhase; block: CatBlock; state: CambridgeState; now: number }) {
  const [all, setAll] = useState(false);
  const cat = catalog();
  const hId = `cam-block-${phaseRowId(phase.key)}-${phaseRowId(block.id)}`;
  const heading = block.id === phase.key ? phase.name : `${phase.name} · ${block.name}`;
  const done = block.items.filter((id) => itemDone(liveItem(state, id))).length;
  // Long phases (A+ has 78 problems) show the next few undone first, then the rest on demand.
  // Short lists keep study order.
  const ordered = block.items.length <= LIST_CAP
    ? block.items
    : [...block.items.filter((id) => !itemDone(liveItem(state, id))), ...block.items.filter((id) => itemDone(liveItem(state, id)))];
  const shown = all ? ordered : ordered.slice(0, LIST_CAP);
  const week = isoWeek(now);
  const doneThisWeek = block.items.filter((id) => {
    const t = liveItem(state, id)?.supervisedAt;
    return t !== undefined && isoWeek(t) === week;
  }).length;
  const due = phase.perWeek && !block.alongside ? Math.max(0, Math.min(block.items.length - done, phase.perWeek - doneThisWeek)) : null;
  return (
    <section aria-labelledby={hId}>
      <div class="m-section">
        <h2 class="m-title" id={hId}>{heading}</h2>
        <Note state={state}>{due !== null ? `${due} due this week` : `${done} of ${block.items.length} done`}</Note>
      </div>
      {block.items.length === 0 ? (
        <div class="m-state" data-kind="empty">
          <p class="m-state-title">No items in {heading} yet.</p>
          <p class="m-state-body">
            {phase.track === 'cst' ? 'Items come from cs.json.' : phase.track === 'courses' ? 'Items come from courses.json.' : 'Items come from step.json.'}
          </p>
        </div>
      ) : (
        <>
          <ul class="cam-items">
            {shown.map((id) => {
              const it = liveItem(state, id);
              const sub = itemSub(it, now);
              return (
                <li key={id}>
                  <button class="m-row cam-item" type="button" onClick={() => openCamItem(id)}>
                    <span class="cam-item-main">
                      <span class="cam-item-title">{cat.items.get(id)?.title ?? id}</span>
                      {sub && <span class="cam-item-sub m-num" data-warn={sub.warn ? 'true' : undefined}>{sub.text}</span>}
                    </span>
                    <StageStatus stage={it?.stage ?? 'not-started'} />
                  </button>
                </li>
              );
            })}
          </ul>
          {ordered.length > LIST_CAP && (
            <button class="m-btn m-btn-quiet cam-more" type="button" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${ordered.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The track: phase map and current blocks                              */
/* ------------------------------------------------------------------ */

export function CamTrack({ which, state, now, title = 'Phases' }: { which: 'math' | 'cst'; state: CambridgeState; now: number; title?: string }) {
  const [msg, setMsg] = useState('');
  const phases = pathPhases(which);
  const hId = `cam-phases-h-${which}`;
  if (phases.length === 0) {
    return (
      <section aria-labelledby={hId}>
        <div class="m-section">
          <h2 class="m-title" id={hId}>{title}</h2>
        </div>
        <div class="m-state" data-kind="empty">
          <p class="m-state-title">The CST track isn't in the plan yet.</p>
          <p class="m-state-body">Its phases and items come from the track in data/cambridge/cs.json.</p>
        </div>
      </section>
    );
  }
  const states = phases.map((p) => phaseState(state, p));
  const passed = states.filter((s) => s === 'passed').length;
  const current = phases.filter((_, i) => states[i] === 'current');
  // Phases that run alongside another come after it, so the main block is first.
  current.sort((a, b) => Number(!!a.alongside) - Number(!!b.alongside));
  return (
    <>
      <section aria-labelledby={hId}>
        <div class="m-section">
          <h2 class="m-title" id={hId}>{title}</h2>
          <Note state={state}>{passed} of {phases.length} passed</Note>
        </div>
        <Guard what="The phase map">
          <ol class="m-phasemap" aria-label={title}>
            {phases.map((p) => (
              <PhaseRow key={p.key} phase={p} state={state} announce={setMsg} />
            ))}
          </ol>
        </Guard>
        <div class="m-sr" aria-live="polite">{msg}</div>
      </section>
      {current.flatMap((p) =>
        [currentBlock(state, p), ...sideBlocks(p)].map((b) => (
          <Guard key={`${p.key}:${b.id}`} what={b.name}>
            <BlockSection phase={p} block={b} state={state} now={now} />
          </Guard>
        )),
      )}
    </>
  );
}

/** The PageHead note: the main current phase and its progress. */
export function headNote(state: CambridgeState, which: 'math' | 'cst'): string {
  const phases = pathPhases(which);
  const p = phases.find((x) => phaseState(state, x) === 'current' && !x.alongside) ?? phases.find((x) => phaseState(state, x) === 'current');
  if (!p) return phases.length ? 'All phases passed' : '';
  const done = p.items.filter((id) => itemDone(liveItem(state, id))).length;
  return `${p.name} · ${done} of ${p.items.length}`;
}

/** Ready once the store has loaded and this path's catalog tracks have arrived. */
export function usePathReady(ready: Promise<void>, which: 'math' | 'cst'): ReturnType<typeof useReady> {
  const both = useMemo(() => Promise.all([ready, loadPath(which)]).then(() => undefined), [ready, which]);
  return useReady(both);
}

export function CambridgePathView({ ready = cambridgeReady }: { ready?: Promise<void> } = {}) {
  void dataRev.value; // re-render on every store write and sync pull
  const status = usePathReady(ready, 'math');
  if (status === 'loading') return <CambridgePathSkeleton />;
  if (status === 'failed')
    return (
      <div class="cam-root">
        <div class="m-state" data-kind="error" role="alert">
          <p class="m-state-title">The Cambridge path didn't load.</p>
          <p class="m-state-body">The study store could not be read on this device.</p>
          <button class="m-btn" type="button" onClick={retryScreen}>Try again</button>
        </div>
      </div>
    );
  const state = readCambridge();
  const now = Date.now();
  const week = supervisionsThisWeek(state, now);
  return (
    <main class="cam-root" aria-labelledby="cam-h">
      <PageHead
        id="cam-h"
        title={
          <span class="cam-title">
            <Emblem kind="cambridge" height={32} />
            <Emblem kind="pembroke" height={32} />
            <span>The Cambridge Method</span>
          </span>
        }
        note={headNote(state, 'math')}
      />
      <p class="cam-week m-num">
        <Gloss text={`Supervisions this week: ${week.held} of ${week.target} · suggested ${week.suggested.join(', ')}`} />
      </p>
      <nav class="cam-tools" aria-label="Cambridge tools">
        <button class="m-btn m-btn-quiet" type="button" onClick={() => openCam('glossary')}>Glossary</button>
        <button class="m-btn m-btn-quiet" type="button" onClick={() => openCam('cam-errors')}>Error log</button>
      </nav>
      <CamTrack which="math" state={state} now={now} />
    </main>
  );
}
