/**
 * Browser entry (Preact). Loads styles, boots the stores/sync and renders <App/>
 * into #app straight away: Today is the first screen. The three.js intro is no
 * longer on the startup path; the Data tab loads it on demand ("Play the intro").
 */
import '@/app/demo'; // must stay first: isolates storage in the demo preview build
import '@/styles/app.css';
// The redesign's tokens and primitives load after app.css so their values win where
// the old dark tokens share a name (DECISIONS D12; the old ones retire in Stage 5).
import '@/styles/tokens.css';
import '@/styles/primitives.css';
import { render } from 'preact';
import { App } from '@/ui/App';
import { boot } from '@/app/bootstrap';
import { startTelemetry, span, afterPaint } from '@/core/telemetry';
import { installExternalLinks } from '@/ui/externalLinks';

const mount = document.getElementById('app');
const route = window.location.hash;

if (route === '#/progress') {
  // The redesign progress page is static HTML generated next to the preview build.
  window.location.replace('./progress/');
} else if (route === '#/styleguide') {
  // The style guide renders on its own, without booting the stores. Leaving it reloads
  // into the app: the token clash that first forced this is gone, but boot, sync and
  // telemetry never started on this page load, and a reload is the one path that
  // starts them exactly as a cold open does (DECISIONS D11, D26).
  window.addEventListener('hashchange', () => window.location.reload());
  void import('@/features/styleguide/Styleguide').then(({ StyleguideView }) => {
    if (mount) {
      mount.replaceChildren(); // drop index.html's Today shell
      render(<StyleguideView />, mount);
    }
  });
} else {
  startTelemetry();
  installExternalLinks();
  // Kept under its old name so telemetry history stays comparable: it now spans boot to first Today paint.
  const endEnter = span('boot:enter');
  void boot(); // appState.init() runs synchronously before render; core loads async
  if (mount) {
    // index.html paints a static Today frame (D15). Clear it and render in the same
    // task, so no frame shows the gap; the real blocks take the shell's exact sizes.
    mount.replaceChildren();
    render(<App />, mount);
  }
  afterPaint(endEnter);
}
