import { describe, it, expect, beforeEach } from 'vitest';
import { record, count, error, span, summarize, snapshot, resetTelemetry, telemetryJSON } from '@/core/telemetry';

// Node env: no localStorage, so save() fails soft and the module runs in memory.
beforeEach(() => resetTelemetry());

describe('telemetry ring', () => {
  it('keeps only the newest 50 samples per metric', () => {
    for (let i = 1; i <= 60; i++) record('m', i);
    const s = snapshot().metrics.m!;
    expect(s.n).toBe(50);
    expect(s.last).toBe(60);
    expect(s.p50).toBe(36); // samples 11..60
  });

  it('ignores non-finite values', () => {
    record('m', NaN);
    record('m', Infinity);
    expect(snapshot().metrics.m).toBeUndefined();
  });

  it('counts events and stamps the latest time', () => {
    count('sync:save:synced');
    count('sync:save:synced', 2);
    const snap = snapshot();
    expect(snap.counts['sync:save:synced']).toBe(3);
    expect(snap.last['sync:save:synced']).toBeGreaterThan(0);
  });

  it('caps the error list at 20, truncates messages, and counts by source', () => {
    for (let i = 0; i < 25; i++) error('window', 'x'.repeat(500));
    const snap = snapshot();
    expect(snap.errors).toHaveLength(20);
    expect(snap.errors[0]!.message).toHaveLength(200);
    expect(snap.counts['error:window']).toBe(25);
  });

  it('span records elapsed time', () => {
    const end = span('t');
    const ms = end();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(snapshot().metrics.t!.n).toBe(1);
  });

  it('reset clears everything', () => {
    record('m', 1);
    count('c');
    error('e', 'boom');
    resetTelemetry();
    const snap = snapshot();
    expect(snap.metrics).toEqual({});
    expect(snap.counts).toEqual({});
    expect(snap.errors).toEqual([]);
    expect(JSON.parse(telemetryJSON()).v).toBe(1);
  });
});

describe('summarize', () => {
  it('returns null for no data', () => {
    expect(summarize(undefined)).toBeNull();
    expect(summarize([])).toBeNull();
  });

  it('computes nearest-rank p50/p95 and keeps insertion-order last', () => {
    const xs = Array.from({ length: 20 }, (_, i) => 20 - i); // 20..1
    expect(summarize(xs)).toEqual({ n: 20, p50: 11, p95: 20, last: 1 });
  });
});
