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
});
