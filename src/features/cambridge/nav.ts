/**
 * Navigation between the Cambridge screens: the path, a study item, the error
 * log and the glossary.
 *
 * The app's Back unwinds one pushed level straight to Today (actions.handleBack),
 * which is right for a section opened from Today but wrong for a study item
 * opened from the path: Back there should land on the path. So a drill-in from
 * one section into another records where it came from, and the popstate
 * handler returns there instead of Today. The history depth stays with
 * actions.ts, because every open still goes through openSection.
 *
 * Tiny on purpose: App.tsx imports it for the popstate handler, so it is in the
 * main chunk.
 */
import { camItemId, currentTab, type Tab } from '@/ui/store';
import { onPopNav, openSection } from '@/ui/actions';

interface Return { tab: Tab; y: number; itemId: string | null }
const stack: Return[] = [];

/** Open a Cambridge screen from the current one; Back returns here. */
export function openCam(tab: Tab, itemId?: string): void {
  const from = currentTab.value;
  if (from !== 'today') stack.push({ tab: from, y: window.scrollY, itemId: camItemId.value });
  if (itemId !== undefined) camItemId.value = itemId;
  openSection(tab);
}

/** Open a study item (pushes history, so Back returns to the screen it was opened from). */
export const openCamItem = (id: string): void => openCam('cam-item', id);

/** The popstate handler App.tsx installs in place of onPopNav. */
export function onCamPopNav(): void {
  // Home collapses the history with one popstate while already on Today: forget
  // every return point, since none of those screens is on the stack any more.
  const back = currentTab.value === 'today' ? undefined : stack.pop();
  if (currentTab.value === 'today') stack.length = 0;
  onPopNav();
  if (!back) return;
  // onPopNav went to Today (and queued Today's scroll); go to the saved screen
  // instead. The render is batched, so Today never paints in between.
  camItemId.value = back.itemId;
  currentTab.value = back.tab;
  const raf = window.requestAnimationFrame ?? ((cb: () => void) => window.setTimeout(cb, 0));
  raf(() => window.scrollTo(0, back.y));
}
