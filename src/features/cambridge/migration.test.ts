// @vitest-environment jsdom
/**
 * Migration from Massey data (contract section 2 and test list 6): a realistic
 * old device loads, the migration backs every Massey key up, and afterwards XP,
 * level, streak, meters, the weekly ring and every old key are byte-identical.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '@/app/bootstrap';
import type { TheoristState } from '@/core/types';
import {
  dayXP, levelIndex, METERS, meterPct, streakCount, syncTrackerFromStore, trackerState, trackerSummary, weeklySessions,
} from '@/features/studytracker/trackerStore';
import { emptyCambridge } from '@/features/cambridge/types';
import { snapshotMassey } from '@/features/cambridge/masseyKeys';
import {
  backupFileName, downloadMasseyBackup, latestMasseyBackup, MASSEY_KEYS, readIdbBackup, runMigration, type MasseyBackup,
} from '@/features/cambridge/migration';

const NOW = Date.parse('2026-09-30T15:00:00Z'); // Wednesday, 11 AM in Brooklyn
const DAY = 86_400_000;

/* ── an old device, built from the real store shapes ── */

const theorist: TheoristState = {
  banked: {
    __carry: 1840,
    '2026-09-01': 185, '2026-09-02': 210, '2026-09-08': 95, '2026-09-15': 240,
    '2026-09-24': 150, '2026-09-25': 60, '2026-09-27': 175, '2026-09-28': 205, '2026-09-29': 130,
  },
  day: {
    date: '2026-09-30',
    blocks: { b1: true, b2: true, b4: true, b5: false },
    scores: { s1: 2, s2: 2, s3: 1, s4: 2, s5: 0, s6: 1, s8: 2, s9: 1 },
    banked: false,
    events: { 'algo:studied': 20, 'journal:retrieval:j2': 50, 'topic:MIT 18.06': 25, 'teach:lecture': 20 },
    dayType: 'full',
  },
  dayTouchedAt: NOW - 2 * 3_600_000,
  mastery: {
    'MIT 18.06': { level: 1, reviewedAt: NOW - 3 * DAY },
    'Stanford Stats': { level: 0.8, reviewedAt: NOW - 20 * DAY },
    'COS 521': { level: 0, reviewedAt: NOW - 40 * DAY },
  },
};

const journal = [
  { id: 'j1', at: NOW - 30 * DAY, title: 'Master theorem, case 2', body: 'T(n) = 2T(n/2) + n log n ... $\\Theta(n \\log^2 n)$', reconstructed: false },
  { id: 'j2', at: NOW - 16 * DAY, title: 'Reading: Cloudflare on QUIC', body: 'Takeaway: head-of-line blocking moves into the stream layer.' },
  { id: 'j3', at: NOW - 2 * DAY, title: 'Prove it: Dijkstra with negative edges', body: 'Counterexample on 3 nodes.', reconstructed: true },
];

const teach = {
  date: '2026-09-30', stage: 'evaluate',
  plan: {
    topicId: 'dijkstra', topicName: "Dijkstra's algorithm", targetAudience: 'a Princeton CS freshman who can code but is new to this topic',
    objectives: ['State the invariant'], arc: ['Motivate', 'Invariant', 'Proof'], definitions: ['Relaxation'], examples: ['Grid'],
    anticipatedHardQuestion: 'Why not negative edges?',
  },
  transcript: 'Today we find shortest paths...', evaluation: { rubricScores: [2, 1, 2, 2, 1, 2], perDimensionFeedback: ['', 'x', '', '', 'y', ''], total: 10 },
  session: null, reflection: '',
};

const OLD_KEYS: Record<string, string> = {
  'meridian-theorist': JSON.stringify(theorist),
  'meridian-theorist__v': String(NOW - 2 * 3_600_000),
  'meridian.curriculum.v1': JSON.stringify({ 'MIT 18.06': true, 'Stanford Stats': true, 'COS 521': false }),
  'meridian.papers.v1': JSON.stringify({ 'The Google File System': [true, true, false], 'Paxos Made Simple': [true, false, false] }),
  'meridian.proofjournal.v1': JSON.stringify(journal),
  'meridian.tracker.ui.v1': JSON.stringify({ feed: false, algo: true, schedule: true, scorecard: true, journal: true }),
  'meridian.tracker.tab.v1': 'today',
  'meridian.teach.v1': JSON.stringify(teach),
  'meridian.feed.v2': JSON.stringify({ date: '2026-09-30', fetchedAt: NOW - 3_600_000, items: [{ source: 'HN', title: 'Ringbuffers', url: 'https://example.com/r', meta: '412 pts', why: 'systems' }] }),
  'meridian.tracker.v1': JSON.stringify({ cumXP: 1840, logged: ['2026-06-01'], day: { date: '2026-06-02', blocks: {}, scores: {}, banked: false } }),
  'meridian.theorist.migrated': '2026-06-03T12:00:00.000Z',
  'meridian.mastery.migrated': '2026-07-01T12:00:00.000Z',
  // Not Massey, but on the same device: must come through untouched too.
  'meridian-core': JSON.stringify({ schedule: {}, entries: [{ id: 'e1' }], todos: [], scratch: [] }),
  'meridian_supabase_url': 'https://example.supabase.co',
};

function dumpStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k)!;
  }
  return out;
}

/** Everything the owner sees from the game layer. */
function gameLayer() {
  syncTrackerFromStore();
  const s = trackerState.value;
  return {
    summary: trackerSummary(),
    cumXP: s.cumXP,
    level: levelIndex(s.cumXP),
    streak: streakCount(s.logged),
    todayXP: dayXP(s.day),
    weekly: weeklySessions(NOW),
    meters: METERS.map(([n, ids]) => [n, meterPct(s.day, ids)]),
  };
}

