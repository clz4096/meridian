/**
 * Learn by Teaching — the PhD teaching simulator, mounted as a Study Tracker
 * section right after Algorithm of the Day (it teaches that same topic). The
 * five-stage loop is Designer → Present → Evaluate → Office Hours → Scorecard.
 *
 * The office-hours defense is the centerpiece: four escalating AI students read
 * the user's ACTUAL transcript and probe it. Scores are framed as feedback on
 * the PRACTICE — a low defense score is what to restudy, never a grade. Loop
 * state + XP banking live in teachingStore; the AI transport is in services/ai.
 */
import { useEffect, useState } from 'preact/hooks';
import { Collapsible } from '@/features/studytracker/Collapsible';
import { GatedReveal } from '@/features/studytracker/GatedReveal';
import { trackerState } from '@/features/studytracker/trackerStore';
import { ALGORITHMS, algoOfDay, type AlgoEntry } from '@/features/studytracker/algorithms';
import { host } from '@/ui/host';
import {
  teachLoop, ensureTeachToday, updatePlan, setManualTopic, setTopicFromAlgo, setTranscript, setStage,
  setEvaluation, setQuestions, setAnswer, setDefenseGrade, setReflection, completeLoop, resetLoop,
  loopResult, teachXpEarned, type TeachStage,
} from '@/features/teaching/teachingStore';
import {
  RUBRIC_DIMENSIONS, PERSONAS, lectureBand, LECTURE_MAX, DEFENSE_MAX, type OfficeHoursQuestion,
} from '@/features/teaching/teachingTypes';
import { gradeLecture, officeHoursQuestions, gradeDefense } from '@/services/ai';

const STAGES: ReadonlyArray<readonly [TeachStage, string]> = [
  ['design', 'Design'],
  ['present', 'Present'],
  ['evaluate', 'Evaluate'],
  ['office', 'Office hours'],
  ['scorecard', 'Scorecard'],
];
const STAGE_IX: Record<TeachStage, number> = { design: 0, present: 1, evaluate: 2, office: 3, scorecard: 4 };

const MIN_TRANSCRIPT = 120; // chars before a lecture is "non-trivial" enough to grade
const scoreCls = (n: number): string => (n >= 2 ? 'green' : n >= 1 ? 'amber' : 'red');
const friendly = (e: string): string =>
  e === 'no proxy' ? 'AI unavailable — configure the proxy in Data settings.' : `AI unavailable — ${e}.`;

/** A multiline list field: one item per line (kept verbatim so editing stays fluid). */
function ListField({ label, hint, rows, value, onChange }: {
  label: string; hint?: string; rows: number; value: string[]; onChange: (next: string[]) => void;
}) {
  return (
    <label class="teach-field">
      <span class="teach-field-lbl">{label}</span>
      {hint && <span class="teach-field-hint">{hint}</span>}
      <textarea
        class="teach-input"
        rows={rows}
        value={value.join('\n')}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value.split('\n'))}
      />
    </label>
  );
}

