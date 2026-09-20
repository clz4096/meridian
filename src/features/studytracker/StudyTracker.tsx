/**
 * Study Tracker view — "The Princeton Theorist". A faithful port of
 * ~/Brainstorm/meridian-tabs/princeton-theorist.html into Meridian's signals
 * idiom. All synced state lives in `trackerStore` (backed by the durable
 * `theorist` store); local view state (open sections, active sub-tab) lives in
 * uiState.ts. CSS is scoped under `.pt-root` (see studytracker.css). The
 * artifact's own light/dark handling is preserved; its global theme-toggle
 * button is dropped (Meridian owns the app theme).
 *
 * Layout: a persistent glance strip (today's XP hero + level + streak) sits
 * above a two-way segmented control — the Standard surface (Today) and Playbook.
 * The Standard surface is one continuous scroll of the brief's six surfaces in
 * literal 1–6 order (community readings, Princeton theory reading, algorithm of
 * the day, courses + psets, the daily schedule, the check-in); Playbook is the
 * sole secondary tab. Only the active tab's sections render.
 */
import { useEffect } from 'preact/hooks';
import { host } from '@/ui/host';
import {
  trackerState, ensureToday,
  LEVELS, SCHEDULE, SCORE, METERS, WEEKLY_TARGET, EVENT_WEIGHTS,
  dayXP, levelIndex, scoreTotal, meterPct,
  weeklySessions, stalestTopic, setDayType, markTopicReviewed, creditEvent,
  toggleBlock, setScore, toggleBank, resetDay, resetAll,
} from '@/features/studytracker/trackerStore';
import { CURRICULUM } from '@/features/studytracker/curriculum';
import { journalEntries, toggleReconstructed } from '@/features/studytracker/proofJournalStore';
import { activeTab, setTab, type TrackerTab } from '@/features/studytracker/uiState';
import { nowTick, startNowClock, currentBlockId } from '@/features/studytracker/now';
import { FeedSection } from '@/features/studytracker/FeedSection';
import { AlgoOfDay } from '@/features/studytracker/AlgoOfDay';
import { TeachSection } from '@/features/teaching/TeachSection';
import { CurriculumSection } from '@/features/studytracker/CurriculumSection';
import { PapersSection } from '@/features/studytracker/PapersSection';
import { ProofJournal } from '@/features/studytracker/ProofJournal';
import { PrincetonGroup } from '@/features/studytracker/PrincetonGroup';
import { Collapsible } from '@/features/studytracker/Collapsible';
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

