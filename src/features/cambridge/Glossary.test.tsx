/**
 * Glossary screen: the full list, search as you type (term, meaning, US
 * equivalent, match words), the empty result, and landing on a linked term.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import glossaryJson from '@data/cambridge/glossary.json';
import { glossaryData, glossaryTarget, type GlossaryData } from '@/features/cambridge/Gloss';
import { GlossaryView, filterTerms } from '@/features/cambridge/Glossary';

const data = glossaryJson as unknown as GlossaryData;
const N = data.terms.length;

beforeEach(() => {
  glossaryData.value = data;
});
afterEach(() => {
  cleanup();
  glossaryTarget.value = null;
});

describe('filterTerms', () => {
  it('matches the term, meaning, US equivalent and match words, ignoring case', () => {
    expect(filterTerms(data.terms, 'tripo').map((t) => t.id)).toContain('tripos');
    expect(filterTerms(data.terms, 'OFFICE HOURS').map((t) => t.id)).toEqual(['supervision']);
    expect(filterTerms(data.terms, 'lent term').map((t) => t.id)).toEqual(['michaelmas-lent-easter']);
    expect(filterTerms(data.terms, '  ')).toHaveLength(N);
  });
});

describe('GlossaryView', () => {
  it('lists every term with its meaning and US equivalent', () => {
    const { container, getByText } = render(<GlossaryView />);
    expect(container.querySelectorAll('.cam-gloss > div')).toHaveLength(N);
    expect(getByText(`${N} terms`)).toBeTruthy();
    const sup = container.querySelector('#g-supervision')!;
    expect(sup.querySelector('dt')!.textContent).toBe('Supervision');
    expect(sup.textContent).toContain('Office hours + oral quiz');
  });

  it('filters as you type and announces the count', () => {
    const { container, getByLabelText } = render(<GlossaryView />);
    fireEvent.input(getByLabelText('Search the glossary'), { target: { value: 'supervis' } });
    const ids = [...container.querySelectorAll('.cam-gloss > div')].map((d) => d.id);
    expect(ids).toEqual(['g-supervision', 'g-supervisor', 'g-supervision-work']); // 'Supervision work' is a CST term (cs track, C11)
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe(`3 of ${N} terms`);
  });

  it('empty result: says so and offers Clear search', () => {
    const { getByLabelText, getByText, getByRole, container } = render(<GlossaryView />);
    const input = getByLabelText('Search the glossary') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'zzqx' } });
    expect(getByText("No term matches 'zzqx'.")).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Clear search' }));
    expect(input.value).toBe('');
    expect(container.querySelectorAll('.cam-gloss > div')).toHaveLength(N);
  });

  it('shows a same-size skeleton while loading', () => {
    glossaryData.value = null;
    const { container } = render(<GlossaryView />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('lands on the term a popover link asked for', () => {
    glossaryTarget.value = 'tripos';
    const { container } = render(<GlossaryView />);
    expect(document.activeElement).toBe(container.querySelector('#g-tripos dt'));
    expect(container.querySelector('#g-tripos')!.getAttribute('data-flash')).toBe('true');
    expect(glossaryTarget.value).toBeNull();
  });
});
