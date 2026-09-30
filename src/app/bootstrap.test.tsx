/**
 * Boot on the first run of the Cambridge build: Today renders the loaded stores
 * without waiting for the Massey backup, and the tracker's day rollover (the first
 * write to a Massey key) still waits for it.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/preact';
import type { MigrationResult } from '@/features/cambridge/migration';
import type { CambridgeState } from '@/features/cambridge/types';

// The backup, held open until the test releases it. The migration module is
// replaced so the test controls exactly when the backup finishes.
const backup = vi.hoisted(() => {
  let release: () => void = () => {};
  const done = new Promise<void>((r) => { release = r; });
  return { done, release: () => release(), calls: 0 };
});
vi.mock('@/features/cambridge/migration', () => ({
  runMigration: async (state: CambridgeState, deps: { now: number }): Promise<MigrationResult> => {
    backup.calls++;
    await backup.done;
    return { state: { ...state, migratedAt: deps.now }, idbOk: true, localOk: true };
  },
}));

const { boot, appState, cambridgeReady, dstr } = await import('@/app/bootstrap');
const { TodayView, PATH_MODS } = await import('@/features/today/TodayTab');
const { papersMod } = await import('@/features/today/ReadingBlock');

const YESTERDAY = '2000-01-01';
const storedDay = (): string => (JSON.parse(localStorage.getItem('meridian-theorist') ?? 'null') as { day: { date: string } }).day.date;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('boot on the first run of the Cambridge build', () => {
  it('renders Today before the backup finishes, and rolls the tracker over only after it', async () => {
    // A Massey device: a tracker day from the past, a todo due today, no Cambridge store.
    localStorage.clear();
    localStorage.setItem('meridian-theorist', JSON.stringify({ banked: {}, day: { date: YESTERDAY, blocks: {}, scores: { s2: 2 }, banked: false, events: {} } }));
    localStorage.setItem('meridian-core', JSON.stringify({ schedule: {}, entries: [], todos: [{ id: 't1', text: 'Due before the backup', done: false, created: 1, due: dstr() }], scratch: [] }));
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // weather stays in its skeleton
    for (const p of PATH_MODS) vi.spyOn(p.mod, 'load').mockResolvedValue();
    vi.spyOn(papersMod, 'load').mockResolvedValue();

    const booted = boot();
    const { getByText } = render(<TodayView />);

    // The backup has started and is still running.
    await waitFor(() => expect(backup.calls).toBe(1));
    // Today already shows the loaded core store: its render did not wait.
    await waitFor(() => expect(getByText('Due before the backup')).toBeTruthy());
    // Nothing has rolled the Massey tracker store over yet, in memory or on disk.
    expect((appState.get('theorist') as { day: { date: string } }).day.date).toBe(YESTERDAY);
    expect(storedDay()).toBe(YESTERDAY);
    let ready = false;
    void cambridgeReady.then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);

    backup.release();
    await booted;

    // After the backup: the rollover ran, banking yesterday's XP under its date.
    const t = appState.get('theorist') as { day: { date: string }; banked: Record<string, number> };
    expect(t.day.date).toBe(dstr());
    expect(t.banked[YESTERDAY]).toBeGreaterThan(0);
    expect(storedDay()).toBe(dstr());
    expect(ready).toBe(true);
    expect((appState.get('cambridge') as { migratedAt?: number }).migratedAt).toBeGreaterThan(0);
  });
});
