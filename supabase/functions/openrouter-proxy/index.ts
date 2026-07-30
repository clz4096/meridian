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
 * Secret (Project Settings → Edge Functions → Secrets):
 *   OPENROUTER_API_KEY = sk-or-...
 *
 * The browser authenticates to this function with the Supabase anon key it
 * already stores for sync, so no new credential is added to the client.
 */

// Only the model(s) the app actually uses. If OpenRouter 404s the request,
// the slug here (and in index.html AI_MODEL) is wrong — copy the exact slug
// from openrouter.ai/models. Keep these two in sync.
const ALLOWED_MODELS = new Set(['deepseek/deepseek-v4-pro']);
const MAX_TOKENS_CAP = 2048;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'method not allowed' } }, 405);

  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: { message: 'proxy missing OPENROUTER_API_KEY' } }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: 'invalid JSON body' } }, 400);
  }

  if (!ALLOWED_MODELS.has(String(body.model))) {
    return json({ error: { message: `model not allowed: ${body.model}` } }, 400);
  }
  // Clamp the caller-supplied ceiling; never trust the browser to bound spend.
  const maxTokens = Math.min(Number(body.max_tokens) || 512, MAX_TOKENS_CAP);

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        // Optional OpenRouter attribution headers.
        'HTTP-Referer': 'https://meridian.app',
        'X-Title': 'Meridian',
      },
      body: JSON.stringify({ ...body, max_tokens: maxTokens }),
    });
    // Pass the OpenRouter response (or error) through verbatim, with CORS added.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return json({ error: { message: (e as Error)?.message || 'upstream fetch failed' } }, 502);
  }
});
