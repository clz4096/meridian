/**
 * Meridian — OpenRouter proxy (Supabase Edge Function).
 *
 * The browser never holds the OpenRouter key. It POSTs an OpenAI-shaped
 * chat-completions body here; this function injects `Authorization: Bearer
 * <OPENROUTER_API_KEY>` server-side and forwards to openrouter.ai. The key
 * lives only in the function's secret store, never on-device.
 *
 * Deploy (Supabase dashboard → Edge Functions → Deploy → Via Editor):
 *   name the function exactly `openrouter-proxy`
 * Secrets (Project Settings → Edge Functions → Secrets):
 *   OPENROUTER_API_KEY = sk-or-...            (required)
 *   ALLOWED_ORIGINS    = https://a,https://b  (optional; merged with the
 *                        built-in defaults below — lets you add/adjust
 *                        allowed origins without a redeploy)
 *
 * The browser authenticates to this function with the Supabase anon key it
 * already stores for sync, so no new credential is added to the client.
 *
 * Abuse controls (the anon key is PUBLIC, so treat callers as untrusted):
 *   - Origin allowlist: only requests from known app origins are served.
 *     NOTE: this is defense-in-depth. A non-browser caller can forge the
 *     Origin header, so the real backstop against runaway spend is a hard
 *     budget/credit cap set on the OpenRouter key at openrouter.ai.
 *   - Request-size cap + param whitelist bound the per-call cost.
 *   - Single-model allowlist + max_tokens clamp bound the per-call ceiling.
 */

// Only the model(s) the app actually uses. If OpenRouter 404s the request,
// the slug here (and in index.html AI_MODEL) is wrong — copy the exact slug
// from openrouter.ai/models. Keep these two in sync.
const ALLOWED_MODELS = new Set(['deepseek/deepseek-v4-pro']);
const MAX_TOKENS_CAP = 2048;
const MAX_BODY_BYTES = 32 * 1024; // reject bodies larger than this before parsing

// The app→proxy call is always cross-origin, so the browser always sends an
// Origin header. Allowlist the app's production origin (scheme+host only — no
// path) plus localhost for dev. Extend at runtime via the ALLOWED_ORIGINS secret.
const DEFAULT_ORIGINS = ['https://clz4096.github.io', 'http://localhost:8765'];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...(Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]);

// Only these fields are forwarded to OpenRouter; any other param a caller
// tries to smuggle through is dropped.
const FORWARD_KEYS = ['model', 'messages', 'max_tokens', 'temperature', 'response_format', 'reasoning'];

const cors = (origin: string | null): Record<string, string> => ({
  // Reflect the caller's origin only when allowed; never a wildcard.
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null',
  'Vary': 'Origin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
});

const json = (body: unknown, status: number, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  const co = cors(origin);
  const originOk = !!origin && ALLOWED_ORIGINS.has(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: co });
  if (req.method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405, co);
  if (!originOk) return json({ error: { message: 'origin not allowed' } }, 403, co);

  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: { message: 'proxy missing OPENROUTER_API_KEY' } }, 500, co);

  // Bound input size before parsing — caps input-token cost and memory.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: { message: 'request too large' } }, 413, co);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: { message: 'invalid JSON body' } }, 400, co);
  }

  if (!ALLOWED_MODELS.has(String(body.model))) {
    return json({ error: { message: `model not allowed: ${body.model}` } }, 400, co);
  }

  // Forward only whitelisted params; clamp the caller-supplied output ceiling.
  const fwd: Record<string, unknown> = {};
  for (const k of FORWARD_KEYS) if (body[k] !== undefined) fwd[k] = body[k];
  fwd.max_tokens = Math.min(Number(body.max_tokens) || 512, MAX_TOKENS_CAP);

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        // Optional OpenRouter attribution headers.
        'HTTP-Referer': 'https://clz4096.github.io/meridian/',
        'X-Title': 'Meridian',
      },
      body: JSON.stringify(fwd),
    });
    // Pass the OpenRouter response (or error) through verbatim, with CORS added.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...co, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return json({ error: { message: (e as Error)?.message || 'upstream fetch failed' } }, 502, co);
  }
});
