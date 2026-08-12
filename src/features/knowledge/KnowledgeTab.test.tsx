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
import { kgLoaded, kgProgressOpen, kgGym, kgTopic, kgTime, kgTarget, kgItems, kgRevealed, kgGraded, kgOverview, kgSession, kgInterview } from '@/ui/store';
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
  // These tests exercise the At-Home flow; the tab now opens on a mode chooser, so
  // select home mode explicitly (the chooser itself is covered separately below).
  kgSession.value = 'home';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  kgLoaded.value = false;
  kgProgressOpen.value = false;
  kgSession.value = 'choose';
  kgInterview.value = '';
  kgOverview.value = true;
  kgGym.value = false;
  kgTopic.value = 'algorithms';
  kgTime.value = 'all';
  kgTarget.value = 'all';
  kgItems.value = {};
  kgRevealed.value = {};
  kgGraded.value = {};
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

  it('renders the secondary Progress (charts) view when kgProgressOpen (back is now the chrome Back → handleBack)', () => {
    kgProgressOpen.value = true;
    const { getByText, container } = render(<KnowledgeView />);
    expect(getByText('Knowledge')).toBeTruthy(); // SecHero eyebrow
    expect(getByText('% mastery')).toBeTruthy(); // SecHero unit next to the value
    // The in-page "‹ Topics" back was retired; Progress→gallery is the chrome Back
    // (handleBack, covered in actions.test). Assert no stray in-page back remains.
    expect(container.querySelector('.backbtn')).toBeNull();
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

  it('renders the seeded question prompt on the topic screen, and Reveal fires knowledgeActions.reveal', () => {
    seedQuestions();
    kgOverview.value = false;
    const revealSpy = vi.spyOn(knowledgeActions, 'reveal').mockImplementation(() => {});
    const { getByText, container } = render(<KnowledgeView />);
    expect(getByText('What is a hash map?')).toBeTruthy();
    fireEvent.click(container.querySelector('.tpc-reveal') as HTMLElement);
    expect(revealSpy).toHaveBeenCalledWith('q1');
  });

  it('renders the topic screen’s calm column — header, tucked effort + 🎧 Gym, cards with an honest effort chip, and NO "Studying for"', () => {
    seedQuestions();
    kgOverview.value = false;
    const { container, getByText, queryByText } = render(<KnowledgeView />);
    expect(container.querySelector('.tpc-head')).toBeTruthy(); // ‹ back · topic · mastery% · N due
    expect(container.querySelector('.tpc-effort')).toBeTruthy(); // the Effort filter
    expect(container.querySelector('.tpc-gym')).toBeTruthy(); // the 🎧 Gym entry
    expect(getByText(/5 min/)).toBeTruthy(); // effort chip = honest length, never a difficulty badge
    expect(queryByText('Studying for')).toBeNull(); // the target filter is cut
    expect(queryByText(/Your trail up/)).toBeNull(); // the trail band is cut
  });

  it('the 🎧 Gym entry fires knowledgeActions.toggleGym', () => {
    seedQuestions();
    kgOverview.value = false;
    const gymSpy = vi.spyOn(knowledgeActions, 'toggleGym').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    fireEvent.click(container.querySelector('.tpc-gym') as HTMLElement);
    expect(gymSpy).toHaveBeenCalledOnce();
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

  it('grading a topic card LOCKS it — reviewed note, grade buttons gone (no re-log)', () => {
    seedQuestions();
    kgOverview.value = false;
    kgRevealed.value = { q1: true };
    vi.spyOn(knowledgeActions, 'rate').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    fireEvent.click((container.querySelector('#rate-q1') as HTMLElement).querySelectorAll('button')[2]); // Good
    expect(kgGraded.value.q1).toBeTruthy(); // card marked reviewed → locked
    const card = container.querySelector('#qc-q1') as HTMLElement;
    expect(card.className).toContain('reviewed'); // dimmed
    expect(container.querySelector('#rate-q1')).toBeNull(); // grade buttons gone — can't re-grade/re-log
    expect(card.textContent).toContain('reviewed'); // the confirmation note
  });

  it('the "Review N due →" row launches the focused review — startReview(topicId)', () => {
    kgItems.value = { algorithms: [QUESTION] };
    appState.set('csgraph', { mastery: {}, gymDone: {}, srs: { q1: { due: '2000-01-01' } }, log: [] });
    kgOverview.value = false;
    const spy = vi.spyOn(knowledgeActions, 'startReview').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    const row = container.querySelector('.tpc-review') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('1 due');
    fireEvent.click(row);
    expect(spy).toHaveBeenCalledWith('algorithms');
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
    fireEvent.click(getByText('5m'));
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

  it('builds the deep-link href and renders practice + Also rows on a TopicCard', () => {
    // clrs's book url is a .pdf → page deep-links to #page=N; practice(single) + see(2).
    seedQuestions([
      {
        ...QUESTION,
        id: 'q1',
        src: { book: 'clrs', ref: '§2.1 Insertion sort', page: 7 },
        practice: { label: 'LC 15 · 3Sum', url: 'https://leetcode.com/problems/3sum/' },
        see: [
          { label: 'Fortnow · Foundations', url: 'https://blog.computationalcomplexity.org/x.html' },
          { label: 'cpu.land', url: 'https://cpu.land/' },
        ],
      },
    ]);
    kgOverview.value = false;
    const { container } = render(<KnowledgeView />);
    const srcA = container.querySelector('.qsrc a') as HTMLAnchorElement;
    expect(srcA.getAttribute('href')).toContain('#page=7');
    expect(srcA.getAttribute('rel')).toBe('noopener noreferrer');
    expect(srcA.getAttribute('target')).toBe('_blank');
    expect(container.querySelectorAll('.qpractice-link').length).toBe(1);
    expect(container.querySelectorAll('.qsee a').length).toBe(2);
  });

  it('renders no practice/Also rows and identical source markup for a plain (no-new-fields) question', () => {
    seedQuestions(); // QUESTION has no page/anchor/practice/see
    kgOverview.value = false;
    const { container } = render(<KnowledgeView />);
    // backward-compat: the source is a plain book link (no #frag), no extras render.
    const srcA = container.querySelector('.qsrc a') as HTMLAnchorElement;
    expect(srcA.getAttribute('href')).not.toContain('#');
    expect(container.querySelector('.qpractice')).toBeNull();
    expect(container.querySelector('.qsee')).toBeNull();
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

describe('KnowledgeView — study-mode router', () => {
  it('opens on the mode chooser and routes At Home / Gym / Interview to the right action', () => {
    seedQuestions();
    kgSession.value = 'choose';
    const spy = vi.spyOn(knowledgeActions, 'chooseMode').mockImplementation(() => {});
    const { container, getByText } = render(<KnowledgeView />);
    expect(container.querySelector('.kgchooser')).toBeTruthy();
    fireEvent.click(getByText('At Home'));
    expect(spy).toHaveBeenCalledWith('home');
    fireEvent.click(getByText('At the Gym'));
    expect(spy).toHaveBeenCalledWith('gym');
    fireEvent.click(getByText('Interview Prep'));
    expect(spy).toHaveBeenCalledWith('interview');
  });

  it('interview mode shows the type picker and fires pickInterview with the preset id', () => {
    seedQuestions();
    kgSession.value = 'interview';
    kgInterview.value = ''; // not yet chosen → picker
    const spy = vi.spyOn(knowledgeActions, 'pickInterview').mockImplementation(() => {});
    const { container, getByText } = render(<KnowledgeView />);
    expect(container.querySelector('.kgpicker')).toBeTruthy();
    fireEvent.click(getByText('HFT / Quant'));
    expect(spy).toHaveBeenCalledWith('hft');
  });

  it('gym mode shows the topic picker and fires pickGymTopic', () => {
    seedQuestions();
    kgSession.value = 'gym';
    kgGym.value = false; // topic not chosen → picker
    const spy = vi.spyOn(knowledgeActions, 'pickGymTopic').mockImplementation(() => {});
    const { container } = render(<KnowledgeView />);
    expect(container.querySelector('.kgpicker')).toBeTruthy();
    const first = container.querySelector('.kgpick') as HTMLElement;
    expect(first).toBeTruthy();
    fireEvent.click(first);
    expect(spy).toHaveBeenCalled();
  });
});
