/**
 * The treadmill screen for the Norwegian 4x4 (owner, 2026-10-26): a step-by-step timer you
 * follow on the machine. One big card says what to do now (jog or walk, the speed and
 * incline to set, time left), the block's minutes show where you are inside it, and the
 * next step shows only what changes. End the session to log it; the blocks finished come
 * from the timer and can be corrected.
 *
 * The timer is wall-clock based (a start time plus banked seconds), so it stays right when
 * the phone sleeps or the tab is in the background, and it is kept in localStorage so a
 * reload mid-session resumes where it was.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  AGE, FOUR, benchDay, blocksDoneAt, fourSegs, fourSessionStage, fourStage, fourSteps, fourMph, hrZone, maxHr, stepAt, totals,
  type FourKind, type FourLog, type FourStep,
} from '@/features/workout/program';
import { exerciseDates } from '@/features/workout/workoutSelectors';
import { wk, currentBW, workoutActions } from '@/ui/actions';

const KEY = 'meridian.treadmill.run.v1';

interface Saved {
  date: string;
  kind: FourKind;
  stage: number;
  mph: number;
  incline: number;
  /** seconds banked before the current run */
  base: number;
  /** epoch ms the timer last started, or null when paused */
  since: number | null;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the timer still runs for this visit */
  }
}

const fmt = (secs: number): string => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "12:30" or "12.5" (minutes) as seconds. */
function parseClock(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = t.includes(':') ? t.split(':').reduce((a, x) => a * 60 + (Number(x) || 0), 0) : Math.round((Number(t) || 0) * 60);
  return n >= 0 ? n : null;
}

let audio: AudioContext | null = null;
function beep(freq: number, secs: number): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio = audio ?? new Ctx();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + secs);
  } catch {
    /* no audio: the screen still shows every change */
  }
}

