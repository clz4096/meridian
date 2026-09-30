/**
 * ReadingBlock: the paper of the week and its next Keshav pass, in every state
 * (loading, content, all passes done, empty, error, offline).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { ReadingBlock, papersMod, readingView } from '@/features/today/ReadingBlock';
import { clockTime, page, writeSaved } from '@/features/today/lazyContent';
import * as actions from '@/ui/actions';
import { clockNow } from '@/ui/store';

type PapersModule = typeof import('@/features/studytracker/papers');
let papers: PapersModule;
const NOW = new Date(2026, 8, 29, 8, 14).getTime();

beforeAll(async () => {
  papers = await import('@/features/studytracker/papers');
});
beforeEach(() => {
  clockNow.value = NOW;
  vi.spyOn(papersMod, 'load').mockResolvedValue();
  papersMod.mod.value = null;
  papersMod.failed.value = false;
  papers.paperProgress.value = {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  papersMod.mod.value = null;
  papersMod.failed.value = false;
  papers.paperProgress.value = {};
});

describe('ReadingBlock', () => {
  it('loading: a skeleton the size of the card', () => {
    const { getByLabelText } = render(<ReadingBlock />);
    expect(getByLabelText("Loading today's reading").classList.contains('td-read')).toBe(true);
  });

  it('content: the next pass with its time, and marking it done moves to the next', () => {
    papersMod.mod.value = papers;
    const p = papers.paperOfWeek(new Date(NOW))!;
    const { getByText, container } = render(<ReadingBlock />);
    expect(getByText('Pass 1 of 3 · Triage')).toBeTruthy();
    expect(getByText('~10 min')).toBeTruthy();
    expect(container.querySelector('.td-read-title')!.textContent).toBe(p.title);
    fireEvent.click(getByText('Mark Triage done'));
    expect(getByText('Pass 2 of 3 · Grasp')).toBeTruthy();
    expect(getByText('~60 min')).toBeTruthy();
    papers.paperProgress.value = { [papers.paperKey(p)]: [true, true, false] };
    const v = readingView(papers, new Date(NOW))!;
    expect(v.pass).toBe(2);
  });

  it('shows ~3 h for the third pass', () => {
    papersMod.mod.value = papers;
    const p = papers.paperOfWeek(new Date(NOW))!;
    papers.paperProgress.value = { [papers.paperKey(p)]: [true, true, false] };
    const { getByText } = render(<ReadingBlock />);
    expect(getByText('Pass 3 of 3 · Reproduce')).toBeTruthy();
    expect(getByText('~3 h')).toBeTruthy();
  });

  it('all three passes done: "Done this week" and next week\'s paper', () => {
    papersMod.mod.value = papers;
    const now = new Date(NOW);
    const p = papers.paperOfWeek(now)!;
    const next = papers.paperOfWeek(new Date(NOW + 7 * 86_400_000))!;
    papers.paperProgress.value = { [papers.paperKey(p)]: [true, true, true] };
    const { getByText, queryByText } = render(<ReadingBlock />);
    expect(getByText('Done this week')).toBeTruthy();
    expect(getByText(`Next week: ${next.title}`)).toBeTruthy();
    expect(queryByText(/^Mark /)).toBeNull();
  });

  it('empty: no paper gives one line and the next step', () => {
    papersMod.mod.value = { ...papers, paperOfWeek: () => undefined };
    const spy = vi.spyOn(actions, 'openSection').mockImplementation(() => {});
    const { getByText } = render(<ReadingBlock />);
    expect(getByText('No paper this week.')).toBeTruthy();
    fireEvent.click(getByText('Open the Cambridge Method'));
    expect(spy).toHaveBeenCalledWith('tracker');
  });

  it('error: says what failed, and Try again reloads', () => {
    papersMod.failed.value = true;
    const reload = vi.spyOn(page, 'reload').mockImplementation(() => {});
    const { getByRole, getByText } = render(<ReadingBlock />);
    expect(getByRole('alert').textContent).toContain("Today's reading didn't load.");
    fireEvent.click(getByText('Try again'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('offline: the saved card with "Offline · Saved h:mm a"', () => {
    const at = NOW - 3_600_000;
    writeSaved('reading', { title: 'A Saved Paper', authors: 'Someone (1999)', area: 'Systems', url: 'https://example.org', pass: 1, passName: 'Grasp', nextWeek: null }, at);
    papersMod.failed.value = true;
    const { getByText, queryByRole, queryByText } = render(<ReadingBlock />);
    expect(getByText('A Saved Paper')).toBeTruthy();
    expect(getByText(`Offline · Saved ${clockTime(at)}`)).toBeTruthy();
    expect(queryByRole('alert')).toBeNull();
    expect(queryByText(/^Mark /)).toBeNull(); // can't tick a pass without the module
  });
});
