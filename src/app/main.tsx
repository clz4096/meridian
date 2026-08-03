/**
 * Browser entry (Preact). Loads styles, gates the app behind the landing, and on
 * Enter boots the stores/sync and renders <App/> into #app.
 */
import '@/styles/app.css';
import { render } from 'preact';
import { App } from '@/ui/App';
import { boot } from '@/app/bootstrap';

const body = document.body;
body.classList.add('pre-enter'); // hide the dashboard until Enter
const root = document.documentElement;
root.style.background = '#070B14'; // paint the void so no safe-area edge shows black under the landing

const landing = document.getElementById('landing');
let entered = false;

function enter(): void {
  if (entered) return;
  entered = true;
  body.classList.remove('pre-enter');
  root.style.background = '';
  if (landing) {
    landing.classList.add('leaving');
    setTimeout(() => landing.remove(), 550);
  }
  void boot(); // appState.init() runs synchronously before render; core loads async
  const mount = document.getElementById('app');
  if (mount) render(<App />, mount);
}

// Lazily pull in the graph chunk (Three) and mount the landing; degrade gracefully.
import('@/landing/index')
  .then((m) => m.mountLanding(document, enter))
  .catch(() => {
    const e = document.getElementById('enter');
    if (e) e.addEventListener('click', (ev) => { ev.preventDefault(); enter(); });
  });
