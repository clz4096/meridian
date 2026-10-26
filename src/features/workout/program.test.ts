import { describe, expect, it } from 'vitest';
import type { WorkoutSet, WorkoutState } from '@/core/types';
import { buildPlan, selectWorkoutView, snapToStack } from './workoutSelectors';
import { benchDay, blocksToSegs, fourMph, fourSegs, fourStage, hrZone, jogStage, maxHr, plannedBlocks, segKcal, totals, trueLevel } from './program';

let n = 0;
const set = (ex: string, type: WorkoutSet['type'], weight: number, reps: number, muscle = 'chest'): WorkoutSet =>
  ({ id: `s${n++}`, ex, type, weight, reps, muscle } as WorkoutSet);

const state = (days: Record<string, WorkoutSet[]>): WorkoutState =>
  ({ settings: {}, days, bw: {}, rpe: {}, done: {}, sessionDone: {} } as unknown as WorkoutState);

describe('full-body program prescriptions', () => {
  it('resets a top set below the range to a weight the true level supports (bench 125 x 3 -> 120 x 5)', () => {
    const W = state({
      '2026-10-11': [set('Bench Press', 'top', 135, 4), set('Bench Press', 'back', 125, 6)],
      '2026-10-12': [set('Bench Press', 'top', 135, 3), set('Bench Press', 'back', 125, 6)],
      '2026-10-15': [set('Bench Press', 'top', 125, 3), set('Bench Press', 'back', 125, 6)],
    });
    const p = buildPlan(W, 'Bench Press', '2026-10-21')!;
    expect(p.day).toBe('A');
    expect(p.top).toEqual({ weight: 120, reps: 5 });
    expect(p.warms.map((w) => w.weight)).toEqual([45, 60, 85, 100]);
    expect(p.backs).toHaveLength(2);
  });

  it('holds the weight and asks for one more rep inside the range', () => {
    const W = state({ '2026-10-21': [set('Bench Press', 'top', 120, 6)] });
    const p = buildPlan(W, 'Bench Press', '2026-10-25')!; // Day B next; check the heavy day after it
    expect(p.day).toBe('B');
    const W2 = state({ '2026-10-21': [set('Bench Press', 'top', 120, 6)], '2026-10-25': [set('Bench Press', 'top', 100, 8)] });
    const a = buildPlan(W2, 'Bench Press', '2026-10-26')!;
    expect(a.day).toBe('A');
    expect(a.top).toEqual({ weight: 120, reps: 7 });
  });

  it('adds one step and restarts at the bottom of the range at the top of it', () => {
    const W = state({ '2026-10-21': [set('Lat Pulldown', 'top', 90, 12, 'back')] });
    const p = buildPlan(W, 'Lat Pulldown', '2026-10-22')!;
    expect(p.bumped).toBe(true);
    expect(p.top.reps).toBe(8);
    expect(p.top.weight).toBeGreaterThan(90);
  });

  it('Day B bench is three straight sets at about 85% of the last heavy top set', () => {
    const W = state({ '2026-10-21': [set('Bench Press', 'top', 120, 5)] });
    const p = buildPlan(W, 'Bench Press', '2026-10-22')!;
    expect(p.day).toBe('B');
    expect(p.top).toEqual({ weight: 100, reps: 8 });
    expect(p.backs).toEqual([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }]);
  });

  it('a missed trip never skips a heavy day: A/B alternate by bench sessions done', () => {
    expect(benchDay([], '2026-10-21')).toBe('A');
    expect(benchDay(['2026-10-21'], '2026-10-29')).toBe('B');
    expect(benchDay(['2026-10-21', '2026-10-22'], '2026-11-02')).toBe('A');
    expect(benchDay(['2026-10-15'], '2026-10-21')).toBe('A'); // pre-program sessions don't count
  });

  it('leaves sessions before the program on the old rules', () => {
    const W = state({ '2026-10-12': [set('Bench Press', 'top', 135, 3)] });
    expect(buildPlan(W, 'Bench Press', '2026-10-15')!.why).toBeUndefined();
  });

  it('cuts about 10% after more than 14 days off a lift', () => {
    const W = state({ '2026-10-21': [set('Leg Press', 'top', 120, 9, 'quads')] });
    const p = buildPlan(W, 'Leg Press', '2026-11-10')!;
    expect(p.top.weight).toBeLessThan(120);
    expect(p.top.reps).toBe(8);
  });
});

