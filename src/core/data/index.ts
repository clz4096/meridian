/**
 * Static, build-time content — the seed JSON is imported and bundled so there is
 * no runtime fetch for it. To add a resource, edit the corresponding .json file;
 * a malformed entry becomes a compile error via resolveJsonModule. Consumers
 * (selectors, actions, components) import `DATA` from here directly.
 */
import defaultWorkout from '@/core/data/defaultWorkout.json';
import books from '@/core/data/books.json';
import gym from '@/core/data/gym.json';
import topics from '@/core/data/topics.json';
import targets from '@/core/data/targets.json';
import exVideo from '@/core/data/exVideo.json';
import exSwap from '@/core/data/exSwap.json';

/** A book in the source registry: title + URL (deep-linked to a PDF page where known). */
export interface BookEntry {
  t: string;
  u: string;
}

export const DATA = {
  defaultWorkout,
  books: books as Record<string, BookEntry>,
  gym,
  topics,
  targets,
  exVideo: exVideo as Record<string, string>,
  /** machine/barbell exercise → the dumbbell alternate to use when away from the gym */
  exSwap: exSwap as Record<string, string>,
};

export type MeridianData = typeof DATA;
