/**
 * Rest-timer alert: a short two-tone chime plus a vibration where supported.
 * iOS only lets Web Audio play after a user gesture, so `unlockChime` runs inside
 * the tap that starts the timer; the chime itself plays later from a timer. A
 * locked or backgrounded PWA can't play sound (and iOS has no vibrate API), so
 * the alert is for when the app is open; a countdown that ended in the
 * background chimes on return.
 */
let ctx: AudioContext | null = null;

export function unlockChime(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no audio: the bar still turns "over" */
  }
}

export function chime(): void {
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch {
    /* unsupported */
  }
  if (!ctx) return;
  // iOS suspends (or "interrupts") the context in the background; try to resume on
  // return. If resume needs a gesture it rejects, and the bar still shows "over".
  if (ctx.state !== 'running') {
    void ctx.resume().then(play, () => {});
    return;
  }
  play();
}

function play(): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const at = t0 + i * 0.18;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.18);
  }
}
