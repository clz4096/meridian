/** Types for scripts/cambridge/merge.mjs, so TypeScript callers (tests) get checked. */
type JsonObject = Record<string, unknown>;

export interface SeededQuestion {
  id: string;
  label?: string;
  step?: string;
}

export function mergeList<T>(
  oldList: T[] | undefined,
  freshList: T[] | undefined,
  keyOf: (x: T) => unknown,
  mergeOne: (old: T, fresh: T) => T,
  scrapable?: (old: T) => boolean,
): T[];
export function isGenericLabel(label: string | undefined): boolean;
export function blockedReason(url: string): string | null;
export function dropBlocked<T>(tree: T, log?: string[], path?: string): T;
export function contextLabel(link: { text: string; before?: string; href: string }, year?: string): string;
export function pdfQuestions(text: string | null): { refs: string[] } | { count: number } | null;
export function assignmentParts(text: string | null): string[];
export function seedQuestions(item: JsonObject, pdf?: string | null): { questions: SeededQuestion[]; note?: string };
export function seedAllQuestions<T extends { items: JsonObject[] }>(step: T, pdfFor?: (item: JsonObject) => string | null, log?: string[]): T;
export function mergeStep<T extends JsonObject>(existing: T, fresh: JsonObject): T;
export function mergeCourses<T extends JsonObject>(existing: T, fresh: JsonObject): T;
export function mergeCs<T extends JsonObject>(existing: T, fresh: JsonObject): T;
export const TRACK_HOSTS: readonly string[];
export function isTrackUrl(url: string): boolean;
export function trackCourseLinks(course: JsonObject): { kind: string; label: string; url: string; verified?: boolean; reason?: string }[];
export function normalizeStep<T extends JsonObject>(doc: T, log?: string[]): T;
export function normalizeCourses<T extends JsonObject>(doc: T, log?: string[]): T;
export function normalizeCs<T extends JsonObject>(doc: T, log?: string[]): T;
export function diffJson(a: unknown, b: unknown, path?: string, out?: string[]): string[];