export function TreadmillRun({ exercise, date, onCustom }: { exercise: string; date: string; onCustom: () => void }) {
  const W = wk();
  const kind: FourKind = benchDay(exerciseDates(W, 'Bench Press'), date) === 'B' ? 'hard' : 'easy';
  const stage = fourStage(W, date);
  const run = fourSessionStage(kind, stage);
  const of = kind === 'hard' ? FOUR.hardBlocks : FOUR.easyBlocks;

  const resumed = useMemo(() => {
    const s = load();
    return s && s.date === date && s.kind === kind && s.stage === stage ? s : null;
  }, [date, kind, stage]);
  const [mph, setMph] = useState(resumed?.mph ?? fourMph(run));
  const [incline, setIncline] = useState(resumed?.incline ?? FOUR.incline[kind]);
  const [base, setBase] = useState(resumed?.base ?? 0);
  const [since, setSince] = useState<number | null>(resumed?.since ?? null);
  const [ending, setEnding] = useState(false);
  const [, tick] = useState(0);
  const [sync, setSync] = useState('');

  const steps = useMemo(() => fourSteps(kind, stage, { jogMph: mph, incline }), [kind, stage, mph, incline]);
  const total = steps.reduce((a, s) => a + s.mins * 60, 0);
  const elapsed = Math.min(total, base + (since != null ? (Date.now() - since) / 1000 : 0));
  const idx = stepAt(steps, elapsed);
  const cur = steps[idx]!;
  const into = elapsed - cur.start;
  const left = cur.mins * 60 - into;
  const next: FourStep | undefined = steps[idx + 1];

  useEffect(() => {
    save({ date, kind, stage, mph, incline, base, since });
  }, [date, kind, stage, mph, incline, base, since]);

  // Repaint 4 times a second while running.
  useEffect(() => {
    if (since == null) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [since]);

  // Keep the screen on while the timer runs.
  useEffect(() => {
    if (since == null) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [since]);

  // Three short beeps before a change, a long one on it; stop at the end.
  const lastBeep = useRef<string>('');
  useEffect(() => {
    if (since == null) return;
    const secLeft = Math.ceil(left);
    const mark = `${idx}:${secLeft}`;
    if (secLeft >= 1 && secLeft <= 3 && next && lastBeep.current !== mark) {
      lastBeep.current = mark;
      beep(660, 0.08);
    }
    if (into < 0.5 && idx > 0 && lastBeep.current !== `${idx}:go`) {
      lastBeep.current = `${idx}:go`;
      beep(990, 0.25);
    }
    if (elapsed >= total) {
      setBase(total);
      setSince(null);
      setEnding(true);
    }
  });

  const jump = (secs: number): void => {
    setBase(Math.max(0, Math.min(total - 1, secs)));
    if (since != null) setSince(Date.now());
  };
  const toggle = (): void => {
    if (since != null) {
      setBase(elapsed);
      setSince(null);
    } else {
      beep(990, 0.05);
      setSince(Date.now());
    }
  };
  const pause = (): void => {
    if (since != null) {
      setBase(elapsed);
      setSince(null);
    }
  };

  const [easyLo, easyHi] = hrZone(AGE, 0.6, 0.75);
  const [hardLo, hardHi] = hrZone(AGE, 0.85, 0.95);
  const recHr = Math.round(maxHr(AGE) * 0.7);
  const cue = (s: FourStep): string => {
    if (s.block == null) {
      if (s.where.startsWith('Recovery')) return kind === 'hard' ? `Keep moving. Let your heart rate fall to about ${recHr}.` : 'Easy walk. Breathe.';
      if (s.where.startsWith('Cool')) return 'Slow down. Done after this.';
      return s.where.endsWith('2') ? 'Brisk. Heart rate starts to rise.' : 'Easy pace. Get loose.';
    }
    if (kind === 'hard') {
      return s.kind === 'jog'
        ? `Hold ${hardLo} to ${hardHi} bpm. A few words, not a sentence.`
        : `Brisk walk. Keep your heart rate near ${hardLo}. Dropping a lot? Walk at 3.8 mph next time.`;
    }
    return s.kind === 'jog' ? `Easy jog. Full sentences, about ${easyLo} to ${easyHi} bpm.` : 'Walk it out, then jog again.';
  };
  const what = (s: FourStep): string => (s.kind === 'jog' ? 'JOG' : 'WALK');
  const setting = (s: FourStep): string => `${s.mph} mph · ${s.incline}%`;

  if (ending) {
    return (
      <TreadmillSummary
        exercise={exercise} kind={kind} stage={stage} of={of} mph={mph} incline={incline}
        counted={elapsed > 0 ? blocksDoneAt(steps, elapsed) : of}
        timed={elapsed > 0}
        onBack={() => setEnding(false)}
        onLogged={() => save(null)}
      />
    );
  }

  const blockSteps = cur.block != null ? steps.filter((s) => s.block === cur.block) : [];
  const minuteOfBlock = cur.block != null ? Math.min(4, (cur.from ?? 0) + Math.floor(into / 60) + 1) : 0;
  const done = blocksDoneAt(steps, elapsed);

  return (
    <div class="tmr">
      <div class="tmr-head">
        <span class="tmr-title">4x4 · {kind === 'hard' ? `Hard day, stage ${stage + 1}` : `Easy day, stage ${run + 1} blocks`}</span>
        <span class="tmr-clock">{fmt(elapsed)} / {fmt(total)}</span>
      </div>
      <p class="tmr-note">
        {kind === 'hard'
          ? <>Set the incline to <b>{incline}%</b> after the warm-up and leave it until the cool-down. Only the speed changes. Blocks: hold {hardLo} to {hardHi} bpm.</>
          : <>Warm up at 4%, then set <b>{incline}%</b> and leave it until the cool-down. Only the speed changes.</>}
      </p>

      <div class="tmr-now" data-tone={cur.tone} aria-live="polite">
        <div class="tmr-where">{cur.where}{cur.block != null ? ` · minute ${minuteOfBlock} of 4` : ''}</div>
        <div class="tmr-what">{what(cur)}</div>
        <div class="tmr-set">{setting(cur)}</div>
        <div class="tmr-left">{fmt(left)}<small>left</small></div>
        <div class="tmr-bar"><i style={{ width: `${(into / (cur.mins * 60)) * 100}%` }} /></div>
        <div class="tmr-cue">{cue(cur)}</div>
      </div>

      {cur.block != null && (
        <div class="tmr-pips" aria-label="Minutes in this block">
          <span class="tmr-pips-l">Block {cur.block + 1}</span>
          {blockSteps.flatMap((p) =>
            Array.from({ length: p.mins }, (_, m) => {
              const at = p.start + m * 60;
              const state = elapsed >= at + 60 ? ' done' : elapsed >= at ? ' cur' : '';
              return <span class={`tmr-pip ${p.kind}${state}`}>{p.kind === 'jog' ? 'JOG' : 'WALK'}</span>;
            }),
          )}
        </div>
      )}

      {next && (
        <div class="tmr-next">
          <div>
            <div class="tmr-k">Next</div>
            <div class="tmr-v">
              {what(next)}{' '}
              <span class="tmr-m">
                {next.mph !== cur.mph ? `→ ${next.mph} mph` : `${next.mph} mph`} ·{' '}
                {next.incline !== cur.incline ? <b>incline → {next.incline}%</b> : `incline stays ${next.incline}%`}
              </span>
            </div>
          </div>
          <div class="tmr-in">in {fmt(left)}</div>
        </div>
      )}

      <div class="tmr-ctl">
        <button type="button" onClick={() => jump(into > 5 || idx === 0 ? cur.start : steps[idx - 1]!.start)} aria-label="Previous step">‹ Back</button>
        <button type="button" class="go" onClick={toggle}>{since != null ? 'Pause' : elapsed > 0 ? 'Resume' : 'Start'}</button>
        <button type="button" onClick={() => next && jump(next.start)} disabled={!next} aria-label="Next step">Skip ›</button>
      </div>

      <div>
        <div class="tmr-strip-h"><span>Whole session</span><span>{done} of {of} blocks done</span></div>
        <div class="tmr-strip">
          {steps.map((s) => <span class={s.tone} style={{ width: `${((s.mins * 60) / total) * 100}%` }} />)}
          <i class="tmr-mark" style={{ left: `${(elapsed / total) * 100}%` }} />
        </div>
      </div>

      <div class="tmr-row">
        <label for="tmr-sync">Treadmill clock says</label>
        <input id="tmr-sync" class="fv" type="text" inputmode="decimal" placeholder="14:20" value={sync} onInput={(e) => setSync((e.target as HTMLInputElement).value)} aria-label="Time on the treadmill screen" />
        <button type="button" class="setundo" onClick={() => { const s = parseClock(sync); if (s != null) jump(s); }}>Match it</button>
      </div>
      <p class="tmr-hint">Started the app late? Type the time on the treadmill screen and the app jumps to the same spot.</p>

      <details class="tmr-more">
        <summary>All steps · change speed or incline</summary>
        <div class="tmr-row">
          <label>Jog speed <input class="fv" type="number" inputmode="decimal" value={mph} onInput={(e) => setMph(Number((e.target as HTMLInputElement).value) || mph)} aria-label="Jog speed (mph)" /> mph</label>
          <label>Incline <input class="fv" type="number" inputmode="decimal" value={incline} onInput={(e) => setIncline(Number((e.target as HTMLInputElement).value) || 0)} aria-label="Incline (%)" /> %</label>
        </div>
        <ol class="tmr-steps">
          {steps.map((s, i) => (
            <li class={i < idx ? 'done' : i === idx ? 'cur' : ''}>
              <span class="t">{fmt(s.start)}</span>
              <span>{s.where}: <b>{what(s).toLowerCase()}</b> {fmt(s.mins * 60)}</span>
              <span class="s">{setting(s)}</span>
            </li>
          ))}
        </ol>
      </details>

      <button type="button" class="tmr-end" onClick={() => { pause(); setEnding(true); }}>End session and log</button>
      <button type="button" class="setundo" onClick={onCustom}>Did something else? Log a different session</button>
    </div>
  );
}

function TreadmillSummary({ exercise, kind, stage, of, mph, incline, counted, timed, onBack, onLogged }: {
  exercise: string; kind: FourKind; stage: number; of: number; mph: number; incline: number;
  counted: number; timed: boolean; onBack: () => void; onLogged: () => void;
}) {
  const [blocks, setBlocks] = useState(counted);
  const [avgHr, setAvgHr] = useState('');
  const [peakHr, setPeakHr] = useState('');
  const segs = fourSegs(kind, stage, blocks, mph, incline);
  const t = totals(segs, Number(currentBW()) || 120);
  const jogMins = segs.filter((g) => g.kind === 'jog').reduce((a, g) => a + g.mins, 0);
  const hr = (v: string): number | undefined => (Number(v) > 0 ? Math.round(Number(v)) : undefined);
  const log = (): void => {
    const fx: FourLog = { kind, stage, blocks, of };
    const a = hr(avgHr);
    const p = hr(peakHr);
    if (a) fx.avgHr = a;
    if (p) fx.peakHr = p;
    workoutActions.logTreadmill(exercise, segs, fx);
    onLogged();
  };
  return (
    <div class="tmr">
      <div class="tmr-sum">
        <div class="tmr-title">Log the 4x4</div>
        <div class="tmr-stats">
          <div><b>{t.mins}</b><span>min</span></div>
          <div><b>{t.miles}</b><span>miles</span></div>
          <div><b>{t.kcal}</b><span>kcal</span></div>
          <div><b>{jogMins}</b><span>min jogged</span></div>
        </div>
        <div>
          <div class="tmr-k">Blocks finished</div>
          <span class="rir">
            {Array.from({ length: of + 1 }, (_, n) => (
              <button type="button" class={'rir-b' + (n === blocks ? ' on' : '')} aria-pressed={n === blocks} onClick={() => setBlocks(n)}>{n}</button>
            ))}
          </span>
          <p class="tmr-hint">
            {timed ? `Counted from the timer: ${counted} of ${of}. Tap to correct it.` : 'Tap how many blocks you finished.'}
            {kind === 'hard' ? ' Two hard days with every block done moves you up a stage.' : ''}
          </p>
        </div>
        <div class="tmr-row">
          <span class="tmr-k">Oura heart rate (optional)</span>
          <label>average <input class="fv" type="number" inputmode="numeric" value={avgHr} onInput={(e) => setAvgHr((e.target as HTMLInputElement).value)} aria-label="Average heart rate" /></label>
          <label>peak <input class="fv" type="number" inputmode="numeric" value={peakHr} onInput={(e) => setPeakHr((e.target as HTMLInputElement).value)} aria-label="Peak heart rate" /></label>
        </div>
        <button type="button" class="logbtn" onClick={log}>Log treadmill</button>
        <button type="button" class="setundo" onClick={onBack}>‹ Back to the session</button>
      </div>
    </div>
  );
}
