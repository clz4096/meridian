/**
 * App shell — the Preact root. Home is the Today tab; everything else
 * (Todos, Scratch, and the four trackers) is a drill-in section reached from
 * Today, each with a pill-Back → Today. No persistent nav. Replaces the old
 * table-of-contents hub.
 */
import { useEffect } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import { camItemId, currentTab, glossaryTarget, sgLogOpen, kgProgressOpen, kgGym, kgOverview, kgSession, kgInterview, type Tab } from '@/ui/store';
import { navHome, loadForHome, rolloverIfNewDay, openSection } from '@/ui/actions';
import { onCamPopNav } from '@/features/cambridge/nav';
import { parseDeepLink, reloadInto, takeReopen } from '@/ui/reopen';
import { navEnd } from '@/core/telemetry';
import { SaveChip, RestBar, UndoToast } from '@/ui/components/Chrome';
import { TodayView } from '@/features/today/TodayTab';

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
  wgu: 'pane-roadmap',
  math: 'pane-math',
  cs: 'pane-cs',
  teach: 'pane-tracker',
  cambridge: 'pane-math',
  'cam-item': 'pane-cam-item',
  'cam-errors': 'pane-cam-errors',
  glossary: 'pane-glossary',
};

/**
 * One section view in its own chunk. Only Today is in the entry bundle: every other
 * section loads on demand, and all of them are prefetched at idle after the first
 * Today paint, so a tap on a tile normally finds the chunk already there. A failed
 * load shows an error whose "Try again" reloads the page into that section (see reloadInto).
 */
interface LazyView {
  View: ComponentType | null;
  ready: Signal<boolean>;
  failed: Signal<boolean>;
  /** Whether the idle prefetch after Today's first paint fetches it. */
  prefetch: boolean;
  load(): Promise<void>;
}
function lazyView(importer: () => Promise<ComponentType>, { prefetch = true } = {}): LazyView {
  let inflight: Promise<void> | null = null;
  const v: LazyView = {
    View: null,
    prefetch,
    ready: signal(false),
    failed: signal(false),
    load() {
      inflight ??= importer().then(
        (View) => {
          v.View = View;
          v.ready.value = true;
        },
        () => {
          inflight = null; // allow a retry
          v.failed.value = true;
        },
      );
      return inflight;
    },
  };
  return v;
}

// `roadmap` is an alias of the WGU path screen: one loader, so it is fetched once.
const wguView = lazyView(() => import('@/features/wgu/WGURoadmap').then((m) => m.WGURoadmapView));

// `math` now opens the Cambridge path (old links and history entries keep working):
// one loader for both ids, so it is fetched once.
// The curriculum itself (catalog.ts's track chunks, 2 to 16 KB gzip each) is never
// prefetched: the prefetch runs inside the load window, where every fetch counts
// against it, and Today needs only the small catalog index. A path screen fetches
// its own tracks when it opens, behind a skeleton of the same size. The two path
// screens' own chunks are small and are prefetched like every other section; the
// study item and error log are reached from the path, so they load on open (from
// the service worker's precache once installed).
const ON_OPEN = { prefetch: false };
const cambridgeView = lazyView(() => import('@/features/cambridge/CambridgePath').then(({ CambridgePathView }) => () => <CambridgePathView />));

// `teach` was the standalone Learn by Teaching screen. Teaching now lives only inside the
// tracker, so the id stays as an alias of it: old history entries and reopen targets
// still land on the screen that holds the teaching section. One loader, fetched once.
const trackerView = lazyView(() => import('@/features/studytracker/StudyTracker').then(({ StudyTrackerView }) => () => <StudyTrackerView />));

