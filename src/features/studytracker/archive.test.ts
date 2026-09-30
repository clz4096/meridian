/**
 * The retired Massey study content lives on in data/archive/ (Cambridge Method,
 * Stage 5). Nothing in the app imports these files any more, so this test is the
 * only thing that notices if one is edited or truncated: each archive must hold
 * exactly what the app shipped before the retirement.
 *
 * The curriculum is compared field for field with the fixture that pinned
 * CURRICULUM while it was live. The Math path's daily items and the Princeton
 * theory group had no fixture, so their pre-retirement content is pinned by a
 * SHA-256 of its JSON, taken from the live modules on 2026-09-30 just before
 * they were removed.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import curriculum from '@data/archive/princeton-curriculum.json';
import mathDaily from '@data/archive/math-daily.json';
import theory from '@data/archive/princeton-theory.json';
import fixture from './curriculum.fixture.json';

const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

describe('archived Massey content (no data lost)', () => {
  it('the curriculum archive equals the pre-retirement CURRICULUM fixture', () => {
    expect(curriculum.courses).toEqual(fixture);
    expect(curriculum.courses).toHaveLength(14);
    expect(sha(curriculum.courses)).toBe('9932e2169b2cb8777667347ea77aa0362dcaf8b9128b0655e91d47170cd075b7');
  });

  it('keeps both course lists: 9 math courses and 5 computer science courses', () => {
    const math = curriculum.courses.filter((c) => c.track === 'Math').map((c) => c.code);
    const cs = curriculum.courses.filter((c) => c.track !== 'Math').map((c) => c.code);
    // Same order as MATH_COURSES and CS_COURSES in the retired src/content files.
    expect(math).toEqual([
      'Stanford Stats', 'Yale CS202', 'Harvard STAT 110', 'MIT 6.042J', 'MIT 18.01',
      'MIT 18.02', 'MIT 18.06', 'MIT 6.041SC', 'MIT 18.100A',
    ]);
    expect(cs).toEqual(['COS 226', 'MIT 6.006', 'MIT 6.046J', 'MIT 18.404J', 'COS 522']);
  });

  it("the Math path's 21 daily items are byte-identical to the retired MATH_DAILY", () => {
    expect(mathDaily.items).toHaveLength(21);
    expect(new Set(mathDaily.items.map((i) => i.id)).size).toBe(21);
    expect(sha(mathDaily.items)).toBe('8fd35a4f889c3f8410e77757d34c5b0fdc98b4dee184fe3f65b84127ed75187e');
  });

  it('the Princeton theory group reading is byte-identical to the retired module', () => {
    expect(theory.theory.papers).toHaveLength(6);
    expect(sha(theory.theory)).toBe('3b6cc8a404985a19fe74030d8e9379280dc84620d955735a0423ca64ddf7722a');
  });
});