export function TeachSection() {
  const l = teachLoop.value; // subscribe
  trackerState.value; // subscribe so banked XP + completion re-render
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => { ensureTeachToday(); }, []);

  // True when the user has entered anything worth losing on a topic switch.
  const planDirty = (): boolean => {
    const p = l.plan;
    return (
      p.objectives.some((s) => s.trim()) || p.arc.some((s) => s.trim()) ||
      p.definitions.some((s) => s.trim()) || p.examples.some((s) => s.trim()) ||
      !!p.anticipatedHardQuestion.trim() || !!l.transcript.trim()
    );
  };
  const confirmSwitch = (): boolean =>
    !planDirty() || host.confirm('Discard your in-progress plan and switch topics?');
  const switchToAlgo = (entry: AlgoEntry): void => {
    if (entry.id === l.plan.topicId || !confirmSwitch()) return;
    setTopicFromAlgo(entry);
  };
  const useManualTopic = (name: string): boolean => {
    if (!confirmSwitch()) return false;
    setManualTopic(name);
    return true;
  };
  const today = algoOfDay();
  const isCustom = l.plan.topicId.startsWith('custom:');
  const peekEntry = ALGORITHMS.find((a) => a.id === l.plan.topicId);
  // Textarea auto-grow: rows track the live line count, clamped to a per-field floor.
  const rowsFor = (min: number, lines: number): number => Math.max(min, lines + 2);

  const runGradeLecture = async (): Promise<void> => {
    setBusy(true); setErr(null);
    const res = await gradeLecture(l.plan.topicName, l.plan.targetAudience, l.transcript);
    setBusy(false);
    if (!res.ok) { setErr(friendly(res.error)); return; }
    setEvaluation({ rubricScores: res.grade.scores, perDimensionFeedback: res.grade.feedback, total: res.grade.total });
    setStage('evaluate');
  };

  const runOfficeHours = async (): Promise<void> => {
    setBusy(true); setErr(null);
    const res = await officeHoursQuestions(l.plan.topicName, l.plan.targetAudience, l.transcript);
    setBusy(false);
    if (!res.ok) { setErr(friendly(res.error)); return; }
    const qs: OfficeHoursQuestion[] = res.questions.map((q) => ({ persona: q.persona, text: q.text, targetsUncovered: q.targetsUncovered }));
    setQuestions(qs);
    setStage('office');
  };

  const runDefense = async (): Promise<void> => {
    const s = l.session;
    if (!s) return;
    setBusy(true); setErr(null);
    const qas = s.questions.map((q, i) => ({ persona: q.persona, question: q.text, answer: s.answers[i] ?? '' }));
    const res = await gradeDefense(l.plan.topicName, l.transcript, qas);
    setBusy(false);
    if (!res.ok) { setErr(friendly(res.error)); return; }
    setDefenseGrade({ scores: res.grade.scores, feedback: res.grade.feedback });
  };

  const errBox = (retry: () => void) =>
    err && (
      <div class="teach-err" role="alert">
        <span>{err}</span>
        <button class="ghost" type="button" onClick={retry}>Retry</button>
      </div>
    );

  const stepIx = STAGE_IX[l.stage];

  return (
    <Collapsible id="teach" eyebrow="Teach" title="Teach today's topic" defaultOpen={false}>
      <p class="hint">
        You have not mastered a topic until you can teach it and defend it. Design a lesson, present it,
        get it graded, then defend it in office hours against four probing students. Scores the practice,
        never a grade — a low defense score is simply what to restudy.
      </p>

      <div class="teach-stepper" role="list" aria-label="Teaching loop stages">
        {STAGES.map(([id, label], i) => (
          <div key={id} role="listitem" class={'teach-step' + (i === stepIx ? ' on' : '') + (i < stepIx ? ' done' : '')}>
            <span class="teach-step-n">{i + 1}</span>
            <span class="teach-step-l">{label}</span>
          </div>
        ))}
      </div>

      {/* ── DESIGN ── */}
      {l.stage === 'design' && (
        <div class="teach-stage">
          {/* Choosing the topic is the first action. Reuses Algorithm-of-the-Day pill styling. */}
          <div class="algo-pills">
            {ALGORITHMS.map((a) => (
              <button
                key={a.id}
                class={'algo-pill' + (a.id === l.plan.topicId ? ' on' : '') + (a.id === today.id ? ' today' : '')}
                type="button"
                onClick={() => switchToAlgo(a)}
              >
                {a.name}
              </button>
            ))}
            <button
              class={'algo-pill' + (isCustom ? ' on' : '')}
              type="button"
              onClick={() => setShowCustom((v) => !v)}
            >
              Custom…
            </button>
          </div>
          {(showCustom || isCustom) && (
            <div class="teach-manual">
              <span class="teach-field-lbl">Teach a different topic instead</span>
              <ManualTopic onUse={useManualTopic} />
            </div>
          )}

          <label class="teach-field">
            <span class="teach-field-lbl">Target audience</span>
            <input
              class="teach-input"
              type="text"
              value={l.plan.targetAudience}
              onInput={(e) => updatePlan({ targetAudience: (e.target as HTMLInputElement).value })}
            />
          </label>

          <ListField label="Objectives"
            hint="From memory: what should the learner be able to DO after your lesson? One per line."
            rows={rowsFor(4, l.plan.objectives.length)}
            value={l.plan.objectives} onChange={(objectives) => updatePlan({ objectives })} />
          <ListField label="Arc"
            hint="Sequence it yourself — intuition, then the formal idea, then invariant/correctness, then a worked example. One beat per line, in your own words."
            rows={rowsFor(6, l.plan.arc.length)}
            value={l.plan.arc} onChange={(arc) => updatePlan({ arc })} />
          <ListField label="Definitions & claims"
            hint="State the precise claims from memory — don't re-read the card above."
            rows={rowsFor(5, l.plan.definitions.length)}
            value={l.plan.definitions} onChange={(definitions) => updatePlan({ definitions })} />
          <ListField label="Examples"
            hint="A concrete worked example that grounds the abstraction."
            rows={rowsFor(4, l.plan.examples.length)}
            value={l.plan.examples} onChange={(examples) => updatePlan({ examples })} />

          <label class="teach-field">
            <span class="teach-field-lbl">Anticipated hard question</span>
            <textarea
              class="teach-input" rows={rowsFor(3, l.plan.anticipatedHardQuestion.split('\n').length)}
              placeholder="The single toughest thing a sharp student could ask — and how you'd handle it."
              value={l.plan.anticipatedHardQuestion}
              onInput={(e) => updatePlan({ anticipatedHardQuestion: (e.target as HTMLTextAreaElement).value })}
            />
          </label>

          {/* Opt-in retrieval check: the notes stay hidden until the user asks for them. */}
          <GatedReveal triggerLabel="Peek at your notes">
            {peekEntry ? (
              <div class="teach-peek">
                <p class="algo-p"><b>Idea. </b>{peekEntry.idea}</p>
                <p class="algo-p"><b>Invariant. </b>{peekEntry.invariant}</p>
                <p class="algo-p"><b>Correctness. </b>{peekEntry.correctness}</p>
                {peekEntry.plain.map((p, i) => (
                  <p key={i} class="algo-p">{p}</p>
                ))}
              </div>
            ) : (
              <p class="algo-p">No notes for a custom topic — teach it from your own understanding.</p>
            )}
          </GatedReveal>

          <div class="teach-actions">
            <button class="primary" type="button" onClick={() => setStage('present')}>Start teaching →</button>
          </div>
        </div>
      )}

      {/* ── PRESENT ── */}
      {l.stage === 'present' && (
        <div class="teach-stage">
          <div class="teach-topic">
            <span class="teach-topic-eyebrow">Lecture</span>
            <span class="teach-topic-name">{l.plan.topicName}</span>
          </div>
          <p class="hint">Teach it out loud, in writing. Explain the why, not just the steps — as if to {l.plan.targetAudience}.</p>
          <textarea
            class="teach-input teach-transcript" rows={12}
            placeholder="Deliver your lecture here — definitions, the generative why, a worked example…"
            value={l.transcript}
            onInput={(e) => setTranscript((e.target as HTMLTextAreaElement).value)}
          />
          <div class="teach-count">
            {l.transcript.trim() ? l.transcript.trim().split(/\s+/).length : 0} words · {l.transcript.length} chars
          </div>
          {errBox(runGradeLecture)}
          <div class="teach-actions">
            <button class="ghost" type="button" onClick={() => setStage('design')}>← Back to design</button>
            <button
              class="primary" type="button"
              disabled={busy || l.transcript.trim().length < MIN_TRANSCRIPT}
              onClick={runGradeLecture}
            >
              {busy ? 'Grading…' : 'Submit lecture for grading'}
            </button>
          </div>
        </div>
      )}

      {/* ── EVALUATE ── */}
      {l.stage === 'evaluate' && l.evaluation && (
        <div class="teach-stage">
          <div class="teach-eval-head">
            <span class="teach-topic-eyebrow">Lecture evaluation</span>
            <div class="teach-eval-tot">
              <span class="tot">{l.evaluation.total} / {LECTURE_MAX}</span>
              <span class={'band ' + lectureBand(l.evaluation.total).cls}>{lectureBand(l.evaluation.total).word}</span>
            </div>
          </div>
          <div class="teach-dims">
            {RUBRIC_DIMENSIONS.map((d, i) => (
              <div key={d.key} class="teach-dim">
                <div class="teach-dim-top">
                  <span class="teach-dim-label">{d.label}</span>
                  <span class={'teach-score ' + scoreCls(l.evaluation!.rubricScores[i] ?? 0)}>
                    {l.evaluation!.rubricScores[i] ?? 0}/2
                  </span>
                </div>
                <p class="teach-dim-fb">{l.evaluation!.perDimensionFeedback[i] || d.blurb}</p>
              </div>
            ))}
          </div>
          {errBox(runOfficeHours)}
          <div class="teach-actions">
            <button class="ghost" type="button" onClick={() => setStage('present')}>← Revise lecture</button>
            <button class="primary" type="button" disabled={busy} onClick={runOfficeHours}>
              {busy ? 'Summoning students…' : 'Enter office hours →'}
            </button>
          </div>
        </div>
      )}

      {/* ── OFFICE HOURS ── */}
      {l.stage === 'office' && l.session && (
        <div class="teach-stage">
          <p class="hint">
            Four students read your actual lecture and push on it, escalating. Answer each in turn — the next
            unlocks once you have written a reply. Going beyond what you said is the point.
          </p>
          <div class="teach-oh">
            {l.session.questions.map((q, i) => {
              const answered = (l.session!.answers[i] ?? '').trim().length > 0;
              const unlocked = i === 0 || (l.session!.answers[i - 1] ?? '').trim().length > 0;
              const p = PERSONAS.find((x) => x.key === q.persona) ?? PERSONAS[i]!;
              if (!unlocked) {
                return (
                  <div key={i} class="teach-q locked">
                    <span class="teach-q-lock">Answer {PERSONAS.find((x) => x.key === l.session!.questions[i - 1]?.persona)?.name ?? 'the previous student'} to unlock {p.name}</span>
                  </div>
                );
              }
              return (
                <div key={i} class="teach-q">
                  <div class="teach-q-head">
                    <div class="teach-q-who">
                      <span class="teach-persona">{p.name}</span>
                      <span class="teach-role">{p.role}</span>
                    </div>
                    {q.targetsUncovered && <span class="teach-badge">Not in your lecture</span>}
                  </div>
                  <p class="teach-q-text">{q.text}</p>
                  <textarea
                    class="teach-input" rows={4}
                    placeholder="Your answer — justify it, extend it, handle the case…"
                    value={l.session!.answers[i] ?? ''}
                    onInput={(e) => setAnswer(i, (e.target as HTMLTextAreaElement).value)}
                  />
                  {answered && <span class="teach-q-ok">✓ answered</span>}
                </div>
              );
            })}
          </div>
          {errBox(runDefense)}
          <div class="teach-actions">
            <button
              class="primary" type="button"
              disabled={busy || l.session.answers.some((a) => !a.trim())}
              onClick={runDefense}
            >
              {busy ? 'Grading defense…' : 'Submit answers for defense grading'}
            </button>
          </div>
        </div>
      )}

      {/* ── SCORECARD ── */}
      {l.stage === 'scorecard' && l.session && (
        <Scorecard />
      )}
    </Collapsible>
  );
}

