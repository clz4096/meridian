/**
 * App shell — the Preact root. Home is the Today tab; everything else
 * (Todos, Scratch, and the four trackers) is a drill-in section reached from
 * Today, each with a pill-Back → Today. No persistent nav. Replaces the old
 * table-of-contents hub.
 */
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import { currentTab, sgLogOpen, kgProgressOpen, kgGym, kgOverview, kgSession, kgInterview, type Tab } from '@/ui/store';
import { navHome, onPopNav, loadForHome, rolloverIfNewDay } from '@/ui/actions';
import { navEnd } from '@/core/telemetry';
import { SaveChip, RestBar } from '@/ui/components/Chrome';
import { TodayView } from '@/features/today/TodayTab';
import { DataView } from '@/features/data/DataTab';
import { MealView } from '@/features/meal/MealTab';
import { KnowledgeView } from '@/features/knowledge/KnowledgeTab';
import { WorkoutView } from '@/features/workout/WorkoutTab';
import { TodosView } from '@/features/todos/TodosTab';
import { ScratchView } from '@/features/scratch/ScratchTab';
import { WGURoadmapView } from '@/features/wgu/WGURoadmap';

// Historical pane ids (the meal tab's pane is #pane-weight) the CSS still targets.
const PANE_ID: Record<Tab, string> = {
  today: 'pane-today',
  todos: 'pane-todos',
  scratch: 'pane-scratch',
  workout: 'pane-workout',
  knowledge: 'pane-knowledge',
  meal: 'pane-weight',
  data: 'pane-data',
  tracker: 'pane-tracker',
  roadmap: 'pane-roadmap',
};

// The Princeton tracker is ~150 KB minified (the algorithm catalogue, proofs, papers,
// teaching simulator): a third of the app bundle. It loads in its own chunk, prefetched
// at idle right after Enter so the first tap on its tile doesn't wait on it.
let TrackerView: ComponentType | null = null;
const trackerReady = signal(false);
const trackerFailed = signal(false);
let trackerLoad: Promise<void> | null = null;
function loadTracker(): Promise<void> {
  trackerLoad ??= import('@/features/studytracker/StudyTracker').then(
    (m) => {
      TrackerView = m.StudyTrackerView;
      trackerReady.value = true;
    },
    () => {
      trackerLoad = null; // allow a retry
      trackerFailed.value = true;
    },
  );
  return trackerLoad;
}

function Section({ tab }: { tab: Tab }) {
  if (tab === 'today') return <TodayView />;
  if (tab === 'todos') return <TodosView />;
  if (tab === 'scratch') return <ScratchView />;
  if (tab === 'data') return <DataView />;
  if (tab === 'meal') return <MealView />;
  if (tab === 'knowledge') return <KnowledgeView />;
  if (tab === 'tracker') {
    if (trackerReady.value && TrackerView) return <TrackerView />;
    if (trackerFailed.value) {
      return (
        <div class="pane-loading note" role="alert">
          Couldn’t load this section. Check your connection, then{' '}
          <button class="mbtn" type="button" onClick={() => { trackerFailed.value = false; void loadTracker(); }}>
            Try again
          </button>
        </div>
      );
    }
    void loadTracker();
    return <div class="pane-loading note" role="status">Loading…</div>;
  }
  if (tab === 'roadmap') return <WGURoadmapView />;
  return <WorkoutView />;
}

export function App() {
  const tab = currentTab.value;
  const home = tab === 'today';

  useEffect(() => {
    document.body.classList.toggle('at-home', home);
  }, [home]);

  // A lazy pane counts as opened once its real content renders, not its placeholder.
  const ready = tab !== 'tracker' || trackerReady.value;
  useEffect(() => { if (ready) navEnd(tab); }, [tab, ready]);

  useEffect(() => {
    loadForHome(); // Today's at-a-glance needs every tracker store
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadTracker());
    window.addEventListener('popstate', onPopNav);
    // Catch midnight while open, and a new day on return from the background.
    const onVisible = (): void => { if (!document.hidden) rolloverIfNewDay(); };
    document.addEventListener('visibilitychange', onVisible);
    const tick = window.setInterval(rolloverIfNewDay, 60_000);
    return () => {
      window.removeEventListener('popstate', onPopNav);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(tick);
    };
  }, []);

  // A key unique per screen/subscreen — changing it replays the paneIn entrance
  // on every navigation (daily-tab switch, drill-in, and back).
  // Each Knowledge sub-screen gets a distinct suffix (mirroring KnowledgeView's router)
  // so the entrance animation replays across chooser → picker → deck, not just the ones
  // that happen to toggle kgOverview/kgGym.
  const kgKey =
    kgSession.value === 'choose' ? ':choose'
      : kgSession.value === 'gym' && !kgGym.value ? ':gympick'
      : kgSession.value === 'interview' && !kgInterview.value ? ':ivpick'
      : kgProgressOpen.value ? ':prog'
      : kgGym.value ? ':gym'
      : kgInterview.value ? ':iv:' + kgInterview.value
      : !kgOverview.value ? ':q'
      : '';
  const screenKey =
    tab === 'meal'
      ? 'meal' + (sgLogOpen.value ? ':log' : '')
      : tab === 'knowledge'
        ? 'knowledge' + kgKey
        : tab;

  return (
    <>
      <div class="appwrap">
        <div class="brandrow">
          {!home && (
            <button class="navbtn" type="button" onClick={() => window.history.back()} aria-label="Back">
              <span aria-hidden="true">‹</span>
            </button>
          )}
          <div class="brand">
            <b>
              Meridia<span class="mn">n</span>
            </b>
          </div>
          {!home && (
            <button class="navbtn navbtn-home" type="button" onClick={navHome} aria-label="Home">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
                <path d="M4 11.5 12 4l8 7.5" />
                <path d="M6 10.5V20h12v-9.5" />
              </svg>
            </button>
          )}
        </div>
        <div class="tabpane on" id={PANE_ID[tab]} key={screenKey}>
          <Section tab={tab} />
        </div>
      </div>
      <RestBar />
      <SaveChip />
    </>
  );
}
