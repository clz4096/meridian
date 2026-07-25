/** Boots the entire index.html in a fake DOM and exercises every tab. */
import fs from 'node:fs';
const html = fs.readFileSync('site/index.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());

const els = new Map();
const listeners = new Map();
function mk(id) {
  const el = {
    id, value: '', innerHTML: '', textContent: '', title: '', disabled: false, dataset: {},
    style: new Proxy({}, { get: (t,k)=>t[k]||'', set:(t,k,v)=>{t[k]=v;return true} }),
    classList: { _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)}, contains(c){return this._s.has(c)}, toggle(c,v){v?this._s.add(c):this._s.delete(c)} },
    _h: {},
    addEventListener(t,f){ this._h[t]=f; },
    removeEventListener(){}, appendChild(){}, insertBefore(){}, focus(){}, blur(){}, click(){},
    setSelectionRange(){}, getAttribute(k){return this.dataset[k]??''}, setAttribute(){},
    querySelector(){return null}, querySelectorAll(){return []}, contains(){return true},
  };
  return el;
}
globalThis.document = {
  getElementById(id){ if(!els.has(id)) els.set(id, mk(id)); return els.get(id); },
  querySelector(){return null}, querySelectorAll(){return []},
  createElement:(t)=>mk('new-'+t),
  addEventListener(t,f){ listeners.set(t,f); },
  body: mk('body'), documentElement: mk('html'),
  visibilityState:'visible', activeElement:null,
};
const LS = {};
globalThis.localStorage = { getItem:k=>k in LS?LS[k]:null, setItem:(k,v)=>{LS[k]=String(v)}, removeItem:k=>{delete LS[k]} };
globalThis.window = { storage:null, scrollY:0, scrollTo(){}, addEventListener(){}, location:{reload(){}} };
Object.defineProperty(globalThis,'navigator',{value:{serviceWorker:{register:async()=>({})},clipboard:{writeText(){}}},configurable:true});
globalThis.indexedDB = undefined;
globalThis.HTMLElement = class {}; globalThis.HTMLInputElement = class {}; globalThis.HTMLSelectElement = class {};
globalThis.requestAnimationFrame = f=>f();
globalThis.setInterval = ()=>0; globalThis.clearInterval = ()=>{};
globalThis.alert = ()=>{}; globalThis.confirm = ()=>true; globalThis.prompt = ()=>null;
globalThis.performance = globalThis.performance || { now: ()=>Date.now() };
let CLOUD = null;
globalThis.fetch = async (u, o) => {
  const url = String(u);
  if (url.includes('questions/index.json')) return { ok:true, json: async()=>({version:1, topics:{}}) };
  if (url.includes('questions/')) return { ok:true, json: async()=>[] };
  if (url.includes('getpantry')) {
    if (o?.method === 'POST') { CLOUD = JSON.parse(o.body); return { ok:true, status:200, json:async()=>({}) }; }
    return CLOUD ? { ok:true, status:200, json:async()=>CLOUD } : { ok:false, status:400, json:async()=>({}) };
  }
  return { ok:false, status:404, json:async()=>({}) };
};

let pass=0, fail=0;
const t=(l,c)=>{ console.log((c?'  PASS  ':'  FAIL  ')+l); c?pass++:fail++; };

console.log('\n=== 1. Every script block executes ===');
let ctx = null;
for (let i=0;i<scripts.length;i++) {
  try {
    if (scripts[i].includes('TAB ROUTER')) {
      ctx = new Function(scripts[i] + '\n;return {renderToday,renderWorkout,renderWeight,renderData,renderKnowledge,renderStudy,saveAll,cloudPull,MC,'
        + 'get WK(){return WK}, get SG(){return SG}, get CORE(){return CORE}, get KG(){return KG},'
        + 'set sgDate(v){sgDate=v}, get sgDate(){return sgDate}, wkLoad,sgLoad,kgLoad,loadCore,dstr,uid};')();
    } else {
      new Function(scripts[i])();
    }
    t(`script block ${i+1}/${scripts.length} (${(scripts[i].length/1024).toFixed(0)}KB)`, true);
  } catch (e) {
    t(`script block ${i+1} — ${e.message.slice(0,80)}`, false);
  }
}

if (!ctx) { console.log('\nFATAL: main script did not expose context'); process.exit(1); }

