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
