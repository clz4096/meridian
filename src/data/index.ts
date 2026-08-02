/**
 * Static, build-time content — imported and inlined by the build so the app
 * stays a single offline HTML file (no runtime fetch, no service-worker cache
 * to invalidate). To add a resource, edit the corresponding .json file; a
 * malformed entry becomes a compile error via resolveJsonModule.
 *
 * Exposed to the (being-strangled) legacy glue as `MeridianCore.data`. When
 * those consumers migrate into typed modules, they import from here directly.
 */
import defaultWorkout from './defaultWorkout.json';
import books from './books.json';
import gym from './gym.json';
import topics from './topics.json';
import targets from './targets.json';
import exVideo from './exVideo.json';

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
};

export type MeridianData = typeof DATA;
