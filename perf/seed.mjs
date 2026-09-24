/**
 * Synthetic "one year of heavy use" state for the perf harness. Deterministic
 * (seeded PRNG) so runs compare; entirely made up, never the owner's data.
 * Returns { localStorageKey: jsonString } in the exact shape appState loads.
 */
import { readFileSync } from 'node:fs';

// mulberry32: tiny deterministic PRNG, so every run seeds identical bytes.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

export function makeSeed({ days = 365, now = Date.now(), root = '.' } = {}) {
  const r = rng(42);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const dates = Array.from({ length: days }, (_, i) => iso(now - (days - 1 - i) * DAY_MS));

  // Workout: the shipped template's lifts, ~4 sessions a week, slow progression.
  const tpl = JSON.parse(readFileSync(`${root}/src/core/data/defaultWorkout.json`, 'utf8'));
  const tplDays = Object.values(tpl.days);
  const overload = { v: 1, settings: tpl.settings, days: {}, bw: {}, rpe: {}, done: {}, sessionDone: {}, incr: {} };
  dates.forEach((d, i) => {
    overload.bw[d] = +(120 + i * 0.05 + r()).toFixed(1);
    if (r() > 4 / 7) return;
    const bump = Math.floor(i / 28) * 5; // +5 lb per four weeks
    overload.days[d] = tplDays[i % tplDays.length].map((s, j) => ({
      ...s,
      id: now - (days - i) * DAY_MS + j,
      weight: typeof s.weight === 'number' && s.type !== 'warm' ? s.weight + bump : s.weight,
    }));
    overload.rpe[d] = 6 + Math.floor(r() * 4);
    overload.sessionDone[d] = true;
  });

  // Meals: 3 to 6 a day, every day.
  const FOODS = ['Oats', 'Eggs', 'Chicken rice', 'Greek yogurt', 'Salmon', 'Pasta', 'Protein shake', 'Burrito', 'Toast', 'Stir fry'];
  const surplus = { settings: { maintenance: 2200, surplus: 500, proteinTarget: 147 }, days: {}, tad: {} };
  dates.forEach((d, i) => {
    const n = 3 + Math.floor(r() * 4);
    surplus.days[d] = Array.from({ length: n }, (_, j) => ({
      id: `m${i}_${j}`, name: pick(FOODS), cal: 250 + Math.floor(r() * 600), protein: 10 + Math.floor(r() * 45),
    }));
  });

  // Knowledge: every real bank card reviewed repeatedly; ~25 reviews a day.
  const index = JSON.parse(readFileSync(`${root}/public/questions/index.json`, 'utf8'));
  const qids = Object.values(index.topics).flatMap((t) =>
    JSON.parse(readFileSync(`${root}/public/${t.file}`, 'utf8')).map((q) => q.id));
  const csgraph = { mastery: {}, srs: {}, log: [], gymDone: {} };
  dates.forEach((d, i) => {
    for (let k = 0; k < 25; k++) {
      const qid = pick(qids);
      const rating = 1 + Math.floor(r() * 5);
      csgraph.log.push({ id: `l${i}_${k}`, qid, at: now - (days - i) * DAY_MS + k * 60_000, rating });
      csgraph.mastery[qid] = rating;
      csgraph.srs[qid] = {
        due: iso(now + Math.floor(r() * 30) * DAY_MS), stability: +(1 + r() * 60).toFixed(2),
        difficulty: +(1 + r() * 9).toFixed(2), reps: 1 + Math.floor(r() * 10), lapses: Math.floor(r() * 3),
        state: 2, lastReview: d,
      };
    }
  });

  // Core: todos and scratch cards at a realistic size.
  const core = {
    schedule: {}, entries: [],
    todos: Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`, text: `Synthetic todo ${i}`, done: i % 3 === 0, created: now - i * DAY_MS,
      ...(i % 4 === 0 ? { due: iso(now + (i % 7) * DAY_MS) } : {}),
    })),
    scratch: Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`, title: `Idea ${i}`, body: 'Lorem ipsum dolor sit amet. '.repeat(8),
      status: pick(['idea', 'trying', 'shipped', 'parked']), created: now - i * DAY_MS, updated: now - i * DAY_MS,
    })),
  };

  // Tracker: XP banked on most days.
  const theorist = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false, events: {} } };
  dates.forEach((d) => { if (r() < 0.8) theorist.banked[d] = 40 + Math.floor(r() * 120); });

  const stores = {
    'meridian-core': core,
    'overload-tracker-state': overload,
    'surplus-tracker-state': surplus,
    csgraph_profile_v2: csgraph,
    'meridian-theorist': theorist,
  };
  const out = {};
  for (const [k, v] of Object.entries(stores)) {
    out[k] = JSON.stringify(v);
    out[`${k}__v`] = String(now);
  }
  out['meridian.theorist.migrated'] = '1'; // skip the one-shot legacy migration
  out['meridian.mastery.migrated'] = '1';
  return out;
}
