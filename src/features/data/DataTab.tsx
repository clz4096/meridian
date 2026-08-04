/**
 * Data tab — status hero + storage stats + calm Cloud/AI/Backup cards + tucked
 * Advanced disclosure. Ports renderDataHTML to JSX; inputs stay uncontrolled (by
 * id) and are read via host.readValue in the handlers, matching the old flow.
 */
import { normaliseState, storageMetrics } from '@/features/data/dataSelectors';
import type { DataViewModel } from '@/features/data/types';
import type { StoreKey } from '@/core/storage/appState';
import { sync, cloudEnabled } from '@/app/bootstrap';
import { host } from '@/ui/host';
import { dataRev, dataMsg } from '@/ui/store';
import { wk, sg, kg, core, dataActions, discard, goHome } from '@/ui/actions';

const KEYS: StoreKey[] = ['core', 'overload', 'surplus', 'csgraph'];

function dataVM(): DataViewModel {
  const state = normaliseState({ core: core(), overload: wk(), surplus: sg(), csgraph: kg() });
  const u = host.getItem('meridian_supabase_url');
  return {
    metrics: storageMetrics(state),
    payloadKb: Math.round(JSON.stringify(state).length / 102.4) / 10,
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
      <button class="backbtn" onClick={goHome}>
        ‹ Back
      </button>
      <div class="eyebrow">Data</div>

      <div class="dhero">
        <div class={'dstatus ' + statusTone}>
          <span class="ddot" />
          {statusLabel}
        </div>
        <div class="dsub">
          rev {s.baseRev}
          {s.dirtyStores.length ? (
            <>
              <br />
              unsynced: {s.dirtyStores.join(', ')}
            </>
          ) : null}
        </div>
      </div>

      <div class="statgrid dstats">
        <div class="stat">
          <div class="v">{m.kilobytes}</div>
          <div class="k">KB</div>
        </div>
        <div class="stat">
          <div class="v">{c.workoutSets}</div>
          <div class="k">sets</div>
        </div>
        <div class="stat">
          <div class="v">{c.meals}</div>
          <div class="k">meals</div>
        </div>
        <div class="stat">
          <div class="v">{c.knowledgeItems}</div>
          <div class="k">cards</div>
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
              ☁↑ Push
            </button>
            <button class="mbtn" onClick={dataActions.pull}>
              ☁↓ Pull
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
            <input id="d-pantry" class="minp" placeholder="Project URL" defaultValue={s.pantryId} />
            <input id="d-pantry-appkey" class="minp" type="password" placeholder="Anon key" />
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
            <div id="d-diagout" class="note" style="font-family:var(--mono);font-size:12px;white-space:pre-line" />
            <div id="d-cloudmsg" class="note" style={'color:' + (s.lastMessageBad ? 'var(--deficit)' : 'var(--ok)')}>
              {s.lastMessage || ''}
            </div>
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
          <button class="mbtn" onClick={() => dataActions.importPasted(rv('d-io'))}>
            Import
          </button>
          <button class="mbtn" onClick={dataActions.copyToClipboard}>
            Copy
          </button>
        </div>
        <textarea id="d-io" class="dictxt" placeholder="Exported JSON appears here." />
        <div id="d-msg" class="note" style="color:var(--ok)" />
      </div>

      <details class="ddisc dadv">
        <summary>Advanced &amp; recovery</summary>
        <div class="ddisc-b">
          <div class="dcard-desc" style="margin-top:0">
            payload {vm.payloadKb}KB · {c.tombstones} tombstones · {c.workoutDays}d workouts · {c.mealDays}d meals
          </div>
          <button class="dadv-btn" onClick={dataActions.restoreSnapshot}>
            Undo last cloud overwrite<small>restore the snapshot from before the last sync</small>
          </button>
          <div class="dadv-sec">Restore a single-app backup</div>
          <div class="dactions">
            <select id="d-single-key" class="minp">
              <option value="overload">Workout</option>
              <option value="surplus">Meals</option>
              <option value="csgraph">Knowledge</option>
              <option value="core">Schedule</option>
            </select>
            <button class="mbtn primary" onClick={() => dataActions.importSingle(rv('d-single-key'), rv('d-single-io'))}>
              Import
            </button>
          </div>
          <textarea id="d-single-io" class="dictxt" placeholder="Paste one app's raw backup JSON here." />
          <button class="dadv-btn danger" onClick={discard}>
            Discard unsaved changes<small>revert edits since the last save</small>
          </button>
        </div>
      </details>
    </>
  );
}
