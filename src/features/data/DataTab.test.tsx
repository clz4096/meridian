/**
 * DataView component test. Replaces dataView.test.ts (which tested the string
 * renderer + focus-preserving paint machinery that no longer exists). Asserts:
 * the VM-derived status/stats render, the action buttons are wired to the right
 * action, and the stored URL is masked (never shown whole) — the credential-
 * safety case carried over from the old suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { DataView } from '@/features/data/DataTab';
import { dataActions } from '@/ui/actions';
import { host } from '@/ui/host';
import { dataIo, dataMsg } from '@/ui/store';

afterEach(() => {
  cleanup();
  dataIo.value = '';
  dataMsg.value = { text: '', bad: false };
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('DataView', () => {
  it('renders the local status + storage cards when cloud is not configured', () => {
    const { getByText, container } = render(<DataView />);
    expect(getByText('Local')).toBeTruthy();
    expect(getByText('Cloud sync')).toBeTruthy();
    expect(getByText('AI features')).toBeTruthy();
    expect(getByText('Backup')).toBeTruthy();
    // stat tile labels (scoped to the grid — the same words also appear in the Advanced restore <select>)
    const labels = [...container.querySelectorAll('.tilegrid .tile-l')].map((e) => e.textContent);
    expect(labels).toEqual(['Storage', 'Workout', 'Meals', 'Knowledge']);
  });

  it('wires Export/Copy to the data actions', () => {
    const exportSpy = vi.spyOn(dataActions, 'exportAll').mockImplementation(() => {});
    const copySpy = vi.spyOn(dataActions, 'copyToClipboard').mockImplementation(() => {});
    const { getByText } = render(<DataView />);
    fireEvent.click(getByText('Export'));
    fireEvent.click(getByText('Copy'));
    expect(exportSpy).toHaveBeenCalledOnce();
    expect(copySpy).toHaveBeenCalledOnce();
  });

  it('reads the pasted JSON when Import is clicked', () => {
    const importSpy = vi.spyOn(dataActions, 'importPasted').mockImplementation(() => {});
    const { getByText, container } = render(<DataView />);
    const io = container.querySelector('#d-io') as HTMLTextAreaElement;
    fireEvent.input(io, { target: { value: '{"overload":{}}' } });
    fireEvent.click(getByText('Import', { selector: '.dcard .mbtn' }));
    expect(importSpy).toHaveBeenCalledWith('{"overload":{}}');
  });

  // BUGS P1-a: the status line appearing after Export re-rendered the card and the
  // textarea came back empty, so Copy copied nothing.
  it('keeps the exported JSON in the textarea after Export, and Copy copies it', async () => {
    const copy = vi.spyOn(host, 'copy').mockResolvedValue(true);
    const { getByText, container } = render(<DataView />);
    fireEvent.click(getByText('Export'));
    await Promise.resolve();
    const io = container.querySelector('#d-io') as HTMLTextAreaElement;
    expect(io.isConnected).toBe(true);
    expect(io.value.length).toBeGreaterThan(0);
    expect(JSON.parse(io.value)).toBeTypeOf('object');
    expect(getByText('Exported all 5 stores.')).toBeTruthy();
    fireEvent.click(getByText('Copy'));
    await Promise.resolve();
    expect(copy).toHaveBeenCalledWith(io.value);
  });

  it('masks a stored Supabase URL — shows the subdomain + ellipsis, never the whole host', () => {
    vi.spyOn(host, 'getItem').mockImplementation((k: string) =>
      k === 'meridian_supabase_url' ? 'https://abcdefgh.supabase.co' : null,
    );
    const { container } = render(<DataView />);
    const pantry = container.querySelector('#d-pantry') as HTMLInputElement;
    expect(pantry.value).toBe('abcdefgh...');
    expect(pantry.value).not.toContain('supabase.co');
  });
});
