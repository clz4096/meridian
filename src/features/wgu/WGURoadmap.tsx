/**
 * WGU Roadmap view — a read-only week-by-week finish plan with a persistent
 * per-course "done" checkbox. Ported from ~/Brainstorm/meridian-tabs/wgu-roadmap.html.
 * Content lives in roadmapData; checkbox state in roadmapStore (namespaced
 * localStorage). CSS scoped under `.wgu-root` so it cannot leak.
 */
import { roadmapChecks, toggleCourse } from '@/features/wgu/roadmapStore';
import {
  HEADER, DAY1, WEEKS, WHY_ORDER, PROGRESS, CAVEATS, FOOTER,
} from '@/features/wgu/roadmapData';
import '@/features/wgu/wgu.css';

export function WGURoadmapView() {
  const checks = roadmapChecks.value; // subscribe

  return (
    <div class="wgu-root">
      <div class="wrap">
        <header class="top">
          <p class="eyebrow">{HEADER.eyebrow}</p>
          <h1>{HEADER.title}</h1>
          <div class="stats">
            {HEADER.stats.map(([k, v]) => (
              <span key={k}><b>{k}</b> {v}</span>
            ))}
          </div>
        </header>

        <div class="callout">
          <h3>Do these three things on Day 1 (they have lead time)</h3>
          <ol class="actions">
            {DAY1.map((t) => <li key={t}>{t}</li>)}
          </ol>
        </div>

        <div class="legend">
          <span class="chip oa">OA exam</span>
          <span class="chip cert">External cert exam</span>
          <span class="chip pa">Project (PA)</span>
          <span class="chip cap">Capstone</span>
        </div>

        <h2>The plan, week by week</h2>

        {WEEKS.map((wk) => (
          <section class="week" key={wk.n}>
            <div class="week__head">
              <span class="week__n">{wk.n}</span>
              <span class="week__dates">{wk.dates}</span>
              <span class="week__theme">{wk.theme}</span>
            </div>
            {wk.courses.map((c) => (
              <div class="course" key={c.code}>
                <input
                  type="checkbox"
                  checked={!!checks[c.code]}
                  onChange={() => toggleCourse(c.code)}
                  aria-label={`${c.code} done`}
                />
                <div class="course__body">
                  <div class="course__title">
                    <span class="course__code">{c.code}</span>
                    <span class="course__name">{c.name}</span>
                    <span class={'chip ' + c.chip}>{c.chipLabel}</span>
                  </div>
                  <p class="kv"><b>Do</b> {c.doText}</p>
                  <p class="kv"><b>Done</b> {c.doneText}</p>
                  <p class="links">
                    {c.links.map((l, i) => (
                      <span key={l.href}>
                        {i > 0 ? ' · ' : ''}
                        <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            ))}
            {wk.admin && <p class="sub">{wk.admin}</p>}
          </section>
        ))}

        <h2>Why this order</h2>
        <ol class="logic">
          {WHY_ORDER.map(([b, t]) => (
            <li key={b}><b>{b}</b>{t}</li>
          ))}
        </ol>

        <h2>Progress</h2>
        <ul class="check">
          {PROGRESS.map(([code, label]) => (
            <li key={code}>
              <input
                type="checkbox"
                checked={!!checks[code]}
                onChange={() => toggleCourse(code)}
                aria-label={`${code} done`}
              />
              <span><span class="c">{code}</span> {label}</span>
            </li>
          ))}
        </ul>

        <h2>Honest caveats</h2>
        <ul class="caveats">
          {CAVEATS.map(([b, t]) => (
            <li key={b}><b>{b}</b>{t}</li>
          ))}
        </ul>

        <footer>{FOOTER}</footer>
      </div>
    </div>
  );
}
