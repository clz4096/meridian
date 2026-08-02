/**
 * Tests for the question-bank loader: fetches the manifest + topic files,
 * caches them, and falls back to the cache when the network is gone.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchQuestionBank } from '@/features/knowledge/questionBank';

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
  it('loads the manifest + every topic file and caches the items', async () => {
    const ls = fakeLs();
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
    // cached for the next cold, offline start
    expect(JSON.parse(ls._map.get('kg_bank_cache')!).graph).toHaveLength(1);
  });

  it('skips a topic file that 404s but still returns the rest', async () => {
    vi.stubGlobal('localStorage', fakeLs());
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('index.json')) return resp(200, { topics: { ok: { file: 'ok.json' }, gone: { file: 'gone.json' } } });
      if (url.includes('ok.json')) return resp(200, [{ id: 'x' }]);
      return resp(404, {});           // gone.json
    }));
    const bank = await fetchQuestionBank();
    expect(bank!.items.ok).toHaveLength(1);
    expect(bank!.items.gone).toBeUndefined();
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
