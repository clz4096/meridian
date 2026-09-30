/**
 * Today's Math card, Cambridge variant (docs/cambridge-screens.md section a):
 * fills the shared PathSummary from the Cambridge store, so PathCard renders it
 * unchanged. The card shows the current item and its loop step, and the week's
 * supervision count.
 *
 * Lazy module: Today reaches it through import() after its first paint. It
 * reads the small build-time catalog index, never the full catalog, so booting
 * Today does not fetch the curriculum JSON.
 */
import method from '@data/cambridge/method.json';
import type { PathSummary } from '@/features/paths/types';
import { dataRev } from '@/ui/store';
import { readCambridge } from './store';
import { catalogIndex, currentFor, indexItem, itemDone, liveItem, pathPhases, phaseState, type IndexPhase } from './catalogIndex';
import { elapsedSec, fmtDue, inSabbath, nyParts, sunset, supervisionsThisWeek } from './schedule';
import type { CambridgeState } from './types';

const DAY = 86_400_000;
const COLD_SEC = 60 * 60;

/** When the Sabbath that contains `now` ends: Saturday's sunset in Brooklyn. */
function sabbathEnd(now: number): number {
  const saturday = nyParts(now).wd === 5 ? now + DAY : now;
  return sunset(saturday).getTime();
}

const stepDo = (id: string): string | undefined => method.steps.find((s) => s.id === id)?.do;

/** "42 of 60 min cold on Q3": the question being timed, else the one furthest along. */
function coldDetail(state: CambridgeState, itemId: string, now: number): string | undefined {
  const it = liveItem(state, itemId);
  if (!it) return undefined;
  const qs = Object.entries(it.questions ?? {})
    .map(([id, q]) => ({ id, q, sec: elapsedSec(q, now) }))
    .filter((x) => x.sec > 0 && x.sec < COLD_SEC);
  const pick = qs.find((x) => x.q.runningSince !== undefined) ?? qs.sort((a, b) => b.sec - a.sec)[0];
  if (!pick) return undefined;
  const label = indexItem(itemId)?.questions.find((q) => q.id === pick.id)?.label ?? pick.id;
  return `${Math.floor(pick.sec / 60)} of 60 min cold on ${label}`;
}

/** Nothing started yet: no item past "not started" and no gate passed. */
function untouched(state: CambridgeState): boolean {
  const anyItem = Object.values(state.items ?? {}).some((i) => !i.deleted && i.stage !== 'not-started');
  return !anyItem && !Object.values(state.gates ?? {}).some((g) => g.passedAt);
}

/** "Phase A · Block 3", or the phase's own title when it has no blocks. */
function courseLine(phase: IndexPhase, itemId: string | undefined): string {
  const block = itemId ? phase.blocks.find((b) => b.items.includes(itemId)) : undefined;
  return `${phase.name} · ${block ? block.name : phase.title}`;
}

/** Pure: the card for a store state at an instant. */
export function summarize(state: CambridgeState, now: number): PathSummary {
  const phases = pathPhases('math');
  const cur = currentFor(state, 'math', now);
  const sup = supervisionsThisWeek(state, now);
  const caption = `Supervisions this week: ${sup.held} of ${sup.target}`;

  // Assignment 1 is listed under Phase 0 (its diagnostic pass) and Phase A. Once
  // Phase 0 has passed, report the item under the phase still in progress.
  const phaseOf = (key: string | undefined): IndexPhase | undefined => (key ? catalogIndex().phases.get(key) : undefined);
  const curPhases = cur ? [phaseOf(cur.phase), phaseOf(indexItem(cur.itemId)?.phase)].filter((p): p is IndexPhase => !!p) : [];
  const phase =
    curPhases.find((p) => phaseState(state, p) !== 'passed') ??
    curPhases[0] ??
    phases.find((p) => phaseState(state, p) === 'current') ??
    phases[phases.length - 1];
  // Counted with the same "done" rule as the current item: a supervised item with
  // no redo owed is finished, as well as one whose redo is done.
  const total = phase?.items.length ?? 0;
  const done = phase ? phase.items.filter((id) => itemDone(liveItem(state, id))).length : 0;
  const course = phase ? courseLine(phase, cur?.itemId) : 'The Cambridge Method';

  let next: PathSummary['next'];
  if (!cur) {
    next = { label: 'Every phase is done', detail: 'Keep the error log moving with redos.' };
  } else if (untouched(state)) {
    next = { label: 'Start Phase 0: diagnostic', detail: stepDo('attempt') };
  } else if (cur.step === 'redo' && cur.due !== undefined && cur.due < now) {
    next = { label: `Redo overdue since ${fmtDue(cur.due)}`, detail: `${cur.title}: ${stepDo('redo') ?? ''}`.trim() };
  } else {
    const detail = cur.step === 'attempt' ? coldDetail(state, cur.itemId, now) ?? stepDo('attempt') : stepDo(cur.step);
    next = { label: cur.label, detail };
  }
  // Nothing is scheduled inside the Sabbath; the card says when work resumes and
  // keeps what comes next as the detail.
  if (inSabbath(now)) next = { label: `Resumes ${fmtDue(sabbathEnd(now))}`, detail: cur ? `Then: ${next.label}` : undefined };

  return { id: 'math', title: 'Math', course, next, progress: { done, total, caption } };
}

/** Live summary for Today's card. Reads dataRev so the calling component re-renders on store writes. */
export function currentSummary(now: Date = new Date()): PathSummary {
  dataRev.value;
  return summarize(readCambridge(), now.getTime());
}
