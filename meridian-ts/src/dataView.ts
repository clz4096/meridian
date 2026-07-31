/**
 * Data tab view. Replaces the 11.1 KB / 52-branch `renderData`.
 * All derivation now comes from `dataSelectors` and the SyncEngine.
 */
import type { StorageMetrics } from './dataSelectors.js';
import type { ViewHost } from './workoutView.js';
import { esc } from './workoutView.js';

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
  return (
    `<div class="panel mpanel"><p class="panel-t">☁ Cloud backend (sync across devices)</p>` +
    `<div class="note" style="margin-bottom:10px">One-time setup: create a <b>Supabase</b> project, create a public bucket, paste your Project URL and anon key below. ` +
    `Every save then syncs, and each device pulls the latest on open. The ID stays on this device only.</div>` +
    `<div class="mrow"><input id="d-pantry" placeholder="Project URL" style="flex:1;min-width:200px" value="${esc(s.pantryId)}"><input id="d-pantry-appkey" type="password" placeholder="Anon Key" style="flex:1;min-width:180px">` +
    `<button class="mbtn primary" data-act="save-id">Save ID</button></div>` +
    `<div class="mrow" style="margin-top:8px"><button class="mbtn" data-act="test">Test connection</button>` +
    `<button class="mbtn" data-act="push">☁↑ Push now</button>` +
    `<button class="mbtn" data-act="pull">☁↓ Pull now</button>` +
    `<button class="mbtn" data-act="diag">Sync status</button></div>` +
    `<div id="d-diagout" class="note" style="margin-top:6px;font-family:var(--mono);font-size:12px;white-space:pre-line"></div>` +
    `<div id="d-cloudmsg" class="note" style="margin-top:6px;color:${s.lastMessageBad ? 'var(--deficit)' : 'var(--teal)'}">` +
    `${esc(s.lastMessage || (s.cloudConfigured ? 'Cloud sync is ON.' : 'Cloud sync is OFF — add a Pantry ID to enable.'))}</div>` +

    `<div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>` +
    `<p class="panel-t">\u2699 AI \u2014 meal estimation, answers &amp; grading</p>` +
    `<div class="note" style="margin-bottom:10px">Meal macro estimates and the Knowledge tab\u2019s AI answer/grade run on <b>${esc(vm.model.model)}</b> through OpenRouter, ` +
    `proxied by a Supabase Edge Function. The OpenRouter key lives in the function\u2019s secrets \u2014 never on this device, never exported or synced. ` +
    `To enable: deploy the <b>openrouter-proxy</b> function and set its <b>OPENROUTER_API_KEY</b> secret.</div>` +
    `<div class="note" style="margin-top:6px">${vm.model.configured ? '\u2713 Cloud proxy configured \u2014 AI features ready.' : 'Set up a cloud backend above first \u2014 AI runs through it.'}</div>` +

    `<div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>` +
    `<p class="panel-t">Storage</p><div class="statgrid">` +
    `<div class="stat"><div class="v">${m.kilobytes}</div><div class="k">KB total</div></div>` +
    `<div class="stat"><div class="v">${c.workoutSets}</div><div class="k">sets · ${c.workoutDays}d</div></div>` +
    `<div class="stat"><div class="v">${c.meals}</div><div class="k">meals · ${c.mealDays}d</div></div>` +
    `<div class="stat"><div class="v">${c.knowledgeItems}</div><div class="k">cards rated</div></div>` +
    `</div><div class="note" style="margin-top:6px">payload ${vm.payloadKb}KB · ${c.tombstones} tombstones · rev ${s.baseRev}` +
    `${s.dirtyStores.length ? ' · unsynced: ' + esc(s.dirtyStores.join(', ')) : ' · all synced'}</div>` +

    `<div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>` +
    `<div class="mrow"><button class="mbtn" data-act="restore-snap">↺ Undo last cloud overwrite</button></div>` +
    `<div class="note" style="margin-top:6px">If a sync ever replaced newer local data, this restores the snapshot taken immediately before it.</div>` +

    `<div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>` +
    `<p class="panel-t">Manual backup (always reliable)</p>` +
    `<div class="note" style="margin-bottom:10px">Export on one device, paste + import on another. Works even when cloud sync is unavailable.</div>` +
    `<div class="mrow"><button class="mbtn primary" data-act="export">Export everything</button>` +
    `<button class="mbtn" data-act="import">Import from paste</button>` +
    `<button class="mbtn" data-act="copy">Copy to clipboard</button></div>` +
    `<textarea id="d-io" class="dictxt" style="margin-top:10px" placeholder="Exported JSON appears here."></textarea>` +

    `<div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>` +
    `<p class="panel-t">Restore a single-app backup</p>` +
    `<div class="note" style="margin-bottom:8px">Import an original per-app export. Pick the store, paste, Import.</div>` +
    `<div class="mrow"><select id="d-single-key">` +
    `<option value="overload">Workout (overload)</option><option value="surplus">Meal Tracker (surplus)</option>` +
    `<option value="csgraph">Knowledge (csgraph)</option><option value="core">Schedule (meridian-core)</option></select>` +
    `<button class="mbtn primary" data-act="import-single">Import single backup</button></div>` +
    `<textarea id="d-single-io" class="dictxt" style="margin-top:10px" placeholder="Paste one app's raw backup JSON here."></textarea>` +
    `<div id="d-msg" class="note" style="color:var(--ok);margin-top:6px"></div></div>`
  );
}

export class DataViewController {
  private lastHTML = '';
  constructor(
    private readonly host: ViewHost,
    private readonly actions: DataActions,
    private readonly readValue: (id: string) => string,
  ) {
    this.host.container.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(e: Event): void {
    const ds = (e.target as unknown as { dataset?: Record<string, string> } | null)?.dataset;
    if (!ds?.act) return;
    switch (ds.act) {
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
    const html = renderDataHTML(vm);
    if (html === this.lastHTML) return false;
    const focusId = this.host.getActiveElementId();
    const caret = this.host.getSelectionStart();
    const typed = this.host.captureInputValues();
    this.host.container.innerHTML = html;
    this.lastHTML = html;
    this.host.restoreInputValues(typed);
    if (focusId) this.host.restoreFocus(focusId, caret);
    return true;
  }
}
