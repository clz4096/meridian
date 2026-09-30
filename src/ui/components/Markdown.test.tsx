/**
 * Markdown renderer tests. Model answers are untrusted (AI-generated cards land
 * in the same field), so the XSS cases matter as much as the formatting ones:
 * markup in the source must come out as literal text, never as elements.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { Markdown, parseInline, parseMarkdown } from '@/ui/components/Markdown';

afterEach(cleanup);

const html = (text: string): string => render(<Markdown text={text} />).container.innerHTML;

describe('parseInline', () => {
  it('parses bold, italic and code', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'i', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
    ]);
  });

  it('keeps emphasis markers literal inside code', () => {
    expect(parseInline('`a*b*c`')).toEqual([{ t: 'code', v: 'a*b*c' }]);
  });

  it('leaves unmatched or spaced markers as text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
    expect(parseInline('**open')).toEqual([{ t: 'text', v: '**open' }]);
    expect(parseInline('a ` b')).toEqual([{ t: 'text', v: 'a ` b' }]);
  });

  it('does not treat snake_case underscores as italics', () => {
    expect(parseInline('TIME_WAIT and my_var_name')).toEqual([{ t: 'text', v: 'TIME_WAIT and my_var_name' }]);
  });
});

describe('parseMarkdown', () => {
  it('splits fenced code, paragraphs and line breaks', () => {
    const blocks = parseMarkdown('one\ntwo\n\n```cpp\nint x = 1;\n```\nthree');
    expect(blocks).toEqual([
      { t: 'p', lines: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
      { t: 'code', v: 'int x = 1;' },
      { t: 'p', lines: [[{ t: 'text', v: 'three' }]] },
    ]);
  });

  it('runs an unclosed fence to the end', () => {
    expect(parseMarkdown('```\na\nb')).toEqual([{ t: 'code', v: 'a\nb' }]);
  });
});

describe('Markdown component', () => {
  it('renders the supported subset as elements', () => {
    expect(html('**RAII** runs on *every* exit, see `std::unique_ptr`')).toBe(
      '<strong>RAII</strong> runs on <em>every</em> exit, see <code>std::unique_ptr</code>',
    );
  });

  it('renders line breaks and code blocks', () => {
    const out = html('a\nb\n\n```\nx < y\n```');
    expect(out).toBe('<p class="md-p">a<br>b</p><pre class="md-pre"><code>x &lt; y</code></pre>');
  });

  it('escapes raw HTML in plain text', () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"><script>alert(1)</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror="alert(1)"><script>alert(1)</script>');
  });

  it('escapes HTML inside bold, italic, code and code blocks', () => {
    const text = '**<b onclick=x>b</b>** *<i>i</i>* `<a href="javascript:x">c</a>`\n\n```\n<svg onload=alert(1)>\n```';
    const { container } = render(<Markdown text={text} />);
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('i')).toBeNull();
    expect(container.querySelectorAll('strong').length).toBe(1);
    expect(container.querySelector('strong')!.textContent).toBe('<b onclick=x>b</b>');
    expect(container.querySelector('pre code')!.textContent).toBe('<svg onload=alert(1)>');
  });

  it('does not turn Markdown links into anchors', () => {
    const { container } = render(<Markdown text={'[click](javascript:alert(1))'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('[click](javascript:alert(1))');
  });
});
