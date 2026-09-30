// @vitest-environment jsdom
/**
 * The tracker as the Cambridge Method (Stage 5): the rename and credit line,
 * Deep Blocks 1 and 3 following the current Cambridge item with their ids
 * unchanged, the weekly Cambridge scorecard and its effect on the meters, and no
 * retired Princeton course code anywhere on the screen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { TheoristState } from '@/core/types';
import { appState } from '@/app/bootstrap';
import { StudyTrackerView } from '@/features/studytracker/StudyTracker';
import { setTab } from '@/features/studytracker/uiState';
import {
  CAM_METERS, METERS, SCHEDULE, meterPct, syncTrackerFromStore, todayISO, type TrackerDay,
} from '@/features/studytracker/trackerStore';
import { journalEntries } from '@/features/studytracker/proofJournalStore';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import { catalogEntries, loadCatalog } from '@/features/cambridge/catalog';
import { cambridgeMeterInput, weekScorecard } from '@/features/cambridge/scorecard';
import { isoWeek } from '@/features/cambridge/schedule';
import retired from '@data/archive/princeton-curriculum.json';

const RETIRED = retired.courses.map((c) => c.code);
const ready = Promise.resolve();
await loadCatalog();
const DAY_MS = 86_400_000;

const seedTheorist = (day: Partial<TrackerDay> = {}, extra: Partial<TheoristState> = {}): void => {
  const t: TheoristState = {
    banked: {},
    day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {}, ...day },
    ...extra,
  };
  appState.set('theorist', t as unknown as Record<string, unknown>);
  syncTrackerFromStore();
};
const seedCam = (s: Partial<CambridgeState>): void => {
  appState.set('cambridge', { ...emptyCambridge(), ...s } as never);
};
const item = (id: string, over: Partial<CamItem>): CamItem => ({ id, stage: 'attempting', questions: {}, updatedAt: Date.now(), ...over });

/**
 * Screen text without the algorithm of the day card: that card (kept as is)
 * cites each algorithm's lecture video by its course, such as "MIT 6.006",
 * which is a source link, not the retired study plan.
 */
const planText = (c: Element): string => {
  const copy = c.cloneNode(true) as Element;
  copy.querySelectorAll('.algo-card').forEach((n) => n.remove());
  return copy.textContent ?? '';
};
const row = (c: Element, id: string): HTMLElement => c.querySelector<HTMLElement>(`[data-block="${id}"]`)!;
const meterValues = (c: Element): Record<string, number> =>
  Object.fromEntries(
    [...c.querySelectorAll('.meter')].map((m) => [
      m.querySelector('.lbl span')!.textContent!,
      Number(m.querySelector('.pct')!.textContent!.replace('%', '')),
    ]),
  );

const savedJournal = journalEntries.value;
beforeEach(() => {
  setTab('today');
  seedTheorist();
  seedCam({});
  journalEntries.value = [];
});
afterEach(() => {
  cleanup();
  setTab('today');
  journalEntries.value = savedJournal;
});

describe('the tracker is The Cambridge Method', () => {
  it('titles the page, credits the Massey Standard directly under the title, and renames the footer', () => {
    const { container } = render(<StudyTrackerView camReady={ready} />);
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toBe('The Cambridge Method');
    const credit = h1.nextElementSibling!;
    expect(credit.tagName).toBe('P');
    expect(credit.classList.contains('fine')).toBe(true);
    expect(credit.textContent).toBe('Scoring system adapted from the Massey Standard');
    expect(container.querySelector('.app-foot')!.textContent).toContain('The Cambridge Method');
    expect(container.textContent).not.toContain('The Massey Standard');
    // The crest and homage stay, under "About the scoring".
    expect(container.querySelector('.mast-about summary')!.textContent).toBe('About the scoring');
    expect(container.querySelector('.mast-about .crest')).toBeTruthy();
  });

  it('no longer renders the curriculum, the problem set of the week, the Princeton group or the proof journal', () => {
    const { container } = render(<StudyTrackerView camReady={ready} />);
    const text = container.textContent!;
    expect(text).not.toContain('The theory track');
    expect(text).not.toContain('Problem set of the week');
    expect(text).not.toContain('Proof & derivation journal');
    expect(text).not.toContain('Princeton theory of computation');
    // Kept: the algorithm of the day, teaching, the paper of the week, the daily scorecard.
    expect(text).toContain('Algorithm of the day');
    expect(text).toContain('Paper of the week');
    expect(text).toContain('Rate today: missed, partial, met');
  });

  it('keeps the proof journal store untouched', () => {
    const entries = [{ id: 'j1', at: 1, title: 'Old proof', body: 'text' }];
    localStorage.setItem('meridian.proofjournal.v1', JSON.stringify(entries));
    render(<StudyTrackerView camReady={ready} />);
    expect(localStorage.getItem('meridian.proofjournal.v1')).toBe(JSON.stringify(entries));
  });
});

