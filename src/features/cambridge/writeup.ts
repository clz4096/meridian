/**
 * Write-up parsing: the Markdown the app already renders (ui/components/Markdown:
 * bold, italic, inline code, fenced code) plus headings, bullet lists, and LaTeX
 * math in `$…$` (inline) and `$$…$$` (display).
 *
 * The write-up is the owner's own text, but it syncs through a public file, so
 * it is treated as untrusted: this returns a token tree, text renders through
 * Preact (escaped), and only KaTeX's own output is ever set as HTML.
 *
 * Math is split out before any Markdown, so `$a*b*c$` is math, not italics.
 * Pure, so it is unit-tested without KaTeX.
 */

export type WInline = { t: 'text'; v: string } | { t: 'math'; v: string; display?: boolean };

export type WBlock =
  | { t: 'code'; v: string }
  | { t: 'math'; v: string }
  | { t: 'h'; level: 1 | 2 | 3; c: WInline[] }
  | { t: 'ul'; items: WInline[][] }
  | { t: 'p'; lines: WInline[][] };

/**
 * Split a line into text and math. `\$` is a literal dollar; backtick code
 * spans are kept whole, so a `$` inside code is not math. Inline math follows
 * the Pandoc rule: the opening `$` is followed by a non-space, the closing one
 * is preceded by a non-space and not followed by a digit, so "$5 and $6" stays text.
 */
export function splitMath(src: string): WInline[] {
  const out: WInline[] = [];
  let text = '';
  const flush = (): void => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && src[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        text += src.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ch === '$' && src[i + 1] === '$') {
      const end = src.indexOf('$$', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'math', v: src.slice(i + 2, end).trim(), display: true });
        i = end + 2;
        continue;
      }
    } else if (ch === '$' && src[i + 1] !== undefined && !/\s/.test(src[i + 1]!)) {
      const end = closingDollar(src, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'math', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

function closingDollar(src: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') {
      j++; // skip the escaped character, so \$ inside math never closes it
      continue;
    }
    if (src[j] !== '$') continue;
    if (/\s/.test(src[j - 1]!) || /\d/.test(src[j + 1] ?? '')) return -1;
    return j;
  }
  return -1;
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;

export function parseWriteup(src: string): WBlock[] {
  const blocks: WBlock[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: string[] = [];
  const flush = (): void => {
    if (para.length) blocks.push({ t: 'p', lines: para.map(splitMath) });
    if (list.length) blocks.push({ t: 'ul', items: list.map(splitMath) });
    para = [];
    list = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      blocks.push({ t: 'code', v: code.join('\n') });
      continue;
    }
    // Display math on its own lines: $$ … $$, possibly over several lines.
    if (trimmed.startsWith('$$')) {
      const rest = trimmed.slice(2);
      const close = rest.indexOf('$$');
      if (close >= 0 && rest.slice(close + 2).trim() === '') {
        flush();
        blocks.push({ t: 'math', v: rest.slice(0, close).trim() });
        continue;
      }
      if (close < 0) {
        const body: string[] = [rest];
        let j = i + 1;
        while (j < lines.length && !lines[j]!.includes('$$')) body.push(lines[j++]!);
        if (j < lines.length) {
          const last = lines[j]!;
          const at = last.indexOf('$$');
          if (last.slice(at + 2).trim() === '') {
            flush();
            body.push(last.slice(0, at));
            blocks.push({ t: 'math', v: body.join('\n').trim() });
            i = j;
            continue;
          }
        }
        // An unclosed $$ stays plain text.
      }
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, c: splitMath(h[2]!) });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      if (para.length) flush();
      list.push(b[1]!);
      continue;
    }
    if (trimmed === '') flush();
    else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}
