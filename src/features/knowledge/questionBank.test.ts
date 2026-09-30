/**
 * Tests for the question-bank loader: fetches the manifest + topic files, falls
 * back to the legacy localStorage mirror when the network is gone, and reads the
 * id-only index that Today uses.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchQuestionBank, fetchQuestionIndex } from '@/features/knowledge/questionBank';

function fakeLs(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0, _map: m,
  };
}
const resp = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response);

afterEach(() => vi.unstubAllGlobals());

describe('fetchQuestionBank', () => {
  it('loads the manifest + every topic file, and clears the legacy mirror instead of writing it', async () => {
    const ls = fakeLs({ kg_bank_cache: JSON.stringify({ algo: [{ id: 'stale' }] }) });
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('index.json')) return resp(200, { topics: { algo: { file: 'questions/algo.json' }, graph: { file: 'questions/graph.json' } } });
      if (url.includes('algo.json')) return resp(200, [{ id: 'a1' }, { id: 'a2' }]);
      if (url.includes('graph.json')) return resp(200, [{ id: 'g1' }]);
      return resp(404, {});
    }));

    const bank = await fetchQuestionBank();
    expect(bank).not.toBeNull();
    expect(Object.keys(bank!.items).sort()).toEqual(['algo', 'graph']);
    expect(bank!.items.algo).toHaveLength(2);
    // the service worker precache covers offline now; the 550 KB mirror is dropped
    expect(ls._map.has('kg_bank_cache')).toBe(false);
  });

  it('skips a topic file that 404s but still returns the rest', async () => {
    const ls = fakeLs({ kg_bank_cache: JSON.stringify({ other: [{ id: 'kept' }] }) });
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('index.json')) return resp(200, { topics: { ok: { file: 'ok.json' }, gone: { file: 'gone.json' } } });
      if (url.includes('ok.json')) return resp(200, [{ id: 'x' }]);
      return resp(404, {});           // gone.json
    }));
    const bank = await fetchQuestionBank();
    expect(bank!.items.ok).toHaveLength(1);
    expect(bank!.items.gone).toBeUndefined();
    expect(ls._map.has('kg_bank_cache')).toBe(true); // incomplete download: the mirror stays
  });

  it('falls back to the localStorage cache when the network is gone', async () => {
    vi.stubGlobal('localStorage', fakeLs({ kg_bank_cache: JSON.stringify({ algo: [{ id: 'cached' }] }) }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const bank = await fetchQuestionBank();
    expect(bank).toMatchObject({ manifest: null });
    expect(bank!.items.algo).toEqual([{ id: 'cached' }]);
  });

  it('returns null when there is neither network nor cache', async () => {
    vi.stubGlobal('localStorage', fakeLs());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchQuestionBank()).toBeNull();
  });
});

describe('fetchQuestionIndex', () => {
  it('returns the ids per topic, as strings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { topics: { algo: { file: 'a.json', ids: ['a1', 2] }, graph: { file: 'g.json', ids: [] } } })));
    expect(await fetchQuestionIndex()).toEqual({ algo: ['a1', '2'], graph: [] });
  });

  it('returns null for an index without ids, rather than a partial set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { topics: { algo: { file: 'a.json', ids: ['a1'] }, graph: { file: 'g.json' } } })));
    expect(await fetchQuestionIndex()).toBeNull();
  });

  it('returns null offline or on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchQuestionIndex()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => resp(500, {})));
    expect(await fetchQuestionIndex()).toBeNull();
  });
});
