/**
 * Study Tracker view: "The Cambridge Method". The scoring system is adapted
 * from the Massey Standard (the tracker's earlier name): XP, levels, the daily
 * scorecard, the five meters and the weekly-session ring are unchanged. What
 * changed is the study content it points at: the retired Princeton curriculum,
 * problem set of the week, theory group and proof journal are gone from the UI,
 * and Deep Blocks 1 and 3 now name the current Cambridge item and loop step.
 * All synced state lives in `trackerStore` (backed by the durable `theorist`
 * store) and the `cambridge` store; local view state (open sections, active
 * sub-tab) lives in uiState.ts. CSS is scoped under `.pt-root`
 * (see studytracker.css).
 *
 * Layout: a persistent glance strip (today's XP hero + level + weekly ring) sits
 * above a two-way segmented control, Today and Playbook. Only the active tab's
 * sections render.
 */
import { useEffect } from 'preact/hooks';
import { host } from '@/ui/host';
import { dataRev } from '@/ui/store';
import {
  trackerState, ensureToday,
  LEVELS, SCHEDULE, SCORE, METERS, CAM_METERS, WEEKLY_TARGET, EVENT_WEIGHTS,
  dayXP, levelIndex, scoreTotal, meterPct,
  weeklySessions, setDayType, creditEvent,
  toggleBlock, setScore, toggleBank, resetDay, resetAll,
} from '@/features/studytracker/trackerStore';
import { journalEntries, toggleReconstructed } from '@/features/studytracker/proofJournalStore';
import { activeTab, setTab, type TrackerTab } from '@/features/studytracker/uiState';
import { nowTick, startNowClock, currentBlockId } from '@/features/studytracker/now';
import { FeedSection } from '@/features/studytracker/FeedSection';
import { AlgoOfDay } from '@/features/studytracker/AlgoOfDay';
import { TeachSection } from '@/features/teaching/TeachSection';
import { PapersSection } from '@/features/studytracker/PapersSection';
import { Collapsible } from '@/features/studytracker/Collapsible';
import { CambridgeWeek } from '@/features/studytracker/CambridgeWeek';
import { cambridgeMeterInput, overrideWeekScore, weekScorecard, type WeekScorecard } from '@/features/cambridge/scorecard';
import { cambridgeReady, putWeek, readCambridge } from '@/features/cambridge/store';
import { hm, isOffline, lastSaved, retryScreen, useReady, write } from '@/features/cambridge/camUi';
import { gloss } from '@/features/cambridge/Gloss';
import { openCam } from '@/features/cambridge/nav';
import type { CamWeekItem } from '@/features/cambridge/types';
import type { TrackerCambridge } from '@/features/cambridge/trackerLink';
import { lazyMod } from '@/features/today/lazyContent';
import crestUrl from '@/features/studytracker/princeton-shield.png';
import '@/features/studytracker/studytracker.css';

const fmt = (n: number): string => n.toLocaleString('en-US');
const SCORE_LABELS = ['Missed', 'Partial', 'Met'] as const;

const CHECK = (
  <svg viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width={3}>
    <path d="M4 10l4 4 8-9" />
  </svg>
);

const TABS: ReadonlyArray<readonly [TrackerTab, string]> = [
  ['today', 'Today'],
  ['playbook', 'Playbook'],
];

/** Only the selected panel is rendered, so both tabs control the one panel id. */
const TAB_PANEL = 'pt-tabpanel';

/**
 * Arrow keys, Home and End move between tabs and select on focus (the WAI-ARIA
 * automatic-activation pattern): switching is instant and cheap here, and the
 * roving tabIndex means Tab alone would otherwise skip the unselected tab.
 */
function onTabKey(e: KeyboardEvent): void {
  const i = TABS.findIndex(([id]) => id === activeTab.value);
  const n = TABS.length;
  const next =
    e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
  if (next < 0) return;
  e.preventDefault();
  const id = TABS[next]![0];
  setTab(id);
  document.getElementById('pt-tab-' + id)?.focus();
}

