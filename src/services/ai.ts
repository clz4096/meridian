/**
 * AI service — meal-macro estimation and the Knowledge tab's answer/grade,
 * on deepseek/deepseek-v4-pro via the Supabase Edge Function proxy.
 *
 * Browser-coupled (fetch + localStorage), like the adapters. The OpenRouter key
 * lives only in the proxy's secrets — never on-device. Keep AI_MODEL in sync
 * with the proxy's ALLOWED_MODELS and index.html.
 */

const AI_MODEL = 'deepseek/deepseek-v4-pro';

export interface AiRequest {
  maxTokens: number;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  /** Ask for a bare JSON object and disable reasoning tokens (they starve short JSON replies). */
  jsonMode?: boolean;
  /** Abort the request after this many ms (default 45s) so a hung proxy can't wedge a caller. */
  timeoutMs?: number;
}

export type AiResult =
  | { ok: true; text: string; usage?: unknown }
  | { ok: false; error: string };

export type MacroEstimate =
  | { name: string; cal: number; protein: number }
  | { error: string };

function proxyUrl(): string {
  try {
    const u = localStorage.getItem('meridian_supabase_url');
    if (!u) return '';
    const base = u.startsWith('http') ? u : 'https://' + u;
    return base.replace(/\/+$/, '') + '/functions/v1/openrouter-proxy';
  } catch {
    return '';
  }
}

function anonKey(): string {
  try {
    return localStorage.getItem('meridian_supabase_key') || '';
  } catch {
    return '';
  }
}

/**
 * One entry point for every AI call. OpenAI-shaped (OpenRouter) request through
 * the proxy; temperature is allowed here (unlike the Anthropic API), so callers
 * use it to steer determinism.
 */
