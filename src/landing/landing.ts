/**
 * landing: mounts the graph into the landing shell and wires the CTA.
 *
 * The landing used to gate every launch, with its markup static in index.html. It is
 * now an on-demand intro: `playIntro()` (called from the Data tab through a lazy
 * import, so Three never loads at startup) builds the same overlay, mounts the graph,
 * and removes everything again on Enter or Escape.
 */
import { mount, type GraphHandle } from '@/landing/graph';
import { backgroundPreset, landingPreset } from '@/landing/presets';
import '@/landing/landing.css';

export function mountLanding(root: ParentNode, onEnter: () => void): () => void {
  const stage = root.querySelector<HTMLElement>('#stage');
  if (!stage) return () => onEnter();
  const enter = root.querySelector<HTMLElement>('.enter');
  const hint = root.querySelector<HTMLElement>('#hint');

  const graph: GraphHandle = mount(stage, landingPreset());
  stage.classList.add('ready'); // css fades the canvas in

  // fade the hint on first interaction, or after 5s
  let hinted = false;
  const fadeHint = (): void => {
    if (hinted || !hint) return;
    hinted = true;
    hint.classList.add('gone');
  };
  stage.addEventListener('pointerdown', fadeHint, { once: true });
  const hintTimer = window.setTimeout(fadeHint, 5000);

  let finished = false;
  const done = (e?: Event): void => {
    e?.preventDefault();
    if (finished) return;
    finished = true;
    window.clearTimeout(hintTimer);
    graph.unmount(); // dispose the interactive landing GL before leaving
    onEnter();
  };
  enter?.addEventListener('click', done);
  return done;
}

const INTRO_HTML = `<div id="stage"></div>
<div class="overlay">
  <div class="mark">MERIDIA<span>N</span></div>
  <div class="bottom">
    <p class="tag">A quiet place for the things you're tracking.</p>
    <a class="enter" href="#" id="enter">Enter Meridian <span class="arrow">&#8594;</span></a>
  </div>
  <div class="hint" id="hint">drag to rotate</div>
</div>`;

/**
 * Show the intro full-screen over the app. Enter (the CTA) or Escape closes it and
 * returns focus to `opener`. A second call while it is open does nothing.
 */
export function playIntro(opener: HTMLElement | null = null): void {
  const prev = document.getElementById('landing');
  if (prev && !prev.classList.contains('leaving')) return; // already open
  prev?.remove(); // still fading out from the last play: replace it at once
  const el = document.createElement('div');
  el.id = 'landing';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Meridian intro');
  el.innerHTML = INTRO_HTML;
  document.body.appendChild(el);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    // aria-modal: Enter is the only control, so Tab stays on it instead of leaving
    // for the page behind the overlay.
    if (e.key === 'Tab') {
      e.preventDefault();
      el.querySelector<HTMLElement>('.enter')?.focus();
    }
  };
  const close = mountLanding(el, () => {
    document.removeEventListener('keydown', onKey);
    el.classList.add('leaving');
    window.setTimeout(() => el.remove(), 550); // matches the #landing opacity transition
    opener?.focus();
  });
  document.addEventListener('keydown', onKey);
  el.querySelector<HTMLElement>('.enter')?.focus();
}

/**
 * Mount the passive graph as a persistent app background. No longer mounted at
 * startup (the redesign drops the dark field); kept for the design stage to reuse.
 */
export function mountBackground(host: HTMLElement): GraphHandle {
  return mount(host, backgroundPreset());
}
