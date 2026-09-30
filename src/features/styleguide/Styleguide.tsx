/**
 * /styleguide: the living reference for the Meridian design system.
 *
 * Lazy-loaded at #/styleguide. Shows every token and primitive in every state, plus
 * one Today path card and the weather header, so the direction can be judged on
 * real content. Colors come only from tokens.css; the contrast numbers come from the
 * same core the CI gate uses (scripts/contrastCore.mjs), parsed from the raw CSS so
 * both variants are always measured, not just the active one.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import '@/styles/tokens.css';
import '@/styles/primitives.css';
import './styleguide.css';
import tokensCss from '@/styles/tokens.css?raw';
import { checkVariant, contrast, parseVariants, resolveToken } from '../../../scripts/contrastCore.mjs';

type Variant = 'a' | 'b';

const VARIANT_NAMES: Record<Variant, string> = { a: 'A · Cream and Coral', b: 'B · Ember' };

const SWATCH_GROUPS: { title: string; tokens: string[] }[] = [
  { title: 'Surfaces', tokens: ['--bg', '--surface', '--surface-2'] },
  { title: 'Ink', tokens: ['--ink', '--ink-2', '--ink-3'] },
  { title: 'Accent', tokens: ['--accent', '--accent-2', '--accent-ink', '--on-accent', '--accent-wash'] },
  { title: 'Neutrals', tokens: ['--peach', '--sand', '--rule', '--rule-strong', '--track'] },
  { title: 'State', tokens: ['--ok', '--warn', '--danger', '--focus'] },
  { title: 'Data series', tokens: ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5'] },
];

const TYPE_STEPS: { step: number; use: string; sample: string }[] = [
  { step: 7, use: 'Display numbers', sample: '64°' },
  { step: 6, use: 'Page title', sample: 'Today' },
  { step: 5, use: 'Section title', sample: "Today's studies" },
  { step: 4, use: 'Card title', sample: 'Applied Probability & Statistics' },
  { step: 3, use: 'Body', sample: 'A hypothesis test asks how surprising the data would be if nothing were going on.' },
  { step: 2, use: 'Labels, dense rows', sample: 'Finish practice test 2' },
  { step: 1, use: 'Meta, units', sample: 'Updated 8:14 AM · 0.12 in' },
];

const SPACES = [1, 2, 3, 4, 5, 6, 7, 8];
const RADII = ['--r-1', '--r-2', '--r-3', '--r-4', '--r-pill'];
const SHADOWS = ['--shadow-1', '--shadow-2', '--shadow-3'];
const EASINGS = ['--ease-standard', '--ease-enter', '--ease-exit', '--ease-calm'];

const ratioText = (r: number): string => `${r.toFixed(2)}:1`;

function setPalette(v: Variant): void {
  if (v === 'a') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = v;
}

export function StyleguideView() {
  const variants = useMemo(() => parseVariants(tokensCss), []);
  const [variant, setVariant] = useState<Variant>(
    () => (document.documentElement.dataset.palette === 'b' ? 'b' : 'a'),
  );
  const map = variants[variant];
  const rows = useMemo(() => checkVariant(map), [map]);
  const bgHex = resolveToken(map, '--bg');

  useEffect(() => {
    setPalette(variant);
  }, [variant]);
  // Leaving the page must not leave the rest of the app on a trial palette.
  useEffect(() => {
    const before = document.documentElement.dataset.palette;
    return () => {
      if (before === undefined) delete document.documentElement.dataset.palette;
      else document.documentElement.dataset.palette = before;
    };
  }, []);

  return (
    <div class="sg-root">
      <header class="sg-head">
        <p class="m-label">Meridian · design system</p>
        <h1 class="sg-h1">Styleguide</h1>
        <div class="sg-toggle" role="group" aria-label="Palette variant">
          {(['a', 'b'] as const).map((v) => (
            <button
              type="button"
              class="m-chip"
              aria-pressed={variant === v}
              onClick={() => setVariant(v)}
              key={v}
            >
              {VARIANT_NAMES[v]}
            </button>
          ))}
        </div>
        <p class="sg-note">
          Variant A is the default. Why: <span class="m-mono">design/palette-decision.md</span>.
        </p>
      </header>

      <Section label="Direction" title="Today, in the new system">
        <div class="sg-direction">
          <WeatherHeaderMock />
          <PathCardMock />
        </div>
      </Section>

      <Section label="Color" title={`Palette ${VARIANT_NAMES[variant]}`}>
        {SWATCH_GROUPS.map((g) => (
          <div class="sg-swatch-group" key={g.title}>
            <h3 class="m-label">{g.title}</h3>
            <ul class="sg-swatches">
              {g.tokens.map((t) => {
                const hex = resolveToken(map, t);
                return (
                  <li class="sg-swatch" key={t}>
                    <span class="sg-chip" style={{ background: `var(${t})` }} aria-hidden="true" />
                    <span class="m-mono sg-token">{t}</span>
                    <span class="m-mono sg-hex">{hex}</span>
                    <span class="m-num sg-ratio">{ratioText(contrast(hex, bgHex))} on bg</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <h3 class="m-label sg-sub">Every allowed pair</h3>
        <div class="sg-table-wrap">
          <table class="sg-table m-num">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                <th scope="col">Foreground</th>
                <th scope="col">Background</th>
                <th scope="col">Ratio</th>
                <th scope="col">Needs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.fg}${r.bg}`}>
                  <td>
                    <span class="sg-pair" style={{ color: `var(${r.fg})`, background: `var(${r.bg})` }}>
                      Aa 42
                    </span>
                  </td>
                  <td class="m-mono">{r.fg}</td>
                  <td class="m-mono">{r.bg}</td>
                  <td>{ratioText(r.ratio)}</td>
                  <td>
                    {r.min}:1 {r.pass ? '' : <strong class="sg-fail">fails</strong>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section label="Type" title="Source Sans 3 and Source Code Pro">
        <ul class="sg-type">
          {TYPE_STEPS.map((s) => (
            <li class="sg-type-row" key={s.step}>
              <span class="m-mono sg-type-meta">--fs-{s.step} · {s.use}</span>
              <span class="sg-type-sample" style={{ fontSize: `var(--fs-${s.step})`, lineHeight: `var(--lh-${s.step})` }}>
                {s.sample}
              </span>
            </li>
          ))}
        </ul>
        <div class="sg-type-extras">
          <p class="m-label">Small caps label, synthesized, tracked</p>
          <p class="m-num sg-figures">Tabular 1,111.11 / 8,888.88</p>
          <p class="m-mono">Mono 0O 1lI · p = 0.032, n = 48</p>
          <p class="sg-weights">
            <span style={{ fontWeight: 'var(--fw-regular)' }}>Regular</span>{' '}
            <span style={{ fontWeight: 'var(--fw-medium)' }}>Medium</span>{' '}
            <span style={{ fontWeight: 'var(--fw-semibold)' }}>Semibold</span>{' '}
            <span style={{ fontWeight: 'var(--fw-bold)' }}>Bold</span>
          </p>
        </div>
      </Section>

      <Section label="Space, radius, shadow" title="Structure">
        <h3 class="m-label">Spacing, 4px base</h3>
        <ul class="sg-spaces">
          {SPACES.map((n) => (
            <li key={n}>
              <span class="m-mono sg-space-name">--sp-{n}</span>
              <span class="sg-space-bar" style={{ width: `var(--sp-${n})` }} />
            </li>
          ))}
        </ul>
        <h3 class="m-label sg-sub">Radius</h3>
        <div class="sg-boxes">
          {RADII.map((r) => (
            <div class="sg-box" style={{ borderRadius: `var(${r})` }} key={r}>
              <span class="m-mono">{r}</span>
            </div>
          ))}
        </div>
        <h3 class="m-label sg-sub">Shadow</h3>
        <div class="sg-boxes">
          {SHADOWS.map((s) => (
            <div class="sg-box sg-box-lift" style={{ boxShadow: `var(${s})` }} key={s}>
              <span class="m-mono">{s}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Motion" title="Calm and short">
        <MotionDemo />
      </Section>

      <Section label="Primitives" title="Every state">
        <PrimitivesDemo />
      </Section>
    </div>
  );
}

function Section(props: { label: string; title: string; children: ComponentChildren }) {
  return (
    <section class="sg-section">
      <div class="m-section">
        <h2 class="sg-h2">{props.title}</h2>
        <span class="m-label">{props.label}</span>
      </div>
      {props.children}
    </section>
  );
}

function WeatherHeaderMock() {
  return (
    <header class="sg-wx" aria-label="Date and weather">
      <p class="m-label">Tuesday · 29 September</p>
      <div class="sg-wx-main">
        <div>
          <h2 class="sg-wx-place">Brooklyn</h2>
          <p class="sg-wx-cond">Light rain</p>
        </div>
        <p class="sg-wx-temp m-num">
          64<span class="sg-wx-unit">°F</span>
        </p>
      </div>
      <dl class="sg-wx-grid m-num">
        <div>
          <dt class="m-label">High</dt>
          <dd>68°</dd>
        </div>
        <div>
          <dt class="m-label">Low</dt>
          <dd>55°</dd>
        </div>
        <div>
          <dt class="m-label">Rain</dt>
          <dd>40%</dd>
        </div>
        <div>
          <dt class="m-label">Amount</dt>
          <dd>
            0.12 <span class="sg-wx-unit-sm">in</span>
          </dd>
        </div>
      </dl>
      <p class="sg-wx-updated m-num">Updated 8:14 AM</p>
    </header>
  );
}

function PathCardMock() {
  const done = 2;
  const total = 13;
  const pct = (done / total) * 100;
  return (
    <button type="button" class="m-card sg-path">
      <span class="sg-path-top">
        <span class="m-label">WGU</span>
        <span class="m-num sg-path-count">
          {done} of {total}
        </span>
      </span>
      <span class="sg-path-course">C955 · Applied Probability &amp; Statistics</span>
      <span class="sg-path-next">
        <span class="m-label sg-path-next-label">Next</span>
        <span class="sg-path-next-text">Finish practice test 2</span>
      </span>
      <span
        class="m-progress"
        role="progressbar"
        aria-label="WGU courses done"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} courses`}
      >
        <span class="m-progress-fill" style={{ '--m-progress': `${pct}%` }} />
      </span>
      <span class="sg-path-caption m-num">
        {Math.round(pct)}% · {done} of {total} courses
      </span>
    </button>
  );
}

function MotionDemo() {
  const [on, setOn] = useState(false);
  return (
    <div>
      <button type="button" class="m-btn" onClick={() => setOn(!on)} aria-pressed={on}>
        {on ? 'Return' : 'Play'}
      </button>
      <ul class="sg-motion">
        {EASINGS.map((e) => (
          <li key={e}>
            <span class="m-mono sg-motion-name">{e}</span>
            <span class="sg-motion-track">
              <span
                class={`sg-motion-dot${on ? ' is-on' : ''}`}
                style={{ transitionTimingFunction: `var(${e})` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p class="sg-note">
        Durations: <span class="m-mono">--dur-1</span> 120ms press, <span class="m-mono">--dur-2</span> 200ms state,{' '}
        <span class="m-mono">--dur-3</span> 320ms reveal. Under reduced motion they drop to near zero and the skeleton
        stops shimmering.
      </p>
    </div>
  );
}

function PrimitivesDemo() {
  const [chip, setChip] = useState('week');
  const [retries, setRetries] = useState(0);
  return (
    <div class="sg-prims">
      <h3 class="m-label">Buttons</h3>
      <div class="sg-row-wrap">
        <button type="button" class="m-btn m-btn-primary">
          Log set
        </button>
        <button type="button" class="m-btn">
          Add a todo
        </button>
        <button type="button" class="m-btn m-btn-quiet">
          Capture an idea
        </button>
        <button type="button" class="m-btn" disabled>
          Disabled
        </button>
      </div>
      <p class="sg-note">Tab to any control to see the focus ring. Every button is at least 44px tall.</p>

      <h3 class="m-label sg-sub">Chips</h3>
      <div class="sg-row-wrap">
        <span class="m-chip">Stats</span>
        <span class="m-chip m-chip-sand">Proof</span>
        {['day', 'week', 'month'].map((c) => (
          <button type="button" class="m-chip" aria-pressed={chip === c} onClick={() => setChip(c)} key={c}>
            {c}
          </button>
        ))}
      </div>

      <h3 class="m-label sg-sub">Section header and rows</h3>
      <div class="m-section">
        <span class="m-label">Your day</span>
        <span class="m-num sg-note">3 due</span>
      </div>
      <ul class="sg-list">
        <li class="m-row">
          Review regression notes <span class="m-row-meta m-num">9:00</span>
        </li>
        <li class="m-row" aria-current="true">
          Practice test 2, section B <span class="m-row-meta m-num">Now</span>
        </li>
        <li class="m-row">
          Walk, 30 min <span class="m-row-meta m-num">18:30</span>
        </li>
      </ul>

      <h3 class="m-label sg-sub">Progress</h3>
      {[0, 2, 13].map((n) => (
        <div class="sg-progress" key={n}>
          <span
            class="m-progress"
            role="progressbar"
            aria-label="Courses done"
            aria-valuemin={0}
            aria-valuemax={13}
            aria-valuenow={n}
            aria-valuetext={`${n} of 13`}
          >
            <span class="m-progress-fill" style={{ '--m-progress': `${(n / 13) * 100}%` }} />
          </span>
          <span class="m-num sg-note">{n} of 13</span>
        </div>
      ))}

      <h3 class="m-label sg-sub">Card, loading</h3>
      <div class="m-card sg-skel-card" aria-busy="true" aria-label="Loading WGU path">
        <span class="m-skel m-skel-line sg-w-25" />
        <span class="m-skel m-skel-line sg-w-80" />
        <span class="m-skel m-skel-line sg-w-60" />
        <span class="m-skel sg-skel-bar" />
      </div>

      <h3 class="m-label sg-sub">Empty</h3>
      <div class="m-state" data-kind="empty">
        <p class="m-state-title">All 13 courses are done.</p>
        <p class="m-state-body">Next step: request your degree audit.</p>
      </div>

      <h3 class="m-label sg-sub">Error</h3>
      <div class="m-state" data-kind="error" role="alert">
        <p class="m-state-title">Weather didn't load.</p>
        <p class="m-state-body">
          The forecast service didn't answer{retries ? ` (tried ${retries + 1} times)` : ''}.
        </p>
        <button type="button" class="m-btn" onClick={() => setRetries(retries + 1)}>
          Try again
        </button>
      </div>

      <h3 class="m-label sg-sub">Offline</h3>
      <div class="m-card">
        <p class="sg-offline-content">Brooklyn · 64°F · Light rain</p>
        <p class="m-state m-num" data-kind="offline">
          Offline · Saved 8:14 AM
        </p>
      </div>
    </div>
  );
}
