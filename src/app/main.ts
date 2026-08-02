/**
 * Browser entry (Vite). Replaces the hand-injected core `<script>` + inline boot
 * IIFE: it loads the styles, gates the app behind the landing, lazy-imports the
 * Three/graph chunk, and mounts the app on Enter (degrading gracefully if the
 * chunk fails to load so the user can always get in).
 */
import '@/styles/app.css';
import { mountApp } from '@/app/entry';
import { DomAppHost } from '@/app/domAppHost';

const body = document.body;
body.classList.add('pre-enter'); // hide the dashboard chrome until Enter
const root = document.documentElement;
root.style.background = '#070B14'; // paint the void so no safe-area edge shows black under the landing

const landing = document.getElementById('landing');
let entered = false;

function enter(): void {
  if (entered) return;
  entered = true;
  body.classList.remove('pre-enter');
  root.style.background = ''; // hand the backdrop back to the app surface
  if (landing) {
    landing.classList.add('leaving');
    setTimeout(() => landing.remove(), 550);
  }
  mountApp(new DomAppHost(document));
}

// Lazily pull in the graph chunk (Three) and mount the landing; on failure, still let the user in.
import('@/landing/index')
  .then((m) => m.mountLanding(document, enter))
  .catch(() => {
    const e = document.getElementById('enter');
    if (e) e.addEventListener('click', (ev) => { ev.preventDefault(); enter(); });
  });
