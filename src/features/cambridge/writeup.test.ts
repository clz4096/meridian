/**
 * Write-up parsing: math is split out before Markdown, and nothing unexpected
 * turns into math or markup.
 */
import { describe, expect, it } from 'vitest';
import { parseWriteup, splitMath } from '@/features/cambridge/writeup';

describe('splitMath', () => {
  it('splits inline and display math from text', () => {
    expect(splitMath('Let $x^2 = 1$, so $$x = \\pm 1$$ done')).toEqual([
      { t: 'text', v: 'Let ' },
      { t: 'math', v: 'x^2 = 1' },
      { t: 'text', v: ', so ' },
      { t: 'math', v: 'x = \\pm 1', display: true },
      { t: 'text', v: ' done' },
    ]);
  });

  it('keeps stars inside math as math, not emphasis', () => {
    expect(splitMath('$a*b*c$')).toEqual([{ t: 'math', v: 'a*b*c' }]);
  });

  it('prices and escaped dollars stay text', () => {
    expect(splitMath('costs $5 and $6 today')).toEqual([{ t: 'text', v: 'costs $5 and $6 today' }]);
    expect(splitMath('a \\$ sign')).toEqual([{ t: 'text', v: 'a $ sign' }]);
    expect(splitMath('$ x$')).toEqual([{ t: 'text', v: '$ x$' }]);
  });

  it('a dollar inside backtick code is not math', () => {
    expect(splitMath('run `echo $HOME$` now')).toEqual([{ t: 'text', v: 'run `echo $HOME$` now' }]);
  });

  it('HTML stays literal text (Preact escapes it on render)', () => {
    expect(splitMath('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('parseWriteup', () => {
  it('reads headings, paragraphs, lists, code and display math', () => {
    const src = ['# Q3', '', 'First line', 'second line', '', '- one', '- $two$', '', '```', '$not math$', '```', '', '$$', '\\int_0^1 x\\,dx', '$$'].join('\n');
    expect(parseWriteup(src)).toEqual([
      { t: 'h', level: 1, c: [{ t: 'text', v: 'Q3' }] },
      { t: 'p', lines: [[{ t: 'text', v: 'First line' }], [{ t: 'text', v: 'second line' }]] },
      { t: 'ul', items: [[{ t: 'text', v: 'one' }], [{ t: 'math', v: 'two' }]] },
      { t: 'code', v: '$not math$' },
      { t: 'math', v: '\\int_0^1 x\\,dx' },
    ]);
  });

  it('a one-line $$…$$ is a display block; an unclosed $$ stays text', () => {
    expect(parseWriteup('$$ e^{i\\pi} $$')).toEqual([{ t: 'math', v: 'e^{i\\pi}' }]);
    expect(parseWriteup('$$ open\nand on')).toEqual([{ t: 'p', lines: [[{ t: 'text', v: '$$ open' }], [{ t: 'text', v: 'and on' }]] }]);
  });
});
