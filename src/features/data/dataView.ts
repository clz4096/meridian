/**
 * Data tab view. Replaces the 11.1 KB / 52-branch `renderData`.
 * All derivation now comes from `dataSelectors` and the SyncEngine.
 */
import type { StorageMetrics } from '@/features/data/dataSelectors';
import { esc } from '@/ui/html';
import { BaseViewController, type ViewHost } from '@/ui/viewHost';

export interface SyncStatus {
  cloudConfigured: boolean;
  pantryId: string;
  baseRev: number;
  dirtyStores: string[];
  lastMessage: string;
  lastMessageBad: boolean;
}

export interface ModelStatus {
  /** whether a key is stored on this device */
  configured: boolean;
  model: string;
  keyPreview: string;
}

export interface DataViewModel {
  metrics: StorageMetrics;
  sync: SyncStatus;
  payloadKb: number;
  model: ModelStatus;
}

export interface DataActions {
  savePantryId(keyId: string, appKey: string): void;
  testConnection(): void;
  push(): void;
  pull(): void;
  exportAll(): void;
  importPasted(text: string): void;
  copyToClipboard(): void;
  importSingle(store: string, text: string): void;
  restoreSnapshot(): void;
  showDiagnostics(): void;
}

export function renderDataHTML(vm: DataViewModel): string {
  const s = vm.sync;
  const m = vm.metrics;
  const c = m.counts;

  const statusLabel = !s.cloudConfigured ? 'Local' : s.dirtyStores.length ? 'Unsynced' : 'Synced';
  const statusTone = !s.cloudConfigured ? 'off' : s.dirtyStores.length ? 'dirty' : 'ok';

  return (
    `<button class="backbtn" data-act="to-hub">‹ Back</button>` +
    `<div class="eyebrow">Data</div>` +

    // status hero
    `<div class="dhero"><div class="dstatus ${statusTone}"><span class="ddot"></span>${statusLabel}</div>` +
    `<div class="dsub">rev ${s.baseRev}${s.dirtyStores.length ? '<br>unsynced: ' + esc(s.dirtyStores.join(', ')) : ''}</div></div>` +

    // storage stats
    `<div class="statgrid dstats">` +
    `<div class="stat"><div class="v">${m.kilobytes}</div><div class="k">KB</div></div>` +
    `<div class="stat"><div class="v">${c.workoutSets}</div><div class="k">sets</div></div>` +
    `<div class="stat"><div class="v">${c.meals}</div><div class="k">meals</div></div>` +
    `<div class="stat"><div class="v">${c.knowledgeItems}</div><div class="k">cards</div></div>` +
    `</div>` +

    // cloud sync card
    `<div class="dcard"><div class="dcard-h"><span class="dcard-t">Cloud sync</span>` +
    `<span class="dcard-st ${s.cloudConfigured ? '' : 'off'}">${s.cloudConfigured ? '● On' : '○ Off'}</span></div>` +
    `<div class="dcard-desc">${s.cloudConfigured ? 'Every save syncs across your devices. Your key stays on this device.' : 'Sync across devices with a Supabase backend.'}</div>` +
    (s.cloudConfigured ? `<div class="dactions"><button class="mbtn" data-act="push">☁↑ Push</button><button class="mbtn" data-act="pull">☁↓ Pull</button></div>` : '') +
    `<details class="ddisc"><summary>${s.cloudConfigured ? 'Settings' : 'Set up cloud sync'}</summary><div class="ddisc-b">` +
    `<div class="note">Create a Supabase project + public bucket, then paste your Project URL and anon key. The ID stays on this device only.</div>` +
    `<input id="d-pantry" class="minp" placeholder="Project URL" value="${esc(s.pantryId)}">` +
    `<input id="d-pantry-appkey" class="minp" type="password" placeholder="Anon key">` +
    `<div class="dactions"><button class="mbtn primary" data-act="save-id">Save</button><button class="mbtn" data-act="test">Test</button><button class="mbtn" data-act="diag">Status</button></div>` +
    `<div id="d-diagout" class="note" style="font-family:var(--mono);font-size:12px;white-space:pre-line"></div>` +
    `<div id="d-cloudmsg" class="note" style="color:${s.lastMessageBad ? 'var(--deficit)' : 'var(--ok)'}">${esc(s.lastMessage || '')}</div>` +
    `</div></details></div>` +

    // AI card
    `<div class="dcard"><div class="dcard-h"><span class="dcard-t">AI features</span>` +
    `<span class="dcard-st ${vm.model.configured ? '' : 'off'}">${vm.model.configured ? '✓ Ready' : '○ Off'}</span></div>` +
    `<div class="dcard-desc">${vm.model.configured ? 'Meal estimates &amp; answer grading, via your cloud backend.' : 'Set up cloud sync first — AI runs through it.'}</div>` +
    `<details class="ddisc"><summary>How it works</summary><div class="ddisc-b"><div class="note">` +
    `Meal macro estimates and the Knowledge tab’s AI answer/grade run on <b>${esc(vm.model.model)}</b> through OpenRouter, proxied by a Supabase Edge Function. ` +
    `The OpenRouter key lives in the function’s secrets — never on this device, never exported or synced. Deploy the <b>openrouter-proxy</b> function and set its <b>OPENROUTER_API_KEY</b> secret.` +
    `</div></div></details></div>` +

    // backup card
    `<div class="dcard"><div class="dcard-h"><span class="dcard-t">Backup</span></div>` +
    `<div class="dcard-desc">Export on one device, import on another. Works even offline.</div>` +
    `<div class="dactions"><button class="mbtn primary" data-act="export">Export</button><button class="mbtn" data-act="import">Import</button><button class="mbtn" data-act="copy">Copy</button></div>` +
    `<textarea id="d-io" class="dictxt" placeholder="Exported JSON appears here."></textarea>` +
    `<div id="d-msg" class="note" style="color:var(--ok)"></div></div>` +

    // advanced & recovery
    `<details class="ddisc dadv"><summary>Advanced &amp; recovery</summary><div class="ddisc-b">` +
    `<div class="dcard-desc" style="margin-top:0">payload ${vm.payloadKb}KB · ${c.tombstones} tombstones · ${c.workoutDays}d workouts · ${c.mealDays}d meals</div>` +
    `<button class="dadv-btn" data-act="restore-snap">Undo last cloud overwrite<small>restore the snapshot from before the last sync</small></button>` +
    `<div class="dadv-sec">Restore a single-app backup</div>` +
    `<div class="dactions"><select id="d-single-key" class="minp"><option value="overload">Workout</option><option value="surplus">Meals</option><option value="csgraph">Knowledge</option><option value="core">Schedule</option></select><button class="mbtn primary" data-act="import-single">Import</button></div>` +
    `<textarea id="d-single-io" class="dictxt" placeholder="Paste one app's raw backup JSON here."></textarea>` +
    `<button class="dadv-btn danger" data-act="discard">Discard unsaved changes<small>revert edits since the last save</small></button>` +
    `</div></details>`
  );
}

export class DataViewController extends BaseViewController {
  constructor(
    host: ViewHost,
    private readonly actions: DataActions,
    private readonly readValue: (id: string) => string,
  ) {
    super(host);
  }

  protected onAction(act: string, _ds: Record<string, string>): void {
    switch (act) {
      case 'save-id': this.actions.savePantryId(this.readValue('d-pantry').trim(), this.readValue('d-pantry-appkey').trim()); break;
      case 'test': this.actions.testConnection(); break;
      case 'push': this.actions.push(); break;
      case 'pull': this.actions.pull(); break;
      case 'diag': this.actions.showDiagnostics(); break;
      case 'export': this.actions.exportAll(); break;
      case 'import': this.actions.importPasted(this.readValue('d-io')); break;
      case 'copy': this.actions.copyToClipboard(); break;
      case 'import-single':
        this.actions.importSingle(this.readValue('d-single-key'), this.readValue('d-single-io'));
        break;
      case 'restore-snap': this.actions.restoreSnapshot(); break;
      default: break;
    }
  }

  repaint(vm: DataViewModel): boolean {
    return this.paint(renderDataHTML(vm));
  }
}
