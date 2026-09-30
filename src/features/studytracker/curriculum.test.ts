import { describe, expect, test } from 'vitest';
import { CURRICULUM, orderCourses } from './curriculum';
import { MATH_COURSES } from '@/content/math';
import { CS_COURSES } from '@/content/cs';
import fixture from './curriculum.fixture.json';

describe('curriculum after the path content split', () => {
  test('the Massey curriculum is unchanged: same courses, fields, and order as before the split', () => {
    expect(JSON.parse(JSON.stringify(CURRICULUM))).toEqual(fixture);
  });
  test('every course lives in exactly one path content file', () => {
    const codes = [...MATH_COURSES, ...CS_COURSES].map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(MATH_COURSES.every((c) => c.track === 'Math')).toBe(true);
    expect(CS_COURSES.every((c) => c.track !== 'Math')).toBe(true);
  });
});

describe('orderCourses', () => {
  const [a, b, c] = MATH_COURSES;
  test('skips a code in the order whose course was deleted', () => {
    const out = orderCourses([b!.code, 'Deleted 101', a!.code], [a!, b!]);
    expect(out).toEqual([b, a]);
    expect(out.every((x) => x !== undefined)).toBe(true);
  });
  test('appends courses missing from the order, in file order', () => {
    expect(orderCourses([c!.code], [a!, b!, c!])).toEqual([c, a, b]);
  });
});
