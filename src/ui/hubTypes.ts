/**
 * Hub — types for the table-of-contents screen shown after Enter. `hubStats()`
 * (in actions) produces `HubStat[]`; `Hub.tsx` renders it.
 */
export type HubKey = 'knowledge' | 'workout' | 'meal' | 'data' | 'todos' | 'scratch';

export interface HubStat {
  key: HubKey;
  label: string;
  desc: string;
  /** The glanceable value, e.g. "72" or "Synced". */
  value: string;
  /** Small unit after the value, e.g. "%" or " kcal". Empty for none. */
  unit: string;
  /** Caption under the value, e.g. "mastery". */
  sub: string;
  /** Accent for the value; '' leaves it in the default ink. */
  tone: 'cyan' | 'kcal' | 'ok' | '';
  /** Show a leading status dot before the value (used by Data · Synced). */
  dot?: boolean;
}
