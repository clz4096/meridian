/**
 * Ascent — the guided "Today's path" study session.
 *
 * A near-verbatim port of the approved prototype (scratchpad/ascent-proto.html):
 * same DOM, same `.asc-*` CSS, same motion — but wired to real FSRS data.
 *
 * The motion crux (consensus §1). ONE persistent `<article class="asc-card">` is
 * rendered for the whole run and NEVER key-remounted — its content is swapped by
 * `cursor`, so the CSS transition on the node itself is what animates. A `cardPhase`
 * signal ('' | 'recede' | 'enter') drives the class IN THE JSX, so class + content
 * flip on the same render tick (no ref/vdom race). Grade → `cardPhase='recede'`,
 * then after `delay` (420 good / 620 again·hard / 120 reduced, matching the recede
 * duration) the cursor bumps and `cardPhase='enter'`; a `useLayoutEffect` keyed on
 * `cursor` runs the proto's reflow shim (`void offsetWidth` → rAF → `cardPhase=''`)
 * so the enter keyframe replays on every advance. The reveal height-slide and the
 * rail/frontier are pure CSS (grid-rows / width transitions) off signals.
 *
 * State is component-local, useRef-persisted signals: unmount auto-cleans it (no
 * store pollution, no manual reset), so backing out abandons the session cleanly.
 * The deck is frozen at Begin and never re-read; `dataRev` is read once at the top
 * for leaf-subscription so a `rate()` (mastery write) live-recolors the dot.
 */
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals';
import { dataRev, kgTopic } from '@/ui/store';
import { kg, knowledgeActions, sessionForTopic, REVIEW_PREFIX, INTERVIEW_PREFIX, type TodaySession } from '@/ui/actions';
import { dstr } from '@/app/bootstrap';
import { readFsrs, previewIntervals, humanizeDays, type Grade } from '@/features/knowledge/fsrs';
import { ascentLedger, bandOf, MWORD, MCOLOR, GRADE_MASTERY, type AscentHistory } from '@/features/knowledge/ascent';
import { daysBetween } from '@/features/knowledge/knowledgeSelectors';
import { srcHref, practiceLinks, seeLinks } from '@/features/knowledge/source';
import { DATA } from '@/core/data/index';
import type { KnowledgeItem } from '@/features/knowledge/types';

type Any = any;
const TOPIC_NAME: Record<string, string> = {};
(DATA.topics as Any[]).forEach((t) => (TOPIC_NAME[t.id] = t.name));
const BOOKS: Any = DATA.books;

type Screen = 'start' | 'card' | 'summit' | 'caught';
type CardPhase = '' | 'recede' | 'enter';

/** Item shape once it flows through allKGItems/dueItems — carries its topic id. */
type DeckItem = KnowledgeItem & { topic: string };

interface AscSt {
  screen: Signal<Screen>;
  cursor: Signal<number>;
  cardPhase: Signal<CardPhase>;
  revealed: Signal<boolean>;
  receipt: Signal<string>;
  note: Signal<string>;
  completed: Signal<number>;
  deckRef: { current: DeckItem[] };
  sessRef: { current: TodaySession | null };
  history: AscentHistory[];
  locked: { current: boolean };
  receiptTimer: { current: number | undefined };
}

const now = (): Date => new Date(dstr() + 'T00:00:00Z');
const pad = (n: number): string => (n < 10 ? '0' : '') + n;

/** Grade defs: value · data-g id (styles the border/label) · label. Keys 1–4. */
const GRADES: ReadonlyArray<{ g: Grade; id: string; label: string }> = [
  { g: 1, id: 'again', label: 'Again' },
  { g: 2, id: 'hard', label: 'Hard' },
  { g: 3, id: 'good', label: 'Good' },
  { g: 4, id: 'easy', label: 'Easy' },
];

function fireReceipt(S: AscSt, text: string, reduced: boolean): void {
  S.receipt.value = text;
  if (S.receiptTimer.current !== undefined) clearTimeout(S.receiptTimer.current);
  S.receiptTimer.current = window.setTimeout(() => {
    S.receipt.value = '';
  }, reduced ? 1400 : 1900);
}

function begin(S: AscSt): void {
  const sess = sessionForTopic(); // snapshot: the deck is frozen here for the run
  S.deckRef.current = sess.items as DeckItem[];
  S.sessRef.current = sess;
  S.history.length = 0;
  S.locked.current = false;
  S.cursor.value = 0;
  S.revealed.value = false;
  S.cardPhase.value = '';
  S.completed.value = 0;
  S.receipt.value = '';
  S.note.value = '';
  S.screen.value = sess.items.length === 0 ? 'caught' : 'card';
}