describe('Deep Blocks 1 and 3 follow the current Cambridge item', () => {
  const first = catalogEntries('step')[0]!;

  it('keeps every block id, so stored ticks stay valid', () => {
    expect(SCHEDULE.map((b) => b.id)).toEqual(Array.from({ length: 15 }, (_, i) => `b${i + 1}`));
  });

  it('names the item and its cold attempt, and a tick still lands on b4', async () => {
    seedCam({ items: { [first.id]: item(first.id, {}) } });
    const { container } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(row(container, 'b4').textContent).toContain(`Deep Block 1: ${first.title}, attempt cold`));
    expect(row(container, 'b7').textContent).toContain(`Deep Block 3: ${first.title}, paper and pen`);
    fireEvent.click(row(container, 'b4').querySelector('button.tick')!);
    const t = appState.get('theorist') as unknown as TheoristState;
    expect(t.day.blocks).toEqual({ b4: true });
  });

  it('moves to the supervision step once the item is written up', async () => {
    seedCam({ items: { [first.id]: item(first.id, { stage: 'written-up' }) } });
    const { container } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(row(container, 'b4').textContent).toContain(`Deep Block 1: ${first.title}, supervision`));
  });

  it('shows the redo deadline once supervised with misses', async () => {
    const at = Date.now() - 3_600_000;
    seedCam({ items: { [first.id]: item(first.id, { stage: 'supervised', supervisedAt: at, redoQs: ['q1'] }) } });
    const { container } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(row(container, 'b4').textContent).toMatch(new RegExp(`Deep Block 1: ${first.title}, redo by `)));
    expect(row(container, 'b7').textContent).toContain('Redo every miss from a blank page');
  });

  it('shows the Cambridge fallback text, never the old problem-set text, before the store is ready', () => {
    const { container } = render(<StudyTrackerView camReady={new Promise(() => {})} />);
    expect(row(container, 'b4').textContent).toContain('Deep Block 1: the Cambridge item');
    expect(row(container, 'b7').textContent).toContain('Deep Block 3: paper and pen');
    expect(container.textContent).not.toContain('pset');
  });
});