// The Cambridge Method tracker is the biggest (~150 KB minified: the algorithm catalogue,
// proofs, papers, teaching simulator); the rest are 10 to 60 KB each.
const LAZY: Record<Exclude<Tab, 'today'>, LazyView> = {
  todos: lazyView(() => import('@/features/todos/TodosTab').then((m) => m.TodosView)),
  scratch: lazyView(() => import('@/features/scratch/ScratchTab').then((m) => m.ScratchView)),
  knowledge: lazyView(() => import('@/features/knowledge/KnowledgeTab').then((m) => m.KnowledgeView)),
  workout: lazyView(() => import('@/features/workout/WorkoutTab').then((m) => m.WorkoutView)),
  meal: lazyView(() => import('@/features/meal/MealTab').then((m) => m.MealView)),
  data: lazyView(() => import('@/features/data/DataTab').then((m) => m.DataView)),
  tracker: trackerView,
  roadmap: wguView,
  wgu: wguView,
  math: cambridgeView,
  cs: lazyView(() => import('@/features/paths/CSPath').then(({ CSPathView }) => () => <CSPathView />)),
  teach: trackerView,
  cambridge: cambridgeView,
  'cam-item': lazyView(() => import('@/features/cambridge/StudyItem').then(({ StudyItemView }) => () => <StudyItemView />), ON_OPEN),
  // Both take optional props for their tests; the app renders them with none.
  'cam-errors': lazyView(() => import('@/features/cambridge/ErrorLog').then(({ ErrorLogView }) => () => <ErrorLogView />), ON_OPEN),
  glossary: lazyView(() => import('@/features/cambridge/Glossary').then(({ GlossaryView }) => () => <GlossaryView />)),
};

/** Open a Cambridge deep link (`#/glossary?t=`, `#/cam-item?id=`), then drop the hash so a later visit does not replay it. */
function openDeepLink(): void {
  const link = parseDeepLink(window.location.hash);
  if (!link) return;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  if (link.term) glossaryTarget.value = link.term;
  if (link.itemId) camItemId.value = link.itemId;
  openSection(link.tab);
}

function Section({ tab }: { tab: Tab }) {
  if (tab === 'today') return <TodayView />;
  const lazy = LAZY[tab];
  const View = lazy.View;
  if (lazy.ready.value && View) return <View />;
  if (lazy.failed.value) {
    return (
      <div class="pane-loading note" role="alert">
        Couldn’t load this section. Check your connection, then{' '}
        <button class="mbtn" type="button" onClick={() => reloadInto(tab)}>
          Try again
        </button>
      </div>
    );
  }
  void lazy.load();
  return <div class="pane-loading note" role="status">Loading…</div>;
}

export function App() {
  const tab = currentTab.value;
  const home = tab === 'today';

  useEffect(() => {
    document.body.classList.toggle('at-home', home);
  }, [home]);

  // A lazy pane counts as opened once its real content renders, not its placeholder.
  const ready = tab === 'today' || LAZY[tab].ready.value;
  useEffect(() => { if (ready) navEnd(tab); }, [tab, ready]);

  useEffect(() => {
    loadForHome(); // Today's at-a-glance needs every tracker store
    const reopen = takeReopen();
    if (reopen) openSection(reopen);
    else openDeepLink();
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    // Prefetch every section after the first Today paint. One per idle slot, so a
    // slow phone never parses all of them in one long task.
    // Without requestIdleCallback (Safari), wait out startup once, then go back to back.
    const queue = [...new Set(Object.values(LAZY))].filter((v) => v.prefetch);
    const soon = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 50));
    const next = (): void => {
      const v = queue.shift();
      if (v) void v.load().finally(() => soon(next));
    };
    idle(next);
    window.addEventListener('popstate', onCamPopNav);
    window.addEventListener('hashchange', openDeepLink);
    // Catch midnight while open, and a new day on return from the background.
    // (A pending delete is applied on hide by bootstrap, before its save.)
    const onVisible = (): void => { if (!document.hidden) rolloverIfNewDay(); };
    document.addEventListener('visibilitychange', onVisible);
    const tick = window.setInterval(rolloverIfNewDay, 60_000);
    return () => {
      window.removeEventListener('popstate', onCamPopNav);
      window.removeEventListener('hashchange', openDeepLink);
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
        : tab === 'cam-item'
          ? 'cam-item:' + (camItemId.value ?? '')
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
      <UndoToast />
      <SaveChip />
    </>
  );
}
