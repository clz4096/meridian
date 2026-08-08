/**
 * AscentSession component test — the motion crux + the data-driven moments,
 * driven with fake timers.
 *
 * The consensus's #1 requirement is that the card recede→advance replays on ONE
 * persistent node (never key-remounted). So the central test grades a card and
 * asserts the exact class sequence on the SAME DOM node: 'recede' → (cursor bump)
 * 'enter' → '' — proving both the choreography and the no-remount invariant.
 * Also: a promotion receipt fires when a grade crosses a mastery band, and the
 * reduced-motion path skips the transform classes while still advancing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { AscentSession } from '@/features/knowledge/AscentSession';
import { appState } from '@/app/bootstrap';
import { kgItems, kgTopic } from '@/ui/store';
import type { KnowledgeItem } from '@/features/knowledge/types';

const WORDS = ['zero', 'one', 'two', 'three'];

/** Seed `n` brand-new (unseen) flip cards + a blank-but-shaped knowledge/core store. */
function seedFresh(n: number): void {
  const items: KnowledgeItem[] = [];
  for (let i = 0; i < n; i++) {
    items.push({ id: 'c' + i, prompt: 'Prompt ' + WORDS[i], reveal: 'Answer ' + WORDS[i], mins: 5, flow: 'flip', src: { book: 'clrs', ref: 'p' + i } });
  }
  kgItems.value = { synthetic: items };
  appState.set('csgraph', { mastery: {}, srs: {}, log: [], gymDone: {} });
  appState.set('core', { entries: [], schedule: {}, todos: [], scratch: [], _del: {} });
}

const card = (root: Element): HTMLElement => root.querySelector('.asc-card') as HTMLElement;
const beginRevealGrade = (root: Element, dataG: string): void => {
  fireEvent.click(root.querySelector('.asc-btn-reveal') as HTMLElement); // Reveal
  fireEvent.click(root.querySelector(`.asc-grade[data-g="${dataG}"]`) as HTMLElement);
};

beforeEach(() => {
  kgTopic.value = '__today__';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
  kgItems.value = {};
  appState.set('csgraph', {});
  appState.set('core', {});
});

describe('AscentSession — motion crux', () => {
  it('replays recede → cursor-bump → enter on the ONE persistent card node', () => {
    vi.useFakeTimers();
    seedFresh(2);
    const { container, getByText } = render(<AscentSession />);
    fireEvent.click(getByText('Begin the climb'));

    const node = card(container);
    expect(node.querySelector('.asc-prompt')!.textContent).toContain('Prompt zero');

    beginRevealGrade(container, 'good'); // Good = 420ms recede

    // 1) recede applied immediately, still card zero, still the same node
    expect(card(container)).toBe(node);
    expect(node.className).toContain('recede');
    expect(node.querySelector('.asc-prompt')!.textContent).toContain('Prompt zero');

    // 2) after the recede delay: cursor bumped to card one, class flips to enter —
    //    and it is STILL the same DOM node (never remounted / key-swapped)
    act(() => { vi.advanceTimersByTime(420); });
    expect(card(container)).toBe(node);
    expect(node.className).toContain('enter');
    expect(node.querySelector('.asc-prompt')!.textContent).toContain('Prompt one');

    // 3) the reflow shim's rAF releases 'enter' → neutral (entrance keyframe plays)
    act(() => { vi.advanceTimersByTime(32); });
    expect(card(container).className).not.toContain('enter');
    expect(card(container).className).not.toContain('recede');
  });

  it('an Again grade uses the longer 620ms recede window before advancing', () => {
    vi.useFakeTimers();
    seedFresh(2);
    const { container, getByText } = render(<AscentSession />);
    fireEvent.click(getByText('Begin the climb'));
    beginRevealGrade(container, 'again');

    // not advanced yet at 420 (the Good timing) — Again holds longer
    act(() => { vi.advanceTimersByTime(420); });
    expect(card(container).querySelector('.asc-prompt')!.textContent).toContain('Prompt zero');
    // the Again reassurance line reflects the REAL interval ("tomorrow", not "<10m")
    expect(card(container).querySelector('.asc-again-note')!.textContent).toContain('tomorrow');

    act(() => { vi.advanceTimersByTime(200); }); // total 620
    expect(card(container).querySelector('.asc-prompt')!.textContent).toContain('Prompt one');
  });
});

describe('AscentSession — data moments', () => {
  it('fires a promotion receipt when a grade crosses a mastery band upward', () => {
    vi.useFakeTimers();
    seedFresh(1);
    const { container, getByText } = render(<AscentSession />);
    fireEvent.click(getByText('Begin the climb'));
    beginRevealGrade(container, 'good'); // new(band0) → solid(band3): a promotion

    const receipt = container.querySelector('.asc-receipt') as HTMLElement;
    expect(receipt.className).toContain('show');
    expect(receipt.textContent).toContain('new → solid');
  });

  it('lands on the summit ledger after the last card, showing solid/newly-learned counts', () => {
    vi.useFakeTimers();
    seedFresh(1);
    const { container, getByText } = render(<AscentSession />);
    fireEvent.click(getByText('Begin the climb'));
    beginRevealGrade(container, 'good');
    act(() => { vi.advanceTimersByTime(420); }); // last card → summit

    expect(getByText('Done for today.')).toBeTruthy();
    const ledger = container.querySelector('.asc-ledger') as HTMLElement;
    expect(ledger.textContent).toContain('1 solid');
    expect(ledger.textContent).toContain('1 newly learned');
  });

  it('shows the caught-up panel when nothing is due or new', () => {
    seedFresh(0);
    const { getByText } = render(<AscentSession />);
    expect(getByText('Nothing due today.')).toBeTruthy();
  });
});

describe('AscentSession — reduced motion', () => {
  it('skips the recede/enter transform classes but still advances the cursor', () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn().mockReturnValue({
      matches: true, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    });
    vi.useFakeTimers();
    seedFresh(2);
    const { container, getByText } = render(<AscentSession />);
    fireEvent.click(getByText('Begin the climb'));
    beginRevealGrade(container, 'good');

    // no recede class in reduced mode
    expect(card(container).className).not.toContain('recede');

    // still advances, on the shorter 120ms path, with no enter class
    act(() => { vi.advanceTimersByTime(120); });
    expect(card(container).querySelector('.asc-prompt')!.textContent).toContain('Prompt one');
    expect(card(container).className).not.toContain('enter');
  });
});