export async function aiCall(req: AiRequest): Promise<AiResult> {
  const url = proxyUrl();
  const anon = anonKey();
  if (!url || !anon) return { ok: false, error: 'no proxy' };

  const body: Record<string, unknown> = { model: AI_MODEL, max_tokens: req.maxTokens, messages: req.messages };
  if (typeof req.temperature === 'number') body.temperature = req.temperature;
  if (req.jsonMode) {
    body.response_format = { type: 'json_object' };
    body.reasoning = { enabled: false };
  }

  // Abort a hung request so an in-flight flag (e.g. the generator's busy state) can't
  // stay stuck forever — the caller's promise always settles.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 45000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + anon, 'apikey': anon },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'proxy auth failed' };
    if (r.status === 429) return { ok: false, error: 'rate limited' };

    let data: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string }; usage?: unknown };
    try {
      data = await r.json();
    } catch {
      return { ok: false, error: 'HTTP ' + r.status };
    }
    if (!r.ok) return { ok: false, error: data?.error?.message || 'HTTP ' + r.status };

    const text = data.choices?.[0]?.message?.content || '';
    if (!text) return { ok: false, error: 'model returned no text' };
    return { ok: true, text, usage: data.usage };
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, error: 'timed out' };
    return { ok: false, error: (e as Error)?.message || 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Estimate macros for a free-text food description. Returns {name,cal,protein} or {error}. */
export async function estimateMacros(desc: string): Promise<MacroEstimate> {
  const res = await aiCall({
    maxTokens: 512,
    temperature: 0.2,
    jsonMode: true,
    messages: [{
      role: 'user',
      content:
        'Estimate total calories and protein grams for this food. Reply with ONLY a JSON object of ' +
        'exactly this shape, no prose: {"name":"short label","cal":<integer>,"protein":<integer>}. Food: ' + desc,
    }],
  });
  if (!res.ok) return { error: res.error };

  // JSON mode returns a bare object, but tolerate a fenced/wrapped payload too.
  const m = res.text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  let o: { name?: unknown; cal?: unknown; protein?: unknown };
  try {
    o = JSON.parse(m ? m[0] : res.text);
  } catch {
    return { error: 'bad response' };
  }
  const cal = Math.max(0, Math.round(Number(o.cal) || 0));
  const protein = Math.max(0, Math.round(Number(o.protein) || 0));
  // Same physical bound the estimator enforces: protein alone is 4 kcal/g.
  if (protein > 0 && cal < protein * 4) return { error: 'model returned impossible macros' };
  return { name: String(o.name || desc).slice(0, 60), cal, protein };
}

export type GenResult = { ok: true; raw: unknown[] } | { ok: false; error: string };

/**
 * Generate `count` fresh study questions for a topic via the AI proxy. Returns the
 * raw parsed card array (validation/normalisation happens in the pure selector, so
 * this stays a thin transport). The prompt bakes in the plain-English house style and
 * the exact card schema, and lists existing prompts so the model avoids duplicates.
 */
export async function generateQuestions(topicName: string, count: number, avoidPrompts: string[]): Promise<GenResult> {
  const n = Math.max(1, Math.min(10, Math.round(count)));
  const avoid = avoidPrompts.slice(0, 60).map((p) => '- ' + p.replace(/\s+/g, ' ').slice(0, 120)).join('\n');
  const system =
    'You write spaced-repetition study cards for a computer-science learner preparing for engineering interviews. ' +
    'House style: PLAIN ENGLISH first — open each answer with a one-sentence gist a smart beginner grasps, then the precise version, then the "tell" (the thing an interviewer is really checking). ' +
    'Never use an acronym or jargon term without immediately glossing it. Be correct and specific; no fluff. ' +
    'A "flip" card is a quick recall prompt (mins=5); a "full" card asks for a written explanation (mins=15 or 30).';
  const user =
    `Write ${n} NEW study cards about "${topicName}". Reply with ONLY a JSON object of this exact shape, no prose:\n` +
    `{"cards":[{"prompt":"<question>","reveal":"<model answer, plain English, gist→precise→tell>","mins":<5|15|30>,"flow":"<flip|full>","tags":["${'lowercase-topic-tags'}"]}]}\n` +
    `Rules: mins must be 5, 15, or 30; flow "flip" pairs with mins 5, "full" with 15 or 30. Each prompt must be DISTINCT from these existing ones:\n${avoid || '(none yet)'}\n` +
    `Do NOT include ids or book/source citations — those are added later. Keep reveals tight (a few sentences to a short paragraph).`;
  const res = await aiCall({
    maxTokens: Math.min(4096, 500 + n * 350),
    temperature: 0.5,
    jsonMode: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  if (!res.ok) return { ok: false, error: res.error };
  const m = res.text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  let o: { cards?: unknown };
  try {
    o = JSON.parse(m ? m[0] : res.text);
  } catch {
    return { ok: false, error: 'bad response' };
  }
  if (!Array.isArray(o.cards)) return { ok: false, error: 'model returned no cards' };
  return { ok: true, raw: o.cards };
}

// ── Learn by Teaching (the PhD teaching simulator) ────────────────────────────
// See docs/learn-by-teaching-2026-09-20.md. Three calls: grade the lecture, run
// office hours (the make-or-break probing questions), grade the defense. Each is a
// thin transport — it validates shape/bounds here and returns typed data.

/** Pull the first JSON object out of a (possibly fenced) model reply. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const m = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(m ? m[0] : text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const clampScore = (v: unknown): number => Math.max(0, Math.min(2, Math.round(Number(v) || 0)));

export interface LectureGrade {
  scores: number[]; // length 6, each 0/1/2
  feedback: string[]; // length 6
  total: number; // 0..12
}

const LECTURE_RUBRIC =
  '1 CORRECTNESS — 2: all definitions/claims/proofs/code precise and error-free; 1: minor imprecision or one non-fatal error; 0: a definition/proof/claim is wrong.\n' +
  '2 EXPLAINS THE WHY — 2: every key rule justified from a definition/first principle; 1: some justification but at least one key idea asserted without its why; 0: rules presented as things to accept.\n' +
  '3 CLARITY FOR THE AUDIENCE — 2: the target-level person could follow it and every acronym/term is expanded on first use; 1: mostly clear but at least one unexplained jump or undefined term; 0: assumes knowledge the audience lacks.\n' +
  '4 STRUCTURE/ARC — 2: intuition then formal then application, motivation precedes formalism; 1: has structure but a segment is out of order or motivation is missing; 0: no discernible arc.\n' +
  '5 USE OF EXAMPLES — 2: at least one concrete worked example (code or a worked proof) illustrating the abstract idea; 1: an example is present but underexplained or trivial; 0: none.\n' +
  '6 PACING/COMPRESSION — 2: fits the target length, no bloat, no critical omission; 1: notably too long or short, or a segment rushed or padded; 0: wildly off or omits core content.';

/** Grade a lecture transcript against the fixed 6-dimension rubric (each 0/1/2, total /12). */
export async function gradeLecture(
  topicName: string,
  targetAudience: string,
  transcript: string,
): Promise<{ ok: true; grade: LectureGrade } | { ok: false; error: string }> {
  const system =
    'You are a rigorous computer-science teaching evaluator. Grade a lecture TRANSCRIPT against a fixed six-dimension rubric, scoring each dimension exactly 0, 1, or 2. ' +
    'For any dimension you score below 2, the feedback MUST quote the specific words or step in the transcript that cost the point and say what was needed — never generic advice. For a 2, give one short confirming sentence. ' +
    'Never give a holistic overall rating; only the six dimension scores. Be exacting: reward precision and the generative "why", penalise hand-waving. Output strict JSON only.';
  const user =
    `TOPIC: ${topicName}\nTARGET AUDIENCE: ${targetAudience}\n\nRUBRIC (score each 0, 1, or 2):\n${LECTURE_RUBRIC}\n\n` +
    `LECTURE TRANSCRIPT:\n"""${transcript}"""\n\n` +
    'Reply with ONLY this JSON, no prose:\n' +
    '{"scores":[s1,s2,s3,s4,s5,s6],"feedback":["f1","f2","f3","f4","f5","f6"],"total":<sum of scores>}';
  const res = await aiCall({ maxTokens: 1400, temperature: 0.2, jsonMode: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  if (!res.ok) return { ok: false, error: res.error };
  const o = parseJsonObject(res.text);
  const scoresRaw = (o?.scores as unknown[]) ?? [];
  const fbRaw = (o?.feedback as unknown[]) ?? [];
  if (!Array.isArray(scoresRaw) || scoresRaw.length !== 6) return { ok: false, error: 'bad grade shape' };
  const scores = scoresRaw.map(clampScore);
  const feedback = Array.from({ length: 6 }, (_, i) => String((fbRaw[i] as string) ?? '').trim());
  const total = scores.reduce((a, b) => a + b, 0);
  return { ok: true, grade: { scores, feedback, total } };
}

export type PersonaKey = 'maya' | 'devin' | 'priya' | 'chen';
export interface OHQuestion {
  persona: PersonaKey;
  text: string;
  targetsUncovered: boolean;
}
const PERSONA_ORDER: PersonaKey[] = ['maya', 'devin', 'priya', 'chen'];

/**
 * Generate the four escalating office-hours questions. This is the make-or-break call:
 * every question must reference SPECIFIC content of THIS transcript, must not be answerable
 * by quoting one sentence, and Priya's must target something the lecture did NOT cover.
 */
export async function officeHoursQuestions(
  topicName: string,
  targetAudience: string,
  transcript: string,
): Promise<{ ok: true; questions: OHQuestion[] } | { ok: false; error: string }> {
  const system =
    'You simulate four graduate-level students in office hours immediately after a lecture. You have READ the user\'s ACTUAL transcript and must target ITS specific content. Produce EXACTLY four questions, one per persona, in escalating difficulty.\n' +
    'HARD RULES (a question that breaks any of these is a failure):\n' +
    '(a) Every question must quote or reference a SPECIFIC part of THIS lecture. Priya instead references a SPECIFIC thing the lecture OMITTED. A question generic enough to apply to a different topic is forbidden.\n' +
    '(b) No question may be answerable by simply repeating a sentence from the lecture — each must force the student to go BEYOND what was said (justify it, extend it, handle a new case, or explain a deeper why).\n' +
    '(c) Difficulty escalates: Maya (easiest) → Devin → Priya → Chen (hardest).\n' +
    'PERSONAS:\n' +
    '- MAYA, confused beginner: pick a step the lecture moved through too fast or assumed obvious, and ask about its mechanics ("why can we just…?"). targetsUncovered=false.\n' +
    '- DEVIN, sharp student: pick a specific claim or boundary the lecture stated and probe its limits ("you said X — does that still hold if…?"). targetsUncovered=false.\n' +
    '- PRIYA, edge-case skeptic: MANDATORY — pick something the lecture did NOT cover (an edge case, empty/degenerate input, a tight-vs-loose distinction, or a counterexample) and ask about it. targetsUncovered=true.\n' +
    '- PROFESSOR CHEN, deep questioner: ask why the subject is defined/built THIS way rather than a named alternative, and what that choice buys or breaks (push toward deeper theory). targetsUncovered=false.\n' +
    'Output strict JSON only.';
  const user =
    `TOPIC: ${topicName}\nTARGET AUDIENCE (the level the lecture was pitched at): ${targetAudience}\n\n` +
    `LECTURE TRANSCRIPT (the ONLY material to target — quote from it; for Priya, find a real omission):\n"""${transcript}"""\n\n` +
    'Reply with ONLY this JSON, no prose:\n' +
    '{"questions":[' +
    '{"persona":"maya","text":"...","targetsUncovered":false},' +
    '{"persona":"devin","text":"...","targetsUncovered":false},' +
    '{"persona":"priya","text":"...","targetsUncovered":true},' +
    '{"persona":"chen","text":"...","targetsUncovered":false}]}';
  const res = await aiCall({ maxTokens: 1400, temperature: 0.7, jsonMode: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  if (!res.ok) return { ok: false, error: res.error };
  const o = parseJsonObject(res.text);
  const arr = (o?.questions as Array<Record<string, unknown>>) ?? [];
  if (!Array.isArray(arr) || arr.length < 4) return { ok: false, error: 'model returned too few questions' };
  // Normalise to the canonical persona order and coerce Priya's mandatory flag.
  const byPersona = new Map<PersonaKey, Record<string, unknown>>();
  for (const q of arr) {
    const p = String(q.persona ?? '').toLowerCase() as PersonaKey;
    if (PERSONA_ORDER.includes(p) && !byPersona.has(p)) byPersona.set(p, q);
  }
  const questions: OHQuestion[] = [];
  for (const p of PERSONA_ORDER) {
    const q = byPersona.get(p);
    const text = String(q?.text ?? '').trim();
    if (!text) return { ok: false, error: 'model omitted the ' + p + ' question' };
    questions.push({ persona: p, text, targetsUncovered: p === 'priya' ? true : Boolean(q?.targetsUncovered) });
  }
  return { ok: true, questions };
}

export interface DefenseGrade {
  scores: number[]; // length 4, each 0/1/2
  feedback: string[]; // length 4
}

/** Grade the four office-hours answers (each 0/1/2) with feedback stating what a full answer needs. */
export async function gradeDefense(
  topicName: string,
  transcript: string,
  qas: Array<{ persona: PersonaKey; question: string; answer: string }>,
): Promise<{ ok: true; grade: DefenseGrade } | { ok: false; error: string }> {
  const system =
    'You grade a student\'s answers to office-hours questions about their own lecture. Score EACH answer exactly 0, 1, or 2.\n' +
    '2 ADDRESSED: directly answers the specific question, is correct, and adds reasoning beyond the bare fact; for an edge-case question the case is handled or honestly reasoned; for a "why" question the generative reason is engaged.\n' +
    '1 PARTIAL: addresses only part, or is correct but hand-wavy, or misses a subtlety.\n' +
    '0 HAND-WAVED/WRONG/DODGED: restates the lecture without answering, is incorrect, or deflects.\n' +
    'For EVERY answer, the feedback must state what a full answer would include (the substance, not just the score). Output strict JSON only.';
  const qaBlock = qas
    .map((qa, i) => `Q${i + 1} [${qa.persona}]: ${qa.question}\nANSWER ${i + 1}: ${qa.answer || '(no answer given)'}`)
    .join('\n\n');
  const user =
    `TOPIC: ${topicName}\n\nThe student's own lecture (for grounding):\n"""${transcript}"""\n\n` +
    `The office-hours exchange to grade:\n${qaBlock}\n\n` +
    'Reply with ONLY this JSON, no prose:\n' +
    `{"scores":[${qas.map(() => 's').join(',')}],"feedback":[${qas.map(() => '"..."').join(',')}]}`;
  const res = await aiCall({ maxTokens: 1600, temperature: 0.2, jsonMode: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  if (!res.ok) return { ok: false, error: res.error };
  const o = parseJsonObject(res.text);
  const scoresRaw = (o?.scores as unknown[]) ?? [];
  const fbRaw = (o?.feedback as unknown[]) ?? [];
  const n = qas.length;
  if (!Array.isArray(scoresRaw) || scoresRaw.length !== n) return { ok: false, error: 'bad defense grade shape' };
  const scores = scoresRaw.map(clampScore);
  const feedback = Array.from({ length: n }, (_, i) => String((fbRaw[i] as string) ?? '').trim());
  return { ok: true, grade: { scores, feedback } };
}