/**
 * Manual topic override input, isolated so its draft state doesn't re-render the
 * loop. `onUse` performs the guarded switch and returns whether it went through;
 * the draft is only cleared on a successful switch (so a declined confirm keeps it).
 */
function ManualTopic({ onUse }: { onUse: (name: string) => boolean }) {
  const [draft, setDraft] = useState('');
  return (
    <div class="teach-manual-row">
      <input
        class="teach-input" type="text" placeholder="e.g. Big-O notation and asymptotic analysis"
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
      />
      <button class="ghost" type="button" disabled={!draft.trim()} onClick={() => { if (onUse(draft)) setDraft(''); }}>
        Use this topic
      </button>
    </div>
  );
}

function Scorecard() {
  const l = teachLoop.value; // subscribe
  trackerState.value; // subscribe so the banked chip reflects the credit
  const s = l.session!;
  const teaching = l.evaluation?.total ?? 0;
  const defense = (s.answerScores ?? []).reduce((a, b) => a + b, 0);
  const reflectionBanked = (trackerState.value.day.events?.['teach:reflection'] ?? 0) > 0;
  const result = loopResult();

  return (
    <div class="teach-stage">
      <p class="teach-note">Score the practice, never a grade. A low defense score is simply what to restudy next.</p>

      <div class="teach-meters">
        <div class="meter">
          <div class="lbl"><span>Teaching quality</span><span class="pct">{teaching} / {LECTURE_MAX}</span></div>
          <div class="mbar"><span style={{ width: `${Math.round((teaching / LECTURE_MAX) * 100)}%` }} /></div>
        </div>
        <div class="meter">
          <div class="lbl"><span>Defense</span><span class="pct">{defense} / {DEFENSE_MAX}</span></div>
          <div class="mbar"><span style={{ width: `${Math.round((defense / DEFENSE_MAX) * 100)}%` }} /></div>
        </div>
      </div>

      <div class="teach-answers">
        {s.questions.map((q, i) => {
          const p = PERSONAS.find((x) => x.key === q.persona) ?? PERSONAS[i]!;
          const score = s.answerScores[i] ?? 0;
          return (
            <div key={i} class="teach-ans">
              <div class="teach-q-head">
                <div class="teach-q-who">
                  <span class="teach-persona">{p.name}</span>
                  <span class="teach-role">{p.role}</span>
                </div>
                <span class={'teach-score ' + scoreCls(score)}>{score}/2</span>
              </div>
              <p class="teach-q-text">{q.text}</p>
              <p class="teach-ans-fb">{s.perAnswerFeedback[i] || 'No feedback returned.'}</p>
            </div>
          );
        })}
      </div>

      <label class="teach-field">
        <span class="teach-field-lbl">Reflection</span>
        <span class="teach-field-hint">Which office-hours question exposed a gap I didn't know I had?</span>
        <textarea
          class="teach-input" rows={3}
          value={l.reflection}
          onInput={(e) => setReflection((e.target as HTMLTextAreaElement).value)}
        />
      </label>

      {reflectionBanked ? (
        <div class="teach-result" role="status">
          <div class="teach-result-h">Loop complete ✓</div>
          <p>
            Teaching {result.teachingScore}/{LECTURE_MAX} · Defense {result.defenseScore}/{DEFENSE_MAX} ·
            <b> +{teachXpEarned()} XP</b> banked into the Standard.
          </p>
        </div>
      ) : (
        <div class="teach-actions">
          <button class="primary" type="button" disabled={!l.reflection.trim()} onClick={() => completeLoop()}>
            Complete loop ✓
          </button>
        </div>
      )}

      <div class="teach-actions">
        <button class="ghost" type="button" onClick={() => resetLoop()}>Start a new loop</button>
      </div>
    </div>
  );
}