async function deleteDb(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await deleteDb('meridian_backups');
  localStorage.clear();
  for (const [k, v] of Object.entries(OLD_KEYS)) localStorage.setItem(k, v);
  // Boot loaded the tracker store; this writes the same bytes back.
  appState.set('theorist', JSON.parse(OLD_KEYS['meridian-theorist']!));
});
afterEach(() => vi.useRealTimers());

describe('Massey migration', () => {
  it('the fixture is the real shape (a sanity check on the test itself)', () => {
    expect(localStorage.getItem('meridian-theorist')).toBe(OLD_KEYS['meridian-theorist']);
    const g = gameLayer();
    expect(g.cumXP).toBe(1840 + 185 + 210 + 95 + 240 + 150 + 60 + 175 + 205 + 130);
    expect(g.level).toBe(1); // Proof Apprentice
    expect(g.streak).toBe(5); // 24, 25, 27, 28, 29 Sep
    expect(g.todayXP).toBeGreaterThan(0);
  });

  it('backs up every Massey key, then marks migrated; XP, level, streak, meters, ring and every old key are unchanged', async () => {
    const beforeKeys = dumpStorage();
    const beforeGame = gameLayer();

    const res = await runMigration(emptyCambridge(), { now: NOW, theorist: appState.get('theorist') });

    expect(res.idbOk).toBe(true);
    expect(res.localOk).toBe(true);
    expect(res.date).toBe('2026-09-30');
    expect(res.state.migratedAt).toBe(NOW);
    expect(res.state.items).toEqual({}); // nothing converted

    // Every old key byte-identical; the only new key is the backup copy.
    const after = dumpStorage();
    for (const [k, v] of Object.entries(beforeKeys)) expect(after[k]).toBe(v);
    expect(Object.keys(after).filter((k) => !(k in beforeKeys))).toEqual(['meridian.backup.massey.2026-09-30']);
    expect(gameLayer()).toEqual(beforeGame);

    // The IndexedDB copy holds each key's raw bytes.
    const idbText = await readIdbBackup('2026-09-30');
    const backup = JSON.parse(idbText!) as MasseyBackup;
    expect(backup.kind).toBe('meridian-massey-backup');
    for (const k of MASSEY_KEYS) expect(backup.keys[k]).toBe(OLD_KEYS[k] ?? null);
    expect(backup.theoristLoaded).toEqual(theorist);
    expect(localStorage.getItem('meridian.backup.massey.2026-09-30')).toBe(idbText);
    // Restoring from it gives back the same game layer.
    expect(JSON.parse(backup.keys['meridian-theorist']!)).toEqual(theorist);
  });

  it('runs once per device: a migrated store takes no new backup', async () => {
    const first = await runMigration(emptyCambridge(), { now: NOW });
    vi.setSystemTime(NOW + DAY);
    const again = await runMigration(first.state, { now: NOW + DAY });
    expect(again.state).toBe(first.state);
    expect(await readIdbBackup('2026-10-01')).toBeNull();
    expect(localStorage.getItem('meridian.backup.massey.2026-10-01')).toBeNull();
  });

  it('does not mark migrated when no copy could be written, so the next launch retries', async () => {
    const full = {
      getItem: (k: string) => localStorage.getItem(k),
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
      removeItem: () => {},
      key: () => null,
      length: 0,
      clear: () => {},
    } as unknown as Storage;
    const noIdb = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory;
    const res = await runMigration(emptyCambridge(), { now: NOW, storage: full, idb: noIdb });
    expect(res.state.migratedAt).toBeUndefined();
    expect(localStorage.getItem('meridian-theorist')).toBe(OLD_KEYS['meridian-theorist']);
  });

  it('Download Massey backup saves the stored backup as a dated JSON file', async () => {
    await runMigration(emptyCambridge(), { now: NOW });
    expect((await latestMasseyBackup()).date).toBe('2026-09-30');
    expect(backupFileName('2026-09-30')).toBe('meridian-massey-backup-2026-09-30.json');

    let saved: Blob | null = null;
    let name = '';
    URL.createObjectURL = vi.fn((b: Blob) => { saved = b; return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    await downloadMasseyBackup();
    expect(click).toHaveBeenCalledOnce();
    expect(name).toBe('meridian-massey-backup-2026-09-30.json');
    const file = JSON.parse(await (saved as unknown as Blob).text()) as MasseyBackup;
    expect(file.keys['meridian.proofjournal.v1']).toBe(OLD_KEYS['meridian.proofjournal.v1']);
    click.mockRestore();
  });
});

describe('the boot snapshot', () => {
  it('backs up the Massey keys as read at boot, even if one changes before the backup is written', async () => {
    localStorage.setItem('meridian.papers.v1', '{"before":true}');
    const snapshot = snapshotMassey(localStorage); // what boot reads, before the first render
    localStorage.setItem('meridian.papers.v1', '{"tickedAfterBoot":true}'); // a tap before the lazy chunk ran
    const res = await runMigration(emptyCambridge(), { now: NOW, snapshot });
    const saved = JSON.parse((await readIdbBackup(res.date!))!) as { keys: Record<string, string | null> };
    expect(saved.keys['meridian.papers.v1']).toBe('{"before":true}');
    // The live key is left alone: the backup never rewrites it.
    expect(localStorage.getItem('meridian.papers.v1')).toBe('{"tickedAfterBoot":true}');
  });
});
