/**
 * Shared chart chrome (full JSX). The SVG plot itself still comes from chart.ts
 * (tested path math) via dangerouslySetInnerHTML; everything around it — section
 * head, hero, period/scale toggles, the swipe carousel + dots, the lift picker —
 * is a component. The carousel's scoped useRef/useEffect replaces the old global
 * MutationObserver.
 */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { chart, type ChartOpts } from '@/ui/charts/chart';
import { PERIOD_LABEL, type Period } from '@/ui/charts/progress';
import { progPeriod, logScale, controlsOpen, progLift } from '@/ui/store';
import { goHub, toggleControls } from '@/ui/actions';

const SEG: Array<[Period, string]> = [
  ['day', 'D'],
  ['week', 'W'],
  ['month', 'M'],
  ['quarter', 'Q'],
  ['year', 'Y'],
];

export function SectionHead({ name }: { name: string }) {
  return (
    <>
      <div class="secbar">
        <button class="backbtn" onClick={goHub}>
          ‹ Back
        </button>
      </div>
      <div class="eyebrow">{name}</div>
    </>
  );
}

export interface Delta {
  text: string;
  dir: 'up' | 'down' | '';
}
export function Hero({ value, unit, label, delta }: { value: string; unit: string; label: string; delta?: Delta }) {
  const tail = unit === '%' ? `% ${label.toLowerCase()}` : ` ${unit} ${label.toLowerCase()}`;
  return (
    <div class="hero">
      <div class="hero-v">
        {value}
        <span class="hero-u">{tail}</span>
      </div>
      {delta && <div class={'hero-d ' + delta.dir}>{delta.text}</div>}
    </div>
  );
}

export function ProgControls() {
  const open = controlsOpen.value;
  const p = progPeriod.value;
  const pl = SEG.find(([per]) => per === p)?.[1] ?? 'W';
  return (
    <div class="ctrl-row">
      {open && (
        <div class="seg-row">
          <div class="seg">
            {(['lin', 'log'] as const).map((s) => (
              <button class={(s === 'log') === logScale.value ? 'on' : ''} onClick={() => (logScale.value = s === 'log')}>
                {s === 'lin' ? 'Lin' : 'Log'}
              </button>
            ))}
          </div>
          <div class="seg">
            {SEG.map(([per, l]) => (
              <button class={per === p ? 'on' : ''} title={PERIOD_LABEL[per]} onClick={() => (progPeriod.value = per)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <button class={'ctrl-toggle' + (open ? ' on' : '')} aria-label="Chart scale and range" onClick={toggleControls}>
        {open ? '⌃' : `${pl} ⌄`}
      </button>
    </div>
  );
}

/** One chart slide — chart.ts renders the SVG; empty series render nothing. */
export function Chart({ opts }: { opts: ChartOpts }) {
  const html = chart({ ...opts, logY: logScale.value });
  if (!html) return null;
  return <div class="chart-cell" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The strength-chart lift selector (JSX chips). */
export function LiftPicker({ lifts }: { lifts: string[] }) {
  const cur = progLift.value;
  if (!lifts.length) return null;
  return (
    <div class="prog-lift" data-keepx="lift">
      {lifts.map((l) => (
        <button class={l === cur ? 'on' : ''} onClick={() => (progLift.value = l)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Horizontal swipe carousel with page dots; scoped scroll wiring (no observer). */
export function Carousel({ keepKey, children }: { keepKey: string; children: ComponentChildren }) {
  const kids = (Array.isArray(children) ? children : [children]).filter((c) => c != null && c !== false);
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const stride = (): number => {
    const c = ref.current;
    if (!c) return 1;
    const a = c.children[0] as HTMLElement | undefined;
    const b = c.children[1] as HTMLElement | undefined;
    return a && b ? b.offsetLeft - a.offsetLeft : a?.offsetWidth || c.clientWidth || 1;
  };
  const onScroll = () => {
    const c = ref.current;
    if (c) setActive(Math.round(c.scrollLeft / stride()));
  };
  return (
    <>
      <div class="carousel" data-keepx={'car-' + keepKey} ref={ref} onScroll={onScroll}>
        {kids}
      </div>
      {kids.length > 1 && (
        <div class="cdots">
          {kids.map((_, i) => (
            <button
              class={'cdot' + (i === active ? ' on' : '')}
              aria-label={`Graph ${i + 1}`}
              onClick={() => ref.current?.scrollTo({ left: i * stride(), behavior: 'smooth' })}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function ViewLogCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button class="cta-log" onClick={onClick}>
      {label}
      <span class="cta-arrow">→</span>
    </button>
  );
}
