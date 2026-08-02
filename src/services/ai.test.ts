/**
 * Tests for the AI service — the error taxonomy of aiCall and the macro
 * parsing/bounds of estimateMacros (the logic that decides what the user sees).
 * fetch + localStorage are stubbed; no network.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { aiCall, estimateMacros } from '@/services/ai';

function fakeLs(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0, _map: m,
  };
}
const CREDS = { meridian_supabase_url: 'https://proj.supabase.co', meridian_supabase_key: 'anon' };
const resp = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response);
const modelResp = (content: string, status = 200) => resp(status, { choices: [{ message: { content } }] });

afterEach(() => vi.unstubAllGlobals());

describe('aiCall', () => {
  it('returns "no proxy" when credentials are missing — never fetches', async () => {
    vi.stubGlobal('localStorage', fakeLs());
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await aiCall({ maxTokens: 10, messages: [] })).toEqual({ ok: false, error: 'no proxy' });
    expect(f).not.toHaveBeenCalled();
  });

  it('maps 401/403 to auth failure and 429 to rate limiting', async () => {
    vi.stubGlobal('localStorage', fakeLs(CREDS));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(resp(401, {})));
    expect(await aiCall({ maxTokens: 10, messages: [] })).toMatchObject({ ok: false, error: 'proxy auth failed' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(resp(429, {})));
    expect(await aiCall({ maxTokens: 10, messages: [] })).toMatchObject({ ok: false, error: 'rate limited' });
  });

  it('returns the assistant text on success', async () => {
    vi.stubGlobal('localStorage', fakeLs(CREDS));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResp('hello there')));
    expect(await aiCall({ maxTokens: 10, messages: [] })).toMatchObject({ ok: true, text: 'hello there' });
  });

  it('flags an empty completion instead of returning blank text', async () => {
    vi.stubGlobal('localStorage', fakeLs(CREDS));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResp('')));
    expect(await aiCall({ maxTokens: 10, messages: [] })).toMatchObject({ ok: false, error: 'model returned no text' });
  });

  it('sends reasoning:{enabled:false} in jsonMode (so reasoning tokens do not starve short JSON)', async () => {
    vi.stubGlobal('localStorage', fakeLs(CREDS));
    const f = vi.fn().mockResolvedValue(modelResp('{}'));
    vi.stubGlobal('fetch', f);
    await aiCall({ maxTokens: 10, messages: [], jsonMode: true });
    const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.reasoning).toEqual({ enabled: false });
  });
});

describe('estimateMacros', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeLs(CREDS)));

  it('parses a bare JSON object into {name,cal,protein}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResp('{"name":"eggs","cal":180,"protein":13}')));
    expect(await estimateMacros('2 eggs')).toEqual({ name: 'eggs', cal: 180, protein: 13 });
  });

  it('tolerates a fenced ```json payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResp('```json\n{"name":"rice","cal":200,"protein":4}\n```')));
    expect(await estimateMacros('rice')).toMatchObject({ name: 'rice', cal: 200, protein: 4 });
  });

  it('rejects physically impossible macros (cal < protein*4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResp('{"name":"x","cal":10,"protein":50}')));
    expect(await estimateMacros('x')).toMatchObject({ error: 'model returned impossible macros' });
  });

  it('reports a parse failure on non-JSON text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResp('sorry, I cannot')));
    expect(await estimateMacros('x')).toMatchObject({ error: 'bad response' });
  });

  it('clamps negatives to 0 and caps the name length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResp(`{"name":"${'z'.repeat(200)}","cal":-5,"protein":-2}`)));
    const r = await estimateMacros('x');
    expect(r).toMatchObject({ cal: 0, protein: 0 });
    if ('name' in r) expect(r.name.length).toBe(60);
  });

  it('propagates the underlying error when the proxy is unreachable', async () => {
    vi.stubGlobal('localStorage', fakeLs());   // no creds
    vi.stubGlobal('fetch', vi.fn());
    expect(await estimateMacros('x')).toEqual({ error: 'no proxy' });
  });
});