(async () => {
  console.log('\n=== 2. Stores hydrate ===');
  await ctx.loadCore(); await ctx.wkLoad(); await ctx.sgLoad(); await ctx.kgLoad();
  t('workout has baked-in history: ' + Object.keys(ctx.WK.days).length + ' days', Object.keys(ctx.WK.days).length > 0);
  t('meal settings defaulted: ' + ctx.SG.settings.proteinTarget + 'g', ctx.SG.settings.proteinTarget > 0);

  console.log('\n=== 3. Every tab renders ===');
  for (const [name, fn] of [['Today', ctx.renderToday], ['Workout', ctx.renderWorkout], ['Meals', ctx.renderWeight], ['Data', ctx.renderData], ['Knowledge', ctx.renderKnowledge], ['Study', ctx.renderStudy]]) {
    try { fn(); await new Promise(r=>setTimeout(r,0)); t(name + ' renders', true); }
    catch (e) { t(name + ' — ' + e.message.slice(0,70), false); }
  }
  const panes = ['pane-workout','pane-weight','pane-data'];
  for (const p of panes) {
    const el = els.get(p);
    t(p + ' produced markup (' + (el?.innerHTML.length||0) + ' chars)', (el?.innerHTML.length||0) > 200);
    t(p + ' has no undefined/NaN', !/undefined|NaN/.test(el?.innerHTML||''));
  }

  console.log('\n=== 4. Meal logging through the typed core ===');
  ctx.sgDate = ctx.dstr();
  const before = (ctx.SG.days[ctx.dstr()]||[]).length;
  document.getElementById('meal-name').value = 'Test Meal'; document.getElementById('meal-cal').value = '400'; document.getElementById('meal-pro').value = '30';
  document.getElementById('pane-weight')._h.click?.({ target: { dataset: { act:'add-meal' } } });
  const after = (ctx.SG.days[ctx.dstr()]||[]).length;
  t('meal added: ' + before + ' -> ' + after, after === before + 1);
  const m = (ctx.SG.days[ctx.dstr()]||[]).at(-1);
  t('macros correct: ' + m?.cal + 'kcal / ' + m?.protein + 'g', m?.cal === 400 && m?.protein === 30);

  console.log('\n=== 5. Save + sync through the SyncEngine ===');
  localStorage.setItem('meridian_pantry_id','boot-test-id');
  const saved = await ctx.saveAll();
  t('save reports local ok', saved.localOk === true);
  t('cloud state: ' + saved.cloud, ['synced','noop','throttled','skipped'].includes(saved.cloud));
  t('cloud received the meal', !!CLOUD && (CLOUD.surplus?.days?.[ctx.dstr()]||[]).length > 0);

  console.log('\n=== 6. Tombstone cap enforced on save ===');
  const del = {}; for (let i=0;i<1200;i++) del['t'+i] = Date.now()-i*1000;
  ctx.WK._del = del;
  ctx.WK.days[ctx.dstr()] = [{ id: ctx.uid(), ex:'Bench Press', type:'top', weight:135, reps:5, muscle:'chest' }];
  await ctx.saveAll();
  const n = Object.keys(ctx.WK._del||{}).length;
  t('tombstones pruned: 1200 -> ' + n + ' (cap 500)', n <= 500);

  console.log('\n=== 7. SRS + Today derivation go through the core ===');

  const sched = ctx.MC.schedule(undefined, 5, ctx.dstr());
  t('schedule returns a finite interval: ' + sched.ivl + 'd', Number.isFinite(sched.ivl) && sched.ivl > 0);
  const lapse = ctx.MC.schedule(sched, 1, ctx.dstr());
  t('a fail floors the interval to ' + lapse.ivl, lapse.ivl === 1 && lapse.n === 0);
  const tv = ctx.MC.selectTodayView(ctx.CORE, ctx.dstr(), ctx.dstr(), 600);
  t('today view derives ' + tv.totalBlocks + ' blocks / ' + tv.xpToday + ' xp', Number.isFinite(tv.xpToday));


  console.log('\n=== 8. Knowledge tab renders through the controller ===');
  try {
    ctx.renderKnowledge();
    await new Promise(r=>setTimeout(r,0));
    const el = document.getElementById('pane-knowledge');
    t('knowledge markup produced (' + (el.innerHTML.length||0) + ' chars)', (el.innerHTML.length||0) > 200);
    t('knowledge has no undefined/NaN', !/undefined|NaN/.test(el.innerHTML||''));
    t('topic tabs rendered', el.innerHTML.includes('class="ktab'));
  } catch (e) { t('knowledge render — ' + e.message.slice(0,70), false); }

  console.log('\n=== 9. Discard reverts to the persisted state ===');
  const day = ctx.dstr();
  ctx.SG.days[day] = ctx.SG.days[day] || [];
  const savedCount = ctx.SG.days[day].length;
  await ctx.saveAll();
  ctx.SG.days[day].push({ id: ctx.uid(), name: 'unsaved', cal: 1, protein: 1 });
  const r = await ctx.MC.sync.discard();
  t('discard restored ' + r.restored.length + ' stores', r.restored.length > 0);
  t('unsaved edit dropped (' + savedCount + ' meals)', (ctx.MC.sync.snapshot().surplus.days[day]||[]).length === savedCount);
  t('no store left dirty', ctx.MC.sync.anyDirty() === false);

  console.log('\n=== 10. Round-trip export/import ===');
  const state = ctx.MC.normaliseState({ core: ctx.CORE, overload: ctx.WK, surplus: ctx.SG, csgraph: ctx.KG });
  const rt = ctx.MC.roundTrip(state);
  t('round-trip ok', rt.ok === true);
  t('deep-equal after round trip', JSON.stringify(rt.state) === JSON.stringify(state));

  console.log('\n----------------------------------------');
  console.log('PASSED: ' + pass + '   FAILED: ' + fail);
  process.exit(fail ? 1 : 0);
})();
