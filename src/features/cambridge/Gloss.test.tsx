/**
 * <Gloss>: the matching rules (whole words, acronym case, first occurrence per
 * block, longest match) and the popover's accessibility (expanded state, the
 * labelled dialog, Escape, outside tap, one open at a time, the glossary link).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import glossaryJson from '@data/cambridge/glossary.json';
import { Gloss, glossaryData, glossaryTarget, segment, type GlossaryData } from '@/features/cambridge/Gloss';
import { currentTab } from '@/ui/store';

const data = glossaryJson as unknown as GlossaryData;

/** The glossed words of a text block, as matched. */
const hits = (text: string, d: GlossaryData = data): string[] =>
  segment(text, d).flatMap((s) => (typeof s === 'string' ? [] : [s.text]));

describe('segment: matching rules', () => {
  it('acronyms match only in their own case', () => {
    expect(hits('Sit STEP I this year')).toEqual(['STEP']);
    expect(hits('One step at a time')).toEqual([]);
    expect(hits('OCR and ocr')).toEqual(['OCR']);
  });

  it('a phrase containing an acronym is case-sensitive too', () => {
    // "Step 2 of 5" is the study loop, not the STEP 2 exam.
    expect(hits('Step 2 of 5: attempt cold')).toEqual([]);
    expect(hits('Then STEP 2 papers')).toEqual(['STEP 2']);
  });

  it('other words ignore case', () => {
    expect(hits('Supervision due')).toEqual(['Supervision']);
    expect(hits('the TRIPOS')).toEqual(['TRIPOS']);
  });

  it('whole words only', () => {
    expect(hits('supervisory notes, STEPS, CSTs')).toEqual([]);
    expect(hits('(supervision)')).toEqual(['supervision']);
  });

  it('prefers the longest match', () => {
    expect(hits('Part III is optional')).toEqual(['Part III']);
    expect(hits('two supervisions a week')).toEqual(['supervisions']);
  });

  it('underlines only the first occurrence of a term per block', () => {
    const segs = segment('A supervision, then supervisions, then a supervisor.', data);
    expect(segs.filter((s) => typeof s !== 'string').map((s) => (s as { text: string }).text)).toEqual([
      'supervision',
      'supervisor',
    ]);
    // Nothing is lost: the plain runs and the terms rebuild the text.
    expect(segs.map((s) => (typeof s === 'string' ? s : s.text)).join('')).toBe(
      'A supervision, then supervisions, then a supervisor.',
    );
  });

  it("underline 'all' marks every occurrence", () => {
    expect(hits('supervision and supervision', { ...data, underline: 'all' })).toEqual(['supervision', 'supervision']);
  });
});

describe('<Gloss> popover', () => {
  beforeEach(() => {
    glossaryData.value = data;
  });
  afterEach(() => {
    cleanup();
    currentTab.value = 'today';
    glossaryTarget.value = null;
  });

  it('renders plain text until the glossary has loaded', () => {
    glossaryData.value = null;
    const { container } = render(<Gloss text="Your first supervision" />);
    expect(container.textContent).toBe('Your first supervision');
    expect(container.querySelector('button')).toBeNull();
  });

  it('plain renders the text only, for use inside a button card', () => {
    const { container } = render(<Gloss text="Supervision due" plain />);
    expect(container.textContent).toBe('Supervision due');
    expect(container.querySelector('button')).toBeNull();
  });

  it('the term is a collapsed button; activating it opens a labelled, non-modal dialog', () => {
    const { getByRole, queryByRole } = render(<Gloss text="Your first supervision is Monday" />);
    const term = getByRole('button', { name: 'supervision' });
    expect(term.getAttribute('aria-expanded')).toBe('false');
    expect(queryByRole('dialog')).toBeNull();

    fireEvent.click(term);
    const dialog = getByRole('dialog', { name: 'Supervision' });
    expect(term.getAttribute('aria-expanded')).toBe('true');
    expect(term.getAttribute('aria-controls')).toBe(dialog.id);
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(dialog.textContent).toContain('Office hours + oral quiz');
    expect(getByRole('link', { name: 'Open glossary' })).toBeTruthy();

    fireEvent.click(term);
    expect(queryByRole('dialog')).toBeNull();
  });

  it('Escape closes it and returns focus to the term', () => {
    const { getByRole, queryByRole } = render(<Gloss text="Your supervisor" />);
    const term = getByRole('button', { name: 'supervisor' });
    fireEvent.click(term);
    getByRole('link', { name: 'Open glossary' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(term);
  });

  it('a tap outside closes it; a tap inside does not', () => {
    const { getByRole, queryByRole } = render(
      <div>
        <p>
          <Gloss text="The Tripos" />
        </p>
        <p data-testid="out">elsewhere</p>
      </div>,
    );
    fireEvent.click(getByRole('button', { name: 'Tripos' }));
    fireEvent.pointerDown(getByRole('dialog'));
    expect(queryByRole('dialog')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(queryByRole('dialog')).toBeNull();
  });

  it('only one popover is open at a time', () => {
    const { getByRole, getAllByRole } = render(<Gloss text="The Tripos has a supervision each week" />);
    fireEvent.click(getByRole('button', { name: 'Tripos' }));
    fireEvent.click(getByRole('button', { name: 'supervision' }));
    const dialogs = getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]!.getAttribute('aria-label')).toBe('Supervision');
    expect(getByRole('button', { name: 'Tripos' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('the glossary link opens the glossary on that term', () => {
    const { getByRole, queryByRole } = render(<Gloss text="The Tripos" />);
    fireEvent.click(getByRole('button', { name: 'Tripos' }));
    fireEvent.click(getByRole('link', { name: 'Open glossary' }));
    expect(currentTab.value).toBe('glossary');
    expect(glossaryTarget.value).toBe('tripos');
    expect(queryByRole('dialog')).toBeNull();
  });
});
