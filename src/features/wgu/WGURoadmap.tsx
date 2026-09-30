/**
 * WGU Roadmap view: a read-only week-by-week finish plan with a persistent
 * per-course "done" checkbox. Ported from ~/Brainstorm/meridian-tabs/wgu-roadmap.html.
 * Content lives in roadmapData; checkbox state in roadmapStore (namespaced
 * localStorage). Styles live in wgu.css, on the global tokens only.
 */
import { roadmapChecks, toggleCourse } from '@/features/wgu/roadmapStore';
import {
  HEADER, DAY1, WEEKS, WHY_ORDER, PROGRESS, CAVEATS, FOOTER, CHIP_LABEL,
  type Chip,
} from '@/features/wgu/roadmapData';
import { summarize } from '@/features/paths/wgu';
import { pct } from '@/features/paths/types';
import { PageHead } from '@/ui/components/PageHead';
import '@/features/wgu/wgu.css';

const CHIPS: readonly Chip[] = ['oa', 'cert', 'pa', 'cap'];

/**
 * The path's one next action, on top of the full plan. Built from the same
 * summarize() Today's card uses, so the two can never disagree.
 */
function TodayHeader({ checks }: { checks: Record<string, boolean> }) {
  const s = summarize(new Date(), checks);
  const { done, total, caption } = s.progress;
  const count = `${done} of ${total} courses`;
  return (
    <section class="m-card wgu-today" aria-labelledby="wgu-today">
      <p class="m-label" id="wgu-today">Today</p>
      {s.course && <p class="wgu-today-course">{s.course}</p>}
      <p class="wgu-today-next">{s.next.label}</p>
      {s.next.detail && <p class="wgu-today-detail">{s.next.detail}</p>}
      <div
        class="m-progress wgu-today-bar"
        role="progressbar"
        aria-label="WGU progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={count}
      >
        <div class="m-progress-fill" style={{ '--m-progress': `${pct(done, total)}%` }} />
      </div>
      <p class="m-num wgu-today-cap">
        {count} · {caption}
      </p>
    </section>
  );
}

/**
 * A native checkbox stretched to the full 44px target and made transparent, over a
 * drawn 22px box. The input stays the real control, so keyboard, form semantics and
 * the accessible name all come from the platform.
 */
function Check({ id, code, checked }: { id: string; code: string; checked: boolean }) {
  return (
    <span class="wgu-box">
      <input
        id={id}
        class="wgu-check"
        type="checkbox"
        checked={checked}
        onChange={() => toggleCourse(code)}
      />
      <span class="wgu-mark" aria-hidden="true" />
    </span>
  );
}

export function WGURoadmapView() {
  const checks = roadmapChecks.value; // subscribe

  return (
    <div class="wgu-root">
      <PageHead title={HEADER.title} note="WGU" />
      <TodayHeader checks={checks} />

      <div class="wgu-top">
        <p class="wgu-degree">{HEADER.eyebrow}</p>
        <dl class="wgu-stats">
          {HEADER.stats.map(([k, v]) => (
            <div key={k}>
              <dt class="m-label">{k}</dt>
              <dd class="m-num">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <section class="m-card wgu-callout" aria-labelledby="wgu-day1">
        <h2 class="m-label wgu-callout-title" id="wgu-day1">
          Do these three things on Day 1 (they have lead time)
        </h2>
        <ol class="wgu-list">
          {DAY1.map((t) => <li key={t}>{t}</li>)}
        </ol>
      </section>

      <div class="m-section">
        <h2 class="wgu-h2">The plan, week by week</h2>
      </div>
      <ul class="wgu-legend" aria-label="Assessment types">
        {CHIPS.map((k) => (
          <li key={k} class="wgu-chip" data-kind={k}>{CHIP_LABEL[k]}</li>
        ))}
      </ul>

      {WEEKS.map((wk) => {
        const headId = `wgu-${wk.start}`;
        return (
          <section class="m-card wgu-week" key={wk.n} aria-labelledby={headId}>
            <div class="wgu-week-head">
              <h3 class="wgu-week-n" id={headId}>{wk.n}</h3>
              <span class="wgu-week-dates m-num">{wk.dates}</span>
              <span class="wgu-week-theme">{wk.theme}</span>
            </div>
            <ul class="wgu-courses">
              {wk.courses.map((c) => {
                const id = `wgu-wk-${c.code}`;
                return (
                  <li class="wgu-course" key={c.code}>
                    <div class="wgu-course-head">
                      <Check id={id} code={c.code} checked={!!checks[c.code]} />
                      <label class="wgu-course-label" for={id}>
                        <span>
                          <span class="wgu-code m-mono">{c.code}</span>{' '}
                          <span class="wgu-name">{c.name}</span>
                        </span>
                      </label>
                      <span class="wgu-chip" data-kind={c.chip}>{c.chipLabel}</span>
                    </div>
                    <div class="wgu-course-body">
                      <p class="wgu-kv"><span class="m-label">Do</span> {c.doText}</p>
                      <p class="wgu-kv"><span class="m-label">Done</span> {c.doneText}</p>
                      <ul class="wgu-links">
                        {c.links.map((l) => (
                          <li key={l.href}>
                            <a class="wgu-link" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                );
              })}
            </ul>
            {wk.admin && <p class="wgu-admin">{wk.admin}</p>}
          </section>
        );
      })}

      <div class="m-section">
        <h2 class="wgu-h2">Why this order</h2>
      </div>
      <ol class="wgu-list">
        {WHY_ORDER.map(([b, t]) => (
          <li key={b}><b>{b}</b>{t}</li>
        ))}
      </ol>

      <div class="m-section">
        <h2 class="wgu-h2">Progress</h2>
      </div>
      <ul class="wgu-progress">
        {PROGRESS.map(([code, label]) => {
          const id = `wgu-pr-${code}`;
          return (
            <li key={code} class="wgu-prog-row">
              <Check id={id} code={code} checked={!!checks[code]} />
              <label class="wgu-course-label" for={id}>
                <span><span class="wgu-code m-mono">{code}</span> {label}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div class="m-section">
        <h2 class="wgu-h2">Honest caveats</h2>
      </div>
      <ul class="wgu-caveats">
        {CAVEATS.map(([b, t]) => (
          <li key={b}><b>{b}</b>{t}</li>
        ))}
      </ul>

      <footer class="wgu-foot">{FOOTER}</footer>
    </div>
  );
}