describe('Leg Extension stack', () => {
  it('snaps to the 20 lb plates the Hoist has (145, 165, 185)', () => {
    expect(snapToStack('Leg Extension', 170)).toBe(165);
    expect(snapToStack('Leg Extension', 185)).toBe(185);
    expect(snapToStack('Leg Extension', 195)).toBe(205);
  });
  it('runs from 15 to 345: a lone 15 lb start, then 25, 45, ... 345', () => {
    expect(snapToStack('Leg Extension', 10)).toBe(15);
    expect(snapToStack('Leg Extension', 19)).toBe(15);
    expect(snapToStack('Leg Extension', 21)).toBe(25);
    expect(snapToStack('Leg Extension', 400)).toBe(345);
  });
  it('resets 185 x 3 to 165 for the 8 to 14 range', () => {
    const W = state({
      '2026-10-12': [set('Leg Extension', 'top', 185, 3, 'quads'), set('Leg Extension', 'back', 170, 6, 'quads')],
      '2026-10-15': [set('Leg Extension', 'top', 185, 3, 'quads'), set('Leg Extension', 'back', 165, 10, 'quads')],
    });
    expect(buildPlan(W, 'Leg Extension', '2026-10-21')!.top).toEqual({ weight: 165, reps: 8 });
  });
});

describe('Leg Press stack', () => {
  it('is 10 lb, then 20, 40, 60 ...', () => {
    expect(snapToStack('Leg Press', 12)).toBe(10);
    expect(snapToStack('Leg Press', 16)).toBe(20);
    expect(snapToStack('Leg Press', 105)).toBe(100);
    expect(snapToStack('Leg Press', 112)).toBe(120);
  });
});

describe('treadmill', () => {
  it('derives minutes and miles from segments', () => {
    const t = totals([{ kind: 'walk', mins: 5, mph: 2.5, incline: 4 }, { kind: 'walk', mins: 10, mph: 3.5, incline: 6 }], 120);
    expect(t.mins).toBe(15);
    expect(t.miles).toBeCloseTo(0.79, 2);
    expect(t.kcal).toBeGreaterThan(70);
    expect(t.kcal).toBeLessThan(95);
  });
  it('counts jogs with one fewer walk break between them', () => {
    expect(totals(blocksToSegs(plannedBlocks('A', 0)), 120).mins).toBe(5 + 6 * 1 + 5 * 1);
  });
  it("logs the owner's 10-21 session at about 17.5 min, not 31", () => {
    const b = { ...plannedBlocks('A', 0), inclineWalk: { mins: 1.5, mph: 3.5, incline: 6 } };
    const t = totals(blocksToSegs(b), 120);
    expect(t.mins).toBe(17.5);
    expect(t.miles).toBeCloseTo(1.04, 2);
  });
  it('Day B is the warm-up plus a 10 min incline walk, no jogs', () => {
    expect(blocksToSegs(plannedBlocks('B', 0)).map((g) => g.mins)).toEqual([5, 10]);
  });
  it('skips a block set to 0 minutes', () => {
    const b = { ...plannedBlocks('A', 0), warm: { mins: 0, mph: 2.5, incline: 4 } };
    expect(blocksToSegs(b).some((g) => g.incline === 4)).toBe(false);
  });
  it('jogging burns more than walking at the same speed', () => {
    expect(segKcal({ kind: 'jog', mins: 1, mph: 4.5, incline: 1 }, 120)).toBeGreaterThan(segKcal({ kind: 'walk', mins: 1, mph: 3.5, incline: 1 }, 120));
  });
  it('moves up a jog stage after two sessions', () => {
    expect(jogStage(0)).toBe(0);
    expect(jogStage(2)).toBe(1);
    expect(jogStage(99)).toBe(4);
  });
});

describe('true level', () => {
  it('is the middle of the last three sessions, so one day cannot swing it', () => {
    expect(trueLevel([150, 100, 152, 149])).toBe(149);
    expect(trueLevel([])).toBe(0);
  });
});

describe('past program days', () => {
  it('still list a lift whose only entry was removed, so it can be logged again on that date', () => {
    const W = state({
      '2026-10-19': [set('Treadmill', 'cardio', 0, 0, 'cardio')],
      '2026-10-21': [set('Bench Press', 'top', 120, 5)],
    });
    const v = selectWorkoutView(W, '2026-10-21', '2026-10-22', { split: 'all' });
    expect(v.exercises).toContain('Bench Press');
    expect(v.exercises).toContain('Treadmill');
  });
  it('days before the program still list only what was logged', () => {
    const W = state({
      '2026-10-12': [set('Treadmill', 'cardio', 0, 0, 'cardio')],
      '2026-10-15': [set('Bench Press', 'top', 125, 3)],
    });
    expect(selectWorkoutView(W, '2026-10-15', '2026-10-22', { split: 'all' }).exercises).toEqual(['Bench Press']);
  });
});

