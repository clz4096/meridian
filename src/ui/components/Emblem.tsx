/**
 * The University of Cambridge arms and the Pembroke College badge, as small
 * pre-rendered WebP files (the source SVG is 172 KB; these are about 11 and 5 KB).
 * Width and height are always set so the page never shifts when an image arrives.
 * `label` gives the image an accessible name; without it the image is decorative,
 * for places where the text beside it already says what it is.
 */
import cambridgeUrl from '@/assets/emblems/cambridge-arms.webp';
import pembrokeUrl from '@/assets/emblems/pembroke-college.webp';

const SOURCES = {
  cambridge: { src: cambridgeUrl, ratio: 144 / 168, name: 'University of Cambridge coat of arms' },
  pembroke: { src: pembrokeUrl, ratio: 1, name: 'Pembroke College, Cambridge' },
} as const;

export function Emblem({ kind, height, label = false }: { kind: keyof typeof SOURCES; height: number; label?: boolean }) {
  const e = SOURCES[kind];
  return (
    <img
      class={`emblem emblem-${kind}`}
      src={e.src}
      width={Math.round(height * e.ratio)}
      height={height}
      alt={label ? e.name : ''}
      decoding="async"
    />
  );
}
