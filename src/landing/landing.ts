/**
 * landing — mounts the graph into the static landing shell and wires the CTA.
 *
 * The overlay markup (wordmark, tag, Enter CTA, hint, #stage) is static HTML in
 * index.html so it paints instantly; this module (lazily imported with Three) mounts
 * the decorative graph, fades the "drag to rotate" hint on first interaction, and on
 * Enter disposes the graph and hands off to `onEnter` (which reveals the dashboard).
 */
import { mount, type GraphHandle } from '@/landing/graph';
import { backgroundPreset, landingPreset } from '@/landing/presets';

export function mountLanding(root: ParentNode, onEnter: () => void): void {
  const stage = root.querySelector<HTMLElement>('#stage');
  if (!stage) return;
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

  const done = (e?: Event): void => {
    e?.preventDefault();
    window.clearTimeout(hintTimer);
    graph.unmount(); // dispose the interactive landing GL before leaving
    onEnter();
  };
  enter?.addEventListener('click', done);
}

/**
 * Mount the passive graph as a persistent app background, reviving the cosmic field
 * behind the dashboard instead of leaving a flat shell. Non-interactive, dimmed, and
 * DPR-capped; the engine already pauses while the tab is hidden and idles the loop
 * under reduced motion. Returns the handle so the caller can dispose it if ever needed.
 */
export function mountBackground(host: HTMLElement): GraphHandle {
  return mount(host, backgroundPreset());
}
