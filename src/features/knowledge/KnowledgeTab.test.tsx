/**
 * KnowledgeView component test. Asserts the gate lands on the Rail by default
 * (detail lives in KnowledgeRail.test.tsx), then exercises the study body via
 * kgOverview=false: a seeded question renders, Reveal / the 4 FSRS grade buttons /
 * filters / gym rows are each wired to the matching knowledgeActions method, and
 * untrusted question text is escaped to inert TEXT (injection safety). Also covers
 * the secondary Progress (charts) view reached via kgProgressOpen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { KnowledgeView } from '@/features/knowledge/KnowledgeTab';
import { knowledgeActions } from '@/ui/actions';
import { appState } from '@/app/bootstrap';
import { kgLoaded, kgProgressOpen, kgGym, kgTopic, kgTime, kgTarget, kgItems, kgRevealed, kgOverview } from '@/ui/store';
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
  kgProgressOpen.value = false;
  kgOverview.value = true;
  kgGym.value = false;
  kgTopic.value = 'algorithms';
  kgTime.value = 'all';
  kgTarget.value = 'all';
  kgItems.value = {};
  kgRevealed.value = {};
  appState.set('csgraph', {});
});

describe('KnowledgeView', () => {
  it('lands on the Rail by default — the three fixed sections + topic tiles (via the gate)', () => {
    const { container, getByText } = render(<KnowledgeView />);
    const heads = Array.from(container.querySelectorAll('.rail-section-h')).map((h) => h.textContent);
    expect(heads).toEqual(['Foundations', 'Systems', 'Frontier']);
    // A couple of the 15 fixed topic names render as rail tiles.
    expect(getByText('Algorithms / LC')).toBeTruthy();
    expect(getByText('Graph Theory')).toBeTruthy();
  });

  it('fires knowledgeActions.openProgress when the Rail’s header meter is tapped', () => {
    const progSpy = vi.spyOn(knowledgeActions, 'openProgress').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    fireEvent.click(container.querySelector('.rail-meter') as HTMLElement);
    expect(progSpy).toHaveBeenCalledOnce();
  });

  it('renders the secondary Progress (charts) view when kgProgressOpen, back → gallery via browseTopics', () => {
    kgProgressOpen.value = true;
    const browseSpy = vi.spyOn(knowledgeActions, 'browseTopics').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    expect(getByText('Knowledge')).toBeTruthy(); // SecHero eyebrow
    expect(getByText('% mastery')).toBeTruthy(); // SecHero unit next to the value
    fireEvent.click(getByText('‹ Topics'));
    expect(browseSpy).toHaveBeenCalledOnce();
  });

  it('renders topic cards on the gallery and tapping a topic fires selectTopic', () => {
    seedQuestions();
    const selectSpy = vi.spyOn(knowledgeActions, 'selectTopic').mockImplementation(() => {});
    const { getByText, getAllByText } = render(<KnowledgeView />);
    expect(getByText('Algorithms / LC')).toBeTruthy();
    expect(getByText('Graph Theory')).toBeTruthy();
    // The card's name button drills into that topic.
    fireEvent.click(getAllByText('Algorithms / LC')[0]);
    expect(selectSpy).toHaveBeenCalledWith('algorithms');
  });

  it('renders the seeded question prompt on the study screen, and Reveal fires knowledgeActions.reveal', () => {
    seedQuestions();
    kgOverview.value = false;
    const revealSpy = vi.spyOn(knowledgeActions, 'reveal').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    expect(getByText('What is a hash map?')).toBeTruthy();
    fireEvent.click(getByText('Show answer'));
    expect(revealSpy).toHaveBeenCalledWith('q1');
  });

  it('fires knowledgeActions.rate with the FSRS grade once the card is revealed', () => {
    seedQuestions();
    kgOverview.value = false;
    kgRevealed.value = { q1: true };
    const rateSpy = vi.spyOn(knowledgeActions, 'rate').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    const rate = container.querySelector('#rate-q1') as HTMLElement;
    const buttons = rate.querySelectorAll('button');
    // Grades are Again/Hard/Good/Easy = 1/2/3/4; index 3 => Easy => grade 4.
    fireEvent.click(buttons[3]);
    expect(rateSpy).toHaveBeenCalledWith('q1', 4);
  });

  it('shows the belonging headline + trail band, and the topic switcher fires selectTopic', () => {
    seedQuestions();
    kgOverview.value = false;
    const selectSpy = vi.spyOn(knowledgeActions, 'selectTopic').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    // Base Camp hero: belonging progress + the forward-looking trail.
    expect(getByText(/You.*ve mastered/)).toBeTruthy();
    expect(getByText(/Your trail up/)).toBeTruthy();
    // The Switch menu lists every topic; picking a different one drills into it.
    fireEvent.click(getByText('Graph Theory'));
    expect(selectSpy).toHaveBeenCalledWith('graph');
  });

  it('fires knowledgeActions.answerWithAI when the AI-answer button is tapped', () => {
    seedQuestions();
    kgOverview.value = false;
    const aiSpy = vi.spyOn(knowledgeActions, 'answerWithAI').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    fireEvent.click(getByText('AI answer'));
    expect(aiSpy).toHaveBeenCalledWith('q1');
  });

  it('fires knowledgeActions.setTimeFilter when a question-length filter is tapped', () => {
    seedQuestions();
    kgOverview.value = false;
    const filterSpy = vi.spyOn(knowledgeActions, 'setTimeFilter').mockImplementation(() => {});
    const { getByText } = render(<KnowledgeView />);
    fireEvent.click(getByText('Quick · 5m'));
    expect(filterSpy).toHaveBeenCalledWith('5');
  });

  it('escapes an HTML-injection payload in the prompt to inert TEXT (never a live element)', () => {
    seedQuestions([{ ...QUESTION, id: 'q1', prompt: '<img src=x onerror="alert(1)">' }]);
    kgOverview.value = false;
    const { container } = render(<KnowledgeView />);
    // Preact auto-escapes text children, so the payload survives as visible text…
    expect(container.innerHTML).toContain('&lt;img');
    // …and never becomes a real <img> the browser could fire onerror on.
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('renders gym rows and fires knowledgeActions.toggleGymDone with the row key in gym mode', () => {
    seedQuestions();
    kgOverview.value = false;
    kgGym.value = true;
    const gymSpy = vi.spyOn(knowledgeActions, 'toggleGymDone').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    const rows = container.querySelectorAll('.goalrow');
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0].querySelector('.chk') as HTMLElement);
    expect(gymSpy).toHaveBeenCalledWith('algorithms|c|0');
  });
});
