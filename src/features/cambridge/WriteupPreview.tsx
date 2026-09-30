/**
 * The write-up preview: Markdown plus KaTeX. Its own lazy chunk, loaded the
 * first time Preview is pressed, so KaTeX (about 270 KB of script plus its CSS
 * and fonts) never loads for someone who only writes.
 *
 * Text renders through Preact, so it is escaped. The only HTML set directly is
 * KaTeX's output for a formula, with `trust: false` (no \href, \url, \html*
 * commands) and errors rendered inline rather than thrown.
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { MdInlineText } from '@/ui/components/Markdown';
import { parseWriteup, type WInline } from '@/features/cambridge/writeup';

const cache = new Map<string, string>();

/** KaTeX HTML for one formula, memoised: the preview re-renders on every keystroke. */
export function renderMath(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
      maxSize: 50,
      maxExpand: 1000,
    });
    if (cache.size > 500) cache.clear();
    cache.set(key, html);
  }
  return html;
}

function Formula({ tex, display }: { tex: string; display?: boolean }) {
  return <span class={display ? 'cam-math-display' : 'cam-math'} dangerouslySetInnerHTML={{ __html: renderMath(tex, !!display) }} />;
}

function Inline({ nodes }: { nodes: WInline[] }) {
  return (
    <>
      {nodes.map((n, i) => (n.t === 'math' ? <Formula key={i} tex={n.v} display={n.display} /> : <MdInlineText key={i} text={n.v} />))}
    </>
  );
}

export function WriteupPreview({ text }: { text: string }) {
  const blocks = parseWriteup(text);
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'code':
            return (
              <pre key={i} class="md-pre">
                <code>{b.v}</code>
              </pre>
            );
          case 'math':
            return <Formula key={i} tex={b.v} display />;
          case 'h': {
            const H = (`h${b.level + 2}` as 'h3' | 'h4' | 'h5');
            return (
              <H key={i}>
                <Inline nodes={b.c} />
              </H>
            );
          }
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline nodes={it} />
                  </li>
                ))}
              </ul>
            );
          case 'p':
            return (
              <p key={i}>
                {b.lines.map((l, j) => (
                  <>
                    {j > 0 && <br />}
                    <Inline nodes={l} />
                  </>
                ))}
              </p>
            );
        }
      })}
    </>
  );
}