function doReveal(S: AscSt): void {
  if (S.revealed.value || S.locked.current) return;
  S.revealed.value = true;
}

/**
 * The grade → advance choreography. Applies the REAL grade (mastery + FSRS
 * schedule + log), then live-recolors the dot, fires a promotion receipt if a
 * mastery band was crossed upward, advances the rail, and runs the recede→enter
 * card swap — all on the one persistent node.
 */
function doGrade(S: AscSt, g: Grade, reduced: boolean): void {
  if (!S.revealed.value || S.locked.current) return;
  const deck = S.deckRef.current;
  const item = deck[S.cursor.value];
  if (!item) return; // guard BEFORE locking, so a bad index can't permanently brick the session
  S.locked.current = true;

  const K = kg();
  const beforeM = (K.mastery?.[item.id] ?? 0) as number;
  const beforeBand = bandOf(beforeM); // band BEFORE rate() — read now, compare after
  const preview = previewIntervals(readFsrs(K.srs?.[item.id]), now());

  knowledgeActions.rate(item.id, g); // verbatim: mastery + scheduleCard + log + core entry, bumps dataRev

  const afterM = GRADE_MASTERY[g];
  S.history.push({ id: item.id, startBand: beforeBand, grade: g });
  S.completed.value = S.history.length; // rail advances one notch (CSS .5s width)

  // Again/Hard reassurance — honest, from the REAL previewed interval (Again ≈ 1d
  // under enable_short_term:false, so "tomorrow", not the proto's "<10m / today").
  if (g === 1 || g === 2) {
    const d = preview[g].days;
    S.note.value = d <= 1 ? 'tomorrow' : 'in ' + preview[g].hint;
  } else {
    S.note.value = '';
  }

  if (bandOf(afterM) > beforeBand) fireReceipt(S, `${MWORD[beforeM]} → ${MWORD[afterM]} ↑`, reduced);

  const M = deck.length;
  const delay = reduced ? 120 : g === 1 || g === 2 ? 620 : 420;
  if (!reduced) S.cardPhase.value = 'recede';
  window.setTimeout(() => {
    const next = S.cursor.value + 1;
    if (next >= M) {
      S.receipt.value = '';
      S.screen.value = 'summit';
    } else {
      S.cursor.value = next;
      S.revealed.value = false;
      S.note.value = '';
      if (!reduced) S.cardPhase.value = 'enter'; // released by the reflow shim in useLayoutEffect
      S.locked.current = false;
    }
  }, delay);
}

/** min whole-days-to-next-due over the live SRS, or null if nothing is scheduled ahead. */
function nextDueInDays(): number | null {
  const K = kg();
  const today = dstr();
  let best = Infinity;
  const srs = (K.srs ?? {}) as Record<string, { due?: string }>;
  for (const id in srs) {
    const due = srs[id]?.due;
    if (typeof due === 'string' && due > today) {
      const d = daysBetween(today, due);
      if (d > 0 && d < best) best = d;
    }
  }
  return best === Infinity ? null : best;
}

const RefreshIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8FA3BE" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <polyline points="21 3 21 9 15 9" />
  </svg>
);

