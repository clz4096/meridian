// Vite plugin: the Cambridge catalog's build-time modules.
//
// - `virtual:cambridge-index`: the small index Today's cards import
//   (src/features/cambridge/catalogIndex.ts).
// - `virtual:cambridge-track/step`, `/courses`, `/cst`: one built track each,
//   which catalog.ts loads on demand, so a screen fetches only the tracks it
//   shows (the CS path loads only the CST track) and builds nothing at runtime.
//
// It runs the app's own catalog builder (src/features/cambridge/catalogBuild.ts)
// over the curriculum JSON at build time and emits only what the screens read,
// so the modules can never go stale: they are rebuilt from the data on every
// build, dev start and data edit.
//
// catalogBuild.ts is bundled with esbuild (already a dev dependency) and run in
// Node. It imports nothing but JSON, types and a data-free helper module, so no
// other app code runs here.
import { build } from 'esbuild';
import { resolve } from 'node:path';

const INDEX_ID = 'virtual:cambridge-index';
const TRACK_PREFIX = 'virtual:cambridge-track/';
const TRACKS = ['step', 'courses', 'cst'];
const IDS = new Set([INDEX_ID, ...TRACKS.map((t) => TRACK_PREFIX + t)]);

/** Bundle catalogBuild.ts, run it, and return `{ data, tracks, inputs }` (the index, each track, and the files read, for watching). */
export async function generateIndex(root) {
  const alias = { '@/': resolve(root, 'src') + '/', '@data/': resolve(root, 'data') + '/' };
  const out = await build({
    entryPoints: [resolve(root, 'src/features/cambridge/catalogBuild.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    metafile: true,
    plugins: [{
      name: 'alias',
      setup(b) {
        b.onResolve({ filter: /^@(data)?\// }, (args) => {
          const key = args.path.startsWith('@data/') ? '@data/' : '@/';
          let path = alias[key] + args.path.slice(key.length);
          // Type-only imports are erased; value imports of .ts files need the extension.
          if (!/\.(json|ts|tsx|md)$/.test(path)) path += '.ts';
          return { path };
        });
      },
    }],
  });
  const code = out.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const inputs = Object.keys(out.metafile.inputs).map((f) => resolve(process.cwd(), f));
  const { index, tracks } = mod.catalogModules();
  return { data: index, tracks, inputs };
}

export function cambridgeIndex() {
  let root = process.cwd();
  // One builder run serves all four modules; a data edit clears it.
  let generated = null;
  let watched = new Set();
  return {
    name: 'cambridge-index',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return IDS.has(id) ? '\0' + id : undefined;
    },
    watchChange(id) {
      if (watched.has(resolve(id))) generated = null;
    },
    async load(id) {
      if (!id.startsWith('\0') || !IDS.has(id.slice(1))) return undefined;
      generated ??= generateIndex(root).catch((e) => {
        generated = null;
        throw e;
      });
      const { data, tracks, inputs } = await generated;
      watched = new Set(inputs);
      // A data edit in dev regenerates the modules.
      for (const f of inputs) this.addWatchFile(f);
      const key = id.slice(1);
      const value = key === INDEX_ID ? data : tracks[key.slice(TRACK_PREFIX.length)];
      return `export default ${JSON.stringify(value)};`;
    },
  };
}
