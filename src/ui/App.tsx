/**
 * App shell — the Preact root. Renders the brandrow + the active pane (hub or a
 * section) + the rest bar + save chip, all driven by signals. Replaces app.ts's
 * render orchestration + DomAppHost's showTab/showHub.
 */
import { useEffect } from 'preact/hooks';
import { atHub, currentTab, sgLogOpen, kgLogOpen, kgGym, type Tab } from '@/ui/store';
import { handleBack, loadForHub } from '@/ui/actions';
import { SaveChip, RestBar } from '@/ui/components/Chrome';
import { Hub } from '@/ui/Hub';
import { DataView } from '@/features/data/DataTab';
import { MealView } from '@/features/meal/MealTab';
import { KnowledgeView } from '@/features/knowledge/KnowledgeTab';
import { WorkoutView } from '@/features/workout/WorkoutTab';

// Historical pane ids (the meal tab's pane is #pane-weight) the CSS still targets.
const PANE_ID: Record<Tab, string> = {
  workout: 'pane-workout',
  knowledge: 'pane-knowledge',
  meal: 'pane-weight',
  data: 'pane-data',
};

function Section({ tab }: { tab: Tab }) {
  if (tab === 'data') return <DataView />;
  if (tab === 'meal') return <MealView />;
  if (tab === 'knowledge') return <KnowledgeView />;
  return <WorkoutView />;
}

export function App() {
  const hub = atHub.value;
  const tab = currentTab.value;

  useEffect(() => {
    document.body.classList.toggle('at-hub', hub);
  }, [hub]);

  useEffect(() => {
    loadForHub(); // hub stats need every section store
    const onPop = (): void => {
      handleBack();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // A key unique per screen/subscreen — changing it remounts the pane so the
  // paneIn entrance replays on every navigation (forward and back).
  const screenKey = hub
    ? 'hub'
    : tab === 'meal'
      ? 'meal' + (sgLogOpen.value ? ':log' : '')
      : tab === 'knowledge'
        ? 'knowledge' + (kgGym.value ? ':gym' : kgLogOpen.value ? ':q' : '')
        : tab;

  return (
    <>
      <div class="appwrap">
        <div class="brandrow">
          <div class="brand">
            <b>
              Meridia<span class="mn">n</span>
            </b>
          </div>
        </div>
        <div class="tabpane on" id={hub ? 'pane-hub' : PANE_ID[tab]} key={screenKey}>
          {hub ? <Hub /> : <Section tab={tab} />}
        </div>
      </div>
      <RestBar />
      <SaveChip />
    </>
  );
}