export function AscentSession() {
  dataRev.value; // leaf-subscription: a rate() bump live-recolors the mastery dot

  const stRef = useRef<AscSt>();
  if (!stRef.current) {
    // A topic review (`__review__:<id>`) and an interview deck (`__interview__:<preset>`)
    // launch straight into their capped deck — no Start panel; "Today's path" keeps the
    // Start → Begin intro. Same engine.
    const isReview = kgTopic.value.startsWith(REVIEW_PREFIX) || kgTopic.value.startsWith(INTERVIEW_PREFIX);
    const sess = sessionForTopic();
    const deck = sess.items as DeckItem[];
    const empty = deck.length === 0;
    stRef.current = {
      screen: signal<Screen>(empty ? 'caught' : isReview ? 'card' : 'start'),
      cursor: signal(0),
      cardPhase: signal<CardPhase>(''),
      revealed: signal(false),
      receipt: signal(''),
      note: signal(''),
      completed: signal(0),
      deckRef: { current: isReview ? deck : [] },
      sessRef: { current: isReview ? sess : null },
      history: [],
      locked: { current: false },
      receiptTimer: { current: undefined },
    };
  }
  const S = stRef.current;

  const reducedRef = useRef<boolean>();
  if (reducedRef.current === undefined) {
    reducedRef.current = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  const reduced = reducedRef.current;

  const cardRef = useRef<HTMLElement>(null);

  // Reflow shim (consensus §1): after the cursor bump renders the next card in its
  // 'enter' (offset/faded) state, force a reflow then release to '' so the enter
  // keyframe replays on THIS persistent node — every advance, not just the first.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || S.screen.value !== 'card') return;
    if (S.cardPhase.value === 'enter') {
      void el.offsetWidth;
      requestAnimationFrame(() => {
        S.cardPhase.value = '';
      });
    }
  }, [S.cursor.value]);

  // Keyboard: R reveals, 1–4 grade — but a focused textarea swallows them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (S.screen.value !== 'card') return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key === 'r' || e.key === 'R') {
        if (!S.revealed.value && tag !== 'TEXTAREA') doReveal(S);
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
        if (!S.revealed.value || tag === 'TEXTAREA') return;
        e.preventDefault();
        doGrade(S, Number(e.key) as Grade, reduced);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [S, reduced]);

  // Clear the receipt timer on unmount (back-out); the local signals die with it.
  useEffect(() => () => {
    if (S.receiptTimer.current !== undefined) clearTimeout(S.receiptTimer.current);
  }, [S]);

  const screen = S.screen.value;
  const deck = S.deckRef.current;
  const M = deck.length;
  const showTop = screen === 'card' || screen === 'summit';

  const item: DeckItem | undefined = screen === 'card' ? deck[S.cursor.value] : undefined;

  // top bar values
  const cur = screen === 'summit' ? M : S.cursor.value + 1;
  const pct = M ? (S.completed.value / M) * 100 : 0;
  const frontierLeft = Math.min(pct + 4, 99.5);
  const frontierOpacity = M > 0 && S.completed.value >= M ? 0 : 0.28;

  return (
    <div class="asc-app">
      {screen === 'start' && (
        <button class="asc-back asc-back-float" onClick={() => window.history.back()} aria-label="Back to topics">
          <span class="asc-chev" aria-hidden="true">‹</span> Back
        </button>
      )}
      {showTop && (
        <div class="asc-topbar">
          <div class="asc-track-row">
            {screen === 'card' && (
              <button class="asc-back" onClick={() => window.history.back()} aria-label="Back to topics">
                <span class="asc-chev" aria-hidden="true">‹</span> Back
              </button>
            )}
            <div class="asc-counter">
              <b>{pad(cur)}</b> / <span>{pad(M)}</span>
            </div>
            <div class="asc-rail-wrap">
              <div class="asc-rail">
                <div class="asc-rail-fill" style={`width:${pct}%`} />
                <div class="asc-frontier" style={`left:${frontierLeft}%;opacity:${frontierOpacity}`} title="new questions forming" />
              </div>
            </div>
          </div>
          <div class="asc-receipt-slot">
            <span class={'asc-receipt' + (S.receipt.value ? ' show' : '')}>{S.receipt.value}</span>
          </div>
        </div>
      )}

      <div class="asc-stage">
        {screen === 'start' && <StartPanel S={S} />}

        {screen === 'card' && item && <Card S={S} item={item} reduced={reduced} cardRef={cardRef} />}

        {screen === 'summit' && <SummitPanel S={S} key="summit" />}

        {screen === 'caught' && <CaughtPanel key="caught" />}
      </div>
    </div>
  );
}

function StartPanel({ S }: { S: AscSt }) {
  const count = sessionForTopic().items.length;
  return (
    <div class="asc-panel" key="start">
      <div class="asc-eyebrow">Today’s path</div>
      <h1>Today’s climb</h1>
      <div class="asc-bignum">
        <b>{count}</b> {count === 1 ? 'card' : 'cards'}
      </div>
      <p class="asc-lede">Due reviews across your topics, newest concepts mixed in.</p>
      <div class="asc-meta">Interleaved automatically · capped at 20 / day</div>
      <button class="asc-cta" onClick={() => begin(S)}>
        Begin the climb
      </button>
    </div>
  );
}

