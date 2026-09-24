import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadDailyFeed } from '@/features/studytracker/feedSources';

// On-taste stories (theme-matched titles) so every hit clears the ranking bar.
const hit = (id: number, pts = 200) => ({
  objectID: String(id), title: `Distributed consensus note ${id}`, url: `https://example.com/${id}`,
  points: pts, num_comments: 10,
});

let pool: Array<ReturnType<typeof hit>> = [];
const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ hits: pool }) }));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T09:00:00'));
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('daily reading feed', () => {
  it('asks HN only for stories from the last week', async () => {
    pool = [hit(1)];
    await loadDailyFeed();
    const url = decodeURIComponent(String(fetchMock.mock.calls[0]![0]));
    const since = Math.floor((Date.now() - 7 * 86_400_000) / 1000);
    expect(url).toContain(`created_at_i>${since}`);
    expect(url).toContain('points>60');
  });

  it('serves the cached list for the rest of the day without refetching', async () => {
    pool = [hit(1)];
    await loadDailyFeed();
    fetchMock.mockClear();
    const r = await loadDailyFeed();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.items.map((i) => i.url)).toEqual(['https://example.com/1']);
    expect(r.fetchedAt).toBe(Date.now());
  });

  it("does not repeat yesterday's stories the next day", async () => {
    pool = [hit(1), hit(2)];
    await loadDailyFeed();
    vi.setSystemTime(new Date('2026-09-25T09:00:00'));
    pool = [hit(1), hit(2), hit(3)];
    const r = await loadDailyFeed();
    expect(r.items.map((i) => i.url)).toEqual(['https://example.com/3']);
  });

  it('lets a story return once it is older than the 14-day history', async () => {
    pool = [hit(1)];
    await loadDailyFeed();
    vi.setSystemTime(new Date('2026-10-09T09:00:00')); // 15 days later
    const r = await loadDailyFeed();
    expect(r.items.map((i) => i.url)).toEqual(['https://example.com/1']);
  });

  it("a refresh keeps today's items and reports when nothing is new", async () => {
    pool = [hit(1), hit(2)];
    await loadDailyFeed();
    const same = await loadDailyFeed(true);
    expect(same.items).toHaveLength(2);
    expect(same.unchanged).toBe(true);

    pool = [hit(1), hit(2), hit(3, 900)];
    const fresh = await loadDailyFeed(true);
    expect(fresh.unchanged).toBe(false);
    expect(fresh.items[0]!.url).toBe('https://example.com/3'); // highest points ranks first
  });

  it('falls back to the saved list when HN is unreachable', async () => {
    pool = [hit(1)];
    await loadDailyFeed();
    fetchMock.mockImplementation(async () => { throw new Error('offline'); });
    const r = await loadDailyFeed(true);
    expect(r.stale).toBe(true);
    expect(r.error).toMatch(/unreachable/);
    expect(r.items).toHaveLength(1);
  });
});
