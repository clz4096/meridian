/**
 * Algorithm of the Day — a section inside the Study Tracker. Shows today's
 * rotating algorithm with plain-English intuition, the formal treatment
 * (idea / invariant / correctness), a C++ (default) or Python implementation,
 * pitfalls, and practice problems. Any entry can be browsed via the pills.
 * Content and rotation live in algorithms.ts.
 */
import { useState } from 'preact/hooks';
import { ALGORITHMS, algoOfDay } from '@/features/studytracker/algorithms';
import { ALGO_PROOFS } from '@/features/studytracker/algoProofs';

export function AlgoOfDay() {
  const today = algoOfDay();
  const [selId, setSelId] = useState(today.id);
  const [lang, setLang] = useState<'cpp' | 'python'>('cpp');
  const cur = ALGORITHMS.find((a) => a.id === selId) ?? today;

  return (
    <section class="algo">
      <div class="sec-h">
        <span class="eyebrow">Practice</span>
        <span class="n">Algorithm of the day</span>
      </div>
      <p class="hint">One algorithm a day, from first principles: C++ first, then ported to Python; rigorous and formal, but in plain English. Rotates daily; tap any to browse.</p>

      <div class="algo-pills">
        {ALGORITHMS.map((a) => (
          <button
            key={a.id}
            class={'algo-pill' + (a.id === cur.id ? ' on' : '') + (a.id === today.id ? ' today' : '')}
            type="button"
            onClick={() => setSelId(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>

      <div class="algo-card">
        <div class="algo-head">
          <div class="algo-title">
            <span class="algo-name">{cur.name}</span>
            <span class="algo-cat">{cur.category}</span>
            {cur.id === today.id && <span class="algo-tag">today</span>}
          </div>
          <div class="algo-badges">
            <span class="algo-badge time">{cur.timeComplexity}</span>
            <span class="algo-badge">{cur.spaceComplexity} space</span>
            <span class="algo-badge">{cur.difficulty}</span>
          </div>
        </div>

        <p class="algo-one">{cur.oneLiner}</p>

        <div class="algo-sub">In plain English</div>
        {cur.plain.map((p, i) => (
          <p key={i} class="algo-p">{p}</p>
        ))}

        <div class="algo-sub">Why it works</div>
        <p class="algo-p"><b>Idea. </b>{cur.idea}</p>
        <p class="algo-p"><b>Invariant. </b>{cur.invariant}</p>
        <p class="algo-p"><b>Correctness. </b>{cur.correctness}</p>

        {ALGO_PROOFS[cur.id] && (
          <>
            <div class="algo-sub">Prove it</div>
            <p class="algo-p algo-proof">{ALGO_PROOFS[cur.id]}</p>
          </>
        )}

        <div class="algo-codehead">
          <div class="algo-sub" style={{ margin: 0 }}>Implementation</div>
          <div class="algo-langs" role="group" aria-label="Language">
            <button class={lang === 'cpp' ? 'on' : ''} type="button" onClick={() => setLang('cpp')}>C++</button>
            <button class={lang === 'python' ? 'on' : ''} type="button" onClick={() => setLang('python')}>Python</button>
          </div>
        </div>
        <pre class="algo-code"><code>{lang === 'cpp' ? cur.cpp : cur.python}</code></pre>

        <div class="algo-sub">Pitfalls</div>
        <ul class="algo-list">
          {cur.pitfalls.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>

        <div class="algo-sub">Practice</div>
        <div class="algo-probs">
          {cur.problems.map((pr) => (
            <a class="algo-prob" key={pr.url} href={pr.url} target="_blank" rel="noopener noreferrer">
              <span class="algo-prob-n">{pr.name}</span>
              <span class="algo-prob-note">{pr.note}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
