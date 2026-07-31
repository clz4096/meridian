// Parity: pure selectors vs the shipped app, on the real workout dataset.
import * as S from './dist/workoutSelectors.js';
import fs from 'fs';
const WK = JSON.parse(fs.readFileSync('src/data/defaultWorkout.json', 'utf8'));
WK.done ??= {}; WK.sessionDone ??= {}; WK.incr ??= {}; WK.bw ??= {}; WK.rpe ??= {};
const TODAY='2026-07-25';
let pass=0,fail=0;
const t=(l,a,e)=>{const ok=JSON.stringify(a)===JSON.stringify(e);
  console.log((ok?'  PASS  ':'  FAIL  ')+l+(ok?'':'  got '+JSON.stringify(a)+' want '+JSON.stringify(e)));ok?pass++:fail++;};

console.log('\n=== Parity with shipped behaviour ===');
t('exercise count', S.allExercises(WK).length, 14);
t('bench increment inferred', S.inferIncrement(WK,'Bench Press'), 5);
t('leg press is lower', S.exerciseSplit(WK,'Leg Press'), 'lower');
t('treadmill is both', S.exerciseSplit(WK,'Treadmill'), 'both');
t('bench is upper', S.exerciseSplit(WK,'Bench Press'), 'upper');
t('bench rest (compound top)', S.restSeconds(WK,'Bench Press','top'), 180);
t('calf rest (isolation top)', S.restSeconds(WK,'Calf Raise (Machine)','top'), 120);
t('warmup rest always 60', S.restSeconds(WK,'Bench Press','warm'), 60);

const plan=S.buildPlan(WK,'Bench Press',TODAY);
t('bench plan exists', plan!==null, true);
t('bench holds at last weight', plan.top.weight, plan.lastTopWeight);
t('bench has warmups', plan.warms.length>0, true);

console.log('\n=== Date-aware split (matches the deployed fix) ===');
t('Jul22 logged lower', S.suggestSplit(WK,'2026-07-22').due, 'lower');
t('Jul23 logged upper', S.suggestSplit(WK,'2026-07-23').due, 'upper');
t('Jul25 alternates', ['upper','lower'].includes(S.suggestSplit(WK,'2026-07-25').due), true);
t('no history -> upper', S.suggestSplit(WK,'2000-01-01').due, 'upper');

console.log('\n=== Completion derivation ===');
t('past day complete', S.isExerciseComplete(WK,'Leg Press','2026-07-22',TODAY), true);
t('session complete on past day', S.isSessionComplete(WK,'2026-07-22',TODAY), true);
t('empty future day not complete', S.isSessionComplete(WK,'2026-12-01',TODAY), false);

console.log('\n=== BUG FIXES ===');
t('sameId bridges number/string', S.sameId(1783105876112.5422,'1783105876112.5422'), true);
t('strict === would have failed', 1783105876112.5422==='1783105876112.5422', false);
t('toNum rejects garbage', S.toNum('abc',-1), -1);
t('old +x||0 silently zeroed', (+'abc')||0, 0);
t('isUnparseableNumber flags it', S.isUnparseableNumber('abc'), true);
t('toNum handles empty', S.toNum('',7), 7);

const now=Date.now(), day=86400000;
const many={}; for(let i=0;i<1200;i++) many['id'+i]=now-i*1000;
const oldOnes={a:now-40*day, b:now-1*day};
t('age prune drops stale', Object.keys(S.pruneTombstones(oldOnes,now)), ['b']);
t('count cap bounds growth', Object.keys(S.pruneTombstones(many,now)).length, 500);
t('cap keeps newest', S.pruneTombstones(many,now)['id0']!==undefined, true);
t('undefined safe', S.pruneTombstones(undefined,now), {});

console.log('\n=== Tombstones exclude deleted rows everywhere ===');
const first=WK.days['2026-07-22'][0];
const withDel={...WK,_del:{[String(first.id)]:now}};
t('setsOn excludes tombstoned', S.setsOn(withDel,first.ex,'2026-07-22').length,
   S.setsOn(WK,first.ex,'2026-07-22').length-1);
t('weeklyWorkingSets respects tombstones',
   S.weeklyWorkingSets(withDel,'2026-07-23')<=S.weeklyWorkingSets(WK,'2026-07-23'), true);

console.log('\n=== Purity: no DOM, no clock ===');
let src=fs.readFileSync('src/workoutSelectors.ts','utf8');
src=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');   // strip comments
t('no document', /\bdocument\./.test(src), false);
t('no innerHTML', /innerHTML/.test(src), false);
t('no getElementById', /getElementById/.test(src), false);
t('no Date.now()', /Date\.now\(\)/.test(src), false);
t('no window', /\bwindow\./.test(src), false);
t('no localStorage', /localStorage/.test(src), false);

console.log('\n=== Determinism (same input -> same output) ===');
const a=S.selectWorkoutView(WK,TODAY,TODAY), b=S.selectWorkoutView(WK,TODAY,TODAY);
t('view model deterministic', JSON.stringify(a)===JSON.stringify(b), true);
t('input not mutated', JSON.parse(fs.readFileSync('src/data/defaultWorkout.json', 'utf8')).days['2026-07-22'].length, WK.days['2026-07-22'].length);
t('view has plans for every exercise', a.exercises.every(e=>e in a.plans), true);
t('estimate is finite', Number.isFinite(a.estimate.minutes)&&a.estimate.minutes>0, true);
console.log('  view: '+a.exercises.length+' exercises, split='+a.split+', ~'+a.estimate.minutes+'min, '+a.estimate.workingSets+' sets');

console.log('\n----------------------------------------');
console.log('PASSED: '+pass+'   FAILED: '+fail);
process.exit(fail?1:0);
