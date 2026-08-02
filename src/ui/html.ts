/**
 * Pure HTML string helpers shared across the view renderers.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** Escape text for interpolation into markup. User data (names, notes) is untrusted. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Stable DOM-safe id derived from an exercise name. */
export function domId(exercise: string): string {
  return exercise.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
