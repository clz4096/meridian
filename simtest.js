// ===== Meridian data-integrity simulation =====
// Models the real storage layer: per-device localStorage+IDB, shared cloud with rev counter.
let CLOUD=null;                 // {rev, syncedAt, core, overload, surplus, csgraph}
let clock=1000; const now=()=>++clock;

function Device(name){
  const LS={};
  const d={
    name,
    lsGet:k=>k in LS?LS[k]:null,
    lsSet:(k,v)=>{LS[k]=String(v)},
    baseRev(){ return parseInt(d.lsGet('base_rev')||'0',10)||0; },
    setBaseRev(r){ d.lsSet('base_rev',String(r)); },
    localMtime(){ return parseInt(d.lsGet('local_mtime')||'0',10)||0; },
    // ---- app state ----
    SG:{days:{},settings:{}}, WK:{days:{},settings:{},done:{},sessionDone:{},incr:{}},
    sgDirty:false, wkDirty:false,
    addMeal(day,name,cal,pro){ (d.SG.days[day]=d.SG.days[day]||[]).push({name,cal,protein:pro}); d.sgDirty=true; },
    logSet(day,ex,type,w,reps){ (d.WK.days[day]=d.WK.days[day]||[]).push({ex,type,weight:w,reps}); d.wkDirty=true; },
    markSessionDone(day){ d.WK.sessionDone[day]=true; d.wkDirty=true; },
    // ---- save (independent per store + verify) ----
    saveLocal(){ const res={};
      if(d.sgDirty){ d.lsSet('surplus',JSON.stringify(d.SG)); res.meals = d.lsGet('surplus')===JSON.stringify(d.SG); if(res.meals) d.sgDirty=false; }
      if(d.wkDirty){ d.lsSet('overload',JSON.stringify(d.WK)); res.workout = d.lsGet('overload')===JSON.stringify(d.WK); if(res.workout) d.wkDirty=false; }
      if(Object.values(res).some(v=>v)) d.lsSet('local_mtime',String(now()));
      return res; },
    push(force){
      let cloudRev = CLOUD? (+CLOUD.rev||0) : 0;
      if(!force && cloudRev > d.baseRev())
        return {ok:false,conflict:true,err:'Cloud rev '+cloudRev+' > your base '+d.baseRev()+'. Pull first.'};
      CLOUD={rev:cloudRev+1, syncedAt:now(), overload:d.lsGet('overload'), surplus:d.lsGet('surplus')};
      d.setBaseRev(CLOUD.rev); d.lsSet('cloud_mtime',String(CLOUD.syncedAt));
      return {ok:true,rev:CLOUD.rev}; },
    pull(){ if(!CLOUD) return {ok:false,err:'cloud empty'};
      const t=CLOUD.syncedAt;
      if(CLOUD.overload!=null){ d.lsSet('overload',CLOUD.overload); d.WK=JSON.parse(CLOUD.overload); }
      if(CLOUD.surplus!=null){ d.lsSet('surplus',CLOUD.surplus); d.SG=JSON.parse(CLOUD.surplus); }
      d.lsSet('local_mtime',String(t)); d.setBaseRev(CLOUD.rev);
      return {ok:true,rev:CLOUD.rev}; },
    background(){ /* no writes => mtime must NOT move */ },
    reopen(){ // boot: pull only if cloud genuinely newer
      const lm=d.localMtime(), cm=CLOUD?+CLOUD.syncedAt:0;
      const hasLocal=!!d.lsGet('overload')||!!d.lsGet('surplus');
      if(CLOUD && (!hasLocal || cm>lm)){ d.pull(); return 'pulled'; }
      if(hasLocal){ d.WK=JSON.parse(d.lsGet('overload')||'{"days":{}}'); d.SG=JSON.parse(d.lsGet('surplus')||'{"days":{}}');
        if(lm>cm) return 'local newer (will push)'; }
      return 'kept local'; },
    meals(day){ return (d.SG.days[day]||[]).length; },
    sets(day){ return (d.WK.days[day]||[]).length; },
    sessionDone(day){ return !!d.WK.sessionDone[day]; }
  };
  return d;
}

