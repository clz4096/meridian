/**
 * Synthetic data for the demo preview (see demo.ts). Deterministic and entirely made
 * up: two months of training and meals, a few realistic todos and ideas, and some
 * study progress, so every screen has something to show. Same store shapes as the
 * perf harness seed (perf/seed.mjs), which the store loaders already accept.
 */
import tpl from '@/core/data/defaultWorkout.json';
import { PROGRESS } from '@/features/wgu/roadmapData';

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;
// Local calendar date, matching how the app keys its days.
const iso = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type SetRow = { weight?: unknown; type?: string } & Record<string, unknown>;

export function demoSeed(now: number, days = 60): Record<string, string> {
  const r = rng(7);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const dates = Array.from({ length: days }, (_, i) => iso(now - (days - 1 - i) * DAY_MS));
  const today = dates[dates.length - 1]!;

  const tplDays = Object.values((tpl as { days: Record<string, SetRow[]> }).days);
  const overload = {
    v: 1, settings: (tpl as { settings: unknown }).settings,
    days: {} as Record<string, unknown>, bw: {} as Record<string, number>, rpe: {} as Record<string, number>,
    done: {}, sessionDone: {} as Record<string, boolean>, incr: {},
  };
  dates.forEach((d, i) => {
    overload.bw[d] = +(121 + i * 0.06 + r() * 0.8).toFixed(1);
    if (d === today || r() > 4 / 7) return;
    const bump = Math.floor(i / 21) * 5;
    overload.days[d] = tplDays[i % tplDays.length]!.map((s, j) => ({
      ...s,
      id: now - (days - i) * DAY_MS + j,
      weight: typeof s.weight === 'number' && s.type !== 'warm' ? s.weight + bump : s.weight,
    }));
    overload.rpe[d] = 6 + Math.floor(r() * 4);
    overload.sessionDone[d] = true;
  });

  const FOODS: ReadonlyArray<readonly [string, number, number]> = [
    ['Oats with whey', 520, 38], ['Eggs and toast', 430, 26], ['Chicken rice bowl', 780, 52],
    ['Greek yogurt', 220, 20], ['Salmon and potatoes', 690, 44], ['Pasta bolognese', 820, 41],
    ['Protein shake', 310, 40], ['Burrito', 900, 39], ['Stir fry', 640, 35],
  ];
  const surplus = { settings: { maintenance: 2200, surplus: 500, proteinTarget: 147 }, days: {} as Record<string, unknown>, tad: {} };
  dates.forEach((d, i) => {
    const n = d === today ? 2 : 3 + Math.floor(r() * 3);
    surplus.days[d] = Array.from({ length: n }, (_, j) => {
      const [name, cal, protein] = pick(FOODS);
      return { id: `m${i}_${j}`, name, cal, protein };
    });
  });

  const TODOS = [
    'Book the AWS CLF-C02 exam slot', 'Post D479 peer-reviewer request', 'Finish C955 practice test 2',
    'Reread Keshav, How to Read a Paper', 'Call the landlord about the radiator', 'Renew library card',
    'Draft D424 capstone outline', 'Grocery run: oats, eggs, rice',
  ];
  const core = {
    schedule: {}, entries: [],
    todos: TODOS.map((text, i) => ({
      id: `t${i}`, text, done: i >= 6, created: now - (i + 1) * DAY_MS,
      ...(i < 4 ? { due: iso(now + (i - 1) * DAY_MS) } : {}),
    })),
    scratch: [
      ['Weather-aware workout nudges', 'Skip the outdoor run suggestion when precipitation is over 60%.', 'idea'],
      ['Proof flashcards', 'Turn each reconstructed proof into a spaced-repetition card.', 'trying'],
      ['Commute reading queue', 'Pre-download the paper of the week for the train.', 'shipped'],
    ].map(([title, body, status], i) => ({
      id: `s${i}`, title, body, status, created: now - (i + 2) * DAY_MS, updated: now - (i + 2) * DAY_MS,
    })),
  };

  const theorist = { banked: {} as Record<string, number>, day: { date: '', blocks: {}, scores: {}, banked: false, events: {} } };
  dates.forEach((d) => { if (d !== today && r() < 0.75) theorist.banked[d] = 40 + Math.floor(r() * 120); });

  const stores: Record<string, unknown> = {
    'meridian-core': core,
    'overload-tracker-state': overload,
    'surplus-tracker-state': surplus,
    csgraph_profile_v2: { mastery: {}, srs: {}, log: [], gymDone: {} },
    'meridian-theorist': theorist,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stores)) {
    out[k] = JSON.stringify(v);
    out[`${k}__v`] = String(now);
  }
  out['meridian.theorist.migrated'] = '1';
  out['meridian.mastery.migrated'] = '1';
  // Some study progress: the first two WGU courses done.
  out['meridian.roadmap.v1'] = JSON.stringify(Object.fromEntries(PROGRESS.slice(0, 2).map(([code]) => [code, true])));
  return out;
}
