// ===== Cross-device sync tests using the REAL merge functions from index.html =====
const fs=require('fs');
const h=fs.readFileSync('site/index.html','utf8');
const js=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
// extract the merge module
const names=['tombSet','tomb','pruneTombs','mergeById','mergeDayMap','mergeScalarMap','mergeListMap','mergeWK','mergeSG','mergeCORE','mergeKG','parseOr'];
let src='';
names.forEach(n=>{
  const re=new RegExp('function '+n+'\\([\\s\\S]*?\\n\\}','m');
  const m=js.match(re); if(!m) throw new Error('missing '+n); src+=m[0]+'\n';
});
eval(src);

let pass=0,fail=0;
const t=(l,a,e)=>{const ok=JSON.stringify(a)===JSON.stringify(e);
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(ok?'':'  got '+JSON.stringify(a)+' want '+JSON.stringify(e)));ok?pass++:fail++;};

// ---- cloud + two devices ----
let CLOUD=null, rev=0;
function Dev(name){
  return {name, SG:{settings:{},days:{},tad:{},_del:{}}, WK:{settings:{},days:{},bw:{},rpe:{},done:{},sessionDone:{},incr:{},_del:{}}, mtime:0,
    addMeal(d,n,c,p,id){ (this.SG.days[d]=this.SG.days[d]||[]).push({id:id||name+'-'+Math.random().toString(36).slice(2,8),name:n,cal:c,protein:p}); this.mtime=++rev; },
    delMeal(d,id){ tomb(this.SG,id); this.SG.days[d]=(this.SG.days[d]||[]).filter(m=>String(m.id)!==String(id)); this.mtime=++rev; },
    logSet(d,ex,w,r){ (this.WK.days[d]=this.WK.days[d]||[]).push({id:name+'-'+Math.random().toString(36).slice(2,8),ex,type:'top',weight:w,reps:r}); this.mtime=++rev; },
    markDone(d,ex){ (this.WK.done[d]=this.WK.done[d]||[]).push(ex); this.mtime=++rev; },
    push(){ const cl=CLOUD?{surplus:JSON.stringify(CLOUD.SG),overload:JSON.stringify(CLOUD.WK),rev:CLOUD.rev,syncedAt:CLOUD.at}:null;
      if(cl && cl.rev>0){ // merge cloud in first (what cloudPush now does)
        this.SG=mergeSG(this.SG,parseOr(cl.surplus,{}),this.mtime>=cl.syncedAt);
        this.WK=mergeWK(this.WK,parseOr(cl.overload,{}),this.mtime>=cl.syncedAt); }
      CLOUD={SG:JSON.parse(JSON.stringify(this.SG)),WK:JSON.parse(JSON.stringify(this.WK)),rev:(CLOUD?CLOUD.rev:0)+1,at:++rev};
      return {ok:true,rev:CLOUD.rev}; },
    pull(){ if(!CLOUD) return {ok:false};
      this.SG=mergeSG(this.SG,CLOUD.SG,this.mtime>=CLOUD.at);
      this.WK=mergeWK(this.WK,CLOUD.WK,this.mtime>=CLOUD.at);
      return {ok:true}; },
    meals(d){ return (this.SG.days[d]||[]).map(m=>m.name).sort(); },
    sets(d){ return (this.WK.days[d]||[]).length; },
    done(d){ return (this.WK.done[d]||[]).sort(); }
  };
}
const D='2026-07-25';

console.log('\n=== 1. THE REPORTED BUG: browser saves, mobile must see it ===');
CLOUD=null;rev=0;
let PC=Dev('pc'), MOB=Dev('mob');
PC.addMeal(D,'Core Power',230,42); PC.addMeal(D,'Cook Unity',900,40); PC.push();
MOB.addMeal(D,'Oatmeal',220,6);              // mobile already had its own local data
MOB.pull();
t('mobile sees browser meals + keeps its own', MOB.meals(D), ['Cook Unity','Core Power','Oatmeal']);
const r=MOB.push();
t('mobile push SUCCEEDS (no conflict)', r.ok, true);
PC.pull();
t('browser now sees all three', PC.meals(D), ['Cook Unity','Core Power','Oatmeal']);

