// ===== Executes the REAL script from index.html against mocked browser APIs =====
const fs=require('fs');
const html=fs.readFileSync('site/index.html','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const appjs=scripts.reduce((a,b)=>b.length>a.length?b:a);   // main app script = largest block

function mkEl(id){
  const el={id,className:'',textContent:'',innerHTML:'',value:'',title:'',disabled:false,
    style:new Proxy({},{get:(t,k)=>t[k]||'',set:(t,k,v)=>{t[k]=v;return true}}),
    classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},
      contains(c){return this._s.has(c)},toggle(c,v){v?this._s.add(c):this._s.delete(c)}},
    addEventListener(){},removeEventListener(){},appendChild(){},insertBefore(){},
    querySelectorAll(){return []},querySelector(){return null},
    getAttribute(){return ''},setAttribute(){},focus(){},click(){}};
  return el;
}
const els={};
global.document={
  getElementById(id){ if(!els[id]) els[id]=mkEl(id); return els[id]; },
  querySelectorAll(){return []}, querySelector(){return null},
  createElement(t){return mkEl('new-'+t)},
  addEventListener(){}, body:mkEl('body'), documentElement:mkEl('html'),
  visibilityState:'visible', activeElement:mkEl('none')
};
const LS={};
global.localStorage={getItem:k=>(k in LS?LS[k]:null),setItem:(k,v)=>{LS[k]=String(v)},removeItem:k=>{delete LS[k]}};
global.window={storage:null,addEventListener(){},scrollY:0,scrollTo(){},location:{reload(){}}};
global.navigator={};
global.indexedDB=undefined;                 // force localStorage-only path
global.requestAnimationFrame=f=>f();
global.setInterval=()=>0; global.clearInterval=()=>{};
global.alert=()=>{}; global.confirm=()=>true; global.prompt=()=>null;

// --- fake Pantry ---
let CLOUD=null, netUp=true, calls={GET:0,POST:0};
global.fetch=async(url,opts)=>{
  if(!netUp) throw new Error('Failed to fetch');
  if(String(url).includes('questions/')) return {ok:true,json:async()=>({version:1,topics:{}})};
  if(String(url).includes('getpantry')){
    if(opts&&opts.method==='POST'){ calls.POST++; CLOUD=JSON.parse(opts.body); return {ok:true,status:200,json:async()=>({})}; }
    calls.GET++;
    if(!CLOUD) return {ok:false,status:400,json:async()=>({})};
    return {ok:true,status:200,json:async()=>CLOUD};
  }
  return {ok:false,status:404,json:async()=>({})};
};

let pass=0,fail=0,thrown=null;
const t=(l,a,e)=>{const ok=JSON.stringify(a)===JSON.stringify(e);
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(ok?'':'  got '+JSON.stringify(a)+' want '+JSON.stringify(e)));ok?pass++:fail++;};

console.log('\n=== A. Does the real app script even execute? ===');
let ctx;
try{
  ctx = new Function(appjs + '\n;return {saveAll,cloudPush,cloudPull,cloudMerge,ensureAllLoaded,setCloudId,cloudEnabled,baseRev,'
    + 'get SG(){return SG}, set SG(v){SG=v}, get WK(){return WK}, set WK(v){WK=v},'
    + 'get sgDirty(){return sgDirty}, set sgDirty(v){sgDirty=v},'
    + 'get sgLoaded(){return sgLoaded}, get wkLoaded(){return wkLoaded}, get coreHydrated(){return coreHydrated},'
    + 'sgLoad,wkLoad,loadCore,kgLoad,uid,dstr};')();
  t('script executes without throwing', true, true);
}catch(e){ thrown=e; console.log('  FAIL  script threw: '+e.message); fail++;
  console.log('\n  >>> stack:\n'+String(e.stack).split('\n').slice(0,6).join('\n')); }

if(ctx){
  (async()=>{
    console.log('\n=== B. Cloud enable + first push ===');
    ctx.setCloudId('test-pantry-id');
    t('cloud enabled', ctx.cloudEnabled(), true);
    await ctx.ensureAllLoaded();
    t('all stores hydrated', [ctx.coreHydrated,ctx.wkLoaded,ctx.sgLoaded], [true,true,true]);

    const D=ctx.dstr();
    ctx.SG.days[D]=(ctx.SG.days[D]||[]); ctx.SG.days[D].push({id:ctx.uid(),name:'m1',cal:100,protein:10});
    ctx.sgDirty=true;
    let r1=await ctx.cloudPush();
    t('first push ok', r1.ok, true);
    t('cloud received data', CLOUD!==null, true);

    console.log('\n=== C. Pull returns what was pushed ===');
    let p=await ctx.cloudPull();
    t('pull ok', p.ok, true);
    t('pull has surplus', typeof p.data.surplus, 'string');
    t('pulled meal present', JSON.parse(p.data.surplus).days[D].length, 1);

    console.log('\n=== D. Identical push is a no-op (no data noise) ===');
    const postsBefore=calls.POST;
    let r2=await ctx.cloudPush();
    t('second push ok', r2.ok, true);
    t('identical data => noop', r2.noop, true);
    t('no network write issued', calls.POST, postsBefore);

    console.log('\n=== D2. Changed data pushes for real ===');
    ctx.SG.days[D].push({id:ctx.uid(),name:'m2',cal:200,protein:20});
    let r2b=await ctx.cloudPush();
    t('changed data pushes', r2b.ok && !r2b.noop, true);
    t('rev advanced', r2b.rev>r1.rev, true);
    t('network write happened', calls.POST>postsBefore, true);
    t('cloud has both meals', JSON.parse(CLOUD.surplus).days[D].length, 2);

    console.log('\n=== E. Merge a foreign cloud payload ===');
    const foreign=JSON.parse(JSON.stringify(CLOUD));
    const fs2=JSON.parse(foreign.surplus); fs2.days[D].push({id:'other-1',name:'from-other',cal:200,protein:20});
    foreign.surplus=JSON.stringify(fs2); foreign.rev=99; foreign.syncedAt=Date.now()+1000;
    await ctx.cloudMerge(foreign);
    t('merged foreign meal', ctx.SG.days[D].map(m=>m.name).sort(), ['from-other','m1','m2']);
    t('baseRev adopted', ctx.baseRev(), 99);

    console.log('\n=== F. Push after merge still works ===');
    let r3=await ctx.cloudPush();
    t('push after merge ok', r3.ok, true);
    t('cloud has all meals', JSON.parse(CLOUD.surplus).days[D].length, 3);

    console.log('\n=== G. Network failure surfaces a real reason ===');
    netUp=false;
    let r4=await ctx.cloudPush();
    t('push reports failure', r4.ok, false);
    t('failure has a reason', typeof r4.err==='string' && r4.err.length>0, true);
    console.log('        reason: '+r4.err);
    let p2=await ctx.cloudPull();
    t('pull reports failure', p2.ok, false);
    console.log('        reason: '+p2.err);
    netUp=true;

    console.log('\n=== H. Recovers after network returns ===');
    let r5=await ctx.cloudPush();
    t('push recovers', r5.ok, true);

    console.log('\n----------------------------------------');
    console.log('PASSED: '+pass+'   FAILED: '+fail+'   (GET '+calls.GET+', POST '+calls.POST+')');
    process.exit(fail?1:0);
  })().catch(e=>{ console.log('\n  UNCAUGHT: '+e.message+'\n'+String(e.stack).split('\n').slice(0,5).join('\n')); process.exit(1); });
} else { console.log('\nPASSED: '+pass+'   FAILED: '+fail); process.exit(1); }
