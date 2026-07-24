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
    done(d){ return (this.WK.done[d]||[]).sort(); },
    // Boot sequence: pull -> merge -> push merged result (matches init() in index.html)
    refresh(){ this.pull(); this.push(); return this; },
    mealIds(d){ return (this.SG.days[d]||[]).map(m=>String(m.id)); }
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


console.log('\n=== 11. YOUR EXACT SEQUENCE (browser -> mobile -> browser) ===');
CLOUD=null;rev=0;
const BR=Dev('browser'), MB=Dev('mobile');
// step 1: changes on browser, save (= push)
BR.addMeal(D,'browser-meal-1',230,42); BR.logSet(D,'Bench',135,5);
let s1=BR.push();
t('11a browser push ok', s1.ok, true);
// step 2: pull on mobile -> shows up
MB.pull();
t('11b mobile sees browser meal', MB.meals(D), ['browser-meal-1']);
t('11c mobile sees browser set', MB.sets(D), 1);
// step 3: changes on mobile, save (= push)
MB.addMeal(D,'mobile-meal-1',900,40); MB.logSet(D,'Lat Pulldown',125,6);
let s2=MB.push();
t('11d mobile push ok', s2.ok, true);
// step 4: pull on browser -> THE STEP THAT FAILED
BR.pull();
t('11e browser pull succeeds and has BOTH meals', BR.meals(D), ['browser-meal-1','mobile-meal-1']);
t('11f browser has both sets', BR.sets(D), 2);
// step 5: keep going, several more rounds
for(let i=0;i<5;i++){
  BR.addMeal(D,'b'+i,1,1); BR.push(); MB.pull();
  MB.addMeal(D,'m'+i,1,1); MB.push(); BR.pull();
}
t('11g after 5 more rounds both converge', BR.meals(D).length, 12);
t('11h mobile identical', (MB.pull(),MB.meals(D)), BR.meals(D));

console.log('\n=== 12. Store never opened on this device must not be dropped ===');
// simulates browser where the Workout tab was never opened (wkLoaded=false)
CLOUD=null;rev=0;
const P=Dev('p'), Q=Dev('q');
P.logSet(D,'Squat',200,5); P.addMeal(D,'meal',100,10); P.push();
// Q pulls but pretends workout store was never loaded -> with the fix it IS loaded
Q.pull();
t('12a unopened store still merged', Q.sets(D), 1);
t('12b meals merged too', Q.meals(D), ['meal']);
Q.addMeal(D,'q-meal',50,5); Q.push(); P.pull();
t('12c pushing from a device does not wipe the other store', P.sets(D), 1);
t('12d both meals survive', P.meals(D), ['meal','q-meal']);

console.log('\n=== 13. Alternating pull-before-push discipline not required ===');
CLOUD=null;rev=0;
const M=Dev('m'), N=Dev('n');
M.addMeal(D,'m1',1,1); M.push();
N.addMeal(D,'n1',1,1);            // N never pulled first
let s3=N.push();                   // must still succeed (merge inside push)
t('13a push without prior pull succeeds', s3.ok, true);
t('13b nothing lost', (M.pull(),M.meals(D)), ['m1','n1']);


console.log('\n=== 14. YOUR DELETION SCENARIO (A add -> B delete -> refresh -> reopen) ===');
CLOUD=null;rev=0;
const A2=Dev('machineA'), B2=Dev('machineB');

// 1. add meal on machine A
A2.addMeal(D,'meal-1',230,42,'id-1'); A2.push();
t('14a A has meal', A2.meals(D), ['meal-1']);

// 2. pull on machine B
B2.pull();
t('14b B pulled the meal', B2.meals(D), ['meal-1']);

// 3+4. remove meal on B, save
B2.delMeal(D,'id-1'); B2.push();
t('14c B shows no meal', B2.meals(D), []);

// 5. refresh browser (machine A) -> meal should be REMOVED
A2.refresh();
t('14d A refresh removes the meal', A2.meals(D), []);
t('14e deletion did not resurrect on A', A2.mealIds(D).includes('id-1'), false);

// 6. add meal on mobile (B)
B2.addMeal(D,'meal-2',900,40,'id-2'); B2.push();

// 7. refresh browser -> should show new meal
A2.refresh();
t('14f A refresh shows the new meal', A2.meals(D), ['meal-2']);
t('14g old deleted meal still gone', A2.mealIds(D).includes('id-1'), false);

// 8+9. remove meal on browser, save
A2.delMeal(D,'id-2'); A2.push();
t('14h A shows no meal', A2.meals(D), []);

// 10+11. close app on mobile, reopen (= boot: pull + merge + push)
const B3=Dev('machineB-reopened');
B3.SG=JSON.parse(JSON.stringify(B2.SG));   // mobile restores its own local storage
B3.WK=JSON.parse(JSON.stringify(B2.WK));
B3.mtime=B2.mtime;
B3.refresh();

// 12. should show NO meal
t('14i mobile reopen shows no meal', B3.meals(D), []);
t('14j no tombstoned ids present', B3.mealIds(D), []);

// and the deletion must stay dead through further syncs
A2.refresh(); B3.refresh(); A2.refresh();
t('14k still empty after repeated syncs on A', A2.meals(D), []);
t('14l still empty after repeated syncs on B', B3.meals(D), []);

console.log('\n=== 15. Delete then re-add the same item is not swallowed ===');
CLOUD=null;rev=0;
const R1=Dev('r1'), R2=Dev('r2');
R1.addMeal(D,'x',1,1,'xid'); R1.push(); R2.pull();
R1.delMeal(D,'xid'); R1.push(); R2.pull();
t('15a delete propagated', R2.meals(D), []);
R2.addMeal(D,'x-again',1,1,'xid-new'); R2.push(); R1.pull();
t('15b new item with a fresh id survives', R1.meals(D), ['x-again']);

console.log('\n----------------------------------------');
console.log('PASSED: '+pass+'   FAILED: '+fail);
process.exit(fail?1:0);