/**
 * The Playbook's path summary and the Deep Block text read the Cambridge
 * catalog, which is too big for this chunk's first paint: it loads with
 * import(), and the static SCHEDULE text shows until it arrives.
 */
const camLink = lazyMod(() => import('@/features/cambridge/trackerLink'));

/** External link that opens outside the PWA. */
function Ext({ href, children }: { href: string; children: preact.ComponentChildren }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** The weekly card for a store state, or null when it can't be read (the card shows its error state). */
function readWeek(now: number): WeekScorecard | null {
  try {
    return weekScorecard(readCambridge(), now);
  } catch {
    return null;
  }
}

export function StudyTrackerView({ camReady = cambridgeReady }: { camReady?: Promise<void> } = {}) {
  const s = trackerState.value; // subscribe
  const tab = activeTab.value; // subscribe
  nowTick.value; // subscribe to the ~45s clock (drives the schedule "now" highlight)
  dataRev.value; // subscribe: Cambridge writes and sync pulls re-derive the week and the blocks
  const camStatus = useReady(camReady);

  useEffect(() => {
    ensureToday();
  }, []);
  useEffect(() => startNowClock(), []);
  useEffect(() => void camLink.load(), []);

  // Nothing Cambridge is read before the store has loaded (and, on a first run,
  // the Massey backup is taken), so an early render never shows an empty week.
  const nowMs = Date.now();
  const camReadyNow = camStatus === 'ready';
  const week = camReadyNow ? readWeek(nowMs) : null;
  // Null (no Cambridge work this week) leaves Focus and Progress exactly as before.
  const camMeter = week ? cambridgeMeterInput(week) : null;
  let link: TrackerCambridge | null = null;
  let linkFailed = camLink.failed.value || camStatus === 'failed';
  const linkMod = camLink.mod.value;
  if (camReadyNow && linkMod) {
    try {
      link = linkMod.trackerCambridge(readCambridge(), nowMs);
    } catch {
      linkFailed = true;
    }
  }
  const blockText = (id: string): { title: string; sub: string } | undefined =>
    id === 'b4' || id === 'b7' ? link?.blocks?.[id] : undefined;
  const setWeek = (item: CamWeekItem, value: 0 | 1 | 2): void => {
    write(() => overrideWeekScore(item, value));
  };
  // A partial override would be zero-filled by import, so Reset writes the
  // line's auto value back into the stored week rather than removing it.
  const resetWeek = (item: CamWeekItem): void => {
    if (!week) return;
    write(() => putWeek({ week: week.week, scores: { ...week.scores, [item]: week.auto[item] } }));
  };

  const idx = levelIndex(s.cumXP);
  const lv = LEVELS[idx]!;
  const next = LEVELS[idx + 1];
  const barPct = next ? Math.max(3, Math.round(((s.cumXP - lv[1]) / (next[1] - lv[1])) * 100)) : 100;
  const nextTxt = next ? `${fmt(next[1] - s.cumXP)} to ${next[0]}` : 'Top level reached';
  const today = dayXP(s.day);
  // Weekly-session ring replaces the old 7-day streak + red band: a supportive
  // "sessions this week" gauge, never a punishing miss. A light/Sabbath day
  // still counts (at a lower bar) and shows a chip instead of a gap.
  const entries = journalEntries.value; // subscribe (spaced-return fallback)
  const sessions = weeklySessions();
  const RING_R = 22;
  const RING_C = 2 * Math.PI * RING_R;
  const weekFrac = Math.min(1, WEEKLY_TARGET > 0 ? sessions / WEEKLY_TARGET : 0);
  const isLight = s.day.dayType === 'light';

  // Spaced-return prompt: the oldest journal entry not yet reconstructed. The
  // decayed-course branch is retired with the Princeton curriculum: every key in
  // `mastery` is a retired course code, so it would only ever surface a course
  // the plan no longer has. The mastery data itself stays in the store.
  let retrieval: { label: string; run: () => void } | null = null;
  const cutoff = Date.now() - 14 * 86_400_000;
  const old = entries.filter((e) => e.at < cutoff && !e.reconstructed);
  if (old.length) {
    const oldest = old.reduce((a, b) => (a.at <= b.at ? a : b));
    retrieval = {
      label: oldest.title,
      // Key the retrieval credit per entry so a second distinct cold
      // reconstruction still pays (a fixed id would cap the day at one).
      run: () => { toggleReconstructed(oldest.id); creditEvent('journal:retrieval:' + oldest.id, EVENT_WEIGHTS.retrieval); },
    };
  }

  const total = scoreTotal(s.day);
  const scWord = total >= 18 ? 'Excellent' : total >= 14 ? 'Solid' : total >= 9 ? 'Drifting' : 'Diagnose';
  const scBand = total >= 14 ? 'green' : total >= 9 ? 'amber' : 'red';

  const nowId = currentBlockId(SCHEDULE);

  const onResetDay = () => {
    if (host.confirm("Clear today's ticks and scores? Banked XP stays.")) resetDay();
  };
  const onResetAll = () => {
    if (host.confirm('Erase all progress: XP, level, streak, and today? This cannot be undone.')) resetAll();
  };

  return (
    <div class="pt-root">
      <div class="masthead">
        <div class="wrap">
          <h1>The Cambridge Method</h1>
          <p class="fine pt-credit">Scoring system adapted from the Massey Standard</p>
          <p class="tag">Rigor, performance, follow-through; scored like a game</p>
          {/* The crest and homage are the history of the rubric, kept under About. */}
          <details class="mast-about">
            <summary>About the scoring</summary>
            <div class="det-body mast-in">
              <img class="crest" src={crestUrl} alt="Princeton University shield" />
              <div>
                <p class="fine">The scoring is a personal study rubric in homage to William A. Massey: Princeton mathematician (Class of 1977), queueing-theory pioneer at Bell Labs, co-founder of CAARMS, and in 2001 the first tenured African American mathematician in the Ivy League. Not affiliated with or endorsed by Princeton University, the University of Cambridge, or Professor Massey. Your progress saves in this browser.</p>
              </div>
            </div>
          </details>
        </div>
      </div>

      <div class="wrap">
        {/* GLANCE STRIP — today's XP hero, with level + 7-day streak as satellites */}
        <div class="pt-glance" role="region" aria-label="Today's status">
          <div class="pt-glance-hero">
            <div class="v">{today}</div>
            <div class="k">XP today</div>
          </div>
          <div class="pt-glance-sats">
            <div class="pt-glance-lv">Lv {idx + 1} · {lv[0]}</div>
            <div class="xprow">
              <span class="eyebrow">{fmt(s.cumXP)} XP</span>
              <span class="nxt">{nextTxt}</span>
            </div>
            <div class="pbar"><span style={{ width: `${barPct}%` }} /></div>
          </div>
          <div class="pt-glance-week">
            <div class="pt-ring" role="img" aria-label={`${sessions} of ${WEEKLY_TARGET} sessions this week`}>
              <svg viewBox="0 0 52 52" width="52" height="52">
                <circle class="pt-ring-track" cx="26" cy="26" r={RING_R} fill="none" stroke-width="6" />
                <circle
                  class="pt-ring-fill"
                  cx="26" cy="26" r={RING_R} fill="none" stroke-width="6"
                  stroke-dasharray={RING_C}
                  stroke-dashoffset={RING_C * (1 - weekFrac)}
                  transform="rotate(-90 26 26)"
                />
              </svg>
              <span class="pt-ring-num">{sessions}/{WEEKLY_TARGET}</span>
            </div>
            <span class="pt-week-lbl">this week</span>
            {isLight && <span class="pt-light-chip">Light day</span>}
          </div>
        </div>

        {/* SUB-TAB SEGMENTED CONTROL */}
        <div class="pt-tabs" role="tablist" aria-label="Study tracker sections" onKeyDown={onTabKey}>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              id={'pt-tab-' + id}
              class={'pt-tab' + (tab === id ? ' on' : '')}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={TAB_PANEL}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'today' && (
          <div role="tabpanel" id={TAB_PANEL} aria-labelledby="pt-tab-today">
            {/* One continuous scroll; the glance strip above is #0. */}

            {/* #1 READING: the community feed, collapsed */}
            <FeedSection />

            {/* #3 ALGORITHM OF THE DAY (now default-open) */}
            <AlgoOfDay />

            {/* #3b LEARN BY TEACHING — an extension of surface #3's practice:
                teach the day's algorithm and defend it in AI office hours. */}
            <TeachSection />

            {/* #4 THE DAILY SCHEDULE (default open). Blocks 1 and 3 follow the
                current Cambridge item; their ids never change, so stored ticks hold. */}
            <Collapsible id="schedule" eyebrow="The day" title="Tick each block as you finish it" defaultOpen={true}>
              <p class="hint">{gloss("Eastern Time. Wake 9:00 AM, gym 3 to 5 PM, lights out 11:45 PM. Deep Blocks 1 and 3 follow your current Cambridge item and its loop step: cold attempt, write-up, supervision or redo. Block 2 is the algorithm of the day in C++. This is the day's shape; tick what you did.")}</p>
              <div class="rows">
                {SCHEDULE.map((r) => {
                  const done = !!s.day.blocks[r.id];
                  const { title, sub } = blockText(r.id) ?? r;
                  return (
                    <div key={r.id} class={'row' + (r.gym ? ' gym' : '') + (done ? ' done' : '') + (r.id === nowId ? ' now' : '')} data-block={r.id}>
                      <button class="tick" aria-pressed={done} aria-label={'Toggle: ' + title} onClick={() => toggleBlock(r.id)}>
                        {CHECK}
                      </button>
                      <div class="time">{r.time}</div>
                      <div class="what"><b>{gloss(title)}</b><div class="sub">{gloss(sub)}</div></div>
                    </div>
                  );
                })}
              </div>
            </Collapsible>

            {/* #6 THE CHECK-IN — scorecard + meters + XP bank + weekly ring.
                Day-type and the spaced-return prompt lead the day-level cluster. */}

            {/* DAY TYPE — Full / Light (auto-Light in the Sabbath window; override here) */}
            <div class="pt-daytype" role="group" aria-label="Day type">
              <span class="pt-daytype-lbl">Today is a</span>
              <button class={'pt-daytype-btn' + (!isLight ? ' on' : '')} type="button" aria-pressed={!isLight} onClick={() => setDayType('full')}>Full day</button>
              <button class={'pt-daytype-btn' + (isLight ? ' on' : '')} type="button" aria-pressed={isLight} onClick={() => setDayType('light')}>Light day</button>
            </div>

            {/* SPACED RETURN — the single stalest signal to reconstruct from memory */}
            {retrieval && (
              <div class="pt-retrieval" role="region" aria-label="Spaced return">
                <div class="pt-retrieval-lbl">Reconstruct from memory</div>
                <div class="pt-retrieval-topic">{retrieval.label}</div>
                <button class="primary" type="button" onClick={retrieval.run}>I re-derived it ✓</button>
              </div>
            )}

            {/* SCORECARDS: today's, and beside it (below it on a phone) this week's Cambridge card */}
            <div class="pt-scpair">
            <Collapsible id="scorecard" eyebrow="Score" title="Rate today: missed, partial, met" defaultOpen={true}>
              <p class="hint">{gloss("Missed, partial, or met. Your scores fill the five meters below. Score the practice, never a grade or exam result. An unrated line stays empty and does not count against you.")}</p>
              <div class="sc">
                {SCORE.map((r) => {
                  const raw = s.day.scores[r.id];
                  const rated = raw !== undefined;
                  return (
                    <div key={r.id} class="scrow">
                      <div class="txt"><b>{r.b}</b>{gloss(r.t)}</div>
                      <div class="seg" role="group" aria-label={r.b.replace(/:\s*$/, '')}>
                        {SCORE_LABELS.map((lbl, n) => {
                          const on = rated && raw === n;
                          return (
                            <button key={n} class={on ? 'on' : ''} aria-pressed={on} aria-label={lbl} onClick={() => setScore(r.id, n)}>
                              {lbl}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div class="scfoot">
                <span class="tot">{total} / 20</span>
                <span class={'band ' + scBand}>{scWord}</span>
              </div>
            </Collapsible>
            <CambridgeWeek
              status={camStatus === 'failed' ? 'failed' : camReadyNow ? 'ready' : 'loading'}
              card={week}
              savedAt={camReadyNow ? lastSaved(readCambridge()) : 0}
              onSet={setWeek}
              onReset={resetWeek}
            />
            </div>

            {/* METERS, under the scorecards they're computed from. Focus and
                Progress add this week's Cambridge card as one more line once
                there is Cambridge work (trackerStore.meterPct). */}
            <div class="meters" role="group" aria-label="Score meters">
              {METERS.map(([name, ids]) => {
                const pct = meterPct(s.day, ids, CAM_METERS.has(name) ? camMeter : null);
                return (
                  <div key={name} class="meter">
                    <div class="lbl">
                      <span>{name}</span>
                      <span class="pct">{pct}%</span>
                    </div>
                    <div class="mbar"><span style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>

            {/* DAILY ACTION — bank today's XP */}
            <div class="controls">
              <button class={'primary' + (s.day.banked ? ' banked' : '')} onClick={toggleBank}>
                {s.day.banked ? 'Banked ✓ — tap to unbank' : 'Log today & bank XP'}
              </button>
            </div>

            {/* BONUS, after the check-in. Collapsed by default. The proof journal's
                entries stay readable in the error log's Archived journal. */}
            <PapersSection />
          </div>
        )}

        {tab === 'playbook' && (
          <div class="pt-playbook" role="tabpanel" id={TAB_PANEL} aria-labelledby="pt-tab-playbook">
            <CamPathSummary link={link} failed={linkFailed} loading={!link && !linkFailed} />

            <details>
              <summary>Gym playlist (3–5 PM, hands-free study)</summary>
              <div class="det-body">
                <ul>
                  {/* Named by lecturer, not course code: the retired Princeton plan's codes no longer appear in the tracker. */}
                  <li><b><Ext href="https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/">Strang, Linear Algebra</Ext></b>: the full video lectures (MIT OpenCourseWare).</li>
                  <li><b><Ext href="https://ocw.mit.edu/courses/18-404j-theory-of-computation-fall-2020/">Sipser, Theory of Computation</Ext></b>: 26 videos (MIT OpenCourseWare).</li>
                  <li><b>AWS video course</b> (freeCodeCamp or Maarek) during Phase 1.</li>
                  <li><b><Ext href="https://introtcs.org/">Barak, Intro to TCS</Ext></b> — free, made to read between sets. Plus Anki review.</li>
                </ul>
              </div>
            </details>

            <details>
              <summary>House rules &amp; traps</summary>
              <div class="det-body">
                <ul>
                  <li><b>Points are a mirror, not a prize.</b> XP is feedback on the day, never the reason to work.</li>
                  <li><b>Score what you control</b> (blocks, proofs, problems), never grades or scores.</li>
                  <li><b>Recovery scores like work.</b> You cannot win by overworking.</li>
                  <li><b>The streak never punishes you</b> — rest days do not break it; a miss never zeroes progress.</li>
                  <li><b>Process words only:</b> "I fought the problem," never "I am a genius." Hard work is the engine.</li>
                  <li><b>Red line:</b> 7–9 hours of sleep; keep the week under about 55 focused hours.</li>
                </ul>
                <p><b>Traps:</b> passive video/re-reading (test yourself instead) · chasing a grade or rating (score the practice) · reading proofs without re-deriving (reconstruct first) · only upper bounds (hunt lower bounds) · fleeing when stuck (sit in it) · sleep debt (protect it) · coasting on being smart (practice at the edge).</p>
              </div>
            </details>

            <details>
              <summary>Words &amp; sources</summary>
              <div class="det-body">
                <p><b>Morning:</b> What do I value about this work beyond a grade? Who am I today — someone who reconstructs and trusts nothing? What is worth sitting in the dark for?</p>
                <p><b>Evening (pick one true):</b> "I sat in stuck without fleeing." · "I reconstructed a proof before reading it." · "I showed up before I felt ready." · "You do not have to be a genius; hard work directed by intuition is the engine."</p>
                <p class="hint">Design evidence: self-monitoring improves goal attainment (Harkin 2016); if-then plans (Gollwitzer 1999); external rewards can undermine intrinsic motivation, so XP is feedback (Deci, Koestner &amp; Ryan 1999); values &amp; process affirmation, not generic praise (Cohen &amp; Sherman 2014; Wood 2009; Mueller &amp; Dweck 1998); hard work over genius (Tao); sleep and sustainable hours (NSF 2015; Pencavel 2015); daily over binge (Boice 1990). Facts verified from AWS CLF-C02 and WGU BSSE guides, MIT OCW, Coursera, and theory.cs.princeton.edu. Rosters and course offerings change; confirm on the live pages. Charikar (Stanford) and Barak (Harvard) are theory-lineage, not current Princeton faculty.</p>
              </div>
            </details>

            {/* RELOCATED RESET CONTROLS — out of the daily cluster */}
            <div class="controls">
              <button class="ghost" onClick={onResetDay}>Reset today</button>
            </div>
            <details>
              <summary>Reset everything</summary>
              <div class="det-body">
                <p class="hint">Erase all progress: XP, level, streak, and today. This cannot be undone, and the wipe propagates across your devices.</p>
                <button class="ghost" onClick={onResetAll}>Reset everything</button>
              </div>
            </details>
          </div>
        )}

        <div class="app-foot">
          <p>The Cambridge Method · a personal daily instrument · saved locally in this browser</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The Playbook's compact Cambridge path: phase, current item and loop step, and
 * supervisions this week, with a way into the full path screen. It reads the
 * same summary as Today's Math card, so the two never disagree.
 */
function CamPathSummary({ link, failed, loading }: { link: TrackerCambridge | null; failed: boolean; loading: boolean }) {
  const saved = isOffline() ? lastSaved(readCambridge()) : 0;
  return (
    <section class="pt-campath" aria-labelledby="pt-campath-h">
      <div class="pt-campath-top">
        <span class="eyebrow">The path</span>
        {isOffline() && (
          <span class="m-state m-num" data-kind="offline">
            Offline{saved ? ` · Saved ${hm(saved)}` : ''}
          </span>
        )}
      </div>
      <h2 class="pt-campath-h" id="pt-campath-h">The Cambridge Method</h2>
      {failed ? (
        <div class="m-state" data-kind="error" role="alert">
          <p class="m-state-title">The Cambridge path didn't load.</p>
          <p class="m-state-body">Check your connection, then try again.</p>
          <button class="m-btn" type="button" onClick={retryScreen}>
            Try again
          </button>
        </div>
      ) : loading || !link ? (
        <div aria-busy="true" aria-label="Loading the Cambridge path">
          <span class="m-skel m-skel-line" />
          <span class="m-skel m-skel-line" />
        </div>
      ) : (
        <>
          <p class="pt-campath-phase">{gloss(link.summary.course)}</p>
          <p class="pt-campath-next">
            <span class="pt-campath-lbl">Next</span>
            <span>{gloss(link.summary.next.label)}</span>
          </p>
          {link.summary.next.detail && <p class="hint">{gloss(link.summary.next.detail)}</p>}
          <p class="pt-campath-sup m-num">{gloss(link.summary.progress.caption)}</p>
        </>
      )}
      <button class="primary" type="button" onClick={() => openCam('cambridge')}>
        Open the Cambridge path
      </button>
    </section>
  );
}
