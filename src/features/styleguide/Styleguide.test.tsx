import { cleanup, fireEvent, render } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleguideView } from './Styleguide';

// Vitest stubs CSS modules, `?raw` included, to an empty string; the page needs the real text.
// jsdom's import.meta.url isn't a file URL, so resolve from the repo root vitest runs in.
vi.mock('@/styles/tokens.css?raw', () => ({
  default: readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8'),
}));

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.palette;
});

describe('StyleguideView', () => {
  it('renders the direction mocks and measured pairs', () => {
    const { getByText, getByRole, container } = render(<StyleguideView />);
    getByText('C955 · Applied Probability & Statistics');
    getByText('Brooklyn');
    const bar = getByRole('progressbar', { name: 'WGU courses done' });
    expect(bar.getAttribute('aria-valuetext')).toBe('2 of 13 courses');
    getByText('15% · 2 of 13 courses');
    // Every declared pair passes, so the page must not show a failure.
    expect(container.querySelector('.sg-fail')).toBeNull();
  });

  it('switches the palette on <html> and restores it on unmount', () => {
    const { getByRole, unmount } = render(<StyleguideView />);
    fireEvent.click(getByRole('button', { name: 'B · Ember' }));
    expect(document.documentElement.dataset.palette).toBe('b');
    fireEvent.click(getByRole('button', { name: 'A · Cream and Coral' }));
    expect(document.documentElement.dataset.palette).toBeUndefined();
    fireEvent.click(getByRole('button', { name: 'B · Ember' }));
    unmount();
    expect(document.documentElement.dataset.palette).toBeUndefined();
  });

  it('shows the Cambridge primitives with their states in text, not color alone', () => {
    const { getByRole, getAllByRole, getByText, container } = render(<StyleguideView />);
    const loops = getAllByRole('list', { name: 'Study loop' });
    const current = loops[0]!.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain('Attempt cold');
    expect(loops[0]!.textContent).toContain('Read, done');
    getByRole('timer', { name: 'Cold time, question 3' });
    const phases = getByRole('list', { name: 'Phases' });
    expect(phases.querySelector('[aria-current="step"]')?.textContent).toContain('Current');
    getByText("Unlocks when Phase B's gate passes.");
    for (const word of ['Not started', 'Attempting', 'Written up', 'Supervised', 'Redo done', 'Solved', 'Partial', 'Stuck'])
      getByText(word);
    expect(container.querySelector('.m-sr > table caption')?.textContent).toBe('Errors per week by cause');
  });

  it('opens the glossary popover on tap and closes it on Escape, returning focus', () => {
    const { getByRole, queryByRole } = render(<StyleguideView />);
    const term = getByRole('button', { name: 'supervision' });
    fireEvent.click(term);
    expect(term.getAttribute('aria-expanded')).toBe('true');
    getByRole('dialog', { name: 'Supervision' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('dialog', { name: 'Supervision' })).toBeNull();
    expect(document.activeElement).toBe(term);
    fireEvent.click(term);
    fireEvent.pointerDown(document.body);
    expect(queryByRole('dialog', { name: 'Supervision' })).toBeNull();
  });

  it('toggles the editor between write and preview, and removes a photo', () => {
    const { getByRole, queryByRole, getAllByRole } = render(<StyleguideView />);
    fireEvent.click(getByRole('button', { name: 'Preview' }));
    getByRole('generic', { name: 'Write-up preview' });
    fireEvent.click(getByRole('button', { name: 'Write' }));
    expect(getAllByRole('textbox').length).toBeGreaterThan(0);
    fireEvent.click(getByRole('button', { name: 'Remove page 1' }));
    expect(queryByRole('img', { name: 'Page 1 of the write-up' })).toBeNull();
    getByRole('list', { name: 'Photos, 1' });
  });
});
