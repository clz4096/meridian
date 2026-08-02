import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { Mastery } from '@/core/types';
import {
  formatReveal, KnowledgeViewController, MASTERY_TEXT, renderKnowledgeHTML,
  type KnowledgeActions, type KnowledgeItem, type KnowledgeViewModel,
} from '@/features/knowledge/knowledgeView';
import type { ViewHost } from '@/ui/viewHost';

const RUNS = Number(process.env.FC_RUNS ?? 150);

class FakeHost implements ViewHost {
  html = ''; binds = 0; paints = 0;
  handlers: Record<string, (e: Event) => void> = {};
  container = {
    get innerHTML() { return hostRef.html; },
    set innerHTML(v: string) { hostRef.html = v; hostRef.paints++; },
    addEventListener: (t: string, h: (e: Event) => void) => { hostRef.handlers[t] = h; hostRef.binds++; },
    querySelector: () => null,
  };
  getActiveElementId = () => null;
  getSelectionStart = () => null;
  restoreFocus = () => {};
  getScrollY = () => 0;
  setScrollY = () => {};
  captureInputValues = () => ({});
  restoreInputValues = () => {};
  fire(dataset: Record<string, string>) { this.handlers.click?.({ target: { dataset } } as unknown as Event); }
}
let hostRef: FakeHost;

const arbItem: fc.Arbitrary<KnowledgeItem> = fc.record({
  id: fc.hexaString({ minLength: 2, maxLength: 6 }),
  prompt: fc.string({ maxLength: 60 }),
  reveal: fc.string({ maxLength: 120 }),
  mins: fc.constantFrom(5, 15, 30),
  flow: fc.constantFrom('flip', 'full'),
  src: fc.record({ book: fc.constantFrom('clrs', 'cses'), ref: fc.string({ maxLength: 20 }) }),
}) as fc.Arbitrary<KnowledgeItem>;

const arbVm: fc.Arbitrary<KnowledgeViewModel> = fc.record({
  topicId: fc.constantFrom('algorithms', 'graph', '__review__', '__target__'),
  topics: fc.array(fc.record({
    id: fc.constantFrom('algorithms', 'graph'), name: fc.string({ maxLength: 14 }),
    books: fc.constant([]), total: fc.integer({ min: 0, max: 30 }),
    mastered: fc.integer({ min: 0, max: 30 }), percent: fc.integer({ min: 0, max: 100 }),
  }), { maxLength: 4 }),
  items: fc.array(arbItem, { maxLength: 5 }),
  mastery: fc.dictionary(fc.hexaString({ minLength: 2, maxLength: 6 }), fc.constantFrom(1, 2, 3, 4, 5), { maxKeys: 6 }),
  dueCount: fc.integer({ min: 0, max: 20 }),
  timeFilter: fc.constantFrom('all', '5', '15', '30'),
  target: fc.constantFrom('all', 'hft', 'dsa'),
  targets: fc.constant([['all', 'All'], ['hft', 'HFT'], ['dsa', 'DSA']] as const),
  targetCount: fc.integer({ min: 0, max: 100 }),
  gymMode: fc.boolean(),
  gym: fc.constant(null),
  sources: fc.array(fc.record({ title: fc.string({ maxLength: 12 }), url: fc.webUrl() }), { maxLength: 3 }),
  revealed: fc.dictionary(fc.hexaString({ minLength: 2, maxLength: 6 }), fc.boolean(), { maxKeys: 4 }),
  logOpen: fc.constant(true), // render the questions expanded for these content assertions
}) as fc.Arbitrary<KnowledgeViewModel>;

