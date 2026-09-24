import { describe, it, expect } from 'vitest';
import { isIosStandalone, safariHref } from '@/ui/externalLinks';

const ORIGIN = 'https://clz4096.github.io';

describe('safariHref', () => {
  it('hands off-site https links to Safari', () => {
    expect(safariHref('https://danluu.com/latency/', ORIGIN)).toBe('x-safari-https://danluu.com/latency/');
  });

  it('keeps http links on their own scheme', () => {
    expect(safariHref('http://example.com/a?b=1#c', ORIGIN)).toBe('x-safari-http://example.com/a?b=1#c');
  });

  it('leaves same-origin, relative, and non-web links alone', () => {
    expect(safariHref('https://clz4096.github.io/meridian/', ORIGIN)).toBeNull();
    expect(safariHref('/meridian/questions/index.json', ORIGIN)).toBeNull();
    expect(safariHref('mailto:someone@example.com', ORIGIN)).toBeNull();
    expect(safariHref('#section', ORIGIN)).toBeNull();
  });
});

describe('isIosStandalone', () => {
  it('is true only when navigator.standalone is exactly true', () => {
    expect(isIosStandalone({ standalone: true } as unknown as Navigator)).toBe(true);
    expect(isIosStandalone({ standalone: false } as unknown as Navigator)).toBe(false);
    expect(isIosStandalone({} as Navigator)).toBe(false);
  });
});
