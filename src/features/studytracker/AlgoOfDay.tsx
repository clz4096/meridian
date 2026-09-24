/**
 * Algorithm of the Day — a section inside the Study Tracker. Shows today's
 * rotating algorithm with plain-English intuition, the formal treatment
 * (idea / invariant / correctness), a C++ (default) or Python implementation,
 * pitfalls, and practice problems. Any entry can be browsed via the pills.
 * Content and rotation live in algorithms.ts.
 */
import { useState } from 'preact/hooks';
import { ALGORITHMS, algoOfDay, ALGO_SOURCE } from '@/features/studytracker/algorithms';
import { ALGO_PROOFS } from '@/features/studytracker/algoProofs';
import { Collapsible } from '@/features/studytracker/Collapsible';
import { ProveItYourself } from '@/features/studytracker/ProveItYourself';
import { trackerState, creditEvent, EVENT_WEIGHTS } from '@/features/studytracker/trackerStore';

export function AlgoOfDay() {
  const today = algoOfDay();
  const [selId, setSelId] = useState(today.id);
  const [lang, setLang] = useState<'cpp' | 'python'>('cpp');
  const cur = ALGORITHMS.find((a) => a.id === selId) ?? today;
  // Subscribe so the button reflects today's credited state (events reset daily).
  const studied = (trackerState.value.day.events?.['algo:studied'] ?? 0) > 0;

  return (
    <Collapsible id="algo" eyebrow="Practice" title="Algorithm of the day" defaultOpen={true}>
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

        {ALGO_SOURCE[cur.id] && (
          <div class="algo-src">
            <span class="algo-src-chip">Currently · {cur.category}</span>
            <a class="algo-src-link" href={ALGO_SOURCE[cur.id]!.url} target="_blank" rel="noopener noreferrer">
              ▶ Watch · {ALGO_SOURCE[cur.id]!.label} ↗
            </a>
          </div>
        )}

        <div class="algo-sub">In plain English</div>
        {cur.plain.map((p, i) => (
          <p key={i} class="algo-p">{p}</p>
        ))}

        <div class="algo-sub">Why it works</div>
        <p class="algo-p"><b>Idea. </b>{cur.idea}</p>
        {/* When a Tier-C proof exists, the invariant + correctness move behind the
            retrieval gate in ProveItYourself so they aren't visible while reconstructing. */}
        {!ALGO_PROOFS[cur.id] && (
          <>
            <p class="algo-p"><b>Invariant. </b>{cur.invariant}</p>
            <p class="algo-p"><b>Correctness. </b>{cur.correctness}</p>
          </>
        )}

        <ProveItYourself
          key={cur.id}
          algoId={cur.id}
          algoName={cur.name}
          invariant={cur.invariant}
          correctness={cur.correctness}
        />

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

        <div class="algo-studied">
          <button
            class={'primary' + (studied ? ' banked' : '')}
            type="button"
            aria-pressed={studied}
            onClick={() => creditEvent('algo:studied', EVENT_WEIGHTS.algoStudied)}
          >
            {studied ? 'Studied ✓' : 'Studied ✓ — mark today'}
          </button>
        </div>
      </div>
    </Collapsible>
  );
}
