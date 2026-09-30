/**
 * Lazy landing chunk entry: bundled with Three and dynamically imported only when
 * the user plays the intro from the Data tab, so Three never loads at startup.
 */
export { mountLanding, mountBackground, playIntro } from '@/landing/landing';
export type { GraphConfig, GraphHandle, GraphColors } from '@/landing/graph';