console.log('\n=== 2. Simultaneous edits both survive ===');
CLOUD=null;rev=0;PC=Dev('pc');MOB=Dev('mob');
PC.addMeal(D,'A',100,10); PC.push(); MOB.pull();
PC.addMeal(D,'B',200,20); MOB.addMeal(D,'C',300,30);   // both edit offline
PC.push(); MOB.push(); PC.pull();
t('no edit lost', PC.meals(D), ['A','B','C']);
t('both devices converge', MOB.pull()&&MOB.meals(D), PC.meals(D));

console.log('\n=== 3. Workouts merge the same way ===');
CLOUD=null;rev=0;PC=Dev('pc');MOB=Dev('mob');
PC.logSet(D,'Bench',135,5); PC.logSet(D,'Bench',135,5); PC.push();
MOB.pull(); MOB.logSet(D,'Lat Pulldown',125,6); MOB.push(); PC.pull();
t('all sets present', PC.sets(D), 3);

console.log('\n=== 4. Completion flags union ===');
CLOUD=null;rev=0;PC=Dev('pc');MOB=Dev('mob');
PC.markDone(D,'Bench'); PC.push(); MOB.pull(); MOB.markDone(D,'Lat Pulldown'); MOB.push(); PC.pull();
t('done list unions', PC.done(D), ['Bench','Lat Pulldown']);

console.log('\n=== 5. Deletes propagate (tombstones) ===');
CLOUD=null;rev=0;PC=Dev('pc');MOB=Dev('mob');
PC.addMeal(D,'Keep',100,10,'k1'); PC.addMeal(D,'Remove',200,20,'k2'); PC.push(); MOB.pull();
t('mobile has both', MOB.meals(D), ['Keep','Remove']);
PC.delMeal(D,'k2'); PC.push(); MOB.pull();
t('delete propagates', MOB.meals(D), ['Keep']);
MOB.push(); PC.pull();
t('deleted item does NOT resurrect', PC.meals(D), ['Keep']);

console.log('\n=== 6. Three-way convergence ===');
CLOUD=null;rev=0;const A=Dev('a'),B=Dev('b'),C=Dev('c');
A.addMeal(D,'a1',1,1); A.push();
B.pull(); B.addMeal(D,'b1',1,1); B.push();
C.pull(); C.addMeal(D,'c1',1,1); C.push();
A.pull(); B.pull();
t('A converged', A.meals(D), ['a1','b1','c1']);
t('B converged', B.meals(D), ['a1','b1','c1']);
t('C has all after pull', (C.pull(),C.meals(D)), ['a1','b1','c1']);

console.log('\n=== 7. Idempotency: repeated sync does not duplicate ===');
for(let i=0;i<10;i++){ A.push(); A.pull(); B.pull(); }
t('no duplication after 10 sync cycles', A.meals(D), ['a1','b1','c1']);
t('B stable too', B.meals(D), ['a1','b1','c1']);

console.log('\n=== 8. Scalar last-writer-wins ===');
const older={settings:{goal:147},days:{},tad:{},_del:{}}, newer={settings:{goal:150},days:{},tad:{},_del:{}};
t('newer local wins', mergeSG(newer,older,true).settings.goal, 150);
t('newer cloud wins', mergeSG(older,newer,false).settings.goal, 150);
t('disjoint keys both kept', Object.keys(mergeSG({settings:{a:1},days:{},tad:{},_del:{}},{settings:{b:2},days:{},tad:{},_del:{}},true).settings).sort(), ['a','b']);

console.log('\n=== 9. STRESS: 200 alternating edits across 2 devices ===');
CLOUD=null;rev=0;const X=Dev('x'),Y=Dev('y');
for(let i=0;i<100;i++){ X.addMeal(D,'x'+i,1,1); X.push(); Y.pull(); Y.addMeal(D,'y'+i,1,1); Y.push(); X.pull(); }
t('all 200 edits survive', X.meals(D).length, 200);
t('both devices identical', (Y.pull(),Y.meals(D).length), 200);
t('no duplicate names', new Set(X.meals(D)).size, 200);

console.log('\n=== 10. Empty / malformed cloud payloads ===');
t('null cloud safe', mergeSG({settings:{},days:{},tad:{},_del:{}},null,true).days, {});
t('bad json safe', parseOr('{{{',{fallback:1}), {fallback:1});
t('missing fields safe', Object.keys(mergeWK({},{},true)).sort(), ['_del','bw','days','done','incr','rpe','sessionDone','settings']);

console.log('\n----------------------------------------');
console.log('PASSED: '+pass+'   FAILED: '+fail);
process.exit(fail?1:0);
