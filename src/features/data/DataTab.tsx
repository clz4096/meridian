/**
 * Data tab — status head + storage stats + calm Cloud/AI/Backup cards + tucked
 * Advanced disclosure. Ports renderDataHTML to JSX; inputs stay uncontrolled (by
 * id) and are read via host.readValue in the handlers, matching the old flow.
 */
import { useEffect, useState } from 'preact/hooks';
import { normaliseState, storageMetrics } from '@/features/data/dataSelectors';
import type { DataViewModel } from '@/features/data/types';
import type { StoreKey } from '@/core/storage/appState';
import { sync, cloudEnabled } from '@/app/bootstrap';
import { host } from '@/ui/host';
import { dataRev, dataMsg, dataIo } from '@/ui/store';
import { wk, sg, kg, core, tg, cam, dataActions, discard } from '@/ui/actions';
import { HealthPanel } from '@/features/data/HealthPanel';
import { PageHead } from '@/ui/components/PageHead';
import { IconCloud } from '@/ui/components/Icons';

const KEYS: StoreKey[] = ['core', 'overload', 'surplus', 'csgraph', 'theorist', 'cambridge'];

function dataVM(): DataViewModel {
  const state = normaliseState({ core: core(), overload: wk(), surplus: sg(), csgraph: kg(), theorist: tg(), cambridge: cam() });
  const u = host.getItem('meridian_supabase_url');
  // One size figure: storageMetrics already measures every store. A second
  // whole-state stringify here cost time on every render and disagreed with the
  // Storage tile.
  const metrics = storageMetrics(state);
  return {
    metrics,
    payloadKb: metrics.kilobytes,
    sync: {
      cloudConfigured: cloudEnabled(),
      pantryId: u ? (u.split('//')[1]?.split('.')[0] ?? '') + '...' : '',
      baseRev: sync.baseRev(),
      dirtyStores: KEYS.filter((k) => sync.isDirtyCloud(k)),
      lastMessage: dataMsg.value.text,
      lastMessageBad: dataMsg.value.bad,
    },
    model: { configured: cloudEnabled(), model: 'DeepSeek v4 Pro', keyPreview: '' },
  };
}

const rv = (id: string): string => host.readValue(id);

/** The old launch animation, on demand. Three.js (~130 KB gzip) loads only on this tap. */
function IntroCard() {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const play = (e: Event): void => {
    if (state === 'loading') return;
    // Passed explicitly: focus returns here when the intro closes.
    const opener = e.currentTarget as HTMLElement;
    setState('loading');
    import('@/landing/index').then(
      (m) => { setState('idle'); m.playIntro(opener); },
      () => setState('failed'),
    );
  };
  return (
    <div class="dcard">
      <div class="dcard-h">
        <span class="dcard-t">Intro</span>
      </div>
      <div class="dcard-desc">The animated Meridian constellation. Enter or Escape closes it.</div>
      <div class="dactions">
        <button class="mbtn" type="button" onClick={play} aria-busy={state === 'loading'}>
          {state === 'loading' ? 'Loading…' : 'Play the intro'}
        </button>
      </div>
      {state === 'failed' && (
        <div class="note" role="alert">Couldn’t load the intro. Check your connection, then try again.</div>
      )}
    </div>
  );
}

const fmtBytes = (n: number): string =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;

/**
 * The Massey backup the Cambridge migration took on this device (DECISIONS C3),
 * as a file, plus how much room the local-only study photos use. Both modules
 * load on demand so the main chunk does not carry them.
 */
