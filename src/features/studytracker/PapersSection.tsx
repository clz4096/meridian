/**
 * Paper of the Week + Keshav 3-pass reproduce loop. Shows one paper (rotating
 * weekly, or any you pick), with the three-pass checklist and a concrete
 * reproduce step anchoring pass 3. Content + progress in papers.ts.
 */
import { useState } from 'preact/hooks';
import { PAPERS, paperOfWeek, KESHAV_PASSES, paperProgress, togglePass, paperKey } from '@/features/studytracker/papers';

export function PapersSection() {
  const progress = paperProgress.value; // subscribe
  const week = paperOfWeek();
  const [selKey, setSelKey] = useState(week ? paperKey(week) : '');
  const cur = PAPERS.find((p) => paperKey(p) === selKey) ?? week;

  if (!cur) return null;
  const passes = progress[paperKey(cur)] ?? [false, false, false];

  return (
    <section class="pp">
      <div class="sec-h">
        <span class="eyebrow">Read + reproduce</span>
        <span class="n">Paper of the week</span>
      </div>
      <p class="hint">Keshav&apos;s three-pass method: triage, grasp, then reproduce. Rotates weekly; tap any to browse. The real learning is pass 3.</p>

      <div class="pp-pills">
        {PAPERS.map((p) => (
          <button
            key={paperKey(p)}
            class={'pp-pill' + (paperKey(p) === paperKey(cur) ? ' on' : '') + (week && paperKey(p) === paperKey(week) ? ' week' : '')}
            type="button"
            onClick={() => setSelKey(paperKey(p))}
          >
            {p.authors}
          </button>
        ))}
      </div>

      <div class="pp-card">
        <div class="pp-head">
          <a class="pp-title" href={cur.url} target="_blank" rel="noopener noreferrer">{cur.title}</a>
          <span class="pp-area">{cur.area}</span>
        </div>
        <div class="pp-by">{cur.authors} · {cur.year}{week && paperKey(cur) === paperKey(week) ? ' · this week' : ''}</div>
        <p class="pp-why">{cur.why}</p>

        <div class="pp-passes">
          {KESHAV_PASSES.map((pass, i) => (
            <div class={'pp-pass' + (passes[i] ? ' done' : '')} key={pass.n}>
              <button
                class="pp-chk"
                type="button"
                role="checkbox"
                aria-checked={passes[i]}
                aria-label={`Pass ${pass.n} ${pass.name} done`}
                onClick={() => togglePass(cur, i as 0 | 1 | 2)}
              >
                {passes[i] ? '✓' : ''}
              </button>
              <div class="pp-pass-body">
                <div class="pp-pass-name">Pass {pass.n} · {pass.name}</div>
                <div class="pp-pass-desc">{pass.desc}</div>
                {i === 2 && <div class="pp-repro"><b>Reproduce: </b>{cur.reproduce}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
