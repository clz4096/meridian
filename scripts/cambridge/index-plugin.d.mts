/** Types for scripts/cambridge/index-plugin.mjs, so TypeScript callers (tests, vite config) get checked. */
import type { Plugin } from 'vite';
import type { CatalogIndexData, CatTrackData, TrackId } from '../../src/features/cambridge/catalogBuild';

export function generateIndex(root: string): Promise<{ data: CatalogIndexData; tracks: Record<TrackId, CatTrackData>; inputs: string[] }>;
export function cambridgeIndex(): Plugin;
