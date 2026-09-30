/**
 * A deliberately tiny Markdown renderer for model answers.
 *
 * Answers come from the question bank and from AI generation, so the text is
 * untrusted. Nothing here touches innerHTML: the parser returns a plain token
 * tree and the component maps it to Preact elements, whose text children are
 * always escaped. Anything the parser does not recognise stays literal text.
 *
 * Supported: **bold**, *italic*, `inline code`, ``` fenced code blocks, single
 * newlines as line breaks and blank lines as paragraph breaks.
 */
import type { ComponentChildren } from 'preact';

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'b'; c: MdInline[] }
  | { t: 'i'; c: MdInline[] };

export type MdBlock = { t: 'code'; v: string } | { t: 'p'; lines: MdInline[][] };

/** Parse inline spans. Code wins over emphasis, so `a*b*c` stays literal inside backticks. */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      // Require non-space just inside both markers so "a ** b" is not bold.
      if (end > i + 2 && !/\s/.test(src[i + 2]) && !/\s/.test(src[end - 1])) {
        flush();
        out.push({ t: 'b', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    } else if (ch === '*') {
      const end = findSingleStar(src, i + 1);
      if (end > i + 1 && !/\s/.test(src[i + 1]) && !/\s/.test(src[end - 1])) {
        flush();
        out.push({ t: 'i', c: parseInline(src.slice(i + 1, end)) });
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

/** Next lone `*` (not part of `**`) at or after `from`, else -1. */
function findSingleStar(src: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] !== '*') continue;
    if (src[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** Split into fenced code blocks and paragraphs; a fence left open runs to the end. */
export function parseMarkdown(src: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', lines: para.map(parseInline) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ t: 'code', v: code.join('\n') });
      continue;
    }
    if (line.trim() === '') flushPara();
    else para.push(line);
  }
  flushPara();
  return blocks;
}

function renderInline(nodes: MdInline[]): ComponentChildren[] {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text':
        return n.v;
      case 'code':
        return <code>{n.v}</code>;
      case 'b':
        return <strong>{renderInline(n.c)}</strong>;
      case 'i':
        return <em>{renderInline(n.c)}</em>;
    }
  });
}

/** Render inline spans only; for callers that already own the block layout. */
export function MdInlineText({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

/** Render a full answer. One paragraph with no breaks renders as bare inline text. */
export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 1 && blocks[0].t === 'p' && blocks[0].lines.length === 1) {
    return <>{renderInline(blocks[0].lines[0])}</>;
  }
  return (
    <>
      {blocks.map((b) =>
        b.t === 'code' ? (
          <pre class="md-pre">
            <code>{b.v}</code>
          </pre>
        ) : (
          <p class="md-p">
            {b.lines.map((l, i) => (
              <>
                {i > 0 && <br />}
                {renderInline(l)}
              </>
            ))}
          </p>
        ),
      )}
    </>
  );
}
