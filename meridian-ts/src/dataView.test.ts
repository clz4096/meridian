/**
 * Data tab view tests — storage/sync/backup panel rendering, credential
 * masking, escaping, and click delegation. (Previously co-located, mislabeled,
 * inside mealView.test.ts.)
 */
import { describe, expect, it, vi } from 'vitest';
import { renderDataHTML, DataViewController, type DataActions, type DataViewModel } from './dataView.js';
import { normaliseState, storageMetrics } from './dataSelectors.js';
import type { ViewHost } from './viewHost.js';

class FakeHost implements ViewHost {
  html = ''; binds = 0; paints = 0;
  handlers: Record<string, (e: Event) => void> = {};
  container = {
    get innerHTML() { return hostRef.html; },
    set innerHTML(v: string) { hostRef.html = v; hostRef.paints++; },
    addEventListener: (t: string, h: (e: Event) => void) => { hostRef.handlers[t] = h; hostRef.binds++; },
    querySelector: () => null,
  };
  getActiveElementId = () => null;
  getSelectionStart = () => null;
  restoreFocus = () => {};
  getScrollY = () => 0;
  setScrollY = () => {};
  captureInputValues = () => ({});
  restoreInputValues = () => {};
  fire(dataset: Record<string, string>) { this.handlers.click?.({ target: { dataset } } as unknown as Event); }
}
let hostRef: FakeHost;

describe('data view', () => {
  const vm = (): DataViewModel => ({
    metrics: storageMetrics(normaliseState({})),
    sync: { cloudConfigured: true, pantryId: 'abc', baseRev: 3, dirtyStores: [], lastMessage: '', lastMessageBad: false },
    payloadKb: 29.7,
    model: { configured: true, model: 'meta-llama/llama-3.3-70b-instruct:free', keyPreview: 'sk-or-…abcd' },
  });

  it('renders balanced markup', () => {
    const html = renderDataHTML(vm());
    expect((html.match(/<div/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
    expect(html).not.toContain('undefined');
  });

  it('never renders the API key itself, only a masked preview', () => {
    const v = vm();
    v.model.keyPreview = 'sk-or-…abcd';
    const html = renderDataHTML(v);
    expect(html).not.toContain('sk-or-v1-realsecret');
    expect(html).toContain('type="password"');
  });

  it('escapes the pantry id', () => {
    const v = vm();
    v.sync.pantryId = '"><script>alert(1)</script>';
    const html = renderDataHTML(v);
    expect(html).not.toContain('<script>alert');
  });

  it('binds once and routes actions', () => {
    hostRef = new FakeHost();
    const actions: DataActions = {
      savePantryId: vi.fn(), testConnection: vi.fn(), push: vi.fn(), pull: vi.fn(),
      exportAll: vi.fn(), importPasted: vi.fn(), copyToClipboard: vi.fn(),
      importSingle: vi.fn(), restoreSnapshot: vi.fn(), showDiagnostics: vi.fn(),
    };
    const values: Record<string, string> = { 'd-pantry': ' my-id ', 'd-io': '{}', 'd-single-key': 'overload', 'd-single-io': '{"a":1}' };
    const ctrl = new DataViewController(hostRef, actions, (id) => values[id] ?? '');
    ctrl.repaint(vm());
    expect(hostRef.binds).toBe(1);
    hostRef.fire({ act: 'save-id' });
    expect(actions.savePantryId).toHaveBeenCalledWith('my-id', '');
    hostRef.fire({ act: 'import-single' });
    expect(actions.importSingle).toHaveBeenCalledWith('overload', '{"a":1}');
    hostRef.fire({ act: 'pull' });
    expect(actions.pull).toHaveBeenCalled();
  });
});
