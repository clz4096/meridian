/**
 * KnowledgeView component test. Replaces the knowledge coverage that lived in the
 * deleted string-renderer suite. Asserts the charts-first Progress screen and its
 * "View questions & study" CTA, then flips kgLogOpen to exercise the study body:
 * a seeded question renders, Reveal / Recall ratings / filters / gym rows are each
 * wired to the matching knowledgeActions method, and untrusted question text is
 * escaped to inert TEXT (the injection-safety case carried from the old suite).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { KnowledgeView } from '@/features/knowledge/KnowledgeTab';
import { knowledgeActions } from '@/ui/actions';
import { appState } from '@/app/bootstrap';
import { kgLoaded, kgLogOpen, kgGym, kgTopic, kgTime, kgTarget, kgItems, kgRevealed } from '@/ui/store';
import type { KnowledgeItem } from '@/features/knowledge/types';

const QUESTION: KnowledgeItem = {
  id: 'q1',
  prompt: 'What is a hash map?',
  reveal: 'A structure mapping keys to values. Average O(1) lookup via hashing.',
  mins: 5,
  flow: 'flip',
  src: { book: 'clrs', ref: 'p1' },
};

function seedQuestions(items: KnowledgeItem[] = [QUESTION]): void {
  kgItems.value = { algorithms: items };
  // knowledgeVM() reads K.mastery / K.gymDone / K.srs unguarded; the empty
  // default store ({}) would throw, so seed a blank-but-shaped knowledge store.
  appState.set('csgraph', { mastery: {}, gymDone: {}, srs: {}, log: [] });
}

beforeEach(() => {
  // The view shows "Loading…" and kicks off a real async loadKnowledge() in its
  // effect unless the loaded-signal is already true. Pre-seed it.
  kgLoaded.value = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  kgLoaded.value = false;
  kgLogOpen.value = false;
  kgGym.value = false;
  kgTopic.value = 'algorithms';
  kgTime.value = 'all';
  kgTarget.value = 'all';
  kgItems.value = {};
  kgRevealed.value = {};
  appState.set('csgraph', {});
});

describe('KnowledgeView', () => {
  it('renders the Progress screen with the Knowledge head + mastery hero by default', () => {
    const { getByText } = render(<KnowledgeView />);
    expect(getByText('Knowledge')).toBeTruthy();
    // Hero renders the label lowercased and joined with its unit ("% mastery").
    expect(getByText('% mastery')).toBeTruthy();
    expect(getByText('View questions & study')).toBeTruthy();
  });

  it('fires knowledgeActions.toggleLog when the "View questions & study" CTA is tapped', () => {
    const toggleSpy = vi.spyOn(knowledgeActions as Required<typeof knowledgeActions>, 'toggleLog').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    fireEvent.click(getByText('View questions & study'));
    expect(toggleSpy).toHaveBeenCalledOnce();
  });

  it('renders the seeded question prompt on the study screen, and Reveal fires knowledgeActions.reveal', () => {
    seedQuestions();
    kgLogOpen.value = true;
    const revealSpy = vi.spyOn(knowledgeActions, 'reveal').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    expect(getByText('What is a hash map?')).toBeTruthy();
    fireEvent.click(getByText('Show answer'));
    expect(revealSpy).toHaveBeenCalledWith('q1');
  });

  it('fires knowledgeActions.rate with the chosen numeric score once the card is revealed', () => {
    seedQuestions();
    kgLogOpen.value = true;
    kgRevealed.value = { q1: true };
    const rateSpy = vi.spyOn(knowledgeActions, 'rate').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    const rate = container.querySelector('#rate-q1') as HTMLElement;
    const buttons = rate.querySelectorAll('button');
    fireEvent.click(buttons[3]); // Recall buttons are 1..5; index 3 => score 4
    expect(rateSpy).toHaveBeenCalledWith('q1', 4);
  });

  it('fires knowledgeActions.setTimeFilter when a question-length filter is tapped', () => {
    seedQuestions();
    kgLogOpen.value = true;
    const filterSpy = vi.spyOn(knowledgeActions, 'setTimeFilter').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    fireEvent.click(getByText('Quick · 5m'));
    expect(filterSpy).toHaveBeenCalledWith('5');
  });

  it('escapes an HTML-injection payload in the prompt to inert TEXT (never a live element)', () => {
    seedQuestions([{ ...QUESTION, id: 'q1', prompt: '<img src=x onerror="alert(1)">' }]);
    kgLogOpen.value = true;
    const { container } = render(<KnowledgeView />);
    // Preact auto-escapes text children, so the payload survives as visible text…
    expect(container.innerHTML).toContain('&lt;img');
    // …and never becomes a real <img> the browser could fire onerror on.
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('renders gym rows and fires knowledgeActions.toggleGymDone with the row key in gym mode', () => {
    seedQuestions();
    kgLogOpen.value = true;
    kgGym.value = true;
    const gymSpy = vi.spyOn(knowledgeActions, 'toggleGymDone').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    const rows = container.querySelectorAll('.goalrow');
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0].querySelector('.chk') as HTMLElement);
    expect(gymSpy).toHaveBeenCalledWith('algorithms|c|0');
  });
});