/** External link that opens outside the PWA. */
function Ext({ href, children }: { href: string; children: preact.ComponentChildren }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function StudyTrackerView() {
  const s = trackerState.value; // subscribe
  const tab = activeTab.value; // subscribe
  nowTick.value; // subscribe to the ~45s clock (drives the schedule "now" highlight)

  useEffect(() => {
    ensureToday();
  }, []);
  useEffect(() => startNowClock(), []);

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

  // Spaced-return prompt: the single stalest signal to reconstruct from memory.
  const stale = stalestTopic();
  let retrieval: { label: string; run: () => void } | null = null;
  if (stale) {
    const course = CURRICULUM.find((c) => c.code === stale.id);
    const label = course ? `${course.code} — ${course.name}` : stale.id;
    // Mastery-only update + the single top retrieval payout (50). Deliberately
    // NOT reviewTopic, which would also credit topic-review (25) → 75 and break
    // "retrieval is the strictly highest single payout".
    retrieval = {
      label,
      run: () => { markTopicReviewed(stale.id); creditEvent('retrieval', EVENT_WEIGHTS.retrieval); },
    };
  } else {
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
        <div class="wrap mast-in">
          <img class="crest" src={crestUrl} alt="Princeton University shield" />
          <div>
            <h1>The Massey Standard</h1>
            <p class="tag">Rigor, performance, follow-through; scored like a game</p>
            <p class="fine">A personal homage; not affiliated with Princeton or Prof. Massey.</p>
            <details class="mast-about">
              <summary>About</summary>
              <div class="det-body">
                <p class="fine">A personal study rubric in homage to William A. Massey: Princeton mathematician (Class of 1977), queueing-theory pioneer at Bell Labs, co-founder of CAARMS, and in 2001 the first tenured African American mathematician in the Ivy League. Not affiliated with or endorsed by Princeton University or Professor Massey. Your progress saves in this browser.</p>
              </div>
            </details>
          </div>
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
        <div class="pt-tabs" role="tablist" aria-label="Study tracker sections">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              class={'pt-tab' + (tab === id ? ' on' : '')}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'today' && (
          <>
            {/* THE STANDARD SURFACE — one continuous scroll of the six surfaces
                in the brief's literal 1–6 order. The glance strip above is #0. */}

            {/* #1 COMMUNITY READINGS */}
            <FeedSection />

            {/* #2 PRINCETON THEORY READING */}
            <PrincetonGroup />

            {/* #3 ALGORITHM OF THE DAY (now default-open) */}
            <AlgoOfDay />

            {/* #3b LEARN BY TEACHING — an extension of surface #3's practice:
                teach the day's algorithm and defend it in AI office hours. */}
            <TeachSection />

            {/* #4 COURSES OF THE DAY + PSETS */}
            <CurriculumSection />

            {/* #5 PRINCETON BSE DAILY SCHEDULE (default open) */}
            <Collapsible id="schedule" eyebrow="The day" title="Tick each block as you finish it" defaultOpen={true}>
              <p class="hint">Eastern Time. Wake 9:00 AM, gym 3–5 PM, lights out 11:45 PM. The focus blocks point at the theory track: proofs and problem sets, algorithms in C++, and reproducing the week's paper. This is the day's shape; tick what you did.</p>
              <div class="rows">
                {SCHEDULE.map((r) => {
                  const done = !!s.day.blocks[r.id];
                  return (
                    <div key={r.id} class={'row' + (r.gym ? ' gym' : '') + (done ? ' done' : '') + (r.id === nowId ? ' now' : '')}>
                      <button class="tick" aria-pressed={done} aria-label={'Toggle: ' + r.title} onClick={() => toggleBlock(r.id)}>
                        {CHECK}
                      </button>
                      <div class="time">{r.time}</div>
                      <div class="what"><b>{r.title}</b><div class="sub">{r.sub}</div></div>
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

            {/* SCORECARD (default open) */}
            <Collapsible id="scorecard" eyebrow="Score" title="Rate today: missed, partial, met" defaultOpen={true}>
              <p class="hint">Missed, partial, or met. Your scores fill the five meters below. Score the practice, never a grade or exam result. An unrated line stays empty and does not count against you.</p>
              <div class="sc">
                {SCORE.map((r) => {
                  const raw = s.day.scores[r.id];
                  const rated = raw !== undefined;
                  return (
                    <div key={r.id} class="scrow">
                      <div class="txt"><b>{r.b}</b>{r.t}</div>
                      <div class="seg" role="group">
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

            {/* METERS — demoted here, under the scorecard where they're computed */}
            <div class="meters" role="group" aria-label="Score meters">
              {METERS.map(([name, ids]) => {
                const pct = meterPct(s.day, ids);
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

            {/* BONUS — beyond the six surfaces; placed AFTER the check-in so the
                literal 1–6 scroll stays contiguous. Collapsed by default. */}
            <PapersSection />
            <ProofJournal />
          </>
        )}

        {tab === 'playbook' && (
          <div class="pt-playbook">
            <details>
              <summary>The path, in three climbs</summary>
              <div class="det-body">
                <p><span class="phase-n">CLIMB 1 · FOUNDATIONS</span> <b>Proof and the mathematics.</b> Discrete math and induction, calculus, linear algebra, probability, real analysis. Build the habit of reconstructing a proof before you read it. See the Curriculum track in Library for the exact courses and problem sets.</p>
                <div class="boss"><b>Boss battle:</b> work a full problem set unaided; write one proof from memory.</div>
                <p><span class="phase-n">CLIMB 2 · ALGORITHMS</span> <b>Algorithms and data structures.</b> COS 226, MIT 6.006, then advanced algorithms (6.046 / COS 423). Implement each in C++, then port to Python; hunt lower bounds, not only upper bounds.</p>
                <div class="boss"><b>Boss battles:</b> finish the DSA courses; prove one non-trivial lower bound; reconstruct the Algorithm-of-the-Day catalogue from memory.</div>
                <p><span class="phase-n">CLIMB 3 · THEORY</span> <b>Computation and complexity.</b> Sipser's Theory of Computation, then Arora–Barak complexity. Read a foundational paper each week and reproduce one result. This is where the Princeton standard is built.</p>
                <div class="boss"><b>Boss battle:</b> reproduce a paper's central result, then extend it by one step.</div>
              </div>
            </details>

            <details>
              <summary>Gym playlist (3–5 PM, hands-free study)</summary>
              <div class="det-body">
                <ul>
                  <li><b><Ext href="https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/">MIT 18.06 Linear Algebra</Ext></b> — Strang's full video lectures.</li>
                  <li><b><Ext href="https://ocw.mit.edu/courses/18-404j-theory-of-computation-fall-2020/">MIT 18.404 Theory of Computation</Ext></b> — 26 videos by Sipser.</li>
                  <li><b>AWS video course</b> (freeCodeCamp or Maarek) during Phase 1.</li>
                  <li><b><Ext href="https://introtcs.org/">Barak, Intro to TCS</Ext></b> — free, made to read between sets. Plus Anki review.</li>
                </ul>
              </div>
            </details>

            <details>
              <summary>The study shelf — extras beyond the ladder</summary>
              <div class="det-body">
                <p class="hint">The full course ladder lives in the <b>Curriculum</b> section (Library). These are the shelf-only extras it doesn't cover.</p>
                <table>
                  <tr><th>Course</th><th>Builds</th></tr>
                  <tr><td><Ext href="https://www.coursera.org/specializations/algorithms">Stanford Algorithms</Ext></td><td>Algorithms — a second pass alongside 6.006 / 6.046J</td></tr>
                  <tr><td><Ext href="https://introtcs.org/">Barak, Intro to TCS</Ext></td><td>A gentle on-ramp to the group's complexity texts</td></tr>
                  <tr><td><Ext href="https://www.cs.princeton.edu/~hy2/teaching/fall25-cos521/index.html">Princeton COS 521</Ext></td><td>Advanced algorithm design — train on their gym</td></tr>
                  <tr><td><Ext href="https://www.cs.princeton.edu/courses/archive/spring25/cos445/">COS 445</Ext></td><td>Economics & computation / algorithmic game theory</td></tr>
                </table>
                <p class="hint">The group works in complexity, algorithms, cryptography, ML theory, and algorithmic game theory (faculty incl. Braverman, Tarjan, Raz, Weinberg, Kol, Yu, Dvir, Kothari, Lombardi, Arora). Theory Lunch: Fridays 12:15 PM.</p>
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
          <p>The Massey Standard · a personal daily instrument · saved locally in this browser</p>
        </div>
      </div>
    </div>
  );
}
