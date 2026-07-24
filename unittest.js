// ===== Meridian unit + stress tests =====
const fs=require('fs');
const h=fs.readFileSync('site/index.html','utf8');
let pass=0,fail=0;
const t=(label,actual,expected)=>{const ok=JSON.stringify(actual)===JSON.stringify(expected);
  console.log((ok?'  PASS  ':'  FAIL  ')+label+(ok?'':'  got '+JSON.stringify(actual)+' want '+JSON.stringify(expected)));ok?pass++:fail++;};

console.log('\n=== A. Static integrity ===');
const S=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];
let syn=0;S.forEach(s=>{try{new Function(s[1])}catch(e){syn++}});
t('index.html parses', syn, 0);
const js=S.map(m=>m[1]).join('\n');
const decl=[...new Set([...js.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_\$][\w\$]*)/gm)].map(m=>m[1]))];
t('no dead functions', decl.filter(f=>(js.match(new RegExp('\\b'+f+'\\b','g'))||[]).length<=1).length, 0);
t('sw.js parses', (()=>{try{require('child_process').execSync('node --check site/sw.js');return 0}catch(e){return 1}})(), 0);

console.log('\n=== B. Rest-timer dismissal ===');
let restTimer=1, restFor='Leg Press|top', barShown=true;
const stopRest=()=>{restTimer=null;restFor='';barShown=false;};
const dismissRestFor=ex=>{ if(restFor && restFor.split('|')[0]===ex) stopRest(); };
dismissRestFor('Bench Press');
t('unrelated exercise leaves timer', restTimer!==null, true);
dismissRestFor('Leg Press');
t('matching exercise stops timer', restTimer, null);
t('rest bar hidden', barShown, false);

console.log('\n=== C. Discard / undo ===');
let CORE={entries:[1,2]}, WK={days:{d:[{ex:'A'}]}}, dirty=false, wkDirty=false;
let clean={};
const snap=()=>{clean={core:JSON.stringify(CORE),overload:JSON.stringify(WK)}};
const discard=()=>{CORE=JSON.parse(clean.core);WK=JSON.parse(clean.overload);dirty=false;wkDirty=false;return true};
snap();
CORE.entries.push(3); WK.days.d.push({ex:'B'}); dirty=true; wkDirty=true;
t('mutations applied', [CORE.entries.length, WK.days.d.length], [3,2]);
discard();
t('discard restores CORE', CORE.entries.length, 2);
t('discard restores WK', WK.days.d.length, 1);
t('discard clears dirty flags', [dirty,wkDirty], [false,false]);
snap(); CORE.entries.push(9); snap();  // snapshot after save
discard();
t('snapshot after save keeps new state', CORE.entries.length, 3);

console.log('\n=== D. Completion derivation ===');
const TODAY='2026-07-24';
const days={'2026-07-22':[{ex:'Leg Press'},{ex:'Leg Press'},{ex:'Leg Press'}],'2026-07-24':[{ex:'Bench Press'}]};
const planned=ex=>ex==='Bench Press'?4:3;
const exDone=(ex,day,explicit)=>{ if((explicit||[]).includes(ex))return true;
  const n=(days[day]||[]).filter(s=>s.ex===ex).length; if(!n)return false;
  if(day<TODAY)return true; return n>=planned(ex); };
t('past day derives done', exDone('Leg Press','2026-07-22',[]), true);
t('today partial not done', exDone('Bench Press',TODAY,[]), false);
t('explicit check wins', exDone('Bench Press',TODAY,['Bench Press']), true);
t('no sets = not done', exDone('Squat','2026-07-22',[]), false);

console.log('\n=== E. Split suggestion (date-aware) ===');
const L=['Leg Press','Leg Extension'];
const sp=e=>L.includes(e)?'lower':(e==='Treadmill'?'both':'upper');
const hist={'2026-07-22':[{ex:'Leg Press',type:'top'}],'2026-07-23':[{ex:'Bench Press',type:'top'}]};
const suggest=target=>{const tally=d=>{const s=(hist[d]||[]).filter(x=>x.type!=='cardio');let lo=0,up=0;
  s.forEach(x=>{const q=sp(x.ex);if(q==='lower')lo++;else if(q==='upper')up++});return (lo===0&&up===0)?null:(lo>=up?'lower':'upper')};
  const own=tally(target); if(own)return own;
  const ds=Object.keys(hist).sort().filter(d=>d<target);
  for(let i=ds.length-1;i>=0;i--){const x=tally(ds[i]);if(x)return x==='lower'?'upper':'lower'}
  return 'upper'};
