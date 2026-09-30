/**
 * Regenerates public/questions/index.json from the topic files it lists.
 *
 *   node scripts/question-index.mjs
 *
 * Each topic entry gets its `count` and the `ids` of its questions, in file order.
 * Today's Knowledge tile computes mastery % from those ids alone, so the app never
 * downloads the whole bank (about 550 KB) just to paint the home screen. Run this
 * after adding, removing, or renaming a question; src/features/knowledge/questionIndex.test.ts
 * fails until you do.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const INDEX = join(PUBLIC, 'questions', 'index.json');

const index = JSON.parse(readFileSync(INDEX, 'utf8'));
for (const entry of Object.values(index.topics)) {
  const items = JSON.parse(readFileSync(join(PUBLIC, entry.file), 'utf8'));
  entry.count = items.length;
  entry.ids = items.map((q) => String(q.id));
}
writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
console.log(`wrote ${INDEX}: ${Object.keys(index.topics).length} topics`);
