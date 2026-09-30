/**
 * Shared shape of a curriculum course. The course lists themselves live in the
 * per-path content files (src/content/math.ts, src/content/cs.ts).
 */
export interface PSet {
  name: string;
  url: string;
}
export interface Course {
  code: string;
  school: 'Princeton' | 'MIT' | 'Yale' | 'Harvard' | 'Stanford';
  name: string;
  track: 'Algorithms' | 'Theory' | 'Math' | 'Systems';
  topics: string;
  text: string;
  url: string;
  psets: PSet[];
  targetWeek: number;
  /**
   * A2: a high-priority CURRENT course, featured near the top of surface #4.
   * Additive/optional; unset on ordinary courses leaves their behavior unchanged.
   */
  featured?: boolean;
}