describe('the weekly Cambridge scorecard', () => {
  const scores = { s1: 2, s2: 2, s3: 2, s4: 2, s5: 0, s6: 1, s7: 1, s8: 0, s9: 2 };

  it('with no Cambridge data: rows unrated, and every meter exactly as before', async () => {
    seedTheorist({ scores });
    const { container, getByText } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(getByText('Not rated')).toBeTruthy());
    const card = container.querySelector('[data-collap="cam-week"]') ?? container;
    expect(card.textContent).toContain('No Cambridge work logged this week');
    const day = { date: todayISO(), blocks: {}, scores, banked: false };
    const before = Object.fromEntries(METERS.map(([n, ids]) => [n, meterPct(day, ids)]));
    expect(before).toEqual({ Focus: 67, Body: 75, Rest: 100, Social: 0, Progress: 75 });
    expect(meterValues(container)).toEqual(before);
  });

  it('with Cambridge work this week: shows the total and feeds Focus and Progress only', async () => {
    seedTheorist({ scores });
    const now = Date.now();
    seedCam({ awarded: { 'cam:coldAttempt:x:q1': now, 'cam:coldAttempt:x:q2': now } });
    const card = weekScorecard({ ...emptyCambridge(), awarded: { 'cam:coldAttempt:x:q1': now, 'cam:coldAttempt:x:q2': now } }, now);
    expect(card.scores.cold).toBe(2);
    const { container, getByText } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(getByText(`${card.total} / 10`)).toBeTruthy());
    expect(container.textContent).toContain(isoWeek(now));
    const day = { date: todayISO(), blocks: {}, scores, banked: false };
    const cam = cambridgeMeterInput(card);
    const want = Object.fromEntries(METERS.map(([n, ids]) => [n, meterPct(day, ids, CAM_METERS.has(n) ? cam : null)]));
    expect(meterValues(container)).toEqual(want);
    expect(want.Focus).not.toBe(67);
    expect({ Body: want.Body, Rest: want.Rest, Social: want.Social }).toEqual({ Body: 75, Rest: 100, Social: 0 });
  });

  it('the owner overrides a line, sees "Set by you", and Reset returns it to the auto value', async () => {
    const { container, getByText, getByRole } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(getByText('Not rated')).toBeTruthy());
    const group = getByRole('group', { name: 'Both supervisions held' });
    fireEvent.click(group.querySelector('button[aria-label="Met"]')!);
    const week = isoWeek(Date.now());
    const stored = (appState.get('cambridge') as unknown as CambridgeState).weeks[week]!;
    expect(stored.scores.supervisions).toBe(2);
    await waitFor(() => expect(container.textContent).toContain('Set by you'));
    expect(getByText('2 / 10')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Reset Both supervisions held to the auto score' }));
    const after = (appState.get('cambridge') as unknown as CambridgeState).weeks[week]!;
    expect(after.scores.supervisions).toBe(0);
    await waitFor(() => expect(container.textContent).not.toContain('Set by you'));
  });
});

describe('no retired course codes', () => {
  it('a decayed Princeton course never surfaces in "Reconstruct from memory", on either tab', async () => {
    // Reviewed 60 days ago: decayed to 0.25, which stalestTopic would pick.
    seedTheorist({}, { mastery: { 'MIT 18.06': { level: 1, reviewedAt: Date.now() - 60 * DAY_MS }, 'COS 226': { level: 1, reviewedAt: Date.now() - 45 * DAY_MS } } });
    const { container, getByRole } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(row(container, 'b4').textContent).toContain('attempt cold'));
    expect(container.textContent).not.toContain('Reconstruct from memory');
    for (const code of RETIRED) expect(planText(container)).not.toContain(code);
    fireEvent.click(getByRole('tab', { name: 'Playbook' }));
    await waitFor(() => expect(container.textContent).toContain('Open the Cambridge path'));
    for (const code of RETIRED) expect(planText(container)).not.toContain(code);
    // The mastery data itself is kept.
    const t = appState.get('theorist') as unknown as TheoristState;
    expect(Object.keys(t.mastery ?? {}).sort()).toEqual(['COS 226', 'MIT 18.06']);
  });

  it('spaced return still offers an old journal entry to reconstruct', () => {
    journalEntries.value = [{ id: 'j1', at: Date.now() - 20 * DAY_MS, title: 'Cauchy-Schwarz from scratch', body: '' }];
    const { container } = render(<StudyTrackerView camReady={ready} />);
    expect(container.querySelector('.pt-retrieval-topic')?.textContent).toBe('Cauchy-Schwarz from scratch');
  });
});

describe('the Playbook path summary', () => {
  it('shows the phase, the next step and supervisions this week, and links to the path', async () => {
    setTab('playbook');
    const { container } = render(<StudyTrackerView camReady={ready} />);
    await waitFor(() => expect(container.querySelector('.pt-campath-phase')).toBeTruthy());
    const box = container.querySelector('.pt-campath')!;
    expect(box.querySelector('.pt-campath-phase')!.textContent).toBe('Phase 0 · Gap check');
    expect(box.querySelector('.pt-campath-next')!.textContent).toContain('Start Phase 0: diagnostic');
    expect(box.querySelector('.pt-campath-sup')!.textContent).toBe('Supervisions this week: 0 of 2');
    expect(container.textContent).not.toContain('The path, in three climbs');
    expect(container.textContent).not.toContain('The study shelf');
  });
});