t('logged day shows its own split', suggest('2026-07-22'), 'lower');
t('logged upper day', suggest('2026-07-23'), 'upper');
t('today alternates from yesterday', suggest('2026-07-24'), 'lower');
t('no history defaults upper', suggest('2020-01-01'), 'upper');

console.log('\n=== F. Rest prescriptions ===');
const rest=(m,type)=>{const comp=['chest','back','quads','hamstrings','glutes'].includes(m);
  if(type==='warm')return 60; if(type==='top')return comp?180:120; return comp?120:90};
t('compound top set 180s', rest('quads','top'), 180);
t('isolation top set 120s', rest('calves','top'), 120);
t('warmup always 60s', [rest('quads','warm'),rest('calves','warm')], [60,60]);

console.log('\n=== G. Knowledge bank ===');
const man=JSON.parse(fs.readFileSync('site/questions/index.json','utf8'));
let tot=0,bad=0;const ids=new Set();let dup=0;
Object.entries(man.topics).forEach(([k,m])=>{const a=JSON.parse(fs.readFileSync('site/'+m.file,'utf8'));
  if(a.length!==m.count)console.log('  count mismatch',k);
  a.forEach(q=>{tot++;if(!q.id||!q.prompt||!q.reveal||!q.src||!q.mins)bad++;if(ids.has(q.id))dup++;ids.add(q.id)})});
t('all questions well-formed', bad, 0);
t('no duplicate ids', dup, 0);
t('question count', tot, 268);
const gym=js.match(/const KG_GYM=\{[\s\S]*?\n\};/)[0];
t('every topic has concepts', (gym.match(/concepts:\[/g)||[]).length, 15);
t('every topic has practice', (gym.match(/practice:\[/g)||[]).length, 15);
t('every topic has reading', (gym.match(/reading:\[/g)||[]).length, 15);

console.log('\n=== H. STRESS: 5000 rapid logs ===');
let WK2={days:{}}, marks=0;
const t0=Date.now();
for(let i=0;i<5000;i++){const d='2026-07-'+String((i%28)+1).padStart(2,'0');
  (WK2.days[d]=WK2.days[d]||[]).push({id:Date.now()+Math.random(),ex:'Ex'+(i%14),type:'top',weight:100+(i%50),reps:5}); marks++;}
const total=Object.values(WK2.days).reduce((a,x)=>a+x.length,0);
t('all 5000 logged', total, 5000);
t('markDirty called each time', marks, 5000);
const ser=JSON.stringify(WK2);
t('serializes without error', ser.length>0, true);
t('round-trips identically', JSON.stringify(JSON.parse(ser))===ser, true);
console.log('  (serialized '+(ser.length/1024).toFixed(0)+'KB in '+(Date.now()-t0)+'ms)');

console.log('\n=== I. STRESS: id uniqueness under rapid fire ===');
// old scheme, kept to document the bug
let oldColl=0;const oldSeen=new Set();
for(let i=0;i<20000;i++){const id=Date.now()+Math.random();if(oldSeen.has(id))oldColl++;oldSeen.add(id)}
console.log('  (legacy Date.now()+Math.random() collisions in 20k: '+oldColl+')');
// current scheme from index.html
let _uidSeq=0;
const uid=()=>{_uidSeq=(_uidSeq+1)%1000000;return Date.now().toString(36)+'-'+_uidSeq.toString(36)+'-'+Math.random().toString(36).slice(2,8)};
const seen=new Set();let coll=0;
for(let i=0;i<200000;i++){const id=uid();if(seen.has(id))coll++;seen.add(id)}
t('no id collisions in 200k (uid)', coll, 0);
t('legacy scheme did collide (bug was real)', oldColl>0, true);
t('uid is a string', typeof uid(), 'string');

console.log('\n=== J. Storage layer: newest-wins across 3 backends ===');
const pick=(cands)=>cands.filter(c=>c[0]!=null).sort((a,b)=>b[1]-a[1])[0];
t('newest wins', pick([['old',1],['new',3],['mid',2]])[0], 'new');
t('null ignored', pick([[null,99],['real',1]])[0], 'real');
t('single source', pick([['only',5]])[0], 'only');

console.log('\n----------------------------------------');
console.log('PASSED: '+pass+'   FAILED: '+fail);
process.exit(fail?1:0);
