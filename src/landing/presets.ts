/**
 * Graph presets. Colours are sourced from the design tokens (src/tokens.ts / the live
 * `:root` values) so nothing is hardcoded here beyond the shape of each preset.
 *
 * - `landing`    — the full, interactive launch graph (~150 nodes, matches the prototype).
 * - `background` — a dimmer, slower, non-interactive variant (fewer nodes, `pointer-events:none`)
 *                  for reuse as a passive site background later.
 */
import type { GraphColors, GraphConfig } from '@/landing/graph';
import { EDGE_SOLID, RING_SOLID, TOKENS, readToken } from '@/ui/tokens';

/** Colours from the live CSS tokens, falling back to the typed constants. */
function colors(): GraphColors {
  return {
    core: readToken('--core', TOKENS.core),
    hub: readToken('--hub', TOKENS.hub),
    void: readToken('--void', TOKENS.void),
    edge: EDGE_SOLID,
    ring: RING_SOLID,
  };
}

export function landingPreset(): GraphConfig {
  return {
    nodeCount: 150,
    clusters: 6,
    radius: 60,
    edgeNeighbors: 3,
    bridges: 10,
    fog: 0.006,
    pointSize: 3.2,
    autoRotateSpeed: 0.0016,
    edgeOpacity: 0.16,
    ringOpacity: 0.22,
    interactive: true,
    dim: 1,
    bloom: false,
    colors: colors(),
  };
}

export function backgroundPreset(): GraphConfig {
  return {
    ...landingPreset(),
    nodeCount: 90,
    bridges: 6,
    autoRotateSpeed: 0.0008,
    interactive: false,
    // Behind the app the graph is decoration: one painted frame, no animation loop.
    // Animating it cost about half the app's idle CPU (measured 16-18% -> 8-10% of a
    // core with it removed), which on a phone is battery drain while nothing happens.
    still: true,
    dim: 0.55,
    maxDpr: 1.5,
  };
}
