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

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + anon, 'apikey': anon },
      body: JSON.stringify(body),
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
    return { ok: false, error: (e as Error)?.message || 'network error' };
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
