/**
 * The Rail — Knowledge's real landing. Asserts the ≥90%-fidelity port is wired to
 * real data: the three fixed curriculum sections render in order; the current tile
 * is the FIRST topic under 60% mastery and carries the "you're here" marker; the
 * Study-next card mirrors that topic and its Study button drills in; a tile tap
 * drills into its topic; the header meter opens Progress; the "Today's path" link
 * starts the Ascent session; and with nothing due the card collapses to the calm
 * "you're current" line (no CTA).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { KnowledgeRail } from '@/features/knowledge/KnowledgeRail';
import { knowledgeActions } from '@/ui/actions';
import { appState } from '@/app/bootstrap';
import { kgItems } from '@/ui/store';
import type { KnowledgeItem } from '@/features/knowledge/types';

const Q = (id: string): KnowledgeItem => ({
  id,
  prompt: 'q ' + id,
  reveal: 'a ' + id,
  mins: 5,
  flow: 'flip',
  src: { book: 'clrs', ref: 'p1' },
});

/**
 * Seed the live stores the Rail derives from. `items` maps topic-id → question
 * list; `masteryById` marks questions mastered (≥4 counts toward percent); `dueIds`
 * schedules questions overdue (drives per-topic due counts + the studyNext card).
 */
function seed(opts: {
  items?: Record<string, KnowledgeItem[]>;
  masteryById?: Record<string, number>;
  dueIds?: string[];
}): void {
  kgItems.value = opts.items ?? {};
  const srs: Record<string, unknown> = {};
  (opts.dueIds ?? []).forEach((id) => (srs[id] = { due: '2000-01-01' }));
  appState.set('csgraph', { mastery: opts.masteryById ?? {}, gymDone: {}, srs, log: [] });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  kgItems.value = {};
  appState.set('csgraph', {});
});

describe('KnowledgeRail', () => {
  it('renders the three fixed curriculum sections in order', () => {
    seed({});
    const { container } = render(<KnowledgeRail />);
    const heads = Array.from(container.querySelectorAll('.rail-section-h')).map((h) => h.textContent);
    expect(heads).toEqual(['Foundations', 'Systems', 'Frontier']);
  });

  it('marks the FIRST topic under 60% mastery as the current "you’re here" tile', () => {
    // algorithms mastered (100% → done/solid); graph new (0% → the frontier).
    seed({ items: { algorithms: [Q('a1')], graph: [Q('g1')] }, masteryById: { a1: 5 } });
    const { container } = render(<KnowledgeRail />);
    const current = container.querySelector('.rail-tile.rail-current') as HTMLElement;
    expect(current).toBeTruthy();
    expect(current.querySelector('.rail-t-name')?.textContent).toBe('Graph Theory');
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(current.textContent).toContain('you’re here');
    // The mastered topic ahead of the frontier renders done.
    const algoTile = Array.from(container.querySelectorAll('.rail-tile')).find((t) => t.textContent?.includes('Algorithms / LC')) as HTMLElement;
    expect(algoTile.className).toContain('rail-done');
  });

  it('the single "Continue → Today’s path" CTA fires startToday — and there is no Study button', () => {
    seed({ items: { algorithms: [Q('a1')] }, dueIds: ['a1'] });
    const startSpy = vi.spyOn(knowledgeActions, 'startToday').mockImplementation(() => {});
    const { container, queryByText } = render(<KnowledgeRail />);
    expect(queryByText('Study')).toBeNull(); // the second CTA is gone
    fireEvent.click(container.querySelector('.rail-btn-continue') as HTMLElement);
    expect(startSpy).toHaveBeenCalledOnce();
  });

  it('a tile tap fires selectTopic(topic.id)', () => {
    seed({ items: { algorithms: [Q('a1')], graph: [Q('g1')] } });
    const spy = vi.spyOn(knowledgeActions, 'selectTopic').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeRail />);
    fireEvent.click(getByText('Graph Theory'));
    expect(spy).toHaveBeenCalledWith('graph');
  });

  it('the header meter fires openProgress', () => {
    seed({});
    const spy = vi.spyOn(knowledgeActions, 'openProgress').mockImplementation(() => {});
    const { container } = render(<KnowledgeRail />);
    fireEvent.click(container.querySelector('.rail-meter') as HTMLElement);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('shows the meter label counting topics that are solid (≥60%)', () => {
    // Two topics mastered → 2 of 15 solid.
    seed({ items: { algorithms: [Q('a1')], graph: [Q('g1')] }, masteryById: { a1: 5, g1: 4 } });
    const { getByText } = render(<KnowledgeRail />);
    expect(getByText('2 of 15 topics solid')).toBeTruthy();
  });

  it('with every topic ≥60% solid, the DEEPEST (last) topic is the current tile (fallback)', () => {
    // No topic is <60, so the "first <60" search returns -1 → deepest topic is current.
    const ALL = ['algorithms', 'graph', 'probstats', 'cpp', 'comparch', 'concurrency', 'linux', 'databases', 'networking', 'distributed', 'sysdesign', 'compilers', 'mlfund', 'gpu', 'behavioral'];
    const items: Record<string, KnowledgeItem[]> = {};
    const masteryById: Record<string, number> = {};
    ALL.forEach((id) => {
      const q = id + '-q';
      items[id] = [Q(q)];
      masteryById[q] = 5; // 100% → solid, so nothing is the "first <60" frontier
    });
    seed({ items, masteryById });
    const { container, getByText } = render(<KnowledgeRail />);
    const currents = container.querySelectorAll('.rail-tile.rail-current');
    expect(currents.length).toBe(1); // exactly one current, never zero or two
    expect((currents[0] as HTMLElement).querySelector('.rail-t-name')?.textContent).toBe('Behavioral'); // the deepest tile
    expect(getByText('15 of 15 topics solid')).toBeTruthy();
  });

  it('collapses to the calm "you’re current — nothing due" line when nothing is due', () => {
    seed({ items: { algorithms: [Q('a1')] } }); // items but no scheduled dues
    const { getByText, queryByText } = render(<KnowledgeRail />);
    expect(getByText(/nothing due/)).toBeTruthy();
    expect(queryByText('Study')).toBeNull(); // no shouting CTA
  });
});
