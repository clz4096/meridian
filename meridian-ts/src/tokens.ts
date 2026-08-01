/**
 * Canonical Meridian design tokens — the single JS source of truth, mirrored by the
 * `:root` custom properties in index.html. The graph/landing consume colours through
 * here (or `readToken`, which reads the live CSS value), so no hex is hardcoded in the
 * component itself. The rest of the app migrates onto these incrementally
 * (see docs/token-migration-plan.md).
 */

export const TOKENS = {
  void: '#070B14', // deep ink field (blue-black, not pure black)
  core: '#BFE9FF', // cool cyan-white node cores / primary accent
  hub: '#F2B25C', // warm amber — the lone accent, used with restraint
  edge: 'rgba(120,170,220,0.18)', // faint cool web
  ring: 'rgba(150,200,255,0.28)', // the meridian ring (signature)
  text: '#DCE6F2', // primary text
  muted: '#8FA3BE', // secondary text
  faint: '#5C7291', // hints / disabled
} as const;

/**
 * Solid hue of `--edge` / `--ring` (their rgb, alpha dropped) for Three line materials,
 * which carry `opacity` separately from `color`.
 */
export const EDGE_SOLID = '#78AADC';
export const RING_SOLID = '#96C8FF';

/** Read a live CSS custom property (so `:root` can override at launch); falls back to `fallback`. */
export function readToken(name: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