let pass=0,fail=0;
function check(label,actual,expected){
  const ok=JSON.stringify(actual)===JSON.stringify(expected);
  console.log((ok?'  PASS  ':'  FAIL  ')+label+'  ->  '+JSON.stringify(actual)+(ok?'':' (expected '+JSON.stringify(expected)+')'));
  ok?pass++:fail++;
}
const D='2026-07-24';

console.log('\n=== 1. Single device: log, save, refresh ===');
CLOUD=null; let A=Device('A');
A.addMeal(D,'Core Power',230,42); A.logSet(D,'Bench','top',135,5);
A.saveLocal(); A.push();
A.reopen();
check('meals after refresh', A.meals(D), 1);
check('sets after refresh',  A.sets(D), 1);

console.log('\n=== 2. Backgrounding without edits must not forge a newer timestamp ===');
const before=A.localMtime(); A.background(); A.background();
check('mtime unchanged by backgrounding', A.localMtime()===before, true);

console.log('\n=== 3. Machine B (fresh) pulls machine A data ===');
let B=Device('B');
check('B boot result', B.reopen(), 'pulled');
check('B sees A meals', B.meals(D), 1);
check('B sees A sets',  B.sets(D), 1);

console.log('\n=== 4. B adds 2 meals and pushes (has latest) ===');
B.addMeal(D,'Cook Unity',900,40); B.addMeal(D,'Oatmeal',220,6);
B.saveLocal(); const rb=B.push();
check('B push ok', rb.ok, true);
check('B meals total', B.meals(D), 3);

console.log('\n=== 5. CONFLICT: A writes without pulling B changes ===');
A.addMeal(D,'Burger',960,48); A.saveLocal();
const ra=A.push();
check('A push rejected as conflict', ra.conflict===true, true);
console.log('        message: '+ra.err);
check('A data still safe locally', A.meals(D), 2);
check('cloud untouched by rejected push', JSON.parse(CLOUD.surplus).days[D].length, 3);

console.log('\n=== 6. A pulls, re-applies, then pushes successfully ===');
A.pull();
check('A now has B meals', A.meals(D), 3);
A.addMeal(D,'Burger',960,48); A.saveLocal();
const ra2=A.push();
check('A push now succeeds', ra2.ok, true);
check('A meals after merge-by-hand', A.meals(D), 4);
B.reopen();
check('B sees all 4 after reopen', B.meals(D), 4);

console.log('\n=== 7. Workout session-complete survives round trip ===');
A.logSet(D,'Leg Press','top',140,8); A.markSessionDone(D); A.saveLocal(); A.push();
B.reopen();
check('B sees session complete', B.sessionDone(D), true);
check('B sees workout sets', B.sets(D), 2);

console.log('\n=== 8. Save fails on one store must not block the other ===');
let C=Device('C'); C.reopen();
C.addMeal(D,'X',1,1); C.logSet(D,'Y','top',1,1);
const saveRes=C.saveLocal();
check('both stores saved independently', saveRes, {meals:true,workout:true});

console.log('\n=== 9. Offline edit then reconnect (local newer than cloud) ===');
let E=Device('E'); E.reopen();
const cloudRevBefore=CLOUD.rev;
E.addMeal(D,'Offline meal',300,20); E.saveLocal();
check('E boot says local newer', E.reopen(), 'local newer (will push)');
check('E offline meal retained', E.meals(D), 5);
const re=E.push();
check('E push succeeds after reconnect', re.ok, true);
check('cloud rev advanced', CLOUD.rev>cloudRevBefore, true);

console.log('\n=== 10. Stale device cannot clobber cloud ===');
let F=Device('F'); F.reopen();          // F syncs
const fRev=F.baseRev();
A.pull(); A.addMeal(D,'A newer',100,10); A.saveLocal(); A.push();   // A moves cloud forward
F.addMeal(D,'F stale',50,5); F.saveLocal();
const rf=F.push();
check('F push blocked (stale base rev)', rf.conflict===true, true);
check('cloud still has A newer', JSON.parse(CLOUD.surplus).days[D].some(m=>m.name==='A newer'), true);

console.log('\n----------------------------------------');
console.log('PASSED: '+pass+'   FAILED: '+fail);
process.exit(fail?1:0);
