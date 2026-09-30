/**
 * Drift guard for public/questions/index.json. Today's Knowledge tile computes
 * mastery % from the index's ids alone, so they must match the topic files exactly;
 * otherwise the home number and the Knowledge tab disagree. Fix a failure by running
 * `node scripts/question-index.mjs`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC = resolve(__dirname, '../../../public');
const index = JSON.parse(readFileSync(join(PUBLIC, 'questions/index.json'), 'utf8')) as {
  topics: Record<string, { file: string; count: number; ids: string[] }>;
};

describe('questions/index.json matches the topic files', () => {
  for (const [topic, entry] of Object.entries(index.topics)) {
    it(`${topic}: ids and count match ${entry.file}`, () => {
      const items = JSON.parse(readFileSync(join(PUBLIC, entry.file), 'utf8')) as Array<{ id: unknown }>;
      const ids = items.map((q) => String(q.id));
      expect(entry.ids).toEqual(ids);
      expect(entry.count).toBe(ids.length);
    });
  }

  it('lists every topic file in questions/', () => {
    const files = readdirSync(join(PUBLIC, 'questions')).filter((f) => f.endsWith('.json') && f !== 'index.json');
    const listed = Object.values(index.topics).map((e) => e.file.replace(/^questions\//, ''));
    expect(listed.sort()).toEqual(files.sort());
  });
});