function MasseyBackupCard() {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [photoBytes, setPhotoBytes] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    import('@/features/cambridge/photos')
      .then((m) => m.photoUsageBytes())
      .then((n) => { if (live) setPhotoBytes(n); }, () => { if (live) setPhotoBytes(null); });
    return () => { live = false; };
  }, []);
  const download = (): void => {
    if (state === 'saving') return;
    setState('saving');
    import('@/features/cambridge/migration')
      .then((m) => m.downloadMasseyBackup())
      .then(() => setState('saved'), () => setState('failed'));
  };
  return (
    <div class="dcard">
      <div class="dcard-h">
        <span class="dcard-t">Massey backup</span>
      </div>
      <div class="dcard-desc">
        A copy of the Massey Standard tracker data, taken on this device before the Cambridge Method first ran.
      </div>
      <div class="dactions">
        <button class="mbtn" type="button" onClick={download} aria-busy={state === 'saving'}>
          {state === 'saving' ? 'Preparing…' : 'Download Massey backup'}
        </button>
      </div>
      {state === 'saved' && <div class="note" role="status">Saved the backup file.</div>}
      {state === 'failed' && (
        <div class="note" role="alert">Couldn’t prepare the backup file. Try again.</div>
      )}
      <div class="note">
        Study photos on this device: {photoBytes === null ? '…' : fmtBytes(photoBytes)} (kept here only, not synced)
      </div>
    </div>
  );
}