function Card({ S, item, reduced, cardRef }: { S: AscSt; item: DeckItem; reduced: boolean; cardRef: { current: HTMLElement | null } }) {
  const K = kg();
  const mVal = (K.mastery?.[item.id] ?? 0) as number;
  const mWord = MWORD[mVal];
  const mColor = MCOLOR[mVal];
  const isAttempt = item.flow !== 'flip';
  const topic = TOPIC_NAME[item.topic] ?? item.topic;
  const book = BOOKS[item.src.book];
  const srcLabel = book && book.t ? `${item.src.ref} · ${book.t}` : item.src.ref;
  // The main study surface never runs the VM merge — resolve the base book url here.
  const href = srcHref(item.src, book?.u);
  const practice = practiceLinks(item);
  const see = seeLinks(item);
  const preview = previewIntervals(readFsrs(K.srs?.[item.id]), now());
  const revealed = S.revealed.value;

  return (
    <article ref={cardRef as Any} class={'asc-card ' + S.cardPhase.value}>
      <div class="asc-pill-row">
        <span class="asc-pill">
          <span class="asc-dot" style={`background:${mColor}; box-shadow:0 0 8px ${mColor}66`} />
          <span class="asc-topic">{topic}</span>
          <span class="asc-sep">·</span>
          <span class="asc-mword" style={`color:${mColor}`}>
            {mWord}
          </span>
        </span>
        {(item as { ai?: boolean }).ai && <span class="asc-flowtag asc-ai" title="AI-generated — verify before trusting">✨ AI</span>}
        <span class="asc-flowtag">{isAttempt ? 'attempt' : 'flip'}</span>
      </div>

      <p class="asc-prompt">{item.prompt}</p>
      {href ? (
        <a class="asc-src" href={href} target="_blank" rel="noopener noreferrer">
          {srcLabel} ↗
        </a>
      ) : (
        <div class="asc-src">{srcLabel}</div>
      )}
      {practice.length > 0 && (
        <div class="asc-practice">
          <span class="asc-practice-lead">Practice ›</span>
          {practice.map((p) => (
            <a href={p.url} target="_blank" rel="noopener noreferrer">
              {p.label} ↗
            </a>
          ))}
        </div>
      )}
      {see.length > 0 && (
        <div class="asc-see">
          Also:{' '}
          {see.map((s, i) => (
            <>
              {i > 0 && ' · '}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </>
          ))}
        </div>
      )}

      <textarea placeholder="Write your answer…" aria-label="Your answer" />


      <div class={'asc-answer-wrap' + (revealed ? ' open' : '')}>
        <div class="asc-answer-inner">
          <div class="asc-answer">
            <div class="asc-bar" />
            <div>
              <div class="asc-label">Model answer</div>
              <div class="asc-body">{item.reveal}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="asc-actions">
        {!revealed ? (
          <button class="asc-btn-reveal" onClick={() => doReveal(S)}>
            Reveal <span class="asc-k">R</span>
          </button>
        ) : (
          <>
            <div class="asc-grades">
              {GRADES.map((gr, i) => (
                <button class="asc-grade" data-g={gr.id} style="position:relative" onClick={() => doGrade(S, gr.g, reduced)}>
                  <span class="asc-g">{gr.label}</span>
                  <span class="asc-hint">{preview[gr.g].hint}</span>
                  <span class="asc-knum" style="position:absolute;top:5px;right:7px">
                    {i + 1}
                  </span>
                </button>
              ))}
            </div>
            <div class="asc-again-note">
              {S.note.value && (
                <>
                  <RefreshIcon />
                  You’ll see this again {S.note.value}.
                </>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function SummitPanel({ S }: { S: AscSt }) {
  const L = ascentLedger(S.history);
  const overflow = S.sessRef.current?.overflow ?? 0;
  const nextDue = nextDueInDays();
  return (
    <div class="asc-panel" key="summit">
      <svg class="asc-summit-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M4 40 L20 12 L28 26 L34 18 L44 40 Z" stroke="#F2B25C" stroke-width="1.6" stroke-linejoin="round" fill="rgba(242,178,92,.08)" />
        <circle cx="20" cy="12" r="2.4" fill="#F2B25C" />
      </svg>
      <div class="asc-eyebrow">Summit</div>
      <h1>Done for today.</h1>
      <div class="asc-ledger">
        <span class="asc-c-solid">{L.solid} solid</span> <span class="asc-sep">·</span> <span class="asc-c-shaky">{L.shaky} shaky</span> <span class="asc-sep">·</span>{' '}
        <span class="asc-c-learn">{L.newlyLearned} newly learned</span>
      </div>
      {nextDue != null && (
        <div class="asc-meta">
          next due in <b style="color:var(--text)">{humanizeDays(nextDue)}</b>
        </div>
      )}
      {overflow > 0 && (
        <div class="asc-overflow">
          <span class="asc-plus">+{overflow}</span> waiting for tomorrow
        </div>
      )}
      <button class="asc-cta ghost" style="margin-top:10px" onClick={() => window.history.back()}>
        Back to topics
      </button>
    </div>
  );
}

function CaughtPanel() {
  const backlog = sessionForTopic().overflow;
  return (
    <div class="asc-panel" key="caught">
      <div class="asc-eyebrow">Rest day</div>
      <h1>Nothing due today.</h1>
      <p class="asc-lede">New questions are forming.</p>
      <div class="asc-frontier-hint">
        <span class="asc-pulse" /> frontier &nbsp;·&nbsp; {backlog > 0 ? `+${backlog} forming for tomorrow` : 'new questions forming'}
      </div>
      <button class="asc-cta ghost" style="margin-top:14px" onClick={() => window.history.back()}>
        Back to topics
      </button>
    </div>
  );
}
