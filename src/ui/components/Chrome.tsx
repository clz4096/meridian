/**
 * App chrome driven by signals: the floating Save chip + the rest-timer bar.
 * These replace DomAppHost's imperative paintSaveChip / DomRestBar — the host
 * adapter now just sets `saveState` / `savedFlash` / `restState` and these render.
 */
import { useEffect } from 'preact/hooks';
import { saveState, savedFlash, restState } from '@/ui/store';
import { stopRest } from '@/ui/host';
import { appState } from '@/app/bootstrap';

export function SaveChip() {
  const s = saveState.value;
  const flash = savedFlash.value;
  return (
    <>
      {(s.dirty || s.failed) && (
        <button class={'savestat ' + (s.failed ? 'failed' : 'dirty')} id="savechip" onClick={() => void appState.save()}>
          <span class="dot" />
          <span id="savetxt">{s.failed ? 'Save failed' : 'Unsaved'}</span>
        </button>
      )}
      <div class={'savedflash' + (flash ? ' show' : '')}>Saved ✓</div>
    </>
  );
}

export function RestBar() {
  const r = restState.value;
  useEffect(() => {
    document.body.classList.toggle('resting', !!r);
    return () => document.body.classList.remove('resting');
  }, [!!r]);
  if (!r) return null;
  return (
    <div class={'restbar' + (r.over ? ' over' : '')} id="restbar">
      <div class="restfill" style={{ width: r.fill + '%' }} />
      <div class="restrow">
        <span class="resttime">{r.remaining}</span>
        <div class="restmeta">
          <div class="restl">{r.label}</div>
          <div class="reste">{r.sub}</div>
        </div>
        <button class="restskip" onClick={stopRest}>
          Skip
        </button>
      </div>
    </div>
  );
}