export function DataView() {
  dataRev.value; // re-derive on store/sync/message changes
  const vm = dataVM();
  const s = vm.sync;
  const m = vm.metrics;
  const c = m.counts;
  const statusLabel = !s.cloudConfigured ? 'Local' : s.dirtyStores.length ? 'Unsynced' : 'Synced';
  const statusTone = !s.cloudConfigured ? 'off' : s.dirtyStores.length ? 'dirty' : 'ok';

  return (
    <>
      <PageHead
        title="Data"
        note={
          <>
            <span class={'tone-' + statusTone}>{statusLabel}</span> · rev {s.baseRev}
            {s.dirtyStores.length ? ` · ${s.dirtyStores.length} unsynced` : ''}
          </>
        }
      />

      {/* Result of the last Push / Pull / Export / Import, visible without opening Settings. */}
      {s.lastMessage && (
        <div id="d-cloudmsg" class="note" role="status" style={'margin-top:12px;color:' + (s.lastMessageBad ? 'var(--danger)' : 'var(--ok)')}>
          {s.lastMessage}
        </div>
      )}

      <div class="tilegrid">
        <div class="tile">
          <span class="tile-l">Storage</span>
          <span class="tile-v">
            {m.kilobytes}
            <span class="tile-u">KB</span>
          </span>
        </div>
        <div class="tile">
          <span class="tile-l">Workout</span>
          <span class="tile-v">
            {c.workoutSets}
            <span class="tile-u">sets</span>
          </span>
        </div>
        <div class="tile">
          <span class="tile-l">Meals</span>
          <span class="tile-v">{c.meals}</span>
        </div>
        <div class="tile">
          <span class="tile-l">Knowledge</span>
          <span class="tile-v">
            {c.knowledgeItems}
            <span class="tile-u">cards</span>
          </span>
        </div>
      </div>

      <div class="dcard">
        <div class="dcard-h">
          <span class="dcard-t">Cloud sync</span>
          <span class={'dcard-st ' + (s.cloudConfigured ? '' : 'off')}>{s.cloudConfigured ? '● On' : '○ Off'}</span>
        </div>
        <div class="dcard-desc">
          {s.cloudConfigured
            ? 'Every save syncs across your devices. Your key stays on this device.'
            : 'Sync across devices with a Supabase backend.'}
        </div>
        {s.cloudConfigured && (
          <div class="dactions">
            <button class="mbtn" onClick={dataActions.push}>
              <IconCloud />↑ Push
            </button>
            <button class="mbtn" onClick={dataActions.pull}>
              <IconCloud />↓ Pull
            </button>
          </div>
        )}
        <details class="ddisc">
          <summary>{s.cloudConfigured ? 'Settings' : 'Set up cloud sync'}</summary>
          <div class="ddisc-b">
            <div class="note">
              Create a Supabase project + public bucket, then paste your Project URL and anon key. The ID stays on this
              device only.
            </div>
            <input id="d-pantry" class="minp" placeholder="Project URL" aria-label="Supabase project URL" defaultValue={s.pantryId} />
            <input id="d-pantry-appkey" class="minp" type="password" placeholder="Anon key" aria-label="Supabase anon key" />
            <div class="dactions">
              <button class="mbtn primary" onClick={() => dataActions.savePantryId(rv('d-pantry').trim(), rv('d-pantry-appkey').trim())}>
                Save
              </button>
              <button class="mbtn" onClick={dataActions.testConnection}>
                Test
              </button>
              <button class="mbtn" onClick={dataActions.showDiagnostics}>
                Status
              </button>
            </div>
            <div id="d-diagout" class="note" style="font-family:var(--font-mono);font-size:var(--fs-1);white-space:pre-line" />
          </div>
        </details>
      </div>

      <div class="dcard">
        <div class="dcard-h">
          <span class="dcard-t">AI features</span>
          <span class={'dcard-st ' + (vm.model.configured ? '' : 'off')}>{vm.model.configured ? '✓ Ready' : '○ Off'}</span>
        </div>
        <div class="dcard-desc">
          {vm.model.configured
            ? 'Meal estimates & answer grading, via your cloud backend.'
            : 'Set up cloud sync first — AI runs through it.'}
        </div>
        <details class="ddisc">
          <summary>How it works</summary>
          <div class="ddisc-b">
            <div class="note">
              Meal macro estimates and the Knowledge tab’s AI answer/grade run on <b>{vm.model.model}</b> through
              OpenRouter, proxied by a Supabase Edge Function. The OpenRouter key lives in the function’s secrets — never
              on this device, never exported or synced. Deploy the <b>openrouter-proxy</b> function and set its{' '}
              <b>OPENROUTER_API_KEY</b> secret.
            </div>
          </div>
        </details>
      </div>

      <div class="dcard">
        <div class="dcard-h">
          <span class="dcard-t">Backup</span>
        </div>
        <div class="dcard-desc">Export on one device, import on another. Works even offline.</div>
        <div class="dactions">
          <button class="mbtn primary" onClick={dataActions.exportAll}>
            Export
          </button>
          <button class="mbtn" onClick={() => dataActions.importPasted(dataIo.value)}>
            Import
          </button>
          <button class="mbtn" onClick={dataActions.copyToClipboard}>
            Copy
          </button>
        </div>
        <textarea
          id="d-io"
          class="dictxt"
          placeholder="Exported JSON appears here."
          aria-label="Backup JSON"
          value={dataIo.value}
          onInput={(e) => { dataIo.value = (e.currentTarget as HTMLTextAreaElement).value; }}
        />
        <div id="d-msg" class="note" style="color:var(--ok)" />
      </div>

      <MasseyBackupCard />

      <HealthPanel />

      <IntroCard />

      <details class="ddisc dadv">
        <summary>Advanced &amp; recovery</summary>
        <div class="ddisc-b">
          <div class="dcard-desc" style="margin-top:0">
            payload {vm.payloadKb}KB · {c.tombstones} tombstones · {c.workoutDays}d workouts · {c.mealDays}d meals
          </div>
          <button class="dadv-btn" onClick={dataActions.restoreSnapshot}>
            Undo last import, pull, or reset<small>restore this device's data from just before it (this device only)</small>
          </button>
          <div class="dadv-sec">Restore a single-app backup</div>
          <div class="dactions">
            <select id="d-single-key" class="minp" aria-label="Which app to restore">
              <option value="overload">Workout</option>
              <option value="surplus">Meals</option>
              <option value="csgraph">Knowledge</option>
              <option value="core">Schedule</option>
            </select>
            <button class="mbtn primary" onClick={() => dataActions.importSingle(rv('d-single-key'), rv('d-single-io'))}>
              Import
            </button>
          </div>
          <textarea id="d-single-io" class="dictxt" placeholder="Paste one app's raw backup JSON here." aria-label="Single-app backup JSON" />
          <button class="dadv-btn danger" onClick={discard}>
            Discard unsaved changes<small>revert edits since the last save</small>
          </button>
          <div class="dadv-sec">Danger zone</div>
          <button class="dadv-btn danger" onClick={dataActions.resetKnowledge}>
            Reset knowledge progress<small>erase all mastery, reviews &amp; history, then overwrite the cloud</small>
          </button>
          <button class="dadv-btn danger" onClick={dataActions.overwriteCloud}>
            Overwrite cloud from this device<small>make this device authoritative — replaces other devices on their next sync</small>
          </button>
        </div>
      </details>
    </>
  );
}
