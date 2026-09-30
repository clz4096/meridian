import { describe, expect, it } from 'vitest';
import { localEpochDay } from '@/core/util';
import { PAPERS, paperByline, paperOfWeek } from './papers';

// Pin New York so the UTC-vs-local difference is real. Each test file runs in its own
// forked process, and every Date below is built after this line.
process.env.TZ = 'America/New_York';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('paperOfWeek turns over at local midnight', () => {
  it('keeps Wednesday night 23:30 in the same week as Wednesday noon', () => {
    // Sep 30 2026 is a Wednesday; 23:30 EDT is already Thursday in UTC, where the old
    // UTC week boundary fell.
    expect(paperOfWeek(at(2026, 9, 30, 23, 30))).toBe(paperOfWeek(at(2026, 9, 30, 12)));
    expect(paperOfWeek(at(2026, 9, 30, 23, 30))).toBe(paperOfWeek(at(2026, 9, 24, 0, 30)));
  });

  it('moves to the next paper at 00:30 local on Thursday', () => {
    const thu = at(2026, 10, 1, 0, 30);
    expect(paperOfWeek(thu)).not.toBe(paperOfWeek(at(2026, 9, 30, 23, 30)));
    const week = Math.floor(localEpochDay(thu) / 7);
    expect(paperOfWeek(thu)).toBe(PAPERS[week % PAPERS.length]);
  });
});

describe('paperByline (TR-10)', () => {
  it('shows the year once when the authors field already carries it', () => {
    const karp = PAPERS.find((p) => p.authors.startsWith('Karp'))!;
    expect(paperByline(karp)).toBe('Karp · 1972');
  });

  it('never repeats the year for any paper in the catalogue', () => {
    for (const p of PAPERS) {
      const hits = paperByline(p).split(String(p.year)).length - 1;
      expect(hits).toBe(1);
    }
  });

  it('keeps a parenthetical that is not the same year', () => {
    const p = { ...PAPERS[0], authors: 'Someone (1999)', year: 2001 };
    expect(paperByline(p)).toBe('Someone (1999) · 2001');
  });
});
