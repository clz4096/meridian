/**
 * The tracker's view of the Cambridge Method (Stage 5): the Playbook's compact
 * path summary, and the text of Deep Blocks 1 and 3 (ids b4 and b7), which now
 * point at the current study item and its loop step instead of the retired
 * problem set of the week.
 *
 * Only the text changes. The block ids stay b4 and b7, so ticks already stored
 * under them in `meridian-theorist` keep counting.
 *
 * Lazy module: the tracker reaches it through import() and shows the static
 * SCHEDULE text until it arrives. It reads the small catalog index, not the
 * full catalog, so opening the tracker never fetches the curriculum JSON.
 */
import method from '@data/cambridge/method.json';
import type { PathSummary } from '@/features/paths/types';
import { currentFor } from './catalogIndex';
import { fmtDue, type CurrentItem, type LoopStep } from './schedule';
import { summarize } from './todayCard';
import type { CambridgeState } from './types';

export interface BlockText {
  title: string;
  sub: string;
}

export type CamBlocks = Record<'b4' | 'b7', BlockText>;

/** The loop step as a short verb phrase after the item title. */
const STEP_WORD: Readonly<Record<LoopStep, string>> = {
  read: 'read the notes',
  attempt: 'attempt cold',
  writeup: 'write up',
  supervision: 'supervision',
  redo: 'redo',
};

// Block 3 is the afternoon paper-and-pen session: it carries the same step on,
// by hand, rather than starting a second item.
const PAPER: Readonly<Record<LoopStep, string>> = {
  read: 'Definitions and key formulas on paper, then start the cold attempt',
  attempt: 'Keep going cold on paper; note where you stalled',
  writeup: 'Write the full solution out, failed attempts included',
  supervision: 'Log the marks, three weak points and two redo questions',
  redo: 'Redo every miss from a blank page',
};

const stepDo = (id: string): string | undefined => method.steps.find((s) => s.id === id)?.do;

/** Block text for the current item, or null when every phase is done (the static text shows). */
export function blockTexts(cur: CurrentItem | null): CamBlocks | null {
  if (!cur) return null;
  const what = cur.step === 'redo' && cur.due !== undefined ? `redo by ${fmtDue(cur.due)}` : STEP_WORD[cur.step];
  return {
    b4: { title: `Deep Block 1: ${cur.title}, ${what}`, sub: stepDo(cur.step) ?? PAPER[cur.step] },
    b7: { title: `Deep Block 3: ${cur.title}, paper and pen`, sub: PAPER[cur.step] },
  };
}

export interface TrackerCambridge {
  /** The Math path card's summary: phase, current item and step, supervisions this week. */
  summary: PathSummary;
  blocks: CamBlocks | null;
}

/** Pure: what the tracker shows for a store state at an instant. */
export function trackerCambridge(state: CambridgeState, now: number): TrackerCambridge {
  return { summary: summarize(state, now), blocks: blockTexts(currentFor(state, 'math', now)) };
}
