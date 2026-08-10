/**
 * App shell — the Preact root. Home is the Today tab; everything else
 * (Todos, Scratch, and the four trackers) is a drill-in section reached from
 * Today, each with a pill-Back → Today. No persistent nav. Replaces the old
 * table-of-contents hub.
 */
import { useEffect } from 'preact/hooks';
import { currentTab, sgLogOpen, kgProgressOpen, kgGym, kgOverview, type Tab } from '@/ui/store';
import { navHome, onPopNav, loadForHome } from '@/ui/actions';
import { SaveChip, RestBar } from '@/ui/components/Chrome';
import { TodayView } from '@/features/today/TodayTab';
import { DataView } from '@/features/data/DataTab';
import { MealView } from '@/features/meal/MealTab';
import { KnowledgeView } from '@/features/knowledge/KnowledgeTab';
import { WorkoutView } from '@/features/workout/WorkoutTab';
import { TodosView } from '@/features/todos/TodosTab';
import { ScratchView } from '@/features/scratch/ScratchTab';

// Historical pane ids (the meal tab's pane is #pane-weight) the CSS still targets.
const PANE_ID: Record<Tab, string> = {
  today: 'pane-today',
  todos: 'pane-todos',
  scratch: 'pane-scratch',
  workout: 'pane-workout',
  knowledge: 'pane-knowledge',
  meal: 'pane-weight',
  data: 'pane-data',
};

function Section({ tab }: { tab: Tab }) {
  if (tab === 'today') return <TodayView />;
  if (tab === 'todos') return <TodosView />;
  if (tab === 'scratch') return <ScratchView />;
  if (tab === 'data') return <DataView />;
  if (tab === 'meal') return <MealView />;
  if (tab === 'knowledge') return <KnowledgeView />;
  return <WorkoutView />;
}

export function App() {
  const tab = currentTab.value;
  const home = tab === 'today';

  useEffect(() => {
    document.body.classList.toggle('at-home', home);
  }, [home]);

  useEffect(() => {
    loadForHome(); // Today's at-a-glance needs every tracker store
    window.addEventListener('popstate', onPopNav);
    return () => window.removeEventListener('popstate', onPopNav);
  }, []);

  // A key unique per screen/subscreen — changing it replays the paneIn entrance
  // on every navigation (daily-tab switch, drill-in, and back).
  const screenKey =
    tab === 'meal'
      ? 'meal' + (sgLogOpen.value ? ':log' : '')
      : tab === 'knowledge'
        ? 'knowledge' + (kgGym.value ? ':gym' : kgProgressOpen.value ? ':prog' : !kgOverview.value ? ':q' : '')
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
