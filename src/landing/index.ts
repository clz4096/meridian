/**
 * Lazy landing chunk entry — bundled to ESM (with Three) as meridian-landing.js and
 * dynamically imported at boot, so Three never blocks app install/boot. The service
 * worker precaches the emitted file for offline launches.
 */
export { mountLanding } from '@/landing/landing';
export type { GraphConfig, GraphHandle, GraphColors } from '@/landing/graph';