describe('bench basis and stack back-offs', () => {
  it('a heavier Day B set in range becomes the Day A basis (125 x 6 -> 125 x 7)', () => {
    const W = state({
      '2026-10-21': [set('Bench Press', 'top', 120, 5), set('Bench Press', 'back', 110, 7)],
      '2026-10-25': [set('Bench Press', 'top', 105, 8), set('Bench Press', 'back', 125, 6), set('Bench Press', 'back', 105, 8)],
    });
    const p = buildPlan(W, 'Bench Press', '2026-10-26')!;
    expect(p.day).toBe('A');
    expect(p.top).toEqual({ weight: 125, reps: 7 });
    expect(p.why).toContain('125 × 6 on 10-25');
  });
  it('a lighter set never becomes the basis', () => {
    const W = state({ '2026-10-21': [set('Bench Press', 'top', 120, 5), set('Bench Press', 'back', 110, 8)] });
    expect(buildPlan(W, 'Bench Press', '2026-10-23')!.day).toBe('B');
    const W2 = state({
      '2026-10-21': [set('Bench Press', 'top', 120, 5), set('Bench Press', 'back', 110, 8)],
      '2026-10-23': [set('Bench Press', 'top', 100, 8)],
    });
    expect(buildPlan(W2, 'Bench Press', '2026-10-25')!.top).toEqual({ weight: 120, reps: 6 });
  });
  it('a Leg Press back-off the stack rounds up to the top weight keeps the top reps', () => {
    const W = state({ '2026-10-25': [set('Leg Press', 'top', 100, 9, 'quads')] });
    const p = buildPlan(W, 'Leg Press', '2026-10-26')!;
    expect(p.top).toEqual({ weight: 100, reps: 10 });
    expect(p.backs).toEqual([{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }]);
  });
});

describe('Norwegian 4x4', () => {
  const tm = (fx: object): WorkoutSet => ({ ...set('Treadmill', 'cardio', 0, 0, 'cardio'), fx } as WorkoutSet);
  it('heart-rate zones at 38: max 187, easy 112-140, hard 159-177', () => {
    expect(maxHr(38)).toBe(187);
    expect(hrZone(38, 0.6, 0.75)).toEqual([112, 140]);
    expect(hrZone(38, 0.85, 0.95)).toEqual([159, 178]);
  });
  it('hard day is about 36 min, easy day about 26', () => {
    expect(totals(fourSegs('hard', 0, 4), 120).mins).toBe(36);
    expect(totals(fourSegs('easy', 0, 3), 120).mins).toBe(26);
  });
  it('stage 1 hard is 8 one-minute jogs; easy at stage 1 is a brisk walk', () => {
    const jogs = fourSegs('hard', 0, 4).filter((g) => g.kind === 'jog');
    expect(jogs).toHaveLength(8);
    expect(jogs.every((g) => g.mins === 1 && g.mph === 4.5)).toBe(true);
    expect(fourSegs('easy', 0, 3).some((g) => g.kind === 'jog')).toBe(false);
  });
  it('a short session logs only the blocks finished', () => {
    expect(totals(fourSegs('hard', 0, 2), 120).mins).toBe(5 + 3 + 4 + 3 + 4 + 3);
  });
  it('moves up after two full hard days; a short one or an easy one does not count', () => {
    const W = state({
      '2026-10-25': [tm({ kind: 'hard', stage: 0, blocks: 4, of: 4 })],
      '2026-10-26': [tm({ kind: 'easy', stage: 0, blocks: 3, of: 3 })],
      '2026-10-28': [tm({ kind: 'hard', stage: 0, blocks: 3, of: 4 })],
    });
    expect(fourStage(W, '2026-10-29')).toBe(0);
    W.days['2026-11-01'] = [tm({ kind: 'hard', stage: 0, blocks: 4, of: 4 })];
    expect(fourStage(W, '2026-11-02')).toBe(1);
  });
  it('speed rises 0.2 mph a stage only after the full 4 minute jog', () => {
    expect(fourMph(0)).toBe(4.5);
    expect(fourMph(3)).toBe(4.5);
    expect(fourMph(5)).toBe(4.9);
  });
});