describe('knowledge renderer', () => {
  it('produces balanced markup with no undefined or NaN', () => {
    fc.assert(fc.property(arbVm, (vm) => {
      const html = renderKnowledgeHTML(vm);
      expect((html.match(/<div/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('NaN');
    }), { numRuns: RUNS });
  });

  it('escapes prompts, reveals and source titles', () => {
    fc.assert(fc.property(arbVm, fc.constant('<img src=x onerror=alert(1)>'), (vm, nasty) => {
      const poisoned: KnowledgeViewModel = {
        ...vm, gymMode: false, topicId: 'algorithms',
        items: [{ id: 'x', prompt: nasty, reveal: nasty, mins: 15, flow: 'full', src: { book: 'clrs', ref: nasty } }],
      };
      const html = renderKnowledgeHTML(poisoned);
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img');
    }), { numRuns: Math.min(RUNS, 200) });
  });

  it('is deterministic', () => {
    fc.assert(fc.property(arbVm, (vm) => {
      expect(renderKnowledgeHTML(vm)).toBe(renderKnowledgeHTML(vm));
    }), { numRuns: RUNS });
  });

  it('renders one card per item, with a rating control each', () => {
    fc.assert(fc.property(arbVm, (vm) => {
      const shown: KnowledgeViewModel = { ...vm, gymMode: false };
      const html = renderKnowledgeHTML(shown);
      if (shown.items.length === 0) return;
      expect((html.match(/class="qcard"/g) ?? []).length).toBe(shown.items.length);
      expect((html.match(/data-act="rate"/g) ?? []).length).toBe(shown.items.length * 5);
    }), { numRuns: RUNS });
  });

  it('formatReveal bolds the lead sentence and escapes the rest', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const out = formatReveal(s);
      expect(out).not.toMatch(/<(?!\/?(b|div)\b)[a-z]/i);
    }), { numRuns: RUNS });
    expect(formatReveal('First. Second part.')).toContain('<b style="color:var(--text)">First.</b>');
  });

  it('mastery labels cover every rating', () => {
    for (const n of [0, 1, 2, 3, 4, 5]) expect(MASTERY_TEXT[n]).toBeTruthy();
  });
});

describe('knowledge controller', () => {
  const base = (): KnowledgeViewModel => ({
    topicId: 'algorithms',
    topics: [{ id: 'algorithms', name: 'Algorithms', books: [], total: 22, mastered: 4, percent: 18 }],
    items: [{ id: 'q1', prompt: 'p', reveal: 'r. rest', mins: 15, flow: 'full', src: { book: 'clrs', ref: 'Ch1' } }],
    mastery: {}, dueCount: 3, timeFilter: 'all', target: 'all',
    targets: [['all', 'All'], ['hft', 'HFT']], targetCount: 0,
    gymMode: false, gym: null, sources: [], revealed: {}, logOpen: true,
  });

  it('binds once across many repaints and skips identical ones', () => {
    hostRef = new FakeHost();
    const actions = Object.fromEntries(
      ['selectTopic','setTimeFilter','setTarget','studyAllTagged','startReview','toggleGym','toggleGymDone','reveal','rate','queueForReview','gradeWithAI'].map((k) => [k, vi.fn()]),
    ) as unknown as KnowledgeActions;
    const ctrl = new KnowledgeViewController(hostRef, actions);
    for (let i = 0; i < 30; i++) ctrl.repaint(base());
    expect(hostRef.binds).toBe(1);
    expect(hostRef.paints).toBe(1);
  });

  it('routes every action from the delegated listener', () => {
    hostRef = new FakeHost();
    const actions = Object.fromEntries(
      ['selectTopic','setTimeFilter','setTarget','studyAllTagged','startReview','toggleGym','toggleGymDone','reveal','rate','queueForReview','gradeWithAI'].map((k) => [k, vi.fn()]),
    ) as unknown as KnowledgeActions;
    new KnowledgeViewController(hostRef, actions).repaint(base());

    hostRef.fire({ act: 'topic', id: 'graph' });
    expect(actions.selectTopic).toHaveBeenCalledWith('graph');
    hostRef.fire({ act: 'rate', id: 'q1', score: '4' });
    expect(actions.rate).toHaveBeenCalledWith('q1', 4 as Mastery);
    hostRef.fire({ act: 'reveal', id: 'q1' });
    expect(actions.reveal).toHaveBeenCalledWith('q1');
    hostRef.fire({ act: 'queue', id: 'q1' });
    expect(actions.queueForReview).toHaveBeenCalledWith('q1');
    hostRef.fire({ act: 'gym-done', key: 'algorithms|c|0' });
    expect(actions.toggleGymDone).toHaveBeenCalledWith('algorithms|c|0');
    hostRef.fire({ act: 'gym' });
    expect(actions.toggleGym).toHaveBeenCalled();
    hostRef.fire({});
    expect(actions.startReview).not.toHaveBeenCalled();
  });

  it('rating always coerces to a valid 1-5 score', () => {
    hostRef = new FakeHost();
    const rate = vi.fn();
    const actions = { ...Object.fromEntries(['selectTopic','setTimeFilter','setTarget','studyAllTagged','startReview','toggleGym','toggleGymDone','reveal','queueForReview','gradeWithAI'].map((k) => [k, vi.fn()])), rate } as unknown as KnowledgeActions;
    new KnowledgeViewController(hostRef, actions).repaint(base());
    for (const bad of ['', 'abc', '0', '99', undefined as unknown as string]) {
      hostRef.fire({ act: 'rate', id: 'q1', score: bad });
    }
    for (const call of rate.mock.calls) {
      expect(call[1]).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(call[1])).toBe(true);
    }
  });
});
