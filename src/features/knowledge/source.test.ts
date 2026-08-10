/**
 * Unit tests for the shared source-link helpers — every precedence branch of
 * `srcHref` (page-on-.pdf, anchor, plain, the .pdf guard, the stripFrag double-
 * fragment guard, the http(s) scheme guard), plus practice/see normalization of the
 * single-object | array | undefined union with the scheme/label guard.
 */
import { describe, expect, it } from 'vitest';
import { srcHref, practiceLinks, seeLinks } from '@/features/knowledge/source';

const PDF = 'https://example.com/book.pdf';
const WEB = 'https://cpu.land/';

describe('srcHref — fragment precedence', () => {
  it('page on a .pdf base → #page=N (rule 1)', () => {
    expect(srcHref({ book: 'b', ref: 'r', page: 42 }, PDF)).toBe('https://example.com/book.pdf#page=42');
  });

  it('page on a NON-.pdf base falls through (rule 1 fails) → plain base', () => {
    expect(srcHref({ book: 'b', ref: 'r', page: 42 }, WEB)).toBe(WEB);
  });

  it('anchor on a non-.pdf base → #anchor (rule 2)', () => {
    expect(srcHref({ book: 'b', ref: 'r', anchor: 'the-fetch-execute-cycle' }, WEB)).toBe('https://cpu.land/#the-fetch-execute-cycle');
  });

  it('page+.pdf wins over anchor when both set', () => {
    expect(srcHref({ book: 'b', ref: 'r', page: 5, anchor: 'x' }, PDF)).toBe('https://example.com/book.pdf#page=5');
  });

  it('no page/anchor → plain base unchanged (rule 3), fragment on base preserved', () => {
    expect(srcHref({ book: 'b', ref: 'r' }, WEB)).toBe(WEB);
    expect(srcHref({ book: 'b', ref: 'r' }, 'https://x.com/p#keep')).toBe('https://x.com/p#keep');
  });

  it('src.url override wins over the book url as the base', () => {
    expect(srcHref({ book: 'b', ref: 'r', page: 3, url: PDF }, WEB)).toBe('https://example.com/book.pdf#page=3');
  });
});

describe('srcHref — stripFrag double-fragment guard', () => {
  it('strips a pre-existing #frag on a .pdf base before appending #page', () => {
    expect(srcHref({ book: 'b', ref: 'r', page: 5, url: 'https://x.com/a.pdf#section' }, undefined)).toBe('https://x.com/a.pdf#page=5');
  });

  it('strips a pre-existing #frag before appending the anchor', () => {
    expect(srcHref({ book: 'b', ref: 'r', anchor: 'sec' }, 'https://x.com/p#old')).toBe('https://x.com/p#sec');
  });
});

describe('srcHref — .pdf detection is case-insensitive', () => {
  it('matches .PDF', () => {
    expect(srcHref({ book: 'b', ref: 'r', page: 2 }, 'https://x.com/A.PDF')).toBe('https://x.com/A.PDF#page=2');
  });
});

describe('srcHref — scheme guard', () => {
  it('returns null for an absent base', () => {
    expect(srcHref({ book: 'b', ref: 'r' }, undefined)).toBeNull();
  });

  it('drops a javascript: base', () => {
    expect(srcHref({ book: 'b', ref: 'r' }, 'javascript:alert(1)')).toBeNull();
    expect(srcHref({ book: 'b', ref: 'r', anchor: 'x' }, 'javascript:alert(1)')).toBeNull();
  });

  it('drops data:, protocol-relative, and unparseable bases', () => {
    expect(srcHref({ book: 'b', ref: 'r' }, 'data:text/html,x')).toBeNull();
    expect(srcHref({ book: 'b', ref: 'r' }, '//evil.com')).toBeNull();
    expect(srcHref({ book: 'b', ref: 'r' }, 'not a url')).toBeNull();
  });

  it('http and https both pass', () => {
    expect(srcHref({ book: 'b', ref: 'r' }, 'http://x.com/')).toBe('http://x.com/');
    expect(srcHref({ book: 'b', ref: 'r' }, 'HTTPS://x.com/')).toBe('HTTPS://x.com/');
  });
});

describe('practiceLinks — union normalization', () => {
  const link = { label: 'LC 15 · 3Sum', url: 'https://leetcode.com/problems/3sum/' };

  it('undefined → []', () => {
    expect(practiceLinks({})).toEqual([]);
    expect(practiceLinks({ practice: undefined })).toEqual([]);
  });

  it('single object → one-element array', () => {
    expect(practiceLinks({ practice: link })).toEqual([link]);
  });

  it('array → passthrough (guarded)', () => {
    const two = [link, { label: 'LC 167', url: 'https://leetcode.com/problems/two-sum-ii/' }];
    expect(practiceLinks({ practice: two })).toEqual(two);
  });

  it('drops entries with a non-http(s) url or a missing/empty label', () => {
    const dirty = [
      link,
      { label: 'bad scheme', url: 'javascript:alert(1)' },
      { label: '', url: 'https://ok.com/' },
      { label: 'no url', url: '' as string },
    ];
    expect(practiceLinks({ practice: dirty })).toEqual([link]);
  });
});

describe('seeLinks — same normalization as practice', () => {
  const s = { label: 'Fortnow · Foundations', url: 'https://blog.computationalcomplexity.org/x.html' };

  it('undefined → []', () => {
    expect(seeLinks({})).toEqual([]);
  });

  it('array passthrough, scheme-guarded', () => {
    expect(seeLinks({ see: [s, { label: 'x', url: 'data:text/html,y' }] })).toEqual([s]);
  });
});
