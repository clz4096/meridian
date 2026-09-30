// @vitest-environment jsdom
/**
 * Cambridge XP: the new EVENT_WEIGHTS, and the one-time guard that stops the
 * same item or question paying again on a later day (creditEvent alone is
 * idempotent only within a day).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { appState } from '@/app/bootstrap';
import type { TheoristState } from '@/core/types';
import { dayXP, EVENT_WEIGHTS, syncTrackerFromStore, trackerState } from '@/features/studytracker/trackerStore';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import {
  awardColdAttempt, awardGate, awardRedo, awardStepSelfMark, awardSupervision, awardWriteup, camEventId,
} from '@/features/cambridge/xp';
import { sunset } from '@/features/cambridge/schedule';

const HOUR = 3_600_000;
const ny = (iso: string, offset: number): number => Date.parse(iso + 'Z') - offset * HOUR;

function setDay(date: string): void {
  const t: TheoristState = { banked: {}, day: { date, blocks: {}, scores: {}, banked: false, events: {} } };
  appState.set('theorist', t as unknown as Record<string, unknown>);
  syncTrackerFromStore();
}
function setCam(items: Record<string, Partial<CamItem>>, extra: Partial<CambridgeState> = {}): void {
  const full: Record<string, CamItem> = {};
  for (const [id, it] of Object.entries(items)) full[id] = { id, stage: 'attempting', questions: {}, updatedAt: 1, ...it };
  appState.set('cambridge', { ...emptyCambridge(), items: full, ...extra } as never);
}
const cam = (): CambridgeState => appState.get('cambridge') as unknown as CambridgeState;
const events = (): Record<string, number> => trackerState.value.day.events ?? {};

beforeEach(() => {
  localStorage.clear();
  setDay('2026-09-29');
  setCam({});
});

describe('Cambridge EVENT_WEIGHTS', () => {
  it('match the contract, and the existing weights are unchanged', () => {
    expect(EVENT_WEIGHTS).toMatchObject({
      coldAttempt: 20, writeup: 15, supervision: 25, redo: 15, stepSelfMark: 10, gatePassed: 200,
      retrieval: 50, paperReproduce: 30, topicReview: 25, algoStudied: 20, journalSave: 10,
    });
  });
});

describe('one-time guards across days', () => {
  it('the same item and question pays once, even on a different day', () => {
    setCam({ 'step-1': { questions: { 3: { q: '3', coldSec: 3600 } } } });
    expect(awardColdAttempt('step-1', '3', 1_000)).toBe(true);
    const id = camEventId('coldAttempt', 'step-1', '3');
    expect(id).toBe('cam:coldAttempt:step-1:3');
    expect(events()[id]).toBe(20);
    expect(dayXP(trackerState.value.day)).toBe(20);
    expect(cam().awarded[id]).toBe(1_000);

    // Same day, again: nothing more.
    expect(awardColdAttempt('step-1', '3', 2_000)).toBe(false);
    // Next day: day.events has rolled over, but the guard persists.
    setDay('2026-09-30');
    expect(awardColdAttempt('step-1', '3', 90_000_000)).toBe(false);
    expect(events()[id]).toBeUndefined();
    expect(dayXP(trackerState.value.day)).toBe(0);
    expect(cam().awarded[id]).toBe(1_000);
  });

  it('a different question of the same item pays separately', () => {
    setCam({ 'step-1': { questions: { 1: { q: '1', coldSec: 3600 }, 2: { q: '2', coldSec: 3700 } } } });
    expect(awardColdAttempt('step-1', '1')).toBe(true);
    expect(awardColdAttempt('step-1', '2')).toBe(true);
    expect(dayXP(trackerState.value.day)).toBe(40);
  });

  it('a gate pays 200 once', () => {
    setCam({}, { gates: { A: { phase: 'A', passedAt: 5, evidence: {}, updatedAt: 5 } } });
    expect(awardGate('A')).toBe(true);
    expect(events()['cam:gatePassed:A']).toBe(200);
    setDay('2026-10-01');
    expect(awardGate('A')).toBe(false);
    expect(dayXP(trackerState.value.day)).toBe(0);
    expect(awardGate('B')).toBe(false); // not passed
  });
});

describe('each award checks its record', () => {
  it('cold attempt: 60 minutes, counting a running timer', () => {
    setCam({ x: { questions: { 1: { q: '1', coldSec: 3599 }, 2: { q: '2', coldSec: 3000, runningSince: 0 } } } });
    expect(awardColdAttempt('x', '1', 10 * 60_000)).toBe(false);
    expect(awardColdAttempt('x', '2', 10 * 60_000)).toBe(true); // 50 banked + 10 running
    expect(awardColdAttempt('nope', '1')).toBe(false);
  });

  it('write-up needs text; supervision needs a held supervision', () => {
    setCam({ x: { writeup: '   ' }, y: { writeup: 'Proof. ...' }, s: { supervisedAt: 5 } });
    expect(awardWriteup('x')).toBe(false);
    expect(awardWriteup('y')).toBe(true);
    expect(events()['cam:writeup:y']).toBe(15);
    expect(awardSupervision('x')).toBe(false);
    expect(awardSupervision('s')).toBe(true);
    expect(events()['cam:supervision:s']).toBe(25);
  });

  it('STEP self-mark pays at 14/20 or more', () => {
    setCam({ x: { questions: { 1: { q: '1', coldSec: 0, mark: 13 }, 2: { q: '2', coldSec: 0, mark: 14 } } } });
    expect(awardStepSelfMark('x', '1')).toBe(false);
    expect(awardStepSelfMark('x', '2')).toBe(true);
    expect(events()['cam:stepSelfMark:x:2']).toBe(10);
  });

  it('a deleted item never pays', () => {
    setCam({ x: { writeup: 'w', deleted: true } });
    expect(awardWriteup('x')).toBe(false);
  });
});

describe('redo pays only within 48 hours of the supervision', () => {
  const mon = ny('2026-09-28T18:00:00', -4); // Monday 6 PM

  it('within 48 h pays; later does not', () => {
    setCam({
      onTime: { supervisedAt: mon, redoneAt: mon + 47 * HOUR },
      edge: { supervisedAt: mon, redoneAt: mon + 48 * HOUR },
      late: { supervisedAt: mon, redoneAt: mon + 49 * HOUR },
      notYet: { supervisedAt: mon },
    });
    expect(awardRedo('onTime')).toBe(true);
    expect(awardRedo('edge')).toBe(true);
    expect(awardRedo('late')).toBe(false);
    expect(awardRedo('notYet')).toBe(false);
    expect(events()['cam:redo:onTime']).toBe(15);
  });

  it('when the 48 h lands in the Sabbath, a redo by Saturday sunset + 1 h still pays', () => {
    const wed = ny('2026-09-30T22:00:00', -4); // due Fri 10 PM: inside the Sabbath
    const shifted = sunset('2026-10-03').getTime() + HOUR;
    setCam({ ok: { supervisedAt: wed, redoneAt: shifted }, late: { supervisedAt: wed, redoneAt: shifted + 60_000 } });
    expect(awardRedo('ok')).toBe(true);
    expect(awardRedo('late')).toBe(false);
  });
});
