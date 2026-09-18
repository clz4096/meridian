/**
 * Study Tracker view — "The Princeton Theorist". A faithful port of
 * ~/Brainstorm/meridian-tabs/princeton-theorist.html into Meridian's signals
 * idiom. All state lives in `trackerStore` (namespaced localStorage). CSS is
 * scoped under `.pt-root` (see studytracker.css) so it cannot leak into other
 * views. The artifact's own light/dark handling is preserved; its global
 * theme-toggle button is dropped (Meridian owns the app theme).
 */
import { useEffect } from 'preact/hooks';
import { host } from '@/ui/host';
import {
  trackerState, ensureToday,
  LEVELS, SCHEDULE, SCORE, METERS,
  dayXP, levelIndex, scoreTotal, streakDays, streakCount,
  toggleBlock, setScore, bankToday, resetDay, resetAll,
} from '@/features/studytracker/trackerStore';
import { FeedSection } from '@/features/studytracker/FeedSection';
import crestUrl from '@/features/studytracker/princeton-shield.png';
import '@/features/studytracker/studytracker.css';

const fmt = (n: number): string => n.toLocaleString('en-US');
const SCORE_LABELS = ['Missed', 'Partial', 'Met'] as const;

const CHECK = (
  <svg viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width={3}>
    <path d="M4 10l4 4 8-9" />
  </svg>
);

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

  useEffect(() => {
    ensureToday();
  }, []);

  const idx = levelIndex(s.cumXP);
  const lv = LEVELS[idx]!;
  const next = LEVELS[idx + 1];
  const barPct = next ? Math.max(3, Math.round(((s.cumXP - lv[1]) / (next[1] - lv[1])) * 100)) : 100;
  const nextTxt = next ? `${fmt(next[1] - s.cumXP)} to ${next[0]}` : 'Top level reached';
  const today = dayXP(s.day);
  const streak = streakCount(s.logged);
  const streakBand = streak >= 5 ? 'green' : streak >= 3 ? 'amber' : 'red';

  const total = scoreTotal(s.day);
  const scWord = total >= 18 ? 'Excellent' : total >= 14 ? 'Solid' : total >= 9 ? 'Drifting' : 'Diagnose';
  const scBand = total >= 14 ? 'green' : total >= 9 ? 'amber' : 'red';

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
            <p class="fine">A personal study rubric in homage to William A. Massey: Princeton mathematician (Class of 1977), queueing-theory pioneer at Bell Labs, co-founder of CAARMS, and in 2001 the first tenured African American mathematician in the Ivy League. Not affiliated with or endorsed by Princeton University or Professor Massey. Your progress saves in this browser.</p>
          </div>
        </div>
      </div>

      <div class="wrap">
        {/* CONTROL PANEL */}
        <div class="panel" role="region" aria-label="Today's status">
          <div class="panel-top">
            <div class="medal">
              <div class="ring">
                <div class="lv">LEVEL</div>
                <div class="num">{idx + 1}</div>
              </div>
              <div class="ttl">{lv[0]}</div>
            </div>
            <div class="xpblock">
              <div class="xprow">
                <span class="big">{fmt(s.cumXP)} XP</span>
                <span class="nxt">{nextTxt}</span>
              </div>
              <div class="pbar"><span style={{ width: `${barPct}%` }} /></div>
              <div class="xprow" style={{ marginTop: '10px' }}>
                <span class="eyebrow">7-day streak</span>
              </div>
              <div class="streakwrap" style={{ padding: '8px 0 0', border: 0 }}>
                <div class="dots">
                  {streakDays(s.logged).map((d) => (
                    <div key={d.iso} class={'dot' + (d.on ? ' on' : '') + (d.today ? ' today' : '')} />
                  ))}
                </div>
                <span class={'band ' + streakBand}>{streak} / 7</span>
              </div>
            </div>
            <div class="today-xp">
              <div class="k">Today</div>
              <div class="v">{today}</div>
              <div class="k" style={{ color: 'var(--accent)' }}>XP</div>
            </div>
          </div>
          <div class="meters">
            {METERS.map(([name, ids]) => {
              const sum = ids.reduce((t, id) => t + (s.day.scores[id] || 0), 0);
              const pct = Math.round((sum / (ids.length * 2)) * 100);
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
          <div class="controls">
            <button class="primary" disabled={s.day.banked} onClick={bankToday}>
              {s.day.banked ? "Today's XP banked ✓" : 'Log today & bank XP'}
            </button>
            <button class="ghost" onClick={onResetDay}>Reset today</button>
            <button class="ghost" onClick={onResetAll}>Reset everything</button>
          </div>
        </div>

        {/* DAILY READING */}
        <FeedSection />

        {/* SCHEDULE */}
        <section>
          <div class="sec-h"><span class="eyebrow">The day</span><span class="n">Tick each block as you finish it</span></div>
          <p class="hint">Eastern Time. Wake 9:00 AM, gym 3–5 PM, lights out 11:45 PM. The focus blocks point at your current phase (right now: AWS). Ticking a block banks its XP for today.</p>
          <div class="rows">
            {SCHEDULE.map((r) => {
              const done = !!s.day.blocks[r.id];
              return (
                <div key={r.id} class={'row' + (r.gym ? ' gym' : '') + (done ? ' done' : '')}>
                  <button class="tick" aria-pressed={done} aria-label={'Toggle: ' + r.title} onClick={() => toggleBlock(r.id)}>
                    {CHECK}
                  </button>
                  <div class="time">{r.time}</div>
                  <div class="what"><b>{r.title}</b><div class="sub">{r.sub}</div></div>
                  <div class="xp">+{r.xp}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SCORECARD */}
        <section>
          <div class="sec-h"><span class="eyebrow">Score</span><span class="n">Rate today: missed, partial, met</span></div>
          <p class="hint">Missed, partial, or met. Your scores fill the five meters above. Score the practice, never a grade or exam result.</p>
          <div class="sc">
            {SCORE.map((r) => {
              const val = s.day.scores[r.id] || 0;
              return (
                <div key={r.id} class="scrow">
                  <div class="txt"><b>{r.b}</b>{r.t}</div>
                  <div class="seg" role="group">
                    {SCORE_LABELS.map((lbl, n) => (
                      <button key={n} class={val === n ? 'on' : ''} aria-pressed={val === n} aria-label={lbl} onClick={() => setScore(r.id, n)}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div class="scfoot">
            <span class="tot">{total} / 20</span>
            <span class={'band ' + scBand}>{scWord}</span>
          </div>
        </section>

        {/* REFERENCE */}
        <section>
          <div class="sec-h"><span class="eyebrow">Reference</span><span class="n">The playbook</span></div>

          <details>
            <summary>The three-phase ladder</summary>
            <div class="det-body">
              <p><span class="phase-n">PHASE 1 · NOW</span> <b>AWS Certified Cloud Practitioner (CLF-C02).</b> 65 questions (50 scored), 90 min, pass 700/1000, $100. Areas: Cloud Concepts 24%, Security &amp; Compliance 30%, Cloud Technology &amp; Services 34%, Billing/Pricing/Support 12%. ~20–40 study hours. Spine: <Ext href="https://skillbuilder.aws/">AWS Skill Builder</Ext> "Cloud Practitioner Essentials," a Maarek or freeCodeCamp course, official practice questions.</p>
              <div class="boss"><b>Boss battle:</b> book the exam, then pass it. A fail is data.</div>
              <p><span class="phase-n">PHASE 2 · NEXT</span> <b>WGU BS Software Engineering.</b> Competency-based, 6-month terms, ~$4,125/term flat (finishing more per term costs less overall). Objective + Performance assessments, not grades. ~39 courses incl. Data Structures &amp; Algorithms, discrete math, calculus, linear algebra. Bundles the <b>AWS Developer Associate</b> cert. 60% finish within 35 months; a focused pace can reach 12–24.</p>
              <div class="boss"><b>Boss battles:</b> clear 12+ units in a term; finish the DSA and math courses; graduate.</div>
              <p><span class="phase-n">PHASE 3 · THE CLIMB</span> <b>The full mathematics, to graduate theory</b> (see the study shelf). This is where the Princeton standard is built.</p>
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
            <summary>The study shelf (Phase 3, free)</summary>
            <div class="det-body">
              <table>
                <tr><th>#</th><th>Course</th><th>Builds</th></tr>
                <tr><td>0</td><td><Ext href="https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/">MIT 18.01</Ext>→<Ext href="https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/">18.02</Ext> Calculus</td><td>Foundation</td></tr>
                <tr><td>1</td><td><Ext href="https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-spring-2015/">6.042J Math for CS</Ext> + <Ext href="https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/">18.06 Linear Algebra</Ext></td><td>Proofs, discrete math, linear algebra</td></tr>
                <tr><td>2</td><td><Ext href="https://ocw.mit.edu/courses/6-041-probabilistic-systems-analysis-and-applied-probability-fall-2010/">6.041 Probability</Ext></td><td>Randomness</td></tr>
                <tr><td>3</td><td><Ext href="https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/">6.006</Ext>→<Ext href="https://ocw.mit.edu/courses/6-046j-design-and-analysis-of-algorithms-spring-2015/">6.046J</Ext> + <Ext href="https://www.coursera.org/specializations/algorithms">Stanford Algorithms</Ext></td><td>Algorithms</td></tr>
                <tr><td>4</td><td><Ext href="https://ocw.mit.edu/courses/18-404j-theory-of-computation-fall-2020/">18.404 Theory of Computation</Ext> + <Ext href="https://ocw.mit.edu/courses/18-100a-real-analysis-fall-2020/">18.100A Real Analysis</Ext></td><td>Computability, complexity, rigor</td></tr>
                <tr><td>5</td><td><Ext href="https://introtcs.org/">Barak, Intro to TCS</Ext> → <Ext href="https://theory.cs.princeton.edu/complexity/">Arora–Barak, Complexity</Ext></td><td>The group's own texts</td></tr>
                <tr><td>6</td><td><Ext href="https://www.cs.princeton.edu/~hy2/teaching/fall25-cos521/index.html">Princeton COS 521</Ext> problem sets; COS 522; <Ext href="https://www.cs.princeton.edu/courses/archive/spring25/cos445/">COS 445</Ext></td><td>Train on their gym</td></tr>
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
        </section>

        <div class="app-foot">
          <p>The Massey Standard · a personal daily instrument · saved locally in this browser</p>
        </div>
      </div>
    </div>
  );
}
