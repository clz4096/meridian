// @vitest-environment jsdom
/**
 * Reload-into-screen recovery (DECISIONS D16) and the Cambridge deep links.
 * A failed chunk stays failed for the life of the page, so every Cambridge
 * "Try again" reloads into the same screen; a study item reopens on the same
 * item, and open editors are asked to save first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_EVENT, parseDeepLink, reloadInto, takeReopen } from '@/ui/reopen';
import { camItemId } from '@/ui/store';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  camItemId.value = null;
});

function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
  return reload;
}

describe('reloadInto / takeReopen', () => {
  it('reloads, then reopens the same study item', () => {
    const reload = stubReload();
    const flushed = vi.fn();
    window.addEventListener(FLUSH_EVENT, flushed);
    camItemId.value = 'found-07';
    reloadInto('cam-item');
    expect(flushed).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    window.removeEventListener(FLUSH_EVENT, flushed);

    camItemId.value = null; // a fresh page
    expect(takeReopen()).toBe('cam-item');
    expect(camItemId.value).toBe('found-07');
    expect(takeReopen()).toBeNull(); // once
  });

  it('reopens the glossary, and still reads the bare tab id older builds stored', () => {
    stubReload();
    reloadInto('glossary');
    expect(takeReopen()).toBe('glossary');
    sessionStorage.setItem('meridian.reopen', 'cam-errors');
    expect(takeReopen()).toBe('cam-errors');
  });

  it('never reopens Today, an unknown tab, or an item screen without an item', () => {
    for (const raw of ['today', 'nope', JSON.stringify({ tab: 'cam-item', itemId: null })]) {
      sessionStorage.setItem('meridian.reopen', raw);
      expect(takeReopen()).toBeNull();
    }
  });
});

describe('parseDeepLink', () => {
  it('routes the glossary and study item links', () => {
    expect(parseDeepLink('#/glossary?t=tripos')).toEqual({ tab: 'glossary', term: 'tripos' });
    expect(parseDeepLink('#/glossary')).toEqual({ tab: 'glossary' });
    expect(parseDeepLink('#/cam-item?id=found-01')).toEqual({ tab: 'cam-item', itemId: 'found-01' });
    expect(parseDeepLink('#/glossary?t=part-ia-ib-ii-iii')).toEqual({ tab: 'glossary', term: 'part-ia-ib-ii-iii' });
  });

  it('ignores everything else', () => {
    for (const h of ['', '#', '#/styleguide', '#/progress', '#/cam-item', '#/glossaryx', '#/cam-item?x=1']) expect(parseDeepLink(h)).toBeNull();
  });
});
